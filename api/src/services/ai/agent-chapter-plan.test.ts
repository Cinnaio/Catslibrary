import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { createAgentSession, beginAgentTurn, readAgentEvents } from './agent-store'
import { parseChapterPlan, readChapterPlan, saveChapterPlan } from './agent-chapter-plan'
import { resolveAgentWritingContext, agentWritingMaterials } from './agent-writing'
import { executeAgentTool, validateAgentCall } from './agent-tools'
import { createAiTask } from './tasks'

let t: TestDb
const input = { title: '雨夜来信', goal: '让主角发现信件被换过', beats: '回家发现信件\n查验封口\n决定独自赴约', characters: '主角保持警惕，不立即和解', ending: '信背面有第二个地址', constraints: '第三人称，不提前揭露送信者', targetWords: 2300 }
const session = () => createAgentSession(t.db, 'plan-author', { novelId: 'plan-book' })
const finish = (id: string) => t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [id])
const params = async (id: string) => JSON.parse((await first<{ params: string }>(t.db, 'SELECT params FROM ai_tasks WHERE id=$1', [id]))!.params)
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  for (const id of ['plan-author', 'plan-other']) await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,'admin','test','test',1,1)", [id])
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('plan-book','雨夜',1,1)")
})
afterAll(async () => { await t?.close() })

it('validates chapter plan fields, sizes and the provider tool contract', () => {
  expect(parseChapterPlan(input)).toEqual(input)
  for (const invalid of [null, [], { ...input, beats: '' }, { ...input, goal: 3 }, { ...input, ending: '字'.repeat(1201) }, { ...input, targetWords: 299 }, { ...input, targetWords: 2300.5 }]) expect(() => parseChapterPlan(invalid)).toThrow()
  expect(validateAgentCall({ id: 'plan-call', type: 'function', function: { name: 'propose_chapter_plan', arguments: JSON.stringify({ ...input, expectedRevision: 0 }) } })).toMatchObject(input)
})
it('isolates plans by owner and session and rejects a stale edit without creating writing tasks', async () => {
  const own = await session()
  const another = await session()
  expect(await readChapterPlan(t.db, 'plan-author', own.id)).toBeNull()
  const saved = await saveChapterPlan(t.db, 'plan-author', own.id, input, 0)
  expect(saved).toMatchObject({ ...input, version: 1, revision: 1 })
  expect(await readChapterPlan(t.db, 'plan-author', another.id)).toBeNull()
  await expect(readChapterPlan(t.db, 'plan-other', own.id)).rejects.toMatchObject({ status: 404 })
  await expect(saveChapterPlan(t.db, 'plan-other', own.id, input, 1)).rejects.toMatchObject({ status: 404 })
  await expect(saveChapterPlan(t.db, 'plan-author', own.id, input, 0)).rejects.toMatchObject({ status: 409 })
  expect((await readAgentEvents(t.db, own.id)).events).toEqual([])
})
it('keeps proposal requests idempotent and blocks generation until a separate author confirmation', async () => {
  const own = await session()
  const turn = await beginAgentTurn(t.db, 'plan-author', own.id, '先规划', 'plan-proposal-turn', undefined, '', undefined, undefined, true)
  const api = vi.fn()
  const args = { ...input, expectedRevision: 0 }
  const result = await executeAgentTool(t.db, own, 'propose_chapter_plan', args, 'plan-proposal-once', api, 'plan-author', turn.taskId)
  expect(await executeAgentTool(t.db, own, 'propose_chapter_plan', args, 'plan-proposal-once', api, 'plan-author', turn.taskId)).toEqual(result)
  await expect(executeAgentTool(t.db, own, 'propose_chapter_plan', { ...args, goal: '替换目标' }, 'plan-proposal-once', api, 'plan-author', turn.taskId)).rejects.toMatchObject({ status: 409 })
  await expect(executeAgentTool(t.db, own, 'generate_draft', { instruction: '擅自开始' }, 'plan-early-generation', api, 'plan-author', turn.taskId)).rejects.toMatchObject({ status: 409 })
  await expect(saveChapterPlan(t.db, 'plan-author', own.id, input, 1)).rejects.toMatchObject({ status: 409 })
  expect(api).not.toHaveBeenCalled()
  expect(await params(turn.taskId)).toMatchObject({ planningOnly: true, chapterPlanProposed: true })
  await finish(turn.taskId)
  await expect(saveChapterPlan(t.db, 'plan-author', own.id, input, 1, { taskId: turn.taskId, operationId: 'late-proposal' })).rejects.toMatchObject({ status: 409 })
})
it('requires the current plan revision, freezes the confirmed copy and replays the original receipt after edits', async () => {
  const own = await session()
  await saveChapterPlan(t.db, 'plan-author', own.id, input, 0)
  await expect(beginAgentTurn(t.db, 'plan-author', own.id, '确认', 'plan-stale-confirm', undefined, '', undefined, 2)).rejects.toMatchObject({ status: 409 })
  const turn = await beginAgentTurn(t.db, 'plan-author', own.id, '确认', 'plan-fixed-confirm', undefined, '', undefined, 1)
  await finish(turn.taskId)
  await saveChapterPlan(t.db, 'plan-author', own.id, { ...input, goal: '修改之后的目标' }, 1)
  expect((await params(turn.taskId)).chapterPlan).toMatchObject({ revision: 1, goal: input.goal })
  expect(await beginAgentTurn(t.db, 'plan-author', own.id, '确认', 'plan-fixed-confirm', undefined, '', undefined, 1)).toEqual({ taskId: turn.taskId, created: false })
  await expect(beginAgentTurn(t.db, 'plan-author', own.id, '确认', 'plan-fixed-confirm', undefined, '', undefined, 2)).rejects.toMatchObject({ status: 409 })
  const context = await resolveAgentWritingContext(t.db, { userId: 'plan-author', novelId: own.novelId }, { sessionId: own.id, authorTaskId: turn.taskId, chapterPlan: { ...input, goal: '注入内容' } })
  expect(context?.chapterPlan).toMatchObject({ revision: 1, goal: input.goal })
  expect(context?.length).toEqual({ kind: 'target', words: input.targetWords })
  expect(agentWritingMaterials(context!).authors.find(block => block.id === 'confirmed-chapter-plan')).toMatchObject({ required: true, source: { field: 'agent_chapter_plan', revision: '1' } })
})
it('passes the confirmed title, beats and length to one stable writing operation', async () => {
  const own = await session()
  await saveChapterPlan(t.db, 'plan-author', own.id, input, 0)
  const unconfirmed = await beginAgentTurn(t.db, 'plan-author', own.id, '继续讨论', 'plan-discuss-only')
  const deniedApi = vi.fn()
  await expect(executeAgentTool(t.db, own, 'generate_draft', { instruction: '开始' }, 'plan-unconfirmed', deniedApi, 'plan-author', unconfirmed.taskId)).rejects.toMatchObject({ status: 409 })
  await finish(unconfirmed.taskId)
  const turn = await beginAgentTurn(t.db, 'plan-author', own.id, '确认计划并写作', 'plan-generate-turn', undefined, '', undefined, 1)
  const draft = await createAiTask(t.db, { userId: 'plan-author', novelId: own.novelId, kind: 'write_chapter' })
  const api = vi.fn().mockResolvedValue({ taskId: draft.id })
  await executeAgentTool(t.db, own, 'generate_draft', { instruction: '按计划写', title: '模型另起标题', outline: '模型另拟提纲', minimumWords: 500 }, 'plan-unstable-operation', api, 'plan-author', turn.taskId)
  expect(api).toHaveBeenCalledWith('/api/ai/writing/chapter', 'POST', expect.objectContaining({ title: input.title, outline: input.beats,
    operationId: turn.taskId + '_chapter_plan_1', chapterCount: 1, agentWriting: expect.objectContaining({ targetWords: input.targetWords, minimumWords: undefined }) }))
  expect(deniedApi).not.toHaveBeenCalled()
  await finish(turn.taskId)
  await finish(draft.id)
})
it('preserves planning-only mode in retries and rejects ambiguous mode combinations', async () => {
  const own = await session()
  const turn = await beginAgentTurn(t.db, 'plan-author', own.id, '拟计划', 'plan-mode-turn', undefined, '', undefined, undefined, true)
  expect(await beginAgentTurn(t.db, 'plan-author', own.id, '拟计划', 'plan-mode-turn', undefined, '', undefined, undefined, true)).toEqual({ taskId: turn.taskId, created: false })
  await expect(beginAgentTurn(t.db, 'plan-author', own.id, '拟计划', 'plan-mode-turn')).rejects.toMatchObject({ status: 409 })
  await expect(beginAgentTurn(t.db, 'plan-author', own.id, '拟计划', 'plan-mode-other', undefined, '', undefined, 1, true)).rejects.toMatchObject({ status: 422 })
  await finish(turn.taskId)
})
