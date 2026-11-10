import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { createAgentSession, beginAgentTurn } from './agent-store'
import { updateAiTask } from './tasks'
import { recordUsage } from './usage'
import { readAgentTurnUsage } from './agent-usage'
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  for (const id of ['owner', 'other'])
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,'admin','test','test',1,1)", [id])
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','合成作品',1,1)")
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_agent_sessions')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_usage')
})
afterAll(async () => {
  await t.close()
})
const usage = {
  userId: 'owner',
  model: 'mock',
  provider: 'mock',
  generationType: 'agent_chat',
  promptTokens: 100,
  completionTokens: 20,
  tokenUsageReported: true,
}
async function turn() {
  const session = await createAgentSession(t.db, 'owner', { novelId: 'book' })
  const receipt = await beginAgentTurn(t.db, 'owner', session.id, '讨论情节', 'usage_request')
  return { session, taskId: receipt.taskId }
}
describe('per-turn agent usage', () => {
  it('counts linked chat and summary once, preserves currencies and never adds unrelated generation', async () => {
    const { session, taskId } = await turn()
    const usd = { ...usage, taskId, usageId: 'once', costMillicents: 10000, costReported: true, costCurrency: 'USD' }
    await recordUsage(t.db, usd)
    await recordUsage(t.db, usd)
    await recordUsage(t.db, { ...usage, taskId, generationType: 'agent_summary', costMillicents: 20000, costReported: true, costCurrency: 'CNY' })
    await recordUsage(t.db, { ...usage, taskId, generationType: 'write_chapter', promptTokens: 9000 })
    await recordUsage(t.db, { ...usage, promptTokens: 9000 })
    await recordUsage(t.db, { ...usage, taskId, userId: 'other', promptTokens: 9000 })
    const rows = await readAgentTurnUsage(t.db, 'owner', session)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tracked: true,
      chatCalls: 1,
      summaryCalls: 1,
      inputTokens: 200,
      outputTokens: 40,
      unknownCostCalls: 0,
      unknownTokenCalls: 0,
      costs: [
        { currency: 'CNY', amount: 0.2 },
        { currency: 'USD', amount: 0.1 },
      ],
    })
    expect(await readAgentTurnUsage(t.db, 'other', session)).toEqual([])
  })
  it('distinguishes unknown tokens and costs from reported zero', async () => {
    const { session, taskId } = await turn()
    await recordUsage(t.db, { ...usage, taskId, promptTokens: 0, completionTokens: 0, tokenUsageReported: false })
    await recordUsage(t.db, { ...usage, taskId, promptTokens: 0, completionTokens: 0, costReported: true, costMillicents: 0, costCurrency: 'USD' })
    expect((await readAgentTurnUsage(t.db, 'owner', session))[0]).toMatchObject({
      chatCalls: 2,
      unknownTokenCalls: 1,
      unknownCostCalls: 1,
      costs: [{ currency: 'USD', amount: 0 }],
    })
  })
  it('keeps late cancellation usage visible and freezes finished elapsed time', async () => {
    const { session, taskId } = await turn()
    await t.db.query("UPDATE ai_tasks SET status='cancelled',created_at=1000,finished_at=3500 WHERE id=$1", [taskId])
    await recordUsage(t.db, { ...usage, taskId })
    expect((await readAgentTurnUsage(t.db, 'owner', session, 90000))[0]).toMatchObject({ status: 'cancelled', elapsedMs: 2500, chatCalls: 1 })
  })
  it('does not pretend old or unrecorded turns have a complete zero bill', async () => {
    const { session, taskId } = await turn()
    expect((await readAgentTurnUsage(t.db, 'owner', session))[0]).toMatchObject({ tracked: true, chatCalls: 0, costs: [] })
    await t.db.query("UPDATE ai_tasks SET params=(params::jsonb-'agentUsageVersion')::text WHERE id=$1", [taskId])
    expect((await readAgentTurnUsage(t.db, 'owner', session))[0]?.tracked).toBe(false)
    const otherSession = await createAgentSession(t.db, 'owner', { novelId: 'book' })
    expect(await readAgentTurnUsage(t.db, 'owner', otherSession)).toEqual([])
  })
  it('bounds recent history and orders it newest first', async () => {
    const { session, taskId } = await turn()
    await updateAiTask(t.db, taskId, { status: 'completed' })
    for (let i = 0; i < 9; i++) {
      const next = await beginAgentTurn(t.db, 'owner', session.id, `下一轮 ${i}`, `usage_request_${i}`)
      await updateAiTask(t.db, next.taskId, { status: 'completed' })
    }
    const rows = await readAgentTurnUsage(t.db, 'owner', session)
    expect(rows).toHaveLength(8)
    expect(rows.some((row) => row.taskId === taskId)).toBe(false)
    expect(rows.map((row) => row.startedAt)).toEqual(rows.map((row) => row.startedAt).sort((a, b) => b - a))
  })
})
