import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('./client', async original => ({
  ...await original<typeof import('./client')>(),
  chat: mocks.chat,
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://fixture.example', apiKey: 'test', model: 'fixture' }),
}))
import { createTestDb, type TestDb } from '../../test/db'
import { createAiTask, updateAiTask } from './tasks'
import { generateWriting } from './writing'
import { recordUsage } from './usage'
let t: TestDb
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
beforeEach(() => { vi.clearAllMocks() })
it('上游响应前取消仍记录可确认用量，不接收草稿，任务保持取消', async () => {
  const task = await createAiTask(t.db, { userId: 'test', kind: 'write_outline' })
  mocks.chat.mockImplementationOnce(async () => {
    await updateAiTask(t.db, task.id, { status: 'cancelled' })
    return { text: '大纲正文', model: 'fixture', promptTokens: 30, completionTokens: 20, cost: .0123, costReported: true, upstreamRequestId: 'cancelled-call', costSource: 'response', costCurrency: 'USD' }
  })
  await expect(generateWriting(t.db, { taskId: task.id, userId: 'test', novelId: '', kind: 'write_outline', title: '书', instruction: '生成大纲', context: '', promptPipelineVersion: 1 })).rejects.toThrow('任务已停止')
  const usage = await t.db.query<{ prompt_tokens: number; completion_tokens: number; cost_millicents: number }>("SELECT * FROM ai_usage WHERE upstream_request_id='cancelled-call'")
  expect(usage.rows).toHaveLength(1)
  expect(usage.rows[0]).toMatchObject({ prompt_tokens: 30, completion_tokens: 20 })
  expect(Number(usage.rows[0]?.cost_millicents)).toBe(1230)
  expect((await t.db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM ai_generations WHERE params_json LIKE $1", [`%${task.id}%`])).rows[0]?.count).toBe(0)
  expect((await t.db.query<{ status: string }>('SELECT status FROM ai_tasks WHERE id=$1', [task.id])).rows[0]?.status).toBe('cancelled')
})
it('同一调用事实重复入账保持一条，不合并不同的真实调用', async () => {
  const record = { usageId: 'same-call', userId: 'test', model: 'fixture', provider: 'fixture', promptTokens: 1, completionTokens: 2 }
  await recordUsage(t.db, record)
  await recordUsage(t.db, record)
  await recordUsage(t.db, { ...record, usageId: 'another-call' })
  const rows = await t.db.query("SELECT id FROM ai_usage WHERE id IN ('same-call','another-call')")
  expect(rows.rows).toHaveLength(2)
})
