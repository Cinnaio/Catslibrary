import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { AiError, chat, chatStream } from './client'
import { createAiTask, getAiTask } from './tasks'
import { parseAiTextProgress } from '@shared/ai-text-progress'
import { recordUsage } from './usage'
import { getMemoryAttempt, getStoryMemoryProgress, pauseStoryMemory } from './story-memory'
import { extractPlotState, getPlotStateForAnchor } from './plot-state'
import { extractRelationshipProfile, getRelationshipProfileForAnchor } from './relationship-profile'

const controls = vi.hoisted(() => ({ stream: false }))
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  chat: vi.fn(),
  chatStream: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://example.test/v1' }),
}))
vi.mock('./settings', () => ({ getAiSettings: async () => ({ plotStateMaxTokens: 4000, relationshipProfileMaxTokens: 4000, storyMemoryTimeoutSeconds: 450, storyMemoryStreamEnabled: controls.stream, storyMemoryReasoningMode: 'low' }) }))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))

let t: TestDb
const response = { text: '【未解线索】钥匙来源待确认 [章节ID:c1]', model: 'test', promptTokens: 12, completionTokens: 8, cost: 0.1, finishReason: 'stop' }
const opts = { userId: 'test', novelId: 'book', sampleChapters: 1 }
async function chapter(index: number, content = `正文${index}。`) {
  await t.db.query('INSERT INTO chapters (id, novel_id, title, content, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, 1)', [
    `c${index}`,
    'book',
    `第${index}章`,
    content,
    index,
  ])
}
function input(index = 0) {
  return vi
    .mocked(chat)
    .mock.calls[index]![0].messages.map((m) => m.content)
    .join('\n')
}

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
}, 30_000)
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  controls.stream = false
  vi.mocked(chatStream).mockReset()
  await t.db.query('DELETE FROM novels')
  await t.db.query("INSERT INTO novels (id, title, created_at, updated_at) VALUES ('book', '隔离测试', 1, 1)")
  vi.mocked(chat).mockReset().mockResolvedValue(response)
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined)
})

describe.each([
  { kind: 'plot', extract: extractPlotState, read: getPlotStateForAnchor, table: 'novel_plot_states' },
  { kind: 'relationship', extract: extractRelationshipProfile, read: getRelationshipProfileForAnchor, table: 'novel_relationship_profiles' },
])('$kind full story memory', ({ kind, extract, read, table }) => {
  it('keeps live fragments out of the archive and saves only the completed source-checked response', async () => {
    controls.stream = true
    await chapter(1)
    const task = await createAiTask(t.db, { userId: 'test', novelId: 'book', kind: kind === 'plot' ? 'plot_state' : 'relationship_profile' })
    vi.mocked(chatStream).mockImplementationOnce(async (request, delta) => {
      expect(request).toMatchObject({ reasoningMode: 'low', retryOnTimeout: false, returnIncompleteResult: true })
      await delta('尚未完成的档案片段')
      expect(parseAiTextProgress((await getAiTask(t.db, task.id))?.result)).toMatchObject({ preview: '尚未完成的档案片段' })
      expect((await t.db.query(`SELECT * FROM ${table} WHERE novel_id='book'`)).rows).toHaveLength(0)
      return { ...response, streamed: true }
    })
    await expect(extract(t.db, { ...opts, taskId: task.id })).resolves.toMatchObject({ complete: true })
    expect(await read(t.db, 'book')).toMatchObject(kind === 'plot' ? { state: response.text } : { profile: response.text })
    expect((await getAiTask(t.db, task.id))?.result).toBe('')
    expect(await getMemoryAttempt(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ streamed: true, reasoningMode: 'low' })
    expect(chat).not.toHaveBeenCalled()
  })
  it('renews the build lease while a slow model request is in flight', async () => {
    await chapter(1)
    const clock = vi.spyOn(Date, 'now')
    const startedAt = Date.now()
    vi.mocked(chat).mockImplementationOnce(async () => {
      const initial = (await t.db.query<{ lease_until: number }>('SELECT lease_until FROM novel_story_memory_builds WHERE novel_id = $1 AND kind = $2', ['book', kind])).rows[0]!
      clock.mockReturnValue(startedAt + 60000)
      await vi.waitFor(async () => {
        const next = (await t.db.query<{ lease_until: number }>('SELECT lease_until FROM novel_story_memory_builds WHERE novel_id = $1 AND kind = $2', ['book', kind])).rows[0]!
        expect(Number(next.lease_until)).toBeGreaterThan(Number(initial.lease_until))
      }, { timeout: 1500, interval: 30 })
      return response
    })
    try { await expect(extract(t.db, opts)).resolves.toMatchObject({ complete: true }) }
    finally { clock.mockRestore() }
  })

  it.each(['timeout', 'upstream'] as const)('retains the checkpoint and records an unbilled unknown-usage timeout (%s)', async (code) => {
    await chapter(1)
    await chapter(2)
    await extract(t.db, opts)
    vi.mocked(chat).mockRejectedValueOnce(new AiError(code, 'AI 服务响应超时', 504))
    await expect(extract(t.db, opts)).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('未自动重试') })
    expect(vi.mocked(chat).mock.calls[1]?.[0]).toMatchObject({ timeoutMs: 450000, retryOnTimeout: false })
    expect(await getMemoryAttempt(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ status: 'timeout', timeoutMs: 450000, promptTokens: null, completionTokens: null, chapterIds: ['c2'] })
    expect(await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ processedChapters: 1, complete: false, running: false })
    expect(recordUsage).toHaveBeenCalledTimes(1)
    vi.mocked(chat).mockResolvedValue(response)
    await expect(extract(t.db, opts)).resolves.toMatchObject({ complete: true, processedChapters: 2 })
    expect(input(2)).toContain('正文2。')
    expect(input(2)).not.toContain('正文1。')
  })

  it('cancels a stalled model call promptly and resumes the last complete checkpoint', async () => {
    await chapter(1)
    await chapter(2)
    await extract(t.db, opts)
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let signal: AbortSignal | undefined
    vi.mocked(chat).mockImplementationOnce((options) => {
      signal = options.signal
      entered()
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('paused', 'AbortError')), { once: true })
      })
    })
    const pending = extract(t.db, opts)
    await started
    const verdict = expect(pending).resolves.toMatchObject({ paused: true, complete: false, processedChapters: 1 })
    await pauseStoryMemory(t.db, 'book', kind as 'plot' | 'relationship')
    expect(signal?.aborted).toBe(true)
    await verdict
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    expect(await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ running: false, paused: true, processedChapters: 1 })
    await expect(extract(t.db, opts)).resolves.toMatchObject({ complete: true, processedChapters: 2 })
    expect(input(2)).toContain('正文2。')
    expect(input(2)).not.toContain('正文1。')
  })

  it('detects a pause written by another process and cancels its pending request', async () => {
    await chapter(1)
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    vi.mocked(chat).mockImplementationOnce(({ signal }) => {
      entered()
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('paused', 'AbortError')), { once: true })
      })
    })
    const pending = extract(t.db, opts)
    await started
    await t.db.query('UPDATE novel_story_memory_builds SET pause_requested = TRUE WHERE novel_id = $1 AND kind = $2', ['book', kind])
    await expect(pending).resolves.toMatchObject({ paused: true, processedChapters: 0 })
    expect(recordUsage).not.toHaveBeenCalled()
    expect(await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ running: false, paused: true })
  }, 3000)

  it('pauses an in-flight batch without releasing its lease and resumes the persisted target', async () => {
    await chapter(1)
    await chapter(2)
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finish!: (value: typeof response) => void
    vi.mocked(chat).mockImplementationOnce(() => {
      entered()
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const pending = extract(t.db, opts)
    await started
    await pauseStoryMemory(t.db, 'book', kind as 'plot' | 'relationship')
    await expect(extract(t.db, opts)).rejects.toThrow('正在更新')
    finish(response)
    await expect(pending).resolves.toMatchObject({ paused: true, complete: false, processedChapters: 1 })
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    const progress = await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')
    expect(progress).toMatchObject({ paused: true, running: false, processedChapters: 1, totalChapters: 2, targetChapterId: 'c2' })
    await chapter(3)
    await expect(extract(t.db, { ...opts, afterChapterId: progress!.targetChapterId })).resolves.toMatchObject({
      complete: true,
      paused: false,
      processedChapters: 2,
    })
    expect(input(1)).toContain('正文2。')
    expect(input(1)).not.toContain('正文1。')
    expect(input(1)).not.toContain('正文3。')
  })

  it('stops before retries and long-chapter pieces while preserving only whole-chapter checkpoints', async () => {
    await chapter(1, '长'.repeat(28_000))
    vi.mocked(chat).mockImplementationOnce(async () => {
      await pauseStoryMemory(t.db, 'book', kind as 'plot' | 'relationship')
      return response
    })
    await expect(extract(t.db, opts)).resolves.toMatchObject({ complete: false, paused: true, processedChapters: 0 })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    expect(await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ processedChapters: 0, paused: true })
    vi.mocked(chat).mockImplementationOnce(async () => {
      await pauseStoryMemory(t.db, 'book', kind as 'plot' | 'relationship')
      return { ...response, finishReason: 'content_filter', truncated: true }
    })
    await expect(extract(t.db, opts)).resolves.toMatchObject({ paused: true, processedChapters: 0 })
    expect(chat).toHaveBeenCalledTimes(2)
    await expect(extract(t.db, opts)).resolves.toMatchObject({ complete: true })
    expect(input(2)).toContain('上一版档案（空表示首次建立）：\n无')
  })

  it('invalidates a paused checkpoint when the covered chapter is edited', async () => {
    await chapter(1)
    await chapter(2)
    await extract(t.db, opts)
    await pauseStoryMemory(t.db, 'book', kind as 'plot' | 'relationship')
    await t.db.query("UPDATE chapters SET content = '修改后的正文' WHERE id = 'c1'")
    expect(await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ processedChapters: 0, totalChapters: 2, previewContent: '' })
    await extract(t.db, opts)
    expect(input(1)).toContain('修改后的正文')
    expect(input(1)).toContain('上一版档案（空表示首次建立）：\n无')
  })

  it.each([
    { text: '', finishReason: 'stop', expected: '返回空内容' },
    { text: '部分档案', finishReason: 'length', expected: '输出被截断' },
    { text: '', finishReason: 'stop', refusal: '拒绝原因', expected: '拒绝生成' },
  ])('distinguishes extraction failure: $expected', async ({ expected, ...reply }) => {
    await chapter(1)
    vi.mocked(chat).mockResolvedValueOnce({ ...response, ...reply })
    await expect(extract(t.db, opts)).rejects.toThrow(expected)
    expect(await getMemoryAttempt(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({
      maxTokens: 4000,
      completionTokens: 8,
      finishReason: reply.finishReason,
    })
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
  })
  it('initializes from chapter one, checkpoints separately, carries memory and appends only new chapters', async () => {
    await chapter(1)
    await chapter(2)
    const first = await extract(t.db, opts)
    expect(first).toMatchObject({ complete: false, processedChapters: 1, totalChapters: 2, targetChapterId: 'c2' })
    expect(await getStoryMemoryProgress(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({
      processedChapters: 1, totalChapters: 2, previewContent: response.text,
    })
    expect((await read(t.db, 'book')).eligibility).not.toBe('usable')
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    expect(input()).toContain('正文1。')
    const second = await extract(t.db, { ...opts, afterChapterId: 'c2' })
    expect(second).toMatchObject({ complete: true, processedChapters: 2, source: { coverage: 'full', sampleCount: 2, extractionPromptVersion: 3 } })
    expect(input(1)).toContain(response.text)
    expect(input(1)).toContain('正文2。')
    expect(input(1)).not.toContain('正文1。')
    expect((await read(t.db, 'book')).eligibility).toBe('usable')
    await chapter(3)
    expect((await read(t.db, 'book')).eligibility).toBe('stale')
    await extract(t.db, opts)
    expect(input(2)).toContain('正文3。')
    expect(input(2)).not.toContain('正文2。')
    await extract(t.db, opts)
    expect(chat).toHaveBeenCalledTimes(3) // already current: no additional paid call
    expect(recordUsage).toHaveBeenCalledTimes(3)
  })

  it('reads a long chapter ending and invalidates edits beyond the old clipping limit', async () => {
    await chapter(1, '前'.repeat(28_000) + '章末关键承诺')
    await extract(t.db, opts)
    expect(chat).toHaveBeenCalledTimes(2)
    expect(input(1)).toContain('章末关键承诺')
    expect(input(1)).toContain('[章节ID:c1]')
    await t.db.query("UPDATE chapters SET content = content || '改写结尾' WHERE id = 'c1'")
    expect((await read(t.db, 'book')).eligibility).toBe('source_changed')
    await extract(t.db, opts)
    expect(input(2)).toContain('上一版档案（空表示首次建立）：\n无')
    expect(input(3)).toContain('改写结尾')
  })

  it('retries the same batch when the gateway cancels a reply mid-stream', async () => {
    await chapter(1, '正文一。')
    await chapter(2, '正文二。')
    // First reply is cancelled after partial output; the retry succeeds on the same
    // batch (filtering is probabilistic, so splitting would only cost more calls).
    vi.mocked(chat)
      .mockResolvedValueOnce({ ...response, text: '半截档案内容', finishReason: 'content_filter', truncated: true })
      .mockResolvedValueOnce({ ...response, text: '完整档案', finishReason: 'stop' })
    const result = await extract(t.db, { ...opts, sampleChapters: 2 })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ complete: true, processedChapters: 2 })
    // The retry re-sends the same two chapters, not a split batch.
    expect(input(1)).toContain('正文一。')
    expect(input(1)).toContain('正文二。')
    expect((await read(t.db, 'book')).eligibility).toBe('usable')
  })

  it('keeps the checkpoint and reports truncation when every retry is cancelled', async () => {
    await chapter(1, '正文一。')
    vi.mocked(chat).mockResolvedValue({ ...response, text: '半截档案', finishReason: 'content_filter', truncated: true })
    await expect(extract(t.db, opts)).rejects.toThrow('内容策略截断')
    // All retries were billed, nothing was published, checkpoint untouched.
    expect(recordUsage).toHaveBeenCalledTimes(5)
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    expect(await getMemoryAttempt(t.db, 'book', kind as 'plot' | 'relationship')).toMatchObject({ status: 'truncated', finishReason: 'content_filter' })
    // A later retry resumes from the same chapter rather than losing history.
    vi.mocked(chat).mockResolvedValue(response)
    await expect(extract(t.db, opts)).resolves.toMatchObject({ complete: true, processedChapters: 1 })
    expect(input(5)).toContain('上一版档案（空表示首次建立）：\n无')
  })

  it('does not carry future memory into an earlier anchor and detects reorder/delete/insert', async () => {
    await chapter(1)
    await chapter(2)
    await extract(t.db, { ...opts, sampleChapters: 10 })
    expect((await read(t.db, 'book', 'c1')).eligibility).toBe('beyond_anchor')
    await extract(t.db, { ...opts, afterChapterId: 'c1' })
    expect(input(1)).toContain('上一版档案（空表示首次建立）：\n无')
    expect(input(1)).not.toContain('正文2。')
    await t.db.query("UPDATE chapters SET sort_order = 0 WHERE id = 'c2'")
    expect((await read(t.db, 'book', 'c1')).eligibility).toBe('source_changed')
    await t.db.query("DELETE FROM chapters WHERE id = 'c2'")
    await chapter(0)
    expect((await read(t.db, 'book')).eligibility).toBe('source_changed')
  })

  it('keeps the official archive on failure, accounts truncated responses, and resumes checkpoint', async () => {
    await chapter(1)
    await extract(t.db, opts)
    await chapter(2)
    await chapter(3)
    await extract(t.db, opts)
    vi.mocked(chat).mockResolvedValueOnce({ ...response, text: '截断', finishReason: 'length' })
    await expect(extract(t.db, opts)).rejects.toThrow('被截断')
    expect((await t.db.query<{ source_json: string }>(`SELECT source_json FROM ${table}`)).rows[0]?.source_json).toContain('"chapterId":"c1"')
    expect(recordUsage).toHaveBeenCalledTimes(3)
    await extract(t.db, opts)
    expect(input(3)).toContain('正文3。')
    expect(input(3)).not.toContain('正文2。')
    expect((await read(t.db, 'book')).eligibility).toBe('usable')
  })

  it('rejects concurrent builds and does not publish a source edited during extraction', async () => {
    await chapter(1)
    await t.db.query('INSERT INTO novel_story_memory_builds (novel_id, kind, lease_until) VALUES ($1, $2, $3)', ['book', kind, Date.now() + 60_000])
    await expect(extract(t.db, opts)).rejects.toThrow('正在更新')
    expect(chat).not.toHaveBeenCalled()
    await t.db.query('UPDATE novel_story_memory_builds SET lease_until = 0')
    vi.mocked(chat).mockImplementationOnce(async () => {
      await t.db.query("UPDATE chapters SET content = '已修改正文' WHERE id = 'c1'")
      return response
    })
    await expect(extract(t.db, opts)).rejects.toThrow('正文在提取期间已修改')
    expect((await t.db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    await extract(t.db, opts)
    expect(input(1)).toContain('已修改正文')
    expect(input(1)).toContain('上一版档案（空表示首次建立）：\n无')
  })

  it('covers more than thirty chapters across batches and rebuilds legacy recent samples', async () => {
    for (let n = 1; n <= 35; n++) await chapter(n)
    const column = kind === 'plot' ? 'state' : 'profile'
    await t.db.query(`INSERT INTO ${table} (novel_id, ${column}, model, source_json, created_at, updated_at) VALUES ('book', '旧取样遗漏历史', '', '', 1, 1)`)
    expect((await read(t.db, 'book')).eligibility).toBe('legacy_unknown')
    const a = await extract(t.db, { ...opts, sampleChapters: 30 })
    expect(a).toMatchObject({ complete: false, processedChapters: 30, totalChapters: 35 })
    expect(input()).not.toContain('旧取样遗漏历史')
    const b = await extract(t.db, { ...opts, sampleChapters: 30 })
    expect(b).toMatchObject({ complete: true, processedChapters: 35, source: { sampleCount: 35 } })
    expect((await read(t.db, 'book')).eligibility).toBe('usable')
  })
})
