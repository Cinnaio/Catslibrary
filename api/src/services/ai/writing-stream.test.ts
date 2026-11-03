import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
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
import { generateContinuationChapters, generateWriting } from './writing'
import { WRITING_PROMPT_PIPELINE_VERSION } from './writing-prompt'
import { parseAiTextProgress } from '@shared/ai-text-progress'
let t: TestDb
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })
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

it.each(['continue', 'write_chapter'] as const)('%s saves message paragraphs intact with output and result lengths', async (kind) => {
  const body = '他掏出手机。\n\n【明天见】\n\n' + '后续剧情。'.repeat(200)
  const text = `标题：雨夜来信\n\n${body}`
  mocks.chatStream.mockResolvedValueOnce({ ...result, text })
  const saved = await generateWriting(t.db, { userId: 'test', novelId: '', kind, title: '书', instruction: '写一章', profileOverrides: {}, promptPipelineVersion: 1 })
  expect(saved.generation.result).toBe(body)
  const row = (await t.db.query<{ params_json: string; result: string }>('SELECT params_json, result FROM ai_generations WHERE id=$1', [saved.generation.id])).rows[0]!
  expect(row.result).toBe(body)
  expect(JSON.parse(row.params_json)).toMatchObject({ draftTitle: '雨夜来信', performance: { outputCharacters: text.length, resultCharacters: body.length } })
  expect(JSON.parse(row.params_json)).not.toHaveProperty('chapterBoundaryTruncation')
})

it('uses the outline to strip an exact bare title without a blank line before saving', async () => {
  mocks.chatStream.mockResolvedValueOnce({ ...result, text: '雨夜来信\n他收到一条消息。' })
  const saved = await generateWriting(t.db, { userId: 'test', novelId: '', kind: 'continue', title: '书', instruction: '写一章', outlineTitle: '雨夜来信', profileOverrides: {}, promptPipelineVersion: 1 })
  expect(saved.generation.result).toBe('他收到一条消息。')
  const row = (await t.db.query<{ params_json: string }>('SELECT params_json FROM ai_generations WHERE id=$1', [saved.generation.id])).rows[0]!
  expect(JSON.parse(row.params_json)).toMatchObject({ draftTitle: '雨夜来信' })
})

it('keeps a narrative opening when only the fallback title is available', async () => {
  const text = '他收到一条消息。\n\n【明天见】\n\n他合上手机。'
  mocks.chatStream.mockResolvedValueOnce({ ...result, text })
  const saved = await generateWriting(t.db, { userId: 'test', novelId: '', kind: 'continue', title: '书', instruction: '写一章', outlineTitle: '雨夜来信', profileOverrides: {}, promptPipelineVersion: 1 })
  expect(saved.generation.result).toBe(text)
})

it.each([1, WRITING_PROMPT_PIPELINE_VERSION])('passes the plot after a message to the next chapter, excluding archived overflow (pipeline %s)', async (promptPipelineVersion) => {
  const body = `${'他等着回信。'.repeat(40)}\n\n【明天见】\n\n他已把钥匙交给沈月。`
  mocks.chatStream
    .mockResolvedValueOnce({ ...result, text: `标题：雨夜来信\n\n${body}\n\n第2章 越界\n\n越界哨兵不得进入上下文。` })
    .mockImplementationOnce(async (request) => {
      const messages = request.messages.map((message: { content: string }) => message.content).join('\n')
      expect(messages).toContain('他已把钥匙交给沈月。')
      expect(messages).not.toContain('越界哨兵不得进入上下文。')
      return { ...result, text: '标题：次日清晨\n\n第二章正常续写。' }
    })
  const batch = await generateContinuationChapters(t.db, {
    userId: 'test', novelId: '', title: '书', instruction: '继续写两章', context: '起点剧情。',
    chapterCount: 2, profileOverrides: {}, promptPipelineVersion,
  })
  expect(batch.generations.map((generation) => generation.result)).toEqual([body, '第二章正常续写。'])
  expect(mocks.chatStream).toHaveBeenCalledTimes(2)
})

it.each([
  { kept: 1500, next: 400, large: true },
  { kept: 10, next: 30, large: true },
  { kept: 1500, next: 30, large: false },
])('retains original output for boundary truncation, warning only when large ($kept/$next)', async ({ kept, next, large }) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const body = '甲'.repeat(kept)
  const text = `标题：雨夜来信\n\n${body}\n\n第2章 次日\n\n${'乙'.repeat(next)}`
  mocks.chatStream.mockResolvedValueOnce({ ...result, text })
  const saved = await generateWriting(t.db, { userId: 'test', novelId: '', kind: 'continue', title: '书', instruction: '写一章', profileOverrides: {}, promptPipelineVersion: 1 })
  expect(saved.generation.result).toBe(body)
  const row = (await t.db.query<{ params_json: string; result: string }>('SELECT params_json, result FROM ai_generations WHERE id=$1', [saved.generation.id])).rows[0]!
  expect(row.result).toBe(body)
  const removedCharacters = '\n\n第2章 次日\n\n'.length + next
  expect(JSON.parse(row.params_json)).toMatchObject({
    chapterBoundaryTruncation: { originalText: text, originalBodyCharacters: kept + removedCharacters, removedCharacters, large },
    performance: { outputCharacters: text.length, resultCharacters: body.length },
  })
  if (large) {
    expect(warn).toHaveBeenCalledExactlyOnceWith('[ai-writing] large chapter boundary truncation; original output retained', {
      generationId: saved.generation.id, originalBodyCharacters: kept + removedCharacters, removedCharacters,
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('雨夜来信')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(body)
  } else expect(warn).not.toHaveBeenCalled()
})
