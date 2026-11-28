import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { studioBlank, type StudioCardInput } from '@shared/ai-writing-studio'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { createAgentSession, beginAgentTurn } from './agent-store'
import { changeWritingCard, saveWritingCard, readWritingStudio, readStudioSource, readWritingEdits, assembleWritingScenes, writingCardVersions, studioSnapshot } from './agent-writing-studio'
import { agentTaskParams } from './agent-recovery'
import { getAiTask } from './tasks'
import { getGeneration, saveGeneration, updateGenerationResult } from './generations'
import { readAgentArtifact } from './agent-actions'
import { agentWritingMaterials } from './agent-writing'
import { executeAgentTool } from './agent-tools'
import type { AgentSession } from '@shared/ai-agent'
let t: TestDb, session: AgentSession
const scene = (title = '雨夜', prose = '她推门走进雨中。'): StudioCardInput => ({ ...studioBlank('scene'), title, values: { ...studioBlank('scene').values, goal: '试探对方', prose } })
async function proposal(card: StudioCardInput, replaces?: { id: string; revision: number }) {
  const turn = await beginAgentTurn(t.db, 'author', session.id, '请整理工坊建议', 'message_' + Math.random().toString(36).slice(2))
  const result = await saveWritingCard(t.db, 'author', session.id, { card, replaces }, { taskId: turn.taskId, operationId: turn.taskId + '_card' })
  await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [turn.taskId])
  return result
}
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations()
  for (const id of ['author', 'other']) await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,'admin','x','x',1,1)", [id])
}, 30000)
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_writing_cards'); await t.db.query('DELETE FROM ai_generations'); await t.db.query('DELETE FROM ai_tasks'); await t.db.query('DELETE FROM novels')
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','雨夜',1,1),('second','另一本',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('anchor','book','第一章','她说：别担心，我会回来。',1,1),('future','book','第二章','后来的秘密',2,1)")
  session = await createAgentSession(t.db, 'author', { novelId: 'book', afterChapterId: 'anchor' })
})
afterAll(async () => { await t?.close() })
it('scopes scene/session, book and personal material to the author and rejects forged ranges', async () => {
  const own = await saveWritingCard(t.db, 'author', session.id, { card: scene() })
  const personal = { ...studioBlank('preference'), title: '动作代替总结', scope: 'personal', values: { rule: '用动作呈现关心', appliesTo: '日常对话', exceptions: '' } }
  await saveWritingCard(t.db, 'author', session.id, { card: personal })
  const next = await createAgentSession(t.db, 'author', { novelId: 'book', afterChapterId: 'anchor' })
  const otherBook = await createAgentSession(t.db, 'author', { novelId: 'second' })
  expect((await readWritingStudio(t.db, 'author', next.id)).cards.map(c => c.kind)).toEqual(['preference'])
  expect((await readWritingStudio(t.db, 'author', otherBook.id)).cards.map(c => c.kind)).toEqual(['preference'])
  await expect(readWritingStudio(t.db, 'other', session.id)).rejects.toMatchObject({ status: 404 })
  await expect(changeWritingCard(t.db, 'author', next.id, own.id, { operation: 'archive', expectedRevision: 1 })).rejects.toMatchObject({ status: 404 })
  await expect(saveWritingCard(t.db, 'author', session.id, { card: { ...scene(), scope: 'personal' } })).rejects.toMatchObject({ status: 422 })
})
it('retains immutable versions, enforces optimistic concurrency and protects locked scenes from replacement', async () => {
  const card = await saveWritingCard(t.db, 'author', session.id, { card: scene() })
  const locked = await changeWritingCard(t.db, 'author', session.id, card.id, { operation: 'lock', expectedRevision: 1 })
  await expect(saveWritingCard(t.db, 'author', session.id, { id: card.id, expectedRevision: locked.revision, card: scene('改动') })).rejects.toMatchObject({ status: 409 })
  const turn = await beginAgentTurn(t.db, 'author', session.id, '改动场景', 'request_lock_1')
  await expect(saveWritingCard(t.db, 'author', session.id, { card: scene('新稿'), replaces: { id: card.id, revision: locked.revision } }, { taskId: turn.taskId, operationId: 'locked_proposal' })).rejects.toMatchObject({ status: 409 })
  await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [turn.taskId])
  const unlocked = await changeWritingCard(t.db, 'author', session.id, card.id, { operation: 'unlock', expectedRevision: locked.revision })
  const updated = await saveWritingCard(t.db, 'author', session.id, { id: card.id, expectedRevision: unlocked.revision, card: scene('改动', '新正文') })
  await expect(saveWritingCard(t.db, 'author', session.id, { id: card.id, expectedRevision: unlocked.revision, card: scene() })).rejects.toMatchObject({ status: 409 })
  const restored = await changeWritingCard(t.db, 'author', session.id, card.id, { operation: 'restore', expectedRevision: updated.revision, version: 1 })
  expect(restored.values.prose).toBe(card.values.prose)
  const history = await writingCardVersions(t.db, 'author', session.id, card.id)
  expect(history.versions).toHaveLength(5)
})
it('keeps model output proposed until explicit acceptance and freezes accepted material with the turn', async () => {
  const original = await saveWritingCard(t.db, 'author', session.id, { card: scene() })
  const suggested = await proposal(scene('争执', '她停在门边。'), { id: original.id, revision: original.revision })
  expect(studioSnapshot((await readWritingStudio(t.db, 'author', session.id)).cards).cards.map(c => c.title)).toEqual(['雨夜'])
  const accepted = await changeWritingCard(t.db, 'author', session.id, suggested.id, { operation: 'accept', expectedRevision: suggested.revision })
  expect(accepted.id).toBe(original.id)
  expect(accepted.values.prose).toBe('她停在门边。')
  const turn = await beginAgentTurn(t.db, 'author', session.id, '按工坊写作', 'snapshot_request')
  const snapshot = agentTaskParams(await getAiTask(t.db, turn.taskId)).writingStudio!
  expect(snapshot.cards).toHaveLength(1)
  expect(snapshot.cards[0]?.title).toBe('争执')
  await expect(changeWritingCard(t.db, 'author', session.id, accepted.id, { operation: 'archive', expectedRevision: accepted.revision })).rejects.toMatchObject({ status: 409 })
  const blocks = agentWritingMaterials({ writingStudio: snapshot, sessionId: session.id, sources: [], authorMessages: [], brief: '' })
  expect(blocks.authors.some(block => block.id === 'writing-studio' && block.text.includes('争执'))).toBe(true)
  await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [turn.taskId])
  await saveWritingCard(t.db, 'author', session.id, { id: accepted.id, expectedRevision: accepted.revision, card: scene('后来改动') })
  expect(agentTaskParams(await getAiTask(t.db, turn.taskId)).writingStudio?.cards[0]?.title).toBe('争执')
})
it('validates source quotes, marks changed evidence stale, and excludes later chapters', async () => {
  const source = await readStudioSource(t.db, 'author', session.id, 'chapter', 'anchor')
  const input = { ...studioBlank('voice'), title: '她的口吻', values: { character: '她', diction: '简短直接', rhythm: '', emotion: '', boundaries: '', audience: '' }, evidence: [{ kind: 'chapter' as const, id: source.id, revision: source.revision, quote: '别担心，我会回来。' }] }
  await expect(saveWritingCard(t.db, 'author', session.id, { card: { ...input, evidence: [{ ...input.evidence[0], quote: '编造引文' }] } })).rejects.toMatchObject({ status: 409 })
  await expect(readStudioSource(t.db, 'author', session.id, 'chapter', 'future')).rejects.toMatchObject({ status: 404 })
  const saved = await proposal(input)
  await t.db.query("UPDATE chapters SET content='已改过的对白。' WHERE id='anchor'")
  await expect(changeWritingCard(t.db, 'author', session.id, saved.id, { operation: 'accept', expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
  expect((await readWritingStudio(t.db, 'author', session.id)).cards[0]?.stale).toBe(true)
})
it('requires actual prose evidence for simulated reading and preserves unresolved knowledge and relationship plans', async () => {
  const card = await saveWritingCard(t.db, 'author', session.id, { card: scene() })
  const source = await readStudioSource(t.db, 'author', session.id, 'scene', card.id)
  const reading = await proposal({ ...studioBlank('reading'), title: '危险感停顿', values: { perspective: '关注紧张感', reaction: '开场使人期待', suggestion: '保持动作推进' }, evidence: [{ kind: 'scene', id: card.id, revision: source.revision, quote: '她推门走进雨中。' }] })
  const accepted = await changeWritingCard(t.db, 'author', session.id, reading.id, { operation: 'accept', expectedRevision: 1 })
  expect(accepted.kind).toBe('reading')
  expect(studioSnapshot([accepted]).cards).toHaveLength(0)
  await saveWritingCard(t.db, 'author', session.id, { card: { ...studioBlank('knowledge'), title: '身份之谜', values: { character: '林', information: '真实身份', state: '待定', learnedAt: '', constraint: '第三场再揭示' } } })
  await saveWritingCard(t.db, 'author', session.id, { card: { ...studioBlank('relationship'), title: '建立信任', values: { people: '林、雨', current: '戒备', target: '愿意合作', milestones: '一起避雨\n替她保守秘密', unresolved: '误会尚未解除' } } })
  const state = await readWritingStudio(t.db, 'author', session.id)
  expect(state.cards.find(c => c.kind === 'knowledge')?.values.state).toBe('待定')
  expect(state.cards.find(c => c.kind === 'relationship')?.values.current).toBe('戒备')
})
it('learns only from saved modifications with two independent before/after samples and keeps personal evidence across books', async () => {
  const draft = await saveGeneration(t.db, { novelId: 'book', chapterId: '', kind: 'write_chapter', model: 'test', prompt: '', paramsJson: '{}', result: '她感到很担心。', status: 'draft', createdBy: 'author' })
  await updateGenerationResult(t.db, draft.id, '她攥紧了袖口。', 'author')
  await updateGenerationResult(t.db, draft.id, '她把伞推到他手里。', 'author')
  const edits = await readWritingEdits(t.db, 'author', session.id)
  expect(edits.edits).toHaveLength(2)
  const evidence = edits.edits.map(e => ({ kind: 'edit' as const, id: e.id, revision: e.revision, quote: e.after, beforeQuote: e.before }))
  const input: StudioCardInput = { ...studioBlank('preference'), title: '动作表达关心', scope: 'personal', values: { rule: '通过动作表达关心', appliesTo: '日常相处', exceptions: '明确告白时可直说' }, evidence }
  const turn = await beginAgentTurn(t.db, 'author', session.id, '学习改稿偏好', 'learn_preference')
  await expect(saveWritingCard(t.db, 'author', session.id, { card: { ...input, evidence: evidence.slice(0, 1) } }, { taskId: turn.taskId, operationId: 'one_sample' })).rejects.toMatchObject({ status: 422 })
  const saved = await saveWritingCard(t.db, 'author', session.id, { card: input }, { taskId: turn.taskId, operationId: 'two_samples' })
  const duplicate = await saveWritingCard(t.db, 'author', session.id, { card: input }, { taskId: turn.taskId, operationId: 'two_samples' })
  expect(duplicate.id).toBe(saved.id)
  await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [turn.taskId])
  await changeWritingCard(t.db, 'author', session.id, saved.id, { operation: 'accept', expectedRevision: 1 })
  const next = await createAgentSession(t.db, 'author', { novelId: 'second' })
  expect((await readWritingStudio(t.db, 'author', next.id)).cards[0]?.stale).toBe(false)
  const other = await createAgentSession(t.db, 'other', { novelId: 'book' })
  expect((await readWritingEdits(t.db, 'other', other.id)).edits).toHaveLength(0)
})
it('assembles the selected scene versions verbatim, is idempotent and exposes the draft through existing artifacts', async () => {
  const firstScene = await saveWritingCard(t.db, 'author', session.id, { card: scene('第一场', '第一场正文。') })
  const secondScene = await saveWritingCard(t.db, 'author', session.id, { card: scene('第二场', '第二场正文。') })
  const body = { title: '雨停之前', scenes: [secondScene, firstScene].map(c => ({ id: c.id, revision: c.revision })) }
  const result = await assembleWritingScenes(t.db, 'author', session.id, body)
  expect(await assembleWritingScenes(t.db, 'author', session.id, body)).toEqual(result)
  const draft = await getGeneration(t.db, result.draftId)
  expect(draft?.result).toBe('第二场正文。\n\n第一场正文。')
  expect(draft?.status).toBe('draft')
  const artifact = await readAgentArtifact(t.db, session, result.taskId)
  expect(artifact.drafts[0]?.id).toBe(result.draftId)
  const changed = { title: '另一个章节', scenes: [{ id: firstScene.id, revision: 0 }] }
  await expect(assembleWritingScenes(t.db, 'author', session.id, changed)).rejects.toMatchObject({ status: 422 })
  expect(await first(t.db, 'SELECT COUNT(*)::int AS n FROM ai_generations')).toEqual({ n: 1 })
})
it('exposes real card definitions and persists agent suggestions through tool execution without auto-accepting', async () => {
  const turn = await beginAgentTurn(t.db, 'author', session.id, '规划场景', 'tools_request')
  const api = async () => ({})
  const catalog = await executeAgentTool(t.db, session, 'read_writing_studio', {}, '', api, 'author', turn.taskId)
  expect(catalog.definitions).toHaveProperty('knowledge')
  const result = await executeAgentTool(t.db, session, 'propose_writing_card', { proposal: JSON.stringify({ card: scene() }) }, turn.taskId + '_proposal', api, 'author', turn.taskId)
  expect(result.card).toMatchObject({ status: 'proposed' })
})

it('keeps a scene replacement baseline readable after acceptance and later author edits', async () => {
  const original = await saveWritingCard(t.db, 'author', session.id, { card: scene() })
  const replacement = await proposal({ ...scene('新场景', '她走回房间。'), evidence: [{ kind: 'scene', id: original.id, revision: String(original.revision), quote: original.values.prose! }] }, { id: original.id, revision: original.revision })
  const accepted = await changeWritingCard(t.db, 'author', session.id, replacement.id, { operation: 'accept', expectedRevision: replacement.revision })
  expect((await readWritingStudio(t.db, 'author', session.id)).cards[0]?.stale).toBe(false)
  await saveWritingCard(t.db, 'author', session.id, { id: accepted.id, expectedRevision: accepted.revision, card: { ...accepted, title: '作者修订标题' } })
  expect((await readWritingStudio(t.db, 'author', session.id)).cards[0]?.stale).toBe(false)
})
