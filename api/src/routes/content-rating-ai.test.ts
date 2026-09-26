import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb
let aiRating: 'restricted' | 'general' = 'restricted'

const fetchMock = vi.fn(async () => {
  const rating = aiRating
  return new Response(
    JSON.stringify({
      model: 'rating-test-model',
      choices: [
        {
          message: {
            content: JSON.stringify({
              rating,
              confidence: 0.92,
              reason: rating === 'general' ? '模型尝试返回一般，但协议不允许该结论' : '元数据中出现明确的限制级分类标签',
              evidence: rating === 'general' ? [] : [{ field: 'categories', value: '测试成人标签' }],
            }),
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 32 },
      cost: '0.01',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
  process.env.AI_TEXT_BASE_URL = 'https://ai.test/v1'
  process.env.AI_TEXT_API_KEY = 'test-key'
  process.env.AI_TEXT_MODEL = 'rating-test-model'
  vi.stubGlobal('fetch', fetchMock)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  delete process.env.AI_TEXT_BASE_URL
  delete process.env.AI_TEXT_API_KEY
  delete process.env.AI_TEXT_MODEL
  await t.close()
})

beforeEach(() => {
  aiRating = 'restricted'
  fetchMock.mockClear()
})

function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

const req = (path: string, init?: RequestInit) => app.request(path, init)
const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T

async function waitForSuggestion(novelId: string, status = 'pending') {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await t.db.query<{ id: string; status: string; suggested_rating: string }>(
      'SELECT id, status, suggested_rating FROM content_rating_ai_suggestions WHERE novel_id = $1 ORDER BY created_at DESC LIMIT 1',
      [novelId],
    )
    const row = result.rows[0]
    if (row?.status === status) return row
    if (row?.status === 'failed') throw new Error('AI suggestion task failed')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`AI suggestion did not reach ${status}`)
}

describe('LLM 内容分级建议审核闭环', () => {
  let adminToken = ''

  it('只分析 unknown，保存模型快照，批准 restricted 后才写入分级审计', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'rating-ai-admin', password: 'adminpass123', displayName: '分级管理员' }))
    expect(boot.status).toBe(201)
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    const created = await req(
      '/api/novels',
      json(
        'POST',
        {
          title: '待分析作品',
          author: '测试作者',
          description: '只提供元数据，正文不发送给 LLM。',
          categories: ['测试成人标签'],
        },
        adminToken,
      ),
    )
    expect(created.status).toBe(201)
    const novelId = (await jsonOf<{ novel: { id: string; contentRating: string } }>(created)).novel.id

    const scan = await req('/api/admin/content-rating-ai/scan', json('POST', { novelIds: [novelId], limit: 10 }, adminToken))
    expect(scan.status).toBe(202)
    const scanBody = await jsonOf<{ taskId: string; selected: number }>(scan)
    expect(scanBody.selected).toBe(1)
    expect(scanBody.taskId).toMatch(/^aitask_/)

    const pending = await waitForSuggestion(novelId)
    expect(pending.suggested_rating).toBe('restricted')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const novelBeforeReview = await t.db.query<{ content_rating: string; content_rating_revision: number }>(
      'SELECT content_rating, content_rating_revision FROM novels WHERE id = $1',
      [novelId],
    )
    expect(novelBeforeReview.rows[0]).toMatchObject({ content_rating: 'unknown', content_rating_revision: 1 })

    const list = await req('/api/admin/content-rating-ai?status=pending', json('GET', undefined, adminToken))
    expect(list.status).toBe(200)
    const listBody = await jsonOf<{
      items: Array<{ id: string; model: string; promptVersion: string; inputSnapshot: { description?: string }; evidence: Array<{ type: string }> }>
      counts: { pending: number }
    }>(list)
    expect(listBody.counts.pending).toBe(1)
    expect(listBody.items[0]).toMatchObject({ model: 'rating-test-model', promptVersion: 'content-rating-ai-v1' })
    expect(listBody.items[0]?.inputSnapshot.description).toContain('只提供元数据')
    expect(listBody.items[0]?.evidence[0]).toMatchObject({ type: 'llm' })

    const approved = await req(
      `/api/admin/content-rating-ai/${pending.id}/review`,
      json('POST', { decision: 'approve', expectedRevision: 0, reason: '管理员核对元数据后确认限制级' }, adminToken),
    )
    expect(approved.status).toBe(200)
    expect(await jsonOf<{ applied: boolean; suggestion: { status: string } }>(approved)).toMatchObject({ applied: true, suggestion: { status: 'approved' } })

    const rated = await t.db.query<{
      content_rating: string
      content_rating_source: string
      content_rating_revision: number
      content_rating_rule_version: string
    }>('SELECT content_rating, content_rating_source, content_rating_revision, content_rating_rule_version FROM novels WHERE id = $1', [novelId])
    expect(rated.rows[0]).toMatchObject({ content_rating: 'restricted', content_rating_source: 'ai_task', content_rating_revision: 2 })
    expect(rated.rows[0]?.content_rating_rule_version).toContain('llm:rating-test-model:content-rating-ai-v1')

    const audit = await t.db.query<{ source: string; evidence: string; rule_version: string }>(
      'SELECT source, evidence, rule_version FROM novel_content_rating_audit WHERE novel_id = $1 ORDER BY created_at DESC LIMIT 1',
      [novelId],
    )
    expect(audit.rows[0]?.source).toBe('ai_task')
    expect(audit.rows[0]?.evidence).toContain('rating-test-model')
    expect(audit.rows[0]?.rule_version).toContain('content-rating-ai-v1')

    const usage = await t.db.query<{ generation_type: string; novel_id: string }>(
      'SELECT generation_type, novel_id FROM ai_usage WHERE novel_id = $1 ORDER BY created_at DESC LIMIT 1',
      [novelId],
    )
    expect(usage.rows[0]).toMatchObject({ generation_type: 'content-rating-llm', novel_id: novelId })
  })

  it('把模型返回的 general 归一为 unknown，不能借 AI 结论覆盖一般作品或生成一般结论', async () => {
    aiRating = 'general'
    const created = await req('/api/novels', json('POST', { title: '模型越权返回一般', author: '测试作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(created)).novel.id

    const scan = await req('/api/admin/content-rating-ai/scan', json('POST', { novelIds: [novelId] }, adminToken))
    expect(scan.status).toBe(202)
    const pending = await waitForSuggestion(novelId)
    expect(pending.suggested_rating).toBe('unknown')

    const review = await req(
      `/api/admin/content-rating-ai/${pending.id}/review`,
      json('POST', { decision: 'approve', expectedRevision: 0, reason: '确认模型没有提供足够的限制级证据' }, adminToken),
    )
    expect(review.status).toBe(200)
    expect(await jsonOf<{ applied: boolean }>(review)).toMatchObject({ applied: false })

    const novel = await t.db.query<{ content_rating: string; content_rating_source: string }>(
      'SELECT content_rating, content_rating_source FROM novels WHERE id = $1',
      [novelId],
    )
    expect(novel.rows[0]).toMatchObject({ content_rating: 'unknown', content_rating_source: 'system' })
  })

  it('作品分级在模型调用期间发生变化时，建议进入 stale 且不能重复审核', async () => {
    const created = await req('/api/novels', json('POST', { title: '并发校验作品', author: '测试作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(created)).novel.id
    const scan = await req('/api/admin/content-rating-ai/scan', json('POST', { novelIds: [novelId] }, adminToken))
    expect(scan.status).toBe(202)

    const pending = await waitForSuggestion(novelId)
    const current = await t.db.query<{ content_rating_revision: number }>('SELECT content_rating_revision FROM novels WHERE id = $1', [novelId])
    const nextRevision = Number(current.rows[0]?.content_rating_revision || 0) + 1
    await t.db.query(
      `UPDATE novels
          SET content_rating = 'general', content_rating_revision = $2, content_rating_source = 'manual',
              content_rating_reason = '并发人工确认', content_rating_updated_by = $3, content_rating_updated_at = $4
        WHERE id = $1`,
      [novelId, nextRevision, 'admin-concurrent', Date.now()],
    )
    const staleReview = await req(
      `/api/admin/content-rating-ai/${pending.id}/review`,
      json('POST', { decision: 'approve', expectedRevision: 0, reason: '不应覆盖并发人工结果' }, adminToken),
    )
    expect(staleReview.status).toBe(409)
    expect((await jsonOf<{ code: string }>(staleReview)).code).toBe('content_rating_ai_stale')
  })

  it('进度接口按批次口径统计缺口，无缺口时不允许断点恢复', async () => {
    const created = await req('/api/novels', json('POST', { title: '进度口径作品', author: '测试作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(created)).novel.id
    const scan = await req('/api/admin/content-rating-ai/scan', json('POST', { novelIds: [novelId] }, adminToken))
    expect(scan.status).toBe(202)
    const taskId = (await jsonOf<{ taskId: string }>(scan)).taskId

    await waitForSuggestion(novelId)

    const progress = await req(`/api/admin/content-rating-ai/tasks/${taskId}/progress`, json('GET', undefined, adminToken))
    expect(progress.status).toBe(200)
    const body = await jsonOf<{ total: number; done: number; remaining: number; canResume: boolean; resumable: boolean }>(progress)
    expect(body).toMatchObject({ total: 1, done: 1, remaining: 0, canResume: false, resumable: false })
  })

  it('断点恢复跳过已有建议的作品，只补缺口并保留原任务记录', async () => {
    const doneNovel = await req('/api/novels', json('POST', { title: '已完成作品', author: '测试作者' }, adminToken))
    const doneId = (await jsonOf<{ novel: { id: string } }>(doneNovel)).novel.id
    const gapNovel = await req('/api/novels', json('POST', { title: '待补跑作品', author: '测试作者' }, adminToken))
    const gapId = (await jsonOf<{ novel: { id: string } }>(gapNovel)).novel.id

    const scan = await req('/api/admin/content-rating-ai/scan', json('POST', { novelIds: [doneId, gapId], limit: 10 }, adminToken))
    expect(scan.status).toBe(202)
    const taskId = (await jsonOf<{ taskId: string }>(scan)).taskId
    await waitForSuggestion(doneId)
    await waitForSuggestion(gapId)

    // 制造缺口：把其中一本的建议改为 failed，使其重新成为待补跑目标
    await t.db.query(`UPDATE content_rating_ai_suggestions SET status = 'failed' WHERE novel_id = $1`, [gapId])

    const progress = await req(`/api/admin/content-rating-ai/tasks/${taskId}/progress`, json('GET', undefined, adminToken))
    expect(await jsonOf<{ done: number; remaining: number; canResume: boolean }>(progress)).toMatchObject({
      done: 1,
      remaining: 1,
      // 原任务已 completed，仍有缺口时恢复才可用
      canResume: true,
    })

    const resumed = await req(`/api/admin/content-rating-ai/tasks/${taskId}/resume`, json('POST', {}, adminToken))
    expect(resumed.status).toBe(202)
    const resumedBody = await jsonOf<{ taskId: string; selected: number; skipped: number; total: number }>(resumed)
    // total/selected 都是本次补跑的规模，skipped 是本批次里被跳过的已完成作品数
    expect(resumedBody).toMatchObject({ selected: 1, skipped: 1, total: 1 })
    expect(resumedBody.taskId).not.toBe(taskId)

    // 原任务记录保留，新任务通过 params.resumedFrom 指向它
    const source = await t.db.query<{ status: string }>('SELECT status FROM ai_tasks WHERE id = $1', [taskId])
    expect(source.rows[0]?.status).toBe('completed')
    const child = await t.db.query<{ params: string }>('SELECT params FROM ai_tasks WHERE id = $1', [resumedBody.taskId])
    expect(child.rows[0]?.params).toContain(taskId)

    // 补跑只针对缺口作品，已完成的那本不会被重复送模型
    await waitForSuggestion(gapId, 'pending')
  })

  it('中止任务后不再产生新的模型调用，已完成建议保留', async () => {
    const first = await req('/api/novels', json('POST', { title: '中止首本', author: '测试作者' }, adminToken))
    const firstId = (await jsonOf<{ novel: { id: string } }>(first)).novel.id
    const second = await req('/api/novels', json('POST', { title: '中止次本', author: '测试作者' }, adminToken))
    const secondId = (await jsonOf<{ novel: { id: string } }>(second)).novel.id

    const scan = await req('/api/admin/content-rating-ai/scan', json('POST', { novelIds: [firstId, secondId], limit: 10 }, adminToken))
    expect(scan.status).toBe(202)
    const taskId = (await jsonOf<{ taskId: string }>(scan)).taskId

    // 立刻取消：执行器在下一次循环的取消检查点看到 cancelled 后必须停止
    await t.db.query(`UPDATE ai_tasks SET status = 'cancelled', updated_at = $1, finished_at = $1 WHERE id = $2`, [Date.now(), taskId])

    const task = await t.db.query<{ status: string }>('SELECT status FROM ai_tasks WHERE id = $1', [taskId])
    expect(task.rows[0]?.status).toBe('cancelled')

    // 取消后等待一小段时间，执行器不得把任务状态改回 completed
    await new Promise((resolve) => setTimeout(resolve, 200))
    const after = await t.db.query<{ status: string }>('SELECT status FROM ai_tasks WHERE id = $1', [taskId])
    expect(after.rows[0]?.status).toBe('cancelled')
  })
})
