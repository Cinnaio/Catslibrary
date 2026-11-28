import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { createAgentSession, beginAgentTurn } from './agent-store'
import { applyAgentOutlineChapter, readAgentOutline, saveAgentOutline } from './agent-outline'
import { readChapterPlan, saveChapterPlan } from './agent-chapter-plan'
import { readStoryThreadPlans, changeStoryThreadPlan, applyStoryThreadPlans, validateStoryThreadSnapshot } from './agent-story-threads'
import { getStoryGraph } from './story-graph'
import { executeAgentTool } from './agent-tools'
import { readAgentContinuation, continuePublishedChapter } from './agent-continuation'
import type { AgentSession } from '@shared/ai-agent'

vi.mock('./story-graph', () => ({ getStoryGraph: vi.fn() }))
let t: TestDb
let session: AgentSession
const chapters = [1,2,3].map(i => ({ title: `安排${i}`, goal: `推进${i}`, beats: `步骤${i}` }))
const input = { ...chapters[0]!, characters: '', ending: '', constraints: '', targetWords: 2000 }
const graph = (updatedAt = 1) => ({ novel: { id: 'book', title: '雨夜' }, updatedAt, status: 'ready' as const, archives: [], chapters: [],
  graph: { version: 1 as const, people: [], relationships: [], threads: [{ id: 'clue', title: '铜钥匙', summary: '钥匙尚未使用', people: [],
    kind: 'clue' as const, certainty: 'clue' as const, evidence: [{ kind: 'plot' as const, quote: '主角保管铜钥匙。', chapterIds: ['anchor'] }] }] } })
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations()
  for (const id of ['author','other']) await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,'admin','x','x',1,1)", [id])
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_generations'); await t.db.query('DELETE FROM ai_tasks'); await t.db.query('DELETE FROM novels')
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','雨夜',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('anchor','book','起点','原文',1,1)")
  session = await createAgentSession(t.db, 'author', { novelId: 'book', afterChapterId: 'anchor' })
  vi.mocked(getStoryGraph).mockResolvedValue(graph())
})
afterAll(async () => { await t?.close() })

it('preserves outline identities through reordering and manual plan edits; rejects stale and foreign writes', async () => {
  const saved = (await saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 0, chapters }))!
  expect(new Set(saved.chapters.map(item => item.id)).size).toBe(3)
  const plan = await applyAgentOutlineChapter(t.db, 'author', session.id, { index: 0, expectedOutlineRevision: 1, expectedPlanRevision: 0 })
  const edited = await saveChapterPlan(t.db, 'author', session.id, { ...plan, goal: '先检查钥匙' }, 1)
  expect(edited.sourceOutline).toEqual({ chapterId: saved.chapters[0]!.id, revision: 1 })
  const reordered = (await saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 1, chapters: [...saved.chapters].reverse() }))!
  expect(reordered.chapters.map(item => item.id)).toEqual(saved.chapters.map(item => item.id).reverse())
  await expect(applyAgentOutlineChapter(t.db, 'author', session.id, { index: 0, expectedOutlineRevision: 1, expectedPlanRevision: 2 })).rejects.toMatchObject({ status: 409 })
  await expect(saveAgentOutline(t.db, 'other', session.id, { expectedRevision: 2, chapters })).rejects.toMatchObject({ status: 404 })
  await expect(saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 2, chapters: [{ ...chapters[0], id: 'foreign' }, ...chapters.slice(1)] })).rejects.toMatchObject({ status: 409 })
})

it('derives progress from owned live drafts and actual chapters, and keeps the original plan snapshot', async () => {
  await saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 0, chapters })
  const plan = await applyAgentOutlineChapter(t.db, 'author', session.id, { index: 0, expectedOutlineRevision: 1, expectedPlanRevision: 0 })
  await t.db.query(`INSERT INTO ai_generations(id,novel_id,kind,result,status,params_json,created_by,created_at)
    VALUES('draft','book','write_chapter','实际正文','draft',$1,'author',1)`, [JSON.stringify({ agentChapterPlan: plan, agentSessionId: session.id, draftTitle: '实际标题' })])
  await expect(saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 1, chapters })).rejects.toMatchObject({ status: 409 })
  let outline = (await readAgentOutline(t.db, 'author', session.id))!
  expect(outline.chapters[0]!.progress).toMatchObject({ status: 'draft', changedSinceWriting: false, drafts: [{ id: 'draft', sessionId: session.id }] })
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('published','book','正式章','实际正文',2,1)")
  await t.db.query("UPDATE ai_generations SET status='published',chapter_id='published' WHERE id='draft'")
  outline = (await saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 1, chapters: outline.chapters.map((item, i) => i === 0 ? { ...item, goal: '新的安排' } : item) }))!
  expect(outline.chapters[0]!.progress).toMatchObject({ status: 'published', changedSinceWriting: true })
  const other = await createAgentSession(t.db, 'other', { novelId: 'book' })
  expect(await readAgentOutline(t.db, 'other', other.id)).toBeNull()
  await t.db.query("DELETE FROM chapters WHERE id='published'")
  expect((await readAgentOutline(t.db, 'author', session.id))!.chapters[0]!.progress?.status).toBe('unavailable')
  await t.db.query("UPDATE ai_generations SET deleted_at=1 WHERE id='draft'")
  expect((await readAgentOutline(t.db, 'author', session.id))!.chapters[0]!.progress?.status).toBe('planned')
})

it('offers an outline in a planning-only turn without starting prose and rejects altered duplicate proposals', async () => {
  const turn = await beginAgentTurn(t.db, 'author', session.id, '先安排三章', 'workflow-outline', undefined, '', undefined, undefined, true)
  const args = { chapters: JSON.stringify(chapters), expectedRevision: 0 }
  const api = vi.fn()
  const saved = await executeAgentTool(t.db, session, 'propose_outline', args, 'outline-operation', api, 'author', turn.taskId)
  expect(await executeAgentTool(t.db, session, 'propose_outline', args, 'outline-operation', api, 'author', turn.taskId)).toEqual(saved)
  await expect(executeAgentTool(t.db, session, 'propose_outline', { ...args, chapters: JSON.stringify(chapters.map(item => ({ ...item, goal: 'changed' }))) }, 'outline-operation', api, 'author', turn.taskId)).rejects.toMatchObject({ status: 409 })
  await expect(executeAgentTool(t.db, session, 'generate_draft', { instruction: '写' }, 'illegal-write', api, 'author', turn.taskId)).rejects.toMatchObject({ status: 409 })
  expect(api).not.toHaveBeenCalled()
})

it('takes story evidence only from the current graph and freezes explicitly selected arrangements', async () => {
  const state = await readStoryThreadPlans(t.db, 'author', session.id)
  const body = { threadId: 'clue', sourceRevision: state.sourceRevision, expectedRevision: 0, disposition: 'later', note: '第三章再开锁' }
  const saved = await changeStoryThreadPlan(t.db, 'author', session.id, { ...body, thread: { title: '伪造来源' } })
  expect(saved.plans[0]!.thread.title).toBe('铜钥匙')
  expect(await changeStoryThreadPlan(t.db, 'author', session.id, body)).toEqual(saved)
  await saveChapterPlan(t.db, 'author', session.id, input, 0)
  const plan = await applyStoryThreadPlans(t.db, 'author', session.id, { ids: [saved.plans[0]!.id], revisions: [1], expectedPlanRevision: 1 })
  expect(plan.storyThreads?.[0]).toMatchObject({ disposition: 'later', note: '第三章再开锁' })
  const writing = await beginAgentTurn(t.db, 'author', session.id, '确认写作', 'thread-confirmed', undefined, '', undefined, plan.revision)
  await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [writing.taskId])
  await changeStoryThreadPlan(t.db, 'author', session.id, { id: saved.plans[0]!.id, expectedRevision: 1, disposition: 'resolved', note: '已在第三章使用' })
  expect((await readChapterPlan(t.db, 'author', session.id))?.storyThreads?.[0]?.disposition).toBe('later')
  expect(await beginAgentTurn(t.db, 'author', session.id, '确认写作', 'thread-confirmed', undefined, '', undefined, plan.revision)).toEqual({ taskId: writing.taskId, created: false })
  await expect(beginAgentTurn(t.db, 'author', session.id, '重新写', 'thread-stale-write', undefined, '', undefined, plan.revision)).rejects.toMatchObject({ status: 409 })
  await expect(applyStoryThreadPlans(t.db, 'author', session.id, { ids: [saved.plans[0]!.id], revisions: [2], expectedPlanRevision: 2 })).rejects.toMatchObject({ status: 409 })
  const cleared = await applyStoryThreadPlans(t.db, 'author', session.id, { ids: [], revisions: [], expectedPlanRevision: 2 })
  expect(cleared.storyThreads).toEqual([])
})

it('rejects outdated graph attachments, foreign owners and stale note updates', async () => {
  const state = await readStoryThreadPlans(t.db, 'author', session.id)
  const saved = await changeStoryThreadPlan(t.db, 'author', session.id, { threadId: 'clue', sourceRevision: state.sourceRevision, expectedRevision: 0, disposition: 'advance', note: '' })
  await saveChapterPlan(t.db, 'author', session.id, input, 0)
  vi.mocked(getStoryGraph).mockResolvedValue(graph(2))
  expect((await readStoryThreadPlans(t.db, 'author', session.id)).plans[0]!.stale).toBe(true)
  await expect(applyStoryThreadPlans(t.db, 'author', session.id, { ids: [saved.plans[0]!.id], revisions: [1], expectedPlanRevision: 1 })).rejects.toMatchObject({ status: 409 })
  await expect(changeStoryThreadPlan(t.db, 'other', session.id, { id: saved.plans[0]!.id, expectedRevision: 1, disposition: 'hold', note: '' })).rejects.toMatchObject({ status: 404 })
  await expect(changeStoryThreadPlan(t.db, 'author', session.id, { id: saved.plans[0]!.id, expectedRevision: 0, disposition: 'hold', note: '' })).rejects.toMatchObject({ status: 409 })
})

it('continues from the actual publication with the next uncompleted outline proposal, without generation', async () => {
  const outline = (await saveAgentOutline(t.db, 'author', session.id, { expectedRevision: 0, chapters }))!
  const plan = await applyAgentOutlineChapter(t.db, 'author', session.id, { index: 0, expectedOutlineRevision: 1, expectedPlanRevision: 0 })
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('published','book','正式章','实际正文',2,1)")
  await t.db.query("INSERT INTO ai_generations(id,novel_id,chapter_id,kind,result,status,params_json,created_by,created_at) VALUES('draft','book','published','write_chapter','实际正文','published',$1,'author',1)", [JSON.stringify({ agentChapterPlan: plan, agentSessionId: session.id })])
  await t.db.query(`INSERT INTO ai_agent_actions(id,session_id,kind,title,payload,preview,status,result,created_at,updated_at)
    VALUES('publication',$1,'publish_draft','发布',$2,'{}','completed','{"chapterId":"published"}',1,1)`, [session.id, JSON.stringify({ draftId: 'draft' })])
  const preview = await readAgentContinuation(t.db, 'author', session.id, 'publication')
  const body = { expectedRevision: preview.revision, selectedIds: [], note: '' }
  const next = await continuePublishedChapter(t.db, 'author', session.id, 'publication', body)
  expect(next.afterChapterId).toBe('published')
  expect(await readChapterPlan(t.db, 'author', next.id)).toMatchObject({ title: chapters[1]!.title, sourceOutline: { chapterId: outline.chapters[1]!.id } })
  expect((await continuePublishedChapter(t.db, 'author', session.id, 'publication', body)).id).toBe(next.id)
  expect((await first<{ count: number }>(t.db, 'SELECT count(*)::int AS count FROM ai_tasks'))?.count).toBe(0)
})


it('tracks partial recovery with verified prose and reminders, preserving fields for older clients', async () => {
  const state = await readStoryThreadPlans(t.db, 'author', session.id)
  const saved = await changeStoryThreadPlan(t.db, 'author', session.id, {
    threadId: 'clue', sourceRevision: state.sourceRevision, expectedRevision: 0, disposition: 'partial', note: '身份尚未揭晓',
    targetChapterNumber: 2, targetStage: '揭晓门派', progressRecord: { chapterNumber: 1, quote: '原文', note: '确认钥匙归属' },
  })
  expect(saved).toMatchObject({ trackingAvailable: true, currentChapterNumber: 2 })
  expect(saved.plans[0]).toMatchObject({ disposition: 'partial', targetChapterNumber: 2, targetStage: '揭晓门派', reminder: 'due',
    progress: [{ chapterId: 'anchor', chapterNumber: 1, quote: '原文', note: '确认钥匙归属', kind: 'partial', sourceChanged: false }] })
  await saveChapterPlan(t.db, 'author', session.id, input, 0)
  const plan = await applyStoryThreadPlans(t.db, 'author', session.id, { ids: [saved.plans[0]!.id], revisions: [1], expectedPlanRevision: 1 })
  expect(plan.storyThreads?.[0]?.progress?.[0]?.quote).toBe('原文')
  const updated = await changeStoryThreadPlan(t.db, 'author', session.id, { id: saved.plans[0]!.id, expectedRevision: 1, disposition: 'hold', note: '等到后面' })
  expect(updated.plans[0]).toMatchObject({ targetChapterNumber: 2, targetStage: '揭晓门派', progress: [{ quote: '原文' }] })
  expect(updated.plans[0]!.reminder).toBeUndefined()
  await expect(validateStoryThreadSnapshot(t.db, 'author', session.id, plan)).rejects.toMatchObject({ status: 409 })
  const cleared = await changeStoryThreadPlan(t.db, 'author', session.id, { id: saved.plans[0]!.id, expectedRevision: 2, disposition: 'resolved', note: '', targetChapterNumber: null, targetStage: '' })
  expect(cleared.plans[0]).toMatchObject({ targetChapterNumber: null, targetStage: '', progress: [{ quote: '原文' }] })
  expect(cleared.plans[0]!.reminder).toBeUndefined()
})

it('rejects invalid tracking inputs and rolls back failed quotations without appending duplicate records', async () => {
  const state = await readStoryThreadPlans(t.db, 'author', session.id)
  const body = { threadId: 'clue', sourceRevision: state.sourceRevision, expectedRevision: 0, disposition: 'advance', note: '' }
  for (const invalid of [{ targetChapterNumber: 0 }, { targetChapterNumber: 1.5 }, { targetChapterNumber: '2' }, { targetStage: '字'.repeat(201) },
    { progressRecord: { chapterNumber: 1, quote: '', note: '归属' } }]) {
    await expect(changeStoryThreadPlan(t.db, 'author', session.id, { ...body, ...invalid })).rejects.toMatchObject({ status: 422 })
  }
  await expect(changeStoryThreadPlan(t.db, 'author', session.id, { ...body, progressRecord: { chapterNumber: 1, quote: '并不存在的正文', note: '归属' } })).rejects.toMatchObject({ status: 409 })
  expect((await readStoryThreadPlans(t.db, 'author', session.id)).plans).toHaveLength(0)
  const saved = await changeStoryThreadPlan(t.db, 'author', session.id, body)
  const update = { id: saved.plans[0]!.id, expectedRevision: 1, disposition: 'partial', note: '', progressRecord: { chapterNumber: 1, quote: '原文', note: '第一次推进' } }
  await changeStoryThreadPlan(t.db, 'author', session.id, update)
  await expect(changeStoryThreadPlan(t.db, 'author', session.id, update)).rejects.toMatchObject({ status: 409 })
  expect((await readStoryThreadPlans(t.db, 'author', session.id)).plans[0]!.progress).toHaveLength(1)
})

it('uses directory ordinals at the selected anchor and hides later progress from earlier conversations', async () => {
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('later','book','揭晓','玉佩属于门派。',80,1)")
  const later = await createAgentSession(t.db, 'author', { novelId: 'book', afterChapterId: 'later' })
  const state = await readStoryThreadPlans(t.db, 'author', later.id)
  const saved = await changeStoryThreadPlan(t.db, 'author', later.id, { threadId: 'clue', sourceRevision: state.sourceRevision,
    expectedRevision: 0, disposition: 'partial', note: '', targetChapterNumber: 2,
    progressRecord: { chapterNumber: 2, quote: '玉佩属于门派。', note: '门派已知，主人未知' } })
  expect(saved.currentChapterNumber).toBe(3)
  expect(saved.plans[0]!.reminder).toBe('overdue')
  const earlier = await readStoryThreadPlans(t.db, 'author', session.id)
  expect(earlier.currentChapterNumber).toBe(2)
  expect(earlier.plans[0]).toMatchObject({ progress: [], hiddenProgressCount: 1, reminder: 'due' })
  const update = { id: saved.plans[0]!.id, expectedRevision: 1, disposition: 'partial', note: '' }
  await expect(changeStoryThreadPlan(t.db, 'author', session.id, { ...update, progressRecord: { chapterNumber: 2, quote: '玉佩属于门派。', note: '越界' } })).rejects.toMatchObject({ status: 404 })
  await changeStoryThreadPlan(t.db, 'author', session.id, update)
  expect((await readStoryThreadPlans(t.db, 'author', later.id)).plans[0]!.progress).toHaveLength(1)
  const other = await createAgentSession(t.db, 'other', { novelId: 'book', afterChapterId: 'later' })
  expect((await readStoryThreadPlans(t.db, 'other', other.id)).plans).toHaveLength(0)
  await expect(changeStoryThreadPlan(t.db, 'other', other.id, { ...update, expectedRevision: 2 })).rejects.toMatchObject({ status: 404 })
})

it('flags changed evidence and invalidates selected snapshots without rewriting the saved quotation', async () => {
  const state = await readStoryThreadPlans(t.db, 'author', session.id)
  const saved = await changeStoryThreadPlan(t.db, 'author', session.id, { threadId: 'clue', sourceRevision: state.sourceRevision,
    expectedRevision: 0, disposition: 'partial', note: '', progressRecord: { chapterNumber: 1, quote: '原文', note: '已经推进' } })
  await saveChapterPlan(t.db, 'author', session.id, input, 0)
  const plan = await applyStoryThreadPlans(t.db, 'author', session.id, { ids: [saved.plans[0]!.id], revisions: [1], expectedPlanRevision: 1 })
  await validateStoryThreadSnapshot(t.db, 'author', session.id, (await readChapterPlan(t.db, 'author', session.id))!)
  await t.db.query("UPDATE chapters SET content='修改后的正文' WHERE id='anchor'")
  expect((await readStoryThreadPlans(t.db, 'author', session.id)).plans[0]!.progress?.[0]).toMatchObject({ quote: '原文', sourceChanged: true })
  await expect(validateStoryThreadSnapshot(t.db, 'author', session.id, plan)).rejects.toMatchObject({ status: 409 })
  await t.db.query("DELETE FROM chapters WHERE id='anchor'")
  const deleted = await readStoryThreadPlans(t.db, 'author', session.id)
  expect(deleted.currentChapterNumber).toBeUndefined()
  expect(deleted.plans[0]).toMatchObject({ progress: [], hiddenProgressCount: 1 })
  expect(deleted.plans[0]!.reminder).toBeUndefined()
})


it('rebinds an explicitly reviewed current source without losing the long-running plan or progress', async () => {
  const state = await readStoryThreadPlans(t.db, 'author', session.id)
  const saved = await changeStoryThreadPlan(t.db, 'author', session.id, { threadId: 'clue', sourceRevision: state.sourceRevision,
    expectedRevision: 0, disposition: 'partial', note: '尚待揭晓', targetChapterNumber: 10,
    progressRecord: { chapterNumber: 1, quote: '原文', note: '确认持有人' } })
  vi.mocked(getStoryGraph).mockResolvedValue(graph(2))
  const refreshed = await readStoryThreadPlans(t.db, 'author', session.id)
  expect(refreshed.plans[0]!.stale).toBe(true)
  const update = { id: saved.plans[0]!.id, expectedRevision: 1, disposition: 'partial', note: '尚待揭晓', refreshSource: true, threadId: 'clue' }
  await expect(changeStoryThreadPlan(t.db, 'author', session.id, { ...update, sourceRevision: state.sourceRevision })).rejects.toMatchObject({ status: 409 })
  const next = await changeStoryThreadPlan(t.db, 'author', session.id, { ...update, sourceRevision: refreshed.sourceRevision })
  expect(next.plans).toHaveLength(1)
  expect(next.plans[0]).toMatchObject({ id: saved.plans[0]!.id, revision: 2, targetChapterNumber: 10, stale: false,
    progress: [{ id: saved.plans[0]!.progress![0]!.id, quote: '原文' }] })
  await saveChapterPlan(t.db, 'author', session.id, input, 0)
  const plan = await applyStoryThreadPlans(t.db, 'author', session.id, { ids: [next.plans[0]!.id], revisions: [2], expectedPlanRevision: 1 })
  await validateStoryThreadSnapshot(t.db, 'author', session.id, plan)
})
