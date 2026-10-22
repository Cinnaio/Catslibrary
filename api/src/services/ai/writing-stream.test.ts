import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ chat: vi.fn(), chatStream: vi.fn() }))
vi.mock('./client', async original => ({
  ...await original<typeof import('./client')>(), ...mocks,
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://fixture.example', apiKey: 'test', model: 'deepseek-flash' }),
}))
vi.mock('./settings', async original => {
  const real = await original<typeof import('./settings')>()
  return { ...real, getAiSettings: async () => ({ ...real.DEFAULT_AI_SETTINGS, writingStreamEnabled: true, writingReasoningMode: 'disabled' }) }
})
import { createTestDb, type TestDb } from '../../test/db'
import { createAiTask, getAiTask, cancelAiTask } from './tasks'
import { generateWriting } from './writing'
import { parseAiTextProgress } from '@shared/ai-text-progress'
let t: TestDb
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
beforeEach(() => { vi.clearAllMocks() })
const result = { text: '完整大纲', model: 'deepseek-flash', promptTokens: 30, completionTokens: 20, reasoningTokens: 2, cost: 0, streamed: true }
it('streams a provisional preview, then saves one complete draft with latency metadata', async () => {
  const task = await createAiTask(t.db, { userId: 'test', kind: 'write_outline' })
  mocks.chatStream.mockImplementationOnce(async (request, delta) => {
    expect(request).toMatchObject({ reasoningMode: 'disabled' })
    await delta('未完成片段')
    expect(parseAiTextProgress((await getAiTask(t.db, task.id))?.result)).toMatchObject({ preview: '未完成片段' })
    expect((await t.db.query("SELECT * FROM ai_generations WHERE params_json LIKE $1", [`%${task.id}%`])).rows).toHaveLength(0)
    return result
  })
  const saved = await generateWriting(t.db, { taskId: task.id, userId: 'test', novelId: '', kind: 'write_outline', title: '书', instruction: '生成大纲', context: '', promptPipelineVersion: 1 })
  expect(saved.generation.result).toBe('完整大纲')
  const row = (await t.db.query<{ params_json: string }>('SELECT params_json FROM ai_generations WHERE id=$1', [saved.generation.id])).rows[0]!
  expect(JSON.parse(row.params_json)).toMatchObject({ reasoningMode: 'disabled', performance: { streamed: true, firstContentMs: expect.any(Number), reasoningTokens: 2 } })
  expect((await getAiTask(t.db, task.id))?.result).toBe('')
  expect(mocks.chat).not.toHaveBeenCalled()
})
it('does not save a preview after cancellation', async () => {
  const task = await createAiTask(t.db, { userId: 'test', kind: 'write_outline' })
  mocks.chatStream.mockImplementationOnce(async (_request, delta) => {
    await cancelAiTask(t.db, task.id)
    await delta('取消后的片段')
    return result
  })
  await expect(generateWriting(t.db, { taskId: task.id, userId: 'test', novelId: '', kind: 'write_outline', title: '书', instruction: '生成大纲', context: '', promptPipelineVersion: 1 })).rejects.toMatchObject({ code: 'cancelled' })
  expect((await t.db.query("SELECT * FROM ai_generations WHERE params_json LIKE $1", [`%${task.id}%`])).rows).toHaveLength(0)
  expect((await getAiTask(t.db, task.id))?.status).toBe('cancelled')
})
