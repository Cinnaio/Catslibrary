import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { failInterruptedAiTasks } from '../services/ai/tasks'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb

/** OpenAI 兼容响应桩：不发真实请求，同时记录调用次数以验证缓存是否生效。 */
const fetchMock = vi.fn(async () =>
  new Response(
    JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content: '少年在雨夜捡到一柄断剑，被巡夜人盯上。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 24 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ),
)

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
  process.env.AI_TEXT_BASE_URL = 'https://ai.test/v1'
  process.env.AI_TEXT_API_KEY = 'test-key'
  process.env.AI_TEXT_MODEL = 'test-model'
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
  fetchMock.mockClear()
})

async function req(path: string, init?: RequestInit) {
  return app.request(path, init)
}
async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}
function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

const LONG_CONTENT = '雨落在青石板上，少年攥紧了那柄断剑，巷口的灯笼被风吹得摇晃。'.repeat(8)

describe('AI API 端到端（pglite + fetch 桩）', () => {
  let adminToken = ''
  let readerToken = ''
  let chapterId = ''
  let secondChapterId = ''
  let shortChapterId = ''
  let failChapterId = ''

  it('准备数据：管理员、读者、小说、章节', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['AI-INVITE', Date.now()])
    const reg = await req('/api/auth/register', json('POST', { username: 'reader', password: 'readerpass1', invite: 'AI-INVITE' }))
    readerToken = (await jsonOf<{ token: string }>(reg)).token

    const novel = await req('/api/novels', json('POST', { title: 'AI 测试书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id

    const c1 = await req('/api/chapters', json('POST', { novelId, title: '第一章', content: LONG_CONTENT }, adminToken))
    chapterId = (await jsonOf<{ chapter: { id: string } }>(c1)).chapter.id
    const c2 = await req('/api/chapters', json('POST', { novelId, title: '第二章', content: LONG_CONTENT }, adminToken))
    secondChapterId = (await jsonOf<{ chapter: { id: string } }>(c2)).chapter.id
    const c3 = await req('/api/chapters', json('POST', { novelId, title: '第三章', content: '太短了' }, adminToken))
    shortChapterId = (await jsonOf<{ chapter: { id: string } }>(c3)).chapter.id
    const c4 = await req('/api/chapters', json('POST', { novelId, title: '第四章', content: LONG_CONTENT }, adminToken))
    failChapterId = (await jsonOf<{ chapter: { id: string } }>(c4)).chapter.id
  })

  it('status：匿名不给能力，登录后开放', async () => {
    const anon = await jsonOf<{ configured: boolean; features: { recap: boolean } }>(await req('/api/ai/status'))
    expect(anon.configured).toBe(true)
    expect(anon.features.recap).toBe(false)

    const mine = await jsonOf<{ features: { recap: boolean }; quota: { limit: number } | null }>(
      await req('/api/ai/status', json('GET', undefined, readerToken)),
    )
    expect(mine.features.recap).toBe(true)
    expect(mine.quota?.limit).toBe(30)
  })

  it('recap：未登录 401，缺 chapterId 400', async () => {
    expect((await req('/api/ai/recap', json('POST', { chapterId }))).status).toBe(401)
    expect((await req('/api/ai/recap', json('POST', {}, readerToken))).status).toBe(400)
  })

  it('recap：首次生成调用上游并记账', async () => {
    const res = await req('/api/ai/recap', json('POST', { chapterId }, readerToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ recap: string; cached: boolean; model: string }>(res)
    expect(data.cached).toBe(false)
    expect(data.recap).toContain('断剑')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const { rows } = await t.db.query<{ prompt_tokens: number; completion_tokens: number }>('SELECT prompt_tokens, completion_tokens FROM ai_usage')
    expect(rows.length).toBe(1)
    expect(rows[0]!.prompt_tokens).toBe(120)
    expect(rows[0]!.completion_tokens).toBe(24)
  })

  it('recap：同章再请求命中缓存，不再调用上游、不再记账', async () => {
    const res = await req('/api/ai/recap', json('POST', { chapterId }, readerToken))
    const data = await jsonOf<{ cached: boolean; recap: string }>(res)
    expect(data.cached).toBe(true)
    expect(data.recap).toContain('断剑')
    expect(fetchMock).not.toHaveBeenCalled()

    const { rows } = await t.db.query('SELECT id FROM ai_usage')
    expect(rows.length).toBe(1)
  })

  it('GET /recap 只读缓存：命中返回内容，未命中返回空串且不生成', async () => {
    const hit = await jsonOf<{ recap: string; cached: boolean }>(
      await req(`/api/ai/recap?chapterId=${chapterId}`, json('GET', undefined, readerToken)),
    )
    expect(hit.cached).toBe(true)

    const miss = await jsonOf<{ recap: string; cached: boolean }>(
      await req(`/api/ai/recap?chapterId=${secondChapterId}`, json('GET', undefined, readerToken)),
    )
    expect(miss.cached).toBe(false)
    expect(miss.recap).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recap：章节过短 422，章节不存在 404', async () => {
    expect((await req('/api/ai/recap', json('POST', { chapterId: shortChapterId }, readerToken))).status).toBe(422)
    expect((await req('/api/ai/recap', json('POST', { chapterId: 'chapter_missing' }, readerToken))).status).toBe(404)
  })

  it('settings：非管理员 403，管理员可改配额', async () => {
    expect((await req('/api/ai/settings', json('GET', undefined, readerToken))).status).toBe(403)

    const saved = await req('/api/ai/settings', json('PUT', { dailyQuota: 1 }, adminToken))
    expect(saved.status).toBe(200)
    const { settings } = await jsonOf<{ settings: { dailyQuota: number; recapEnabled: boolean } }>(saved)
    expect(settings.dailyQuota).toBe(1)
    expect(settings.recapEnabled).toBe(true)

    // 越界值被夹回区间，不是原样落库
    const clamped = await req('/api/ai/settings', json('PUT', { maxChapterChars: 99999 }, adminToken))
    const { settings: s2 } = await jsonOf<{ settings: { maxChapterChars: number } }>(clamped)
    expect(s2.maxChapterChars).toBe(20000)
  })

  it('配额：读者超额 429，管理员不受限', async () => {
    // 读者今日已用 1 次，dailyQuota=1 → 新章节被拦
    const blocked = await req('/api/ai/recap', json('POST', { chapterId: secondChapterId }, readerToken))
    expect(blocked.status).toBe(429)
    expect((await jsonOf<{ code: string }>(blocked)).code).toBe('quota_exceeded')
    expect(fetchMock).not.toHaveBeenCalled()

    const byAdmin = await req('/api/ai/recap', json('POST', { chapterId: secondChapterId }, adminToken))
    expect(byAdmin.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('总开关关闭后读者侧立即不可用', async () => {
    await req('/api/ai/settings', json('PUT', { recapEnabled: false }, adminToken))
    const res = await req('/api/ai/recap', json('POST', { chapterId }, readerToken))
    expect(res.status).toBe(403)

    const status = await jsonOf<{ features: { recap: boolean } }>(await req('/api/ai/status', json('GET', undefined, readerToken)))
    expect(status.features.recap).toBe(false)
    await req('/api/ai/settings', json('PUT', { recapEnabled: true }, adminToken))
  })

  it('usage：管理员可读用量汇总', async () => {
    const res = await req('/api/ai/usage', json('GET', undefined, adminToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ today: { calls: number; promptTokens: number } }>(res)
    expect(data.today.calls).toBe(2)
    expect(data.today.promptTokens).toBe(240)
  })

  it('上游失败时返回 502，且不落缓存', async () => {
    const before = await t.db.query('SELECT id FROM ai_generations')
    fetchMock.mockImplementationOnce(async () => new Response('upstream boom', { status: 400 }))

    const res = await req('/api/ai/recap', json('POST', { chapterId: failChapterId }, adminToken))
    expect(res.status).toBe(502)
    expect((await jsonOf<{ code: string }>(res)).code).toBe('upstream')
    // 400 不属于可重试状态码，只应调用一次
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const after = await t.db.query('SELECT id FROM ai_generations')
    expect(after.rows.length).toBe(before.rows.length)
  })

  it('推理模型思考 token 吃满预算时，报截断而不是笼统的空回复', async () => {
    // deepseek-v4 类模型：max_tokens 被 reasoning_content 用光 → content 空 + finish_reason=length
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            model: 'test-model',
            choices: [{ message: { role: 'assistant', content: '', reasoning_content: '我需要先想想…' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 87, completion_tokens: 16 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const res = await req('/api/ai/recap', json('POST', { chapterId: failChapterId }, adminToken))
    expect(res.status).toBe(422)
    const data = await jsonOf<{ code: string; error: string }>(res)
    expect(data.code).toBe('invalid')
    expect(data.error).toContain('max_tokens')
  })

  it('content 为分片数组时也能取到文本', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            model: 'test-model',
            choices: [{ message: { content: [{ type: 'text', text: '分片' }, { type: 'text', text: '文本' }] }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const res = await req('/api/ai/recap', json('POST', { chapterId: failChapterId }, adminToken))
    expect(res.status).toBe(200)
    expect((await jsonOf<{ recap: string }>(res)).recap).toBe('分片文本')
  })

  // ---------- 任务 1 · 章节正文更新后作废提要缓存 ----------

  it('PUT 改正文后提要缓存作废，只改标题不失效', async () => {
    // 恢复读者配额，避免前面用例把 dailyQuota 调到 1 影响后续
    await req('/api/ai/settings', json('PUT', { dailyQuota: 30, recapEnabled: true }, adminToken))
    const nid = await firstNovelId(t)

    const created = await req('/api/chapters', json('POST', { novelId: nid, title: '缓存作废章', content: LONG_CONTENT }, adminToken))
    const chId = (await jsonOf<{ chapter: { id: string } }>(created)).chapter.id

    const gen = await req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken))
    expect((await jsonOf<{ cached: boolean }>(gen)).cached).toBe(false)

    const before = await jsonOf<{ cached: boolean; recap: string }>(await req(`/api/ai/recap?chapterId=${chId}`, json('GET', undefined, readerToken)))
    expect(before.cached).toBe(true)

    // 改正文 → 缓存作废
    await req(`/api/chapters/${chId}`, json('PUT', { content: LONG_CONTENT + '改过的结尾。' }, adminToken))
    const invalidated = await jsonOf<{ cached: boolean; recap: string }>(
      await req(`/api/ai/recap?chapterId=${chId}`, json('GET', undefined, readerToken)),
    )
    expect(invalidated.cached).toBe(false)
    expect(invalidated.recap).toBe('')

    // 重新生成后只改标题 → 缓存仍有效
    await req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken))
    await req(`/api/chapters/${chId}`, json('PUT', { title: '缓存作废章（改标题）' }, adminToken))
    const afterTitle = await jsonOf<{ cached: boolean }>(await req(`/api/ai/recap?chapterId=${chId}`, json('GET', undefined, readerToken)))
    expect(afterTitle.cached).toBe(true)
  })

  // ---------- 任务 2 · 同章并发去重 ----------

  it('同章并发只打一次上游，只记一次账', async () => {
    const nid = await firstNovelId(t)
    const created = await req('/api/chapters', json('POST', { novelId: nid, title: '并发章', content: LONG_CONTENT }, adminToken))
    const chId = (await jsonOf<{ chapter: { id: string } }>(created)).chapter.id

    const before = await t.db.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM ai_usage')
    const beforeCount = Number(before.rows[0]?.total) || 0

    // 桩延迟 50ms：确保两个请求都先过了缓存检查，再同时进 generateRecap
    fetchMock.mockImplementationOnce(
      async () => {
        await sleep(50)
        return new Response(
          JSON.stringify({
            model: 'test-model',
            choices: [{ message: { content: '并发生成的同一段提要内容。' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    )

    const [a, b] = await Promise.all([
      req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken)),
      req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken)),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const [da, db2] = await Promise.all([jsonOf<{ recap: string }>(a), jsonOf<{ recap: string }>(b)])
    expect(da.recap).toBe('并发生成的同一段提要内容。')
    expect(db2.recap).toBe(da.recap)

    // 只调用一次上游、只多一行用量
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const after = await t.db.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM ai_usage')
    expect(Number(after.rows[0]?.total) || 0).toBe(beforeCount + 1)
  })

  // ---------- 任务 3 · 采集真实成本 ----------

  it('上游回显 cost 时落库 cost_millicents', async () => {
    const nid = await firstNovelId(t)
    const created = await req('/api/chapters', json('POST', { novelId: nid, title: '成本章', content: LONG_CONTENT }, adminToken))
    const chId = (await jsonOf<{ chapter: { id: string } }>(created)).chapter.id

    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            model: 'test-model',
            cost: '0.00123',
            choices: [{ message: { content: '成本采集提要。' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 90, completion_tokens: 18 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )

    const res = await req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken))
    expect(res.status).toBe(200)

    const { rows } = await t.db.query<{ cost_millicents: number }>(
      'SELECT cost_millicents FROM ai_usage ORDER BY created_at DESC LIMIT 1',
    )
    expect(Number(rows[0]?.cost_millicents)).toBe(123)
  })

  // ---------- 任务 4 · 回来接着读（进度感知回顾） ----------

  it('catchup：原料足够时合成一段回顾，只调用一次上游', async () => {
    const readerId = await userIdByUsername(t, 'reader')
    // 新开一本：保证这本书没有任何历史进度/缓存干扰
    const novel = await req('/api/novels', json('POST', { title: '回顾测试书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id

    // 建 3 章并各自生成提要（published 缓存）
    const ids: string[] = []
    for (let i = 1; i <= 3; i++) {
      const c = await req('/api/chapters', json('POST', { novelId, title: `第${i}章`, content: LONG_CONTENT }, adminToken))
      const chId = (await jsonOf<{ chapter: { id: string } }>(c)).chapter.id
      ids.push(chId)
    }
    for (const chId of ids) {
      await req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken))
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // 读者读到最后一行：进度落在最后一章
    await t.db.query(
      'INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at) VALUES ($1,$2,$3,$4,0.5,$5,0)',
      [`prog_catchup_${novelId}`, readerId, novelId, ids[2]!, Date.now() - 8 * 24 * 60 * 60 * 1000],
    )

    fetchMock.mockClear()
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            model: 'test-model',
            choices: [{ message: { content: '这是把你接回剧情的一段连贯回顾。' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 200, completion_tokens: 30 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )

    const res = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ recap: string | null; cached: boolean; chapterIds?: string[] }>(res)
    expect(data.cached).toBe(false)
    expect(data.recap).toContain('回顾')
    expect(data.chapterIds?.length).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 二次请求命中缓存：不再调上游、不记账
    fetchMock.mockClear()
    const hit = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    const hitData = await jsonOf<{ cached: boolean; recap: string }>(hit)
    expect(hitData.cached).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('catchup：已缓存提要不足 2 条时返回 null，完全不调用上游', async () => {
    const readerId = await userIdByUsername(t, 'reader')
    const novel = await req('/api/novels', json('POST', { title: '回顾不足书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id

    // 只有 1 章且有提要 → 不足 2 条
    const c = await req('/api/chapters', json('POST', { novelId, title: '孤章', content: LONG_CONTENT }, adminToken))
    const chId = (await jsonOf<{ chapter: { id: string } }>(c)).chapter.id
    await req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken))

    await t.db.query(
      'INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at) VALUES ($1,$2,$3,$4,0.5,$5,0)',
      [`prog_solo_${novelId}`, readerId, novelId, chId, Date.now() - 8 * 24 * 60 * 60 * 1000],
    )

    fetchMock.mockClear()
    const res = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ recap: string | null; cached: boolean; reason?: string }>(res)
    expect(data.recap).toBeNull()
    expect(data.cached).toBe(false)
    expect(data.reason).toBe('insufficient_summaries')
    // 完全不触发批量生成：一个上游请求都没有
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('catchup：未超过 7 天时由后端拒绝，不检查配额也不调用上游', async () => {
    const readerId = await userIdByUsername(t, 'reader')
    const novel = await req('/api/novels', json('POST', { title: '未过期回顾书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id
    const c1 = await req('/api/chapters', json('POST', { novelId, title: '第一章', content: LONG_CONTENT }, adminToken))
    const chId = (await jsonOf<{ chapter: { id: string } }>(c1)).chapter.id
    await t.db.query(
      'INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at) VALUES ($1,$2,$3,$4,0.5,$5,0)',
      [`prog_fresh_${novelId}`, readerId, novelId, chId, Date.now()],
    )
    await req('/api/ai/settings', json('PUT', { dailyQuota: 0 }, adminToken))
    fetchMock.mockClear()
    const res = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ recap: string | null; reason?: string }>(res)
    expect(data.recap).toBeNull()
    expect(data.reason).toBe('not_stale')
    expect(fetchMock).not.toHaveBeenCalled()
    await req('/api/ai/settings', json('PUT', { dailyQuota: 30 }, adminToken))
  })

  it('catchup：无进度时返回 no_progress，不检查配额', async () => {
    const novel = await req('/api/novels', json('POST', { title: '无进度回顾书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id
    await req('/api/ai/settings', json('PUT', { dailyQuota: 0 }, adminToken))
    const res = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ recap: string | null; reason?: string }>(res)
    expect(data.recap).toBeNull()
    expect(data.reason).toBe('no_progress')
    await req('/api/ai/settings', json('PUT', { dailyQuota: 30 }, adminToken))
  })

  it('catchup：已删除进度视为无进度', async () => {
    const readerId = await userIdByUsername(t, 'reader')
    const novel = await req('/api/novels', json('POST', { title: '删除进度回顾书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id
    const c1 = await req('/api/chapters', json('POST', { novelId, title: '第一章', content: LONG_CONTENT }, adminToken))
    const chId = (await jsonOf<{ chapter: { id: string } }>(c1)).chapter.id
    await t.db.query(
      'INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at) VALUES ($1,$2,$3,$4,0.5,$5,1)',
      [`prog_deleted_${novelId}`, readerId, novelId, chId, Date.now() - 8 * 24 * 60 * 60 * 1000],
    )
    const res = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    const data = await jsonOf<{ recap: string | null; reason?: string }>(res)
    expect(data.recap).toBeNull()
    expect(data.reason).toBe('no_progress')
  })

  it('catchup：单章摘要重生成后不命中旧回顾缓存', async () => {
    const readerId = await userIdByUsername(t, 'reader')
    const novel = await req('/api/novels', json('POST', { title: '摘要版本回顾书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id
    const ids: string[] = []
    for (let i = 1; i <= 3; i++) {
      const c = await req('/api/chapters', json('POST', { novelId, title: `第${i}章`, content: LONG_CONTENT }, adminToken))
      ids.push((await jsonOf<{ chapter: { id: string } }>(c)).chapter.id)
    }
    for (const chId of ids) await req('/api/ai/recap', json('POST', { chapterId: chId }, readerToken))
    await t.db.query(
      'INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at) VALUES ($1,$2,$3,$4,0.5,$5,0)',
      [`prog_version_${novelId}`, readerId, novelId, ids[2]!, Date.now() - 8 * 24 * 60 * 60 * 1000],
    )
    fetchMock.mockClear()
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: '第一次回顾。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const firstCatchup = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    expect(firstCatchup.status).toBe(200)
    expect((await jsonOf<{ cached: boolean }>(firstCatchup)).cached).toBe(false)
    fetchMock.mockClear()
    await req(`/api/chapters/${ids[1]}`, json('PUT', { content: LONG_CONTENT + '正文变更。' }, adminToken))
    await req('/api/ai/recap', json('POST', { chapterId: ids[1] }, readerToken))
    const secondCatchup = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
    expect(secondCatchup.status).toBe(200)
    expect((await jsonOf<{ cached: boolean }>(secondCatchup)).cached).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('catchup：未登录 401，缺 novelId 400', async () => {
    expect((await req('/api/ai/catchup', json('POST', { novelId: 'x' }))).status).toBe(401)
    expect((await req('/api/ai/catchup', json('POST', {}, readerToken))).status).toBe(400)
  })

  it('已生成内容：非管理员 403，列表带小说/章节标题，删除后缓存失效', async () => {
    // 管理员生成一条提要（管理员不受配额限制）
    const gen = await req('/api/ai/recap', json('POST', { chapterId: secondChapterId }, adminToken))
    expect(gen.status).toBe(200)
    const { id } = await jsonOf<{ id: string }>(gen)

    // 读者无权访问管理列表
    const forbidden = await req('/api/ai/generations', json('GET', undefined, readerToken))
    expect(forbidden.status).toBe(403)

    // 列表可见这条内容，且带小说/章节标题
    const list = await req('/api/ai/generations', json('GET', undefined, adminToken))
    const listBody = await jsonOf<{ items: Array<{ id: string; novelTitle: string; chapterTitle: string; kind: string; status: string }>; total: number }>(list)
    expect(list.status).toBe(200)
    expect(listBody.total).toBeGreaterThan(0)
    const mine = listBody.items.find((i) => i.id === id)
    expect(mine).toBeDefined()
    expect(mine?.novelTitle).toBe('AI 测试书')
    expect(mine?.chapterTitle).toBe('第二章')
    expect(mine?.kind).toBe('summary')
    expect(mine?.status).toBe('published')

    // 删除后：再删 404，且只读缓存不再命中
    const del = await req(`/api/ai/generations/${id}`, json('DELETE', undefined, adminToken))
    expect(del.status).toBe(200)
    expect((await req(`/api/ai/generations/${id}`, json('DELETE', undefined, adminToken))).status).toBe(404)

    const cached = await req(`/api/ai/recap?chapterId=${secondChapterId}`, json('GET', undefined, adminToken))
    const cachedBody = await jsonOf<{ cached: boolean; recap: string }>(cached)
    expect(cachedBody.cached).toBe(false)
    expect(cachedBody.recap).toBe('')
  })

  it('AI 创作：大纲/章节走后台任务生成草稿，编辑后发布为正式章节', async () => {
    const novelId = await firstNovelId(t)
    const outlineStart = await req('/api/ai/writing/outline', json('POST', { title: '新作品', instruction: '悬疑开篇' }, adminToken))
    expect(outlineStart.status).toBe(202)
    const outlineTaskId = (await jsonOf<{ taskId: string }>(outlineStart)).taskId
    expect((await waitForTask(outlineTaskId, adminToken)).status).toBe('completed')
    const { rows: outlineRows } = await t.db.query<{ id: string; result: string; status: string }>(
      "SELECT id, result, status FROM ai_generations WHERE kind = 'write_outline' ORDER BY created_at DESC LIMIT 1",
    )
    expect(outlineRows[0]?.status).toBe('draft')
    expect((outlineRows[0]?.result || '').length).toBeGreaterThan(0)

    const chapterStart = await req('/api/ai/writing/chapter', json('POST', { novelId, title: 'AI 测试书', outline: outlineRows[0]!.result, instruction: '写一个紧张的开场' }, adminToken))
    expect(chapterStart.status).toBe(202)
    const chapterTaskId = (await jsonOf<{ taskId: string }>(chapterStart)).taskId
    expect((await waitForTask(chapterTaskId, adminToken)).status).toBe('completed')
    const { rows: chapterRows } = await t.db.query<{ id: string; status: string }>(
      "SELECT id, status FROM ai_generations WHERE kind = 'write_chapter' ORDER BY created_at DESC LIMIT 1",
    )
    expect(chapterRows[0]?.status).toBe('draft')
    const draftId = chapterRows[0]!.id

    const edited = await req(`/api/ai/writing/drafts/${draftId}`, json('PUT', { result: '编辑后的章节正文。' }, adminToken))
    expect(edited.status).toBe(200)
    const published = await req(`/api/ai/writing/drafts/${draftId}/publish`, json('POST', { novelId, title: 'AI 创作章' }, adminToken))
    expect(published.status).toBe(200)
    const publishedBody = await jsonOf<{ chapter: { id: string; title: string } }>(published)
    expect(publishedBody.chapter.title).toBe('AI 创作章')

    const savedChapter = await req(`/api/chapters/${publishedBody.chapter.id}`)
    expect((await jsonOf<{ chapter: { content: string } }>(savedChapter)).chapter.content).toBe('编辑后的章节正文。')
    const forbidden = await req('/api/ai/writing/continue', json('POST', { novelId }, readerToken))
    expect(forbidden.status).toBe(403)
  })

  it('自定义系统提示词后缓存键变化：改提示词即失效并重新生成', async () => {
    // 记录修改前的提示词，测试结束后恢复，避免影响其它用例
    const before = await req('/api/ai/settings', json('GET', undefined, adminToken))
    const beforePrompt = (await jsonOf<{ settings: { recapSystemPrompt: string } }>(before)).settings.recapSystemPrompt

    // 默认提示词下给 chapterId 生成/命中提要
    const defaultRecap = await req('/api/ai/recap', json('POST', { chapterId }, adminToken))
    expect(defaultRecap.status).toBe(200)
    const defaultBody = await jsonOf<{ id: string; cached: boolean }>(defaultRecap)

    // 管理员自定义系统提示词
    const CUSTOM_PROMPT = '你是一个很会讲故事的小说读者，请用极具感染力的语言复述上一章。'
    const saved = await req('/api/ai/settings', json('PUT', { recapSystemPrompt: CUSTOM_PROMPT }, adminToken))
    expect(saved.status).toBe(200)

    try {
      // 同章再次生成：缓存键含提示词指纹，旧缓存不命中，必须重新调上游
      const regen = await req('/api/ai/recap', json('POST', { chapterId }, adminToken))
      expect(regen.status).toBe(200)
      const regenBody = await jsonOf<{ cached: boolean; id: string }>(regen)
      expect(regenBody.cached).toBe(false)
      expect(regenBody.id).not.toBe(defaultBody.id)

      // 再次请求命中新提示词的缓存
      const hit = await req('/api/ai/recap', json('POST', { chapterId }, adminToken))
      const hitBody = await jsonOf<{ cached: boolean; id: string }>(hit)
      expect(hitBody.cached).toBe(true)
      expect(hitBody.id).toBe(regenBody.id)
    } finally {
      await req('/api/ai/settings', json('PUT', { recapSystemPrompt: beforePrompt }, adminToken))
    }
  })
  it('多章续写后台执行：立即返回 taskId，每章一条草稿且批次号一致', async () => {
    const novelId = await firstNovelId(t)
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({
        model: 'test-model',
        choices: [{ message: { content: 'chapter continuation' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    const response = await req('/api/ai/writing/continue', json('POST', { novelId, chapterCount: 20, targetWords: 1200 }, adminToken))
    expect(response.status).toBe(202)
    const data = await jsonOf<{ ok: boolean; taskId: string; batchId: string; total: number }>(response)
    expect(data.ok).toBe(true)
    expect(data.total).toBe(20)

    const task = await waitForTask(data.taskId, adminToken)
    expect(task.status).toBe('completed')
    expect(task.current).toBe(20)
    expect(fetchMock).toHaveBeenCalledTimes(20)

    const rows = await t.db.query<{ params_json: string }>("SELECT params_json FROM ai_generations WHERE kind = 'continue' ORDER BY created_at DESC LIMIT 20")
    expect(rows.rows).toHaveLength(20)
    expect(rows.rows.every((row) => JSON.parse(row.params_json).targetWords === 1200)).toBe(true)
    // 草稿的批次号与接口返回的一致，前端可按 batchId 归组
    expect(rows.rows.every((row) => JSON.parse(row.params_json).batchId === data.batchId)).toBe(true)
  })

  it('后台续写上游失败时任务标记 failed 并携带错误信息', async () => {
    const novelId = await firstNovelId(t)
    fetchMock.mockImplementationOnce(async () => new Response('upstream boom', { status: 400 }))

    const response = await req('/api/ai/writing/continue', json('POST', { novelId, chapterCount: 2 }, adminToken))
    expect(response.status).toBe(202)
    const { taskId } = await jsonOf<{ taskId: string }>(response)

    const task = await waitForTask(taskId, adminToken)
    expect(task.status).toBe('failed')
    expect(task.error.length).toBeGreaterThan(0)
  })

  it('GET /tasks/:id：任务不存在 404，非管理员 403', async () => {
    expect((await req('/api/ai/tasks/task_missing', json('GET', undefined, adminToken))).status).toBe(404)
    expect((await req('/api/ai/tasks/task_missing', json('GET', undefined, readerToken))).status).toBe(403)
  })

  it('失败任务可按原参数重试：新任务完成并产出草稿，任务列表支持状态筛选', async () => {
    // 上一个用例留下一个失败的续写任务（chapterCount: 2）
    const failedList = await jsonOf<{ items: Array<{ id: string; status: string; kind: string; params: string }> }>(
      await req('/api/ai/tasks?status=failed', json('GET', undefined, adminToken)),
    )
    expect(failedList.items.every((item) => item.status === 'failed')).toBe(true)
    const failed = failedList.items.find((item) => item.kind === 'continue')
    expect(failed).toBeDefined()
    expect(failed!.params.length).toBeGreaterThan(0)

    const retried = await req(`/api/ai/tasks/${failed!.id}/retry`, json('POST', {}, adminToken))
    expect(retried.status).toBe(202)
    const { taskId, batchId } = await jsonOf<{ taskId: string; batchId: string }>(retried)
    expect(taskId).not.toBe(failed!.id)

    const task = await waitForTask(taskId, adminToken)
    expect(task.status).toBe('completed')
    expect(task.current).toBe(2)

    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM ai_generations WHERE kind = 'continue' AND params_json LIKE $1`,
      [`%"batchId":"${batchId}"%`],
    )
    expect(rows).toHaveLength(2)

    // 已完成的任务不能重试；不存在的任务 404
    expect((await req(`/api/ai/tasks/${taskId}/retry`, json('POST', {}, adminToken))).status).toBe(409)
    expect((await req('/api/ai/tasks/task_missing/retry', json('POST', {}, adminToken))).status).toBe(404)
  })

  // ---------- 参数调优设置真实生效 ----------

  it('recap 生成使用参数调优里的温度与 token 上限', async () => {
    await req('/api/ai/settings', json('PUT', { recapTemperature: 0.55, recapMaxTokens: 888 }, adminToken))
    try {
      const nid = await firstNovelId(t)
      const created = await req('/api/chapters', json('POST', { novelId: nid, title: '调参提要章', content: LONG_CONTENT }, adminToken))
      const chId = (await jsonOf<{ chapter: { id: string } }>(created)).chapter.id

      const res = await req('/api/ai/recap', json('POST', { chapterId: chId }, adminToken))
      expect(res.status).toBe(200)

      const lastCall = fetchMock.mock.calls.at(-1) as unknown as [string, { body: string }]
      const payload = JSON.parse(lastCall[1].body) as { temperature: number; max_tokens: number }
      expect(payload.temperature).toBe(0.55)
      expect(payload.max_tokens).toBe(888)
    } finally {
      await req('/api/ai/settings', json('PUT', { recapTemperature: 0.2, recapMaxTokens: 1200 }, adminToken))
    }
  })

  it('catchup 生成使用参数调优里的温度 / token / 最大章节数', async () => {
    const readerId = await userIdByUsername(t, 'reader')
    await req('/api/ai/settings', json('PUT', { catchupTemperature: 0.44, catchupMaxTokens: 777, catchupMaxChapters: 2 }, adminToken))
    try {
      const novel = await req('/api/novels', json('POST', { title: '调参回顾书', author: '某作者' }, adminToken))
      const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id
      const ids: string[] = []
      for (let i = 1; i <= 3; i++) {
        const c = await req('/api/chapters', json('POST', { novelId, title: `第${i}章`, content: LONG_CONTENT }, adminToken))
        ids.push((await jsonOf<{ chapter: { id: string } }>(c)).chapter.id)
      }
      for (const chId of ids) await req('/api/ai/recap', json('POST', { chapterId: chId }, adminToken))
      await t.db.query(
        'INSERT INTO reading_progress (id, user_id, novel_id, chapter_id, scroll_percent, updated_at, deleted_at) VALUES ($1,$2,$3,$4,0.5,$5,0)',
        [`prog_params_${novelId}`, readerId, novelId, ids[2]!, Date.now() - 8 * 24 * 60 * 60 * 1000],
      )

      const res = await req('/api/ai/catchup', json('POST', { novelId }, readerToken))
      expect(res.status).toBe(200)
      const data = await jsonOf<{ cached: boolean; chapterIds?: string[] }>(res)
      expect(data.cached).toBe(false)
      // catchupMaxChapters=2：3 章都有提要，但只取进度章往前 2 章
      expect(data.chapterIds?.length).toBe(2)

      const lastCall = fetchMock.mock.calls.at(-1) as unknown as [string, { body: string }]
      const payload = JSON.parse(lastCall[1].body) as { temperature: number; max_tokens: number }
      expect(payload.temperature).toBe(0.44)
      expect(payload.max_tokens).toBe(777)
    } finally {
      await req('/api/ai/settings', json('PUT', { catchupTemperature: 0.2, catchupMaxTokens: 1200, catchupMaxChapters: 5 }, adminToken))
    }
  })

  it('catchupEnabled 独立于 recapEnabled：关闭后 catchup 403，recap 不受影响', async () => {
    await req('/api/ai/settings', json('PUT', { catchupEnabled: false }, adminToken))
    try {
      const status = await jsonOf<{ features: { recap: boolean; catchup: boolean } }>(
        await req('/api/ai/status', json('GET', undefined, readerToken)),
      )
      expect(status.features.recap).toBe(true)
      expect(status.features.catchup).toBe(false)

      const res = await req('/api/ai/catchup', json('POST', { novelId: 'whatever' }, readerToken))
      expect(res.status).toBe(403)
      expect((await jsonOf<{ code: string }>(res)).code).toBe('disabled')
    } finally {
      await req('/api/ai/settings', json('PUT', { catchupEnabled: true }, adminToken))
    }
  })

  // ---------- 启动恢复：中断任务标记失败 ----------

  it('failInterruptedAiTasks 只处理 queued/running，已结束任务不动', async () => {
    const now = Date.now()
    await t.db.query(
      `INSERT INTO ai_tasks (id,user_id,novel_id,kind,status,current,total,step,prompt,batch_id,error,created_at,updated_at,finished_at) VALUES
       ('task_interrupt_run','u1','','continue','running',1,3,'生成中','','','',$1,$1,0),
       ('task_interrupt_queue','u1','','continue','queued',0,1,'','','','',$1,$1,0),
       ('task_interrupt_done','u1','','continue','completed',1,1,'已完成','','','',$1,$1,$1)`,
      [now],
    )

    const affected = await failInterruptedAiTasks(t.db)
    expect(affected).toBe(2)

    const { rows } = await t.db.query<{ id: string; status: string; error: string; finished_at: number }>(
      "SELECT id, status, error, finished_at FROM ai_tasks WHERE id LIKE 'task_interrupt_%' ORDER BY id",
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get('task_interrupt_run')?.status).toBe('failed')
    expect(byId.get('task_interrupt_run')?.error).toContain('中断')
    expect(Number(byId.get('task_interrupt_run')?.finished_at)).toBeGreaterThan(0)
    expect(byId.get('task_interrupt_queue')?.status).toBe('failed')
    expect(byId.get('task_interrupt_done')?.status).toBe('completed')
  })

  // ---------- 草稿发布：事务化与重复发布保护 ----------

  it('发布事务化：重复发布同一草稿被拒，连续发布序号递增，计数一致', async () => {
    const novelId = await firstNovelId(t)

    async function makeDraft(): Promise<string> {
      const res = await req('/api/ai/writing/chapter', json('POST', { novelId, title: 'AI 测试书', instruction: '写一段' }, adminToken))
      expect(res.status).toBe(202)
      const { taskId } = await jsonOf<{ taskId: string }>(res)
      expect((await waitForTask(taskId, adminToken)).status).toBe('completed')
      const { rows } = await t.db.query<{ id: string }>(
        "SELECT id FROM ai_generations WHERE kind = 'write_chapter' AND status = 'draft' ORDER BY created_at DESC LIMIT 1",
      )
      return rows[0]!.id
    }
    const draft1 = await makeDraft()
    const draft2 = await makeDraft()

    const p1 = await req(`/api/ai/writing/drafts/${draft1}/publish`, json('POST', { novelId, title: '事务发布一' }, adminToken))
    expect(p1.status).toBe(200)
    const c1 = (await jsonOf<{ chapter: { order: number } }>(p1)).chapter

    // 已发布的草稿不能再次发布
    const again = await req(`/api/ai/writing/drafts/${draft1}/publish`, json('POST', { novelId, title: '事务发布一' }, adminToken))
    expect(again.status).toBe(404)

    const p2 = await req(`/api/ai/writing/drafts/${draft2}/publish`, json('POST', { novelId, title: '事务发布二' }, adminToken))
    expect(p2.status).toBe(200)
    const c2 = (await jsonOf<{ chapter: { order: number } }>(p2)).chapter
    expect(c2.order).toBe(c1.order + 1)

    // 小说不存在：整体回滚，草稿保持 draft 可再次发布
    const draft3 = await makeDraft()
    const missing = await req(`/api/ai/writing/drafts/${draft3}/publish`, json('POST', { novelId: 'novel_missing', title: '不存在' }, adminToken))
    expect(missing.status).toBe(404)
    const { rows: draftRows } = await t.db.query<{ status: string }>('SELECT status FROM ai_generations WHERE id = $1', [draft3])
    expect(draftRows[0]?.status).toBe('draft')

    // chapter_count 与真实章节数一致
    const { rows } = await t.db.query<{ chapter_count: number; actual: number }>(
      'SELECT n.chapter_count, (SELECT COUNT(*)::int FROM chapters c WHERE c.novel_id = n.id) AS actual FROM novels n WHERE n.id = $1',
      [novelId],
    )
    expect(Number(rows[0]?.chapter_count)).toBe(Number(rows[0]?.actual))
  })

  it('整批发布：按批次顺序发布剩余草稿，序号衔接现有章节，重复发布 404', async () => {
    // 新书隔离，避免影响其它用例的章节计数
    const novel = await req('/api/novels', json('POST', { title: '整批发布书', author: '某作者' }, adminToken))
    const novelId = (await jsonOf<{ novel: { id: string } }>(novel)).novel.id
    await req('/api/chapters', json('POST', { novelId, title: '第 1 章', content: LONG_CONTENT }, adminToken))

    const started = await req('/api/ai/writing/continue', json('POST', { novelId, chapterCount: 3 }, adminToken))
    expect(started.status).toBe(202)
    const { taskId, batchId } = await jsonOf<{ taskId: string; batchId: string }>(started)
    expect((await waitForTask(taskId, adminToken)).status).toBe('completed')

    // 先单独发布批次里的第 2 章草稿：整批发布应跳过它
    const { rows: draftRows } = await t.db.query<{ id: string; params_json: string }>(
      `SELECT id, params_json FROM ai_generations WHERE kind = 'continue' AND status = 'draft' AND params_json LIKE $1`,
      [`%"batchId":"${batchId}"%`],
    )
    expect(draftRows).toHaveLength(3)
    const second = draftRows
      .map((row) => ({ id: row.id, idx: Number((JSON.parse(row.params_json) as { batchIndex: number }).batchIndex) }))
      .find((draft) => draft.idx === 2)!
    const single = await req(`/api/ai/writing/drafts/${second.id}/publish`, json('POST', { novelId, title: '手动发布章' }, adminToken))
    expect(single.status).toBe(200)

    // 整批发布剩余 2 章：标题「第 N 章」沿现有序号递增
    const batch = await req(`/api/ai/writing/batches/${batchId}/publish`, json('POST', { novelId }, adminToken))
    expect(batch.status).toBe(200)
    const body = await jsonOf<{ published: Array<{ title: string; order: number }> }>(batch)
    expect(body.published).toHaveLength(2)
    expect(body.published.map((chapter) => chapter.order)).toEqual([3, 4])
    expect(body.published.map((chapter) => chapter.title)).toEqual(['第 3 章', '第 4 章'])

    // 批次里已无草稿：重复整批发布 404
    expect((await req(`/api/ai/writing/batches/${batchId}/publish`, json('POST', { novelId }, adminToken))).status).toBe(404)

    // 章节计数与真实章节数一致（1 手写 + 1 单发 + 2 整批 = 4）
    const { rows } = await t.db.query<{ chapter_count: number }>('SELECT chapter_count FROM novels WHERE id = $1', [novelId])
    expect(Number(rows[0]?.chapter_count)).toBe(4)
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询后台任务直到离开 queued/running（fetch 桩是即时返回，通常几个事件循环就结束）。 */
async function waitForTask(taskId: string, token: string): Promise<{ status: string; current: number; total: number; error: string }> {
  for (let i = 0; i < 500; i++) {
    const res = await app.request(`/api/ai/tasks/${taskId}`, json('GET', undefined, token))
    const { task } = (await res.json()) as { task: { status: string; current: number; total: number; error: string } }
    if (task.status !== 'queued' && task.status !== 'running') return task
    await sleep(10)
  }
  throw new Error(`任务 ${taskId} 超时未结束`)
}

/** 测试库里的第一本小说 id（各用例内新建章节用）。 */
async function firstNovelId(t: TestDb): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>('SELECT id FROM novels ORDER BY created_at LIMIT 1')
  return String(rows[0]?.id || '')
}

/** 按用户名取 user id。 */
async function userIdByUsername(t: TestDb, username: string): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])
  return String(rows[0]?.id || '')
}
