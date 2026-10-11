import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import type { BookImportPreview } from '@shared/types'
import { pruneImportSnapshots } from '../services/book-import-state'
import { applyImport, type StoredImportRun } from '../services/book-import'

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

const call = async (path: string, method = 'GET', body?: unknown) => {
  const match = path.match(/^\/api\/book-import\/([^/]+)\/(?:ai-review(?:\/apply)?|target|commit|boundaries)$/)
  let data = body
  if (method === 'POST' && match && body && typeof body === 'object' && !('revision' in body)) {
    const row = await t.db.query<{ revision: number }>('SELECT revision FROM book_import_runs WHERE id=$1', [match[1]])
    data = { ...body, revision: row.rows[0]?.revision || 0 }
  }
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
}

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

it('唯一同名候选可切换为新建，提交不会向旧书追加章节', async () => {
  await t.db.query("INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ('import-existing-target','切换新建样本','作者',1,1)")
  const res = await previewTxt('作者：作者\n第一章 起\n新作品的章节正文。', '切换新建样本.txt')
  expect(res.status).toBe(200)
  const preview = await res.json() as BookImportPreview
  expect(preview.targetNovelId).toBe('import-existing-target')
  const target = await call(`/api/book-import/${preview.runId}/target`, 'POST', { targetNovelId: null })
  expect(target.status).toBe(200)
  const next = await target.json() as BookImportPreview
  expect(next.targetNovelId).toBeNull()
  expect(next.targetNovel).toBeNull()
  const committed = await call(`/api/book-import/${preview.runId}/commit`, 'POST', {
    targetNovelId: null,
    selectedChapterIds: next.chapters.map((chapter) => chapter.id),
    metadataFields: [],
    metadataMode: 'missing',
  })
  expect(committed.status).toBe(200)
  expect(await committed.json()).toMatchObject({ novelCreated: true, created: 1 })
  const oldChapters = await t.db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id='import-existing-target'")
  expect(oldChapters.rows[0]?.count).toBe(0)
})

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

    expect(after.diagnostics).toBeTruthy()
    // 已复核行不再占下一批候选，但建议继续保留。
    expect(after.diagnostics?.uncertain.some((row) => row.line === 1)).toBe(false)
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

function upstream(content: string, finishReason = 'stop', refusal?: string) {
  return new Response(
    JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content, ...(refusal ? { refusal } : {}) }, finish_reason: finishReason }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

it('人工修正累计保留，预览不写库，单条撤销与恢复原始解析可用', async () => {
  const content = ['序章', '序章正文。', '第1章 起', '正文甲。', '尾声', '尾声正文。'].join('\n')
  const original = (await (await previewTxt(content, '累计.txt')).json()) as BookImportPreview
  const first = (await (
    await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { changes: [{ line: 1, verdict: 'heading' }] })
  ).json()) as BookImportPreview
  expect(first.book.chapters.map((c) => c.title)).toEqual(['序章', '第1章 起'])
  const dry = (await (
    await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { changes: [{ line: 5, verdict: 'heading' }], dryRun: true })
  ).json()) as { chapterCount: number; impacts: Array<{ before: { title: string }; after: { title: string } }> }
  expect(dry.chapterCount).toBe(3)
  expect(dry.impacts[0]).toMatchObject({ before: { title: '第1章 起' }, after: { title: '尾声' } })
  const unchanged = (await (await call(`/api/book-import/${original.runId}`)).json()) as BookImportPreview
  expect(unchanged.revision).toBe(first.revision)
  const second = (await (
    await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { changes: [{ line: 5, verdict: 'heading' }] })
  ).json()) as BookImportPreview
  expect(second.book.chapters.map((c) => c.title)).toEqual(['序章', '第1章 起', '尾声'])
  expect(second.boundaryOverrides).toHaveLength(2)
  const undone = (await (await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { removeLines: [5] })).json()) as BookImportPreview
  expect(undone.book.chapters.map((c) => c.title)).toEqual(['序章', '第1章 起'])
  const reset = (await (await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { reset: true })).json()) as BookImportPreview
  expect(reset.book.chapters).toEqual(original.book.chapters)
  expect(reset.boundaryOverrides).toEqual([])
})

it('AI 建议支持逐条采纳，多轮采纳保留此前修正', async () => {
  const original = (await (
    await previewTxt(['序章', '序章正文。', '第1章 起', '正文甲。', '尾声', '尾声正文。'].join('\n'), '逐条.txt')
  ).json()) as BookImportPreview
  fetchMock.mockResolvedValueOnce(upstream('{"headings":[1,5]}'))
  const review = (await (await call(`/api/book-import/${original.runId}/ai-review`, 'POST', {})).json()) as { suggestions: unknown[] }
  expect(review.suggestions).toHaveLength(2)
  const first = (await (await call(`/api/book-import/${original.runId}/ai-review/apply`, 'POST', { lines: [1] })).json()) as BookImportPreview
  expect(first.book.chapters.map((c) => c.title)).toEqual(['序章', '第1章 起'])
  expect(first.aiReview?.suggestions.map((s) => s.line)).toEqual([5])
  const second = (await (await call(`/api/book-import/${original.runId}/ai-review/apply`, 'POST', { lines: [5] })).json()) as BookImportPreview
  expect(second.book.chapters.map((c) => c.title)).toEqual(['序章', '第1章 起', '尾声'])
  expect(second.aiReview).toBeNull()
  expect(second.boundaryOverrides?.every((item) => item.source === 'ai')).toBe(true)
})

it('分批复核越过候选截断，已复核且一致的行不会再次调用', async () => {
  const content = Array.from({ length: 350 }, (_, i) => `序章 ${i + 1}\n正文。`).join('\n')
  const original = (await (await previewTxt(content, '批次.txt')).json()) as BookImportPreview
  expect(original.diagnostics?.truncatedCount).toBe(50)
  const seen: number[] = []
  for (let i = 0; i < 5; i++) {
    fetchMock.mockResolvedValueOnce(upstream('{"headings":[]}'))
    const response = await call(`/api/book-import/${original.runId}/ai-review`, 'POST', {})
    expect(response.status).toBe(200)
    const review = (await response.json()) as { reviewedLines: number[]; candidateCount: number; remainingCount: number }
    expect(review.candidateCount).toBe(i === 4 ? 30 : 80)
    seen.push(...review.reviewedLines.filter((line) => !seen.includes(line)))
    expect(review.remainingCount).toBe(Math.max(0, 350 - (i + 1) * 80))
  }
  expect(seen).toHaveLength(350)
  const callsBefore = fetchMock.mock.calls.length
  expect((await call(`/api/book-import/${original.runId}/ai-review`, 'POST', {})).status).toBe(200)
  expect(fetchMock.mock.calls.length).toBe(callsBefore)
})

it('格式错误、空回复、截断和拒答均不生成建议，已发生用量仍入账', async () => {
  for (const response of [upstream('第 1 行不是标题'), upstream(''), upstream('{"headings":[1]}', 'length'), upstream('', 'stop', '无法完成此请求')]) {
    const original = (await (await previewTxt(SAMPLE_TXT, '失败.txt')).json()) as BookImportPreview
    const before = await t.db.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM ai_usage')
    fetchMock.mockResolvedValueOnce(response)
    const result = await call(`/api/book-import/${original.runId}/ai-review`, 'POST', {})
    expect([422, 502]).toContain(result.status)
    const after = await t.db.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM ai_usage')
    expect(after.rows[0]!.total).toBe(before.rows[0]!.total + 1)
    const stored = (await (await call(`/api/book-import/${original.runId}`)).json()) as BookImportPreview
    expect(stored.revision).toBe(0)
    expect(stored.aiReview).toBeNull()
    expect(stored.reviewedLines).toEqual([])
    const audit = await t.db.query<{ status: string; error: string }>('SELECT status,error FROM book_import_review_attempts WHERE run_id=$1', [original.runId])
    expect(audit.rows[0]!.status).toBe('failed')
    expect(audit.rows[0]!.error).toBeTruthy()
  }
})

it('复核租约阻止重复上游调用，晚到的结果不能覆盖新版本', async () => {
  const original = (await (await previewTxt(SAMPLE_TXT, '并发.txt')).json()) as BookImportPreview
  let release!: (response: Response) => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  fetchMock.mockImplementationOnce(async () => {
    started()
    return new Promise<Response>((resolve) => {
      release = resolve
    })
  })
  const waiting = call(`/api/book-import/${original.runId}/ai-review`, 'POST', { revision: 0 })
  await entered
  const duplicate = await call(`/api/book-import/${original.runId}/ai-review`, 'POST', { revision: 0 })
  expect(duplicate.status).toBe(409)
  const target = await call(`/api/book-import/${original.runId}/target`, 'POST', { targetNovelId: null, revision: 0 })
  expect(target.status).toBe(200)
  release(upstream('{"headings":[1]}'))
  expect((await waiting).status).toBe(409)
  const stored = (await (await call(`/api/book-import/${original.runId}`)).json()) as BookImportPreview
  expect(stored.revision).toBe(1)
  expect(stored.aiReview).toBeNull()
})

it('过期版本不能修改或提交，锁内会再次检查快照版本', async () => {
  const original = (await (await previewTxt(SAMPLE_TXT, '版本.txt')).json()) as BookImportPreview
  const stale = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [original.runId])).rows[0]!
  await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { changes: [{ line: 1, verdict: 'heading' }] })
  for (const operation of ['target', 'boundaries', 'ai-review', 'commit']) {
    expect((await call(`/api/book-import/${original.runId}/${operation}`, 'POST', { revision: 0 })).status).toBe(409)
  }
  await expect(
    applyImport(t.db, { run: stale, selectedChapterIds: original.chapters.map((c) => c.id), metadataFields: [], metadataMode: 'missing', actorUserId: 'test' }),
  ).rejects.toThrow('预览版本')
})

it('过期快照清理保留历史和回滚记录，已完成导入仍可撤回', async () => {
  const original = (await (await previewTxt(SAMPLE_TXT, '保留.txt')).json()) as BookImportPreview
  const committed = await call(`/api/book-import/${original.runId}/commit`, 'POST', {
    selectedChapterIds: original.chapters.map((c) => c.id),
    metadataFields: [],
  })
  expect(committed.status).toBe(200)
  const stored = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [original.runId])).rows[0]!
  expect(Number(stored.source_expires_at) - Number(stored.applied_at)).toBeGreaterThan(29 * 86400000)
  const expired = (await (await previewTxt(SAMPLE_TXT, '过期.txt')).json()) as BookImportPreview
  await t.db.query('UPDATE book_import_runs SET source_expires_at=$1 WHERE id=ANY($2::text[])', [Date.now() - 1, [original.runId, expired.runId]])
  expect((await call(`/api/book-import/${expired.runId}/commit`, 'POST', {})).status).toBe(409)
  await pruneImportSnapshots(t.db)
  const cleared = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [original.runId])).rows[0]!
  expect(cleared.source_text).toBe('')
  expect(cleared.payload_json).toBe('{}')
  expect(cleared.changes_json).toBe(stored.changes_json)
  const history = (await (await call('/api/book-import/history?limit=50')).json()) as {
    items: Array<{ runId: string; status: string; novelTitle: string; created: number }>
  }
  expect(history.items.find((item) => item.runId === expired.runId)).toMatchObject({ status: 'expired', novelTitle: '过期' })
  expect(history.items.find((item) => item.runId === original.runId)?.created).toBe(1)
  expect((await call(`/api/book-import/${original.runId}/rollback`, 'POST', {})).status).toBe(200)
})

it('行级原文只返回附近范围，人工修正拒绝越界或空行', async () => {
  const original = (await (await previewTxt('序章\n\n正文。\n第1章 起\n正文甲。', '行号.txt')).json()) as BookImportPreview
  const context = (await (await call(`/api/book-import/${original.runId}/lines?line=1`)).json()) as { lines: Array<{ line: number }> }
  expect(context.lines[0]?.line).toBe(1)
  expect(context.lines.length).toBeLessThanOrEqual(7)
  for (const line of [0, 2, 100, 1.5]) {
    expect((await call(`/api/book-import/${original.runId}/boundaries`, 'POST', { changes: [{ line, verdict: 'heading' }] })).status).toBe(400)
  }
})
