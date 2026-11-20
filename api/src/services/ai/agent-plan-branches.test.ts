import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { first } from '../../db/query'
import { createAgentSession, beginAgentTurn, deleteAgentSession } from './agent-store'
import { saveChapterPlan } from './agent-chapter-plan'
import { changePlanBranch, readPlanBranches, removePlanBranch } from './agent-plan-branches'
import { executeAgentTool } from './agent-tools'
import { resolveAgentWritingContext, agentWritingMaterials } from './agent-writing'

let t: TestDb
const input = { title: '雨夜来信', goal: '发现信件被换过', beats: '查验封口\n独自赴约', characters: '主角保持警惕', ending: '第二个地址', constraints: '不揭露身份', targetWords: 2300 }
const alternative = { ...input, goal: '向同伴求助', beats: '与同伴核对信件\n两人共同赴约', ending: '同伴认出笔迹', targetWords: 3000 }
const setup = async () => { const session = await createAgentSession(t.db, 'branch-author', { novelId: 'branch-book' }); await saveChapterPlan(t.db, 'branch-author', session.id, input, 0); return session }
const save = (id: string, name = '独自赴约', revision = 1, operationId = 'save-branch-1') => changePlanBranch(t.db, 'branch-author', id, { name, expectedRevision: revision, operationId })
const select = (id: string, branchId: string, revision: number, operationId = 'select-branch-1') => changePlanBranch(t.db, 'branch-author', id, { expectedRevision: revision, operationId }, branchId)
const finish = (id: string) => t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [id])
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  for (const id of ['branch-author', 'branch-other']) await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,'admin','test','test',1,1)", [id])
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('branch-book','雨夜',1,1)")
})
afterAll(async () => { await t?.close() })

it('captures only the owned saved plan and rejects stale revisions and malformed branch requests', async () => {
  const session = await setup()
  const result = await changePlanBranch(t.db, 'branch-author', session.id, { name: '独自赴约', expectedRevision: 1, operationId: 'branch-save-owned', plan: alternative })
  expect(result.branches).toHaveLength(1)
  expect(result.branches[0]!.plan).toMatchObject(input)
  for (const body of [null, { name: '', expectedRevision: 1, operationId: 'valid-key' }, { name: '长'.repeat(61), expectedRevision: 1, operationId: 'valid-key' }, { name: '路线', expectedRevision: 0, operationId: 'valid-key' }, { name: '路线', expectedRevision: 1, operationId: '' }])
    await expect(changePlanBranch(t.db, 'branch-author', session.id, body)).rejects.toMatchObject({ status: 422 })
  await expect(save(session.id, '另一条', 2, 'stale-branch-save')).rejects.toMatchObject({ status: 409 })
  await expect(readPlanBranches(t.db, 'branch-other', session.id)).rejects.toMatchObject({ status: 404 })
  await expect(changePlanBranch(t.db, 'branch-other', session.id, { name: '私密', expectedRevision: 1, operationId: 'branch-foreign' })).rejects.toMatchObject({ status: 404 })
  await expect(removePlanBranch(t.db, 'branch-other', session.id, result.branches[0]!.id)).rejects.toMatchObject({ status: 404 })
})
it('switches to a fresh revision, preserves the displaced plan and never confirms or starts writing', async () => {
  const session = await setup()
  const a = (await save(session.id)).branches[0]!
  await saveChapterPlan(t.db, 'branch-author', session.id, alternative, 1)
  const switched = await select(session.id, a.id, 2)
  expect(switched.plan).toMatchObject({ ...input, revision: 3, sourceBranch: { id: a.id, name: a.name } })
  expect(switched.branches).toHaveLength(2)
  const b = switched.branches.find(item => item.source === 'switch')!
  expect(b.plan).toMatchObject({ ...alternative, revision: 2 })
  expect((await select(session.id, b.id, 3, 'switch-back-branch')).plan).toMatchObject({ ...alternative, revision: 4 })
  expect((await readPlanBranches(t.db, 'branch-author', session.id)).branches).toHaveLength(2)
  const turn = await beginAgentTurn(t.db, 'branch-author', session.id, '看看这条路线', 'branch-discussion')
  const api = vi.fn()
  await expect(executeAgentTool(t.db, session, 'generate_draft', { instruction: '写吧' }, 'branch-unconfirmed-generate', api, 'branch-author', turn.taskId)).rejects.toMatchObject({ status: 409 })
  expect(api).not.toHaveBeenCalled()
  await finish(turn.taskId)
})
it('replays branch operations without duplicating or rolling back a later edit', async () => {
  const session = await setup()
  const a = (await save(session.id)).branches[0]!
  expect((await save(session.id)).branches).toHaveLength(1)
  await expect(save(session.id, '换一个名字')).rejects.toMatchObject({ status: 409 })
  await saveChapterPlan(t.db, 'branch-author', session.id, alternative, 1)
  await select(session.id, a.id, 2)
  await saveChapterPlan(t.db, 'branch-author', session.id, { ...alternative, constraints: '后来修改' }, 3)
  const replay = await select(session.id, a.id, 2)
  expect(replay.plan).toMatchObject({ revision: 4, constraints: '后来修改' })
  expect(replay.branches).toHaveLength(2)
  await expect(select(session.id, a.id, 4)).rejects.toMatchObject({ status: 409 })
  await expect(select(session.id, a.id, 2, 'new-stale-selection')).rejects.toMatchObject({ status: 409 })
})
it('retains confirmed branch snapshots through edits, branch deletion and delayed selection retries', async () => {
  const session = await setup()
  const a = (await save(session.id)).branches[0]!
  await saveChapterPlan(t.db, 'branch-author', session.id, alternative, 1)
  await select(session.id, a.id, 2)
  const turn = await beginAgentTurn(t.db, 'branch-author', session.id, '确认选定路线', 'branch-confirmed-turn', undefined, '', undefined, 3)
  await finish(turn.taskId)
  await saveChapterPlan(t.db, 'branch-author', session.id, alternative, 3)
  const removed = await removePlanBranch(t.db, 'branch-author', session.id, a.id)
  expect(removed.plan).toMatchObject({ ...alternative, revision: 4 })
  expect((await select(session.id, a.id, 2)).plan).toMatchObject({ ...alternative, revision: 4 })
  await expect(save(session.id)).rejects.toMatchObject({ status: 409 })
  const context = await resolveAgentWritingContext(t.db, { userId: 'branch-author', novelId: session.novelId }, { sessionId: session.id, authorTaskId: turn.taskId })
  expect(context!.chapterPlan).toMatchObject({ ...input, revision: 3, sourceBranch: { id: a.id } })
  expect(agentWritingMaterials(context!).authors.find(block => block.id === 'confirmed-chapter-plan')!.text).toContain('独自赴约')
})
it('isolates branch IDs by session and blocks mutation during an active coordinator turn', async () => {
  const own = await setup()
  const another = await setup()
  const a = (await save(own.id)).branches[0]!
  await expect(select(another.id, a.id, 1)).rejects.toMatchObject({ status: 404 })
  await removePlanBranch(t.db, 'branch-author', another.id, a.id)
  expect((await readPlanBranches(t.db, 'branch-author', own.id)).branches).toHaveLength(1)
  const turn = await beginAgentTurn(t.db, 'branch-author', own.id, '拟定另一条路线', 'branch-active-turn')
  await expect(save(own.id, '新路线', 1, 'branch-save-busy')).rejects.toMatchObject({ status: 409 })
  await expect(select(own.id, a.id, 1)).rejects.toMatchObject({ status: 409 })
  await expect(removePlanBranch(t.db, 'branch-author', own.id, a.id)).rejects.toMatchObject({ status: 409 })
  expect((await readPlanBranches(t.db, 'branch-author', own.id)).branches).toHaveLength(1)
  await finish(turn.taskId)
})
it('enforces capacity atomically and refuses to discard an unsaved route when switching', async () => {
  const session = await setup()
  for (let i = 0; i < 8; i++) await save(session.id, '路线' + i, 1, 'branch-capacity-' + i)
  await expect(save(session.id, '超限', 1, 'branch-capacity-over')).rejects.toMatchObject({ status: 409 })
  await saveChapterPlan(t.db, 'branch-author', session.id, alternative, 1)
  let data = await readPlanBranches(t.db, 'branch-author', session.id)
  const a = data.branches[0]!
  await expect(select(session.id, a.id, 2)).rejects.toMatchObject({ status: 409 })
  data = await readPlanBranches(t.db, 'branch-author', session.id)
  expect(data.plan).toMatchObject({ ...alternative, revision: 2 })
  expect(data.branches).toHaveLength(8)
  await removePlanBranch(t.db, 'branch-author', session.id, data.branches[1]!.id)
  const switched = await select(session.id, a.id, 2)
  expect(switched.branches).toHaveLength(8)
  expect(switched.plan!.revision).toBe(3)
  expect(switched.branches.find(item => item.source === 'switch')!.plan).toMatchObject(alternative)
})
it('deduplicates an identical named snapshot and rejects conflicting names without replacing content', async () => {
  const session = await setup()
  await save(session.id)
  expect((await save(session.id, '独自赴约', 1, 'branch-save-same-name')).branches).toHaveLength(1)
  await saveChapterPlan(t.db, 'branch-author', session.id, alternative, 1)
  await expect(save(session.id, '独自赴约', 2, 'branch-save-conflicting-name')).rejects.toMatchObject({ status: 409 })
  expect((await readPlanBranches(t.db, 'branch-author', session.id)).branches[0]!.plan).toMatchObject(input)
})
it('cascades branch records and receipts when their conversation is deleted', async () => {
  const session = await setup()
  await save(session.id)
  await deleteAgentSession(t.db, 'branch-author', session.id)
  expect(await first(t.db, 'SELECT id FROM ai_agent_plan_branches WHERE session_id=$1', [session.id])).toBeUndefined()
  expect(await first(t.db, 'SELECT request_id FROM ai_agent_plan_branch_operations WHERE session_id=$1', [session.id])).toBeUndefined()
})
