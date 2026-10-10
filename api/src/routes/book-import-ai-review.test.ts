import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

/**
 * 导入 AI 复核端到端：multipart 预览 → 诊断 → 复核 → 采纳重切。
 * 上游用 fetch 桩，不发真实请求。
 */
let t: TestDb
let token = ''

const fetchMock = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        model: 'test-model',
        // 「序章」在第 1 行：启发式判为正文（无编号），复核把它翻成标题。
        choices: [{ message: { content: '{"headings":[1]}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 12 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
)

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.AI_TEXT_BASE_URL = 'https://ai.test/v1'
  process.env.AI_TEXT_API_KEY = 'test-key'
  process.env.AI_TEXT_MODEL = 'test-model'
  vi.stubGlobal('fetch', fetchMock)
  const boot = (await (await call('/api/auth/bootstrap-admin', 'POST', { username: 'importer', password: 'password123' })).json()) as { token: string }
  token = boot.token
})

afterAll(async () => {
  vi.unstubAllGlobals()
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.AI_TEXT_BASE_URL
  delete process.env.AI_TEXT_API_KEY
  delete process.env.AI_TEXT_MODEL
  await t.close()
})

const call = (path: string, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function previewTxt(content: string, fileName: string) {
  const form = new FormData()
  form.append('file', new File([content], fileName, { type: 'text/plain' }))
  return app.request('/api/book-import/preview', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
}

/** 「序章」无编号，启发式判为正文 → 进待复核证据；第 1 章是确定边界。 */
const SAMPLE_TXT = ['序章', '序章正文，足够长的一段内容用来构成一章。', '第1章 起', '正文甲，同样足够长的一段内容。'].join('\n')

describe('导入 AI 复核端到端', () => {
  it('预览返回解析诊断与待复核证据', async () => {
    const res = await previewTxt(SAMPLE_TXT, '序章样本.txt')
    expect(res.status).toBe(200)
    const preview = (await res.json()) as {
      runId: string
      book: { chapters: Array<{ title: string }> }
      diagnostics?: {
        stats: { parser: string; headingLines: number }
        uncertain: Array<{ line: number; rejectedBy?: string }>
        anomalies: Array<{ code: string }>
      }
    }

    expect(preview.diagnostics?.stats.parser).toBe('text')
    expect(preview.diagnostics?.stats.headingLines).toBe(1)
    // 「序章」被标为待复核，而不是静默丢弃。
    expect(preview.diagnostics?.uncertain.some((row) => row.line === 1 && row.rejectedBy === 'unnumbered-heading-shape')).toBe(true)
    expect(preview.diagnostics?.anomalies.map((item) => item.code)).toContain('uncertain-lines')
    // 未采纳前章节数不变。
    expect(preview.book.chapters).toHaveLength(1)
  })

  it('开关未开启时复核被拒绝', async () => {
    const preview = (await (await previewTxt(SAMPLE_TXT, '未开启.txt')).json()) as { runId: string }
    const res = await call(`/api/book-import/${preview.runId}/ai-review`, 'POST', {})

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('开启开关后复核给出改判建议与预计章节数', async () => {
    await call('/api/ai/settings', 'PUT', { importAiReviewEnabled: true })
    const preview = (await (await previewTxt(SAMPLE_TXT, '复核样本.txt')).json()) as { runId: string }
    const res = await call(`/api/book-import/${preview.runId}/ai-review`, 'POST', {})
    expect(res.status).toBe(200)
    const review = (await res.json()) as {
      candidateCount: number
      suggestions: Array<{ line: number; verdict: string; heuristic: string }>
      projectedChapterCount: number
    }

    expect(review.candidateCount).toBeGreaterThan(0)
    expect(review.suggestions).toHaveLength(1)
    expect(review.suggestions[0]).toMatchObject({ line: 1, verdict: 'heading', heuristic: 'prose' })
    // 「序章」成为独立章节 → 2 章。
    expect(review.projectedChapterCount).toBe(2)

    // 复核只记账，不改动快照里的 payload。
    const stored = await t.db.query<{ payload_json: string; preview_json: string; source_text: string }>(
      'SELECT payload_json, preview_json, source_text FROM book_import_runs WHERE id = $1',
      [preview.runId],
    )
    expect(JSON.parse(stored.rows[0]!.payload_json).chapters).toHaveLength(1)
    expect(stored.rows[0]!.source_text).toBe(SAMPLE_TXT)
    expect(JSON.parse(stored.rows[0]!.preview_json).aiReview.suggestions).toHaveLength(1)

    // 调用被记账，供用量审计。
    const usage = await t.db.query<{ generation_type: string }>('SELECT generation_type FROM ai_usage ORDER BY created_at DESC LIMIT 1')
    expect(usage.rows[0]!.generation_type).toBe('import_review')
  })

  it('采纳建议后按行号覆盖重切，章节数增加且选择状态重置', async () => {
    const preview = (await (await previewTxt(SAMPLE_TXT, '采纳样本.txt')).json()) as { runId: string }
    await call(`/api/book-import/${preview.runId}/ai-review`, 'POST', {})
    const res = await call(`/api/book-import/${preview.runId}/ai-review/apply`, 'POST', {})
    expect(res.status).toBe(200)
    const next = (await res.json()) as {
      book: { chapters: Array<{ title: string; content: string }> }
      diagnostics?: { uncertain: Array<{ line: number }> }
      aiReview: unknown
    }

    expect(next.book.chapters).toHaveLength(2)
    expect(next.book.chapters[0]?.title).toBe('序章')
    expect(next.book.chapters[0]?.content).toContain('序章正文')
    expect(next.book.chapters[1]?.title).toBe('第1章 起')
    // 已采纳的行不再是待复核证据，避免重复建议。
    expect(next.diagnostics?.uncertain.some((row) => row.line === 1)).toBe(false)
    // 重切后的快照不再带旧的复核结果。
    expect(next.aiReview).toBeNull()

    const stored = await t.db.query<{ payload_json: string }>('SELECT payload_json FROM book_import_runs WHERE id = $1', [preview.runId])
    expect(JSON.parse(stored.rows[0]!.payload_json).chapters).toHaveLength(2)
  })

  it('没有复核建议时采纳被拒绝', async () => {
    // 上游回空数组：无改判 → 无可采纳建议。
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'test-model',
          choices: [{ message: { content: '{"headings":[]}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const preview = (await (await previewTxt(SAMPLE_TXT, '无建议.txt')).json()) as { runId: string }
    const review = (await (await call(`/api/book-import/${preview.runId}/ai-review`, 'POST', {})).json()) as { suggestions: unknown[] }
    expect(review.suggestions).toHaveLength(0)

    const res = await call(`/api/book-import/${preview.runId}/ai-review/apply`, 'POST', {})
    expect(res.status).toBe(409)
  })

  it('切换导入目标后诊断与复核结果仍在', async () => {
    // 选完目标会重建预览（比对基准变了）。若重建时丢掉诊断，诊断面板与复核入口
    // 会在管理员选完目标后凭空消失——这是流程上的真实回归点。
    const preview = (await (await previewTxt(SAMPLE_TXT, '切换目标.txt')).json()) as { runId: string }
    const before = (await (await call(`/api/book-import/${preview.runId}/ai-review`, 'POST', {})).json()) as { suggestions: unknown[] }
    expect(before.suggestions).toHaveLength(1)

    const after = (await (await call(`/api/book-import/${preview.runId}/target`, 'POST', { targetNovelId: null })).json()) as {
      diagnostics?: { uncertain: Array<{ line: number }> }
      aiReview: { suggestions: unknown[] } | null
    }

    expect(after.diagnostics?.uncertain.some((row) => row.line === 1)).toBe(true)
    expect(after.aiReview?.suggestions).toHaveLength(1)
  })

  it('已提交的导入不能再复核或重切', async () => {
    const preview = (await (await previewTxt(SAMPLE_TXT, '已提交.txt')).json()) as { runId: string }
    await t.db.query("UPDATE book_import_runs SET status='applied' WHERE id=$1", [preview.runId])

    expect((await call(`/api/book-import/${preview.runId}/ai-review`, 'POST', {})).status).toBe(409)
    expect((await call(`/api/book-import/${preview.runId}/ai-review/apply`, 'POST', {})).status).toBe(409)
  })

  it('不存在的导入记录返回 404', async () => {
    expect((await call('/api/book-import/missing-run/ai-review', 'POST', {})).status).toBe(404)
    expect((await call('/api/book-import/missing-run/ai-review/apply', 'POST', {})).status).toBe(404)
  })

  it('历史列表不携带原文快照', async () => {
    const res = await call('/api/book-import/history?limit=5')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }

    // source_text 可能是整份 25 MB 原文，绝不能进列表响应。
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((item) => !('source_text' in item) && !('sourceText' in item))).toBe(true)
  })
})
