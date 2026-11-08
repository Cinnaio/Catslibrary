import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { runMigrations } from '../db/migrate'
import { setDbForTests, type Db } from '../db/pool'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { saveAiSettings } from '../services/ai/settings'
import { checkQuota, recordUsage, reserveReaderQuota, settleReaderQuota, startOfToday, startOfTomorrow } from '../services/ai/usage'
import { saveGeneration } from '../services/ai/generations'
import { generateRecap, recapParams } from '../services/ai/summary'

const mocks = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('../services/ai/client', async original => ({
  ...await original<typeof import('../services/ai/client')>(),
  chat: mocks.chat,
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'fixture' }),
}))
import { app } from '../app'
import { AiError } from '../services/ai/client'

const integrationUrl = process.env.READER_RELIABILITY_TEST_DATABASE_URL
const tokens = { reader: 'a'.repeat(64), expired: 'b'.repeat(64), other: 'c'.repeat(64), admin: 'd'.repeat(64) }
const content = '少年走进书院，借了一本旧书，开始阅读古人的故事。'.repeat(30)
const reply = { text: '少年在书院阅读。', model: 'fixture', promptTokens: 20, completionTokens: 10, cost: 0 }
let db: Db
let memory: TestDb | undefined

function request(path: string, method = 'GET', body?: unknown, who: keyof typeof tokens | null = 'reader', cookie = false) {
  return app.request('http://localhost/api' + path, {
    method, headers: {
      'Content-Type': 'application/json',
      ...(who && !cookie ? { Authorization: `Bearer ${tokens[who]}` } : {}),
      ...(cookie ? { Cookie: `zz_session=${who ? tokens[who] : ''}`, Origin: 'http://localhost', 'X-Session-Transport': 'cookie', 'X-ZZ-CSRF': '1', 'X-ZZ-Account': 'reader' } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeAll(async () => {
  if (integrationUrl) {
    const url = new URL(integrationUrl)
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/reader_reliability_test') throw new Error('Requires an isolated local reader test database')
    db = new Pool({ connectionString: integrationUrl, max: 8 }) as unknown as Db
    await runMigrations(db)
  } else {
    memory = await createTestDb()
    await memory.applyMigrations()
    db = memory.db
  }
  setDbForTests(db)
  process.env.DATABASE_URL = 'postgres://fixture/fixture'
  process.env.COVER_FETCH_ENABLED = '0'
  const now = Date.now()
  for (const who of ['reader', 'other', 'admin'] as const) {
    await db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,$2,'unused','unused',$3,$3)", [who, who === 'admin' ? 'admin' : 'reader', now])
  }
  for (const [who, token] of Object.entries(tokens)) {
    await db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,$2,$3,$4,$4)',
      [await hashToken(token, loadConfig().sessionHashSalt), who === 'expired' ? 'reader' : who, who === 'expired' ? now - 1000 : now + 86400000, now - 2000])
  }
  await db.query("INSERT INTO novels(id,title,content_rating,status,created_at,updated_at) VALUES('book','书院','general','ongoing',$1,$1)", [now])
  for (let i = 1; i <= 3; i++) {
    await db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,'book',$1,$2,$3,$4)", [`ch${i}`, content, i, now])
  }
})

beforeEach(async () => {
  for (const table of ['ai_quota_reservations', 'ai_usage', 'ai_generations', 'reading_progress']) await db.query(`DELETE FROM ${table}`)
  await saveAiSettings(db, { dailyQuota: 1, recapEnabled: true, catchupEnabled: true })
  mocks.chat.mockReset().mockResolvedValue(reply)
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  if (memory) await memory.close()
  else if (db) await db.end()
})

it.each([false, true])('过期会话的进度写入和删除返回 401，已有记录保留（Cookie=%s）', async cookie => {
  const body = { novelId: 'book', chapterId: 'ch1', scrollPercent: .7, clientUpdatedAt: Date.now() }
  expect((await request('/progress', 'POST', body, 'expired', cookie)).status).toBe(401)
  expect((await db.query('SELECT * FROM reading_progress')).rows).toHaveLength(0)
  expect((await request('/progress', 'POST', body)).status).toBe(200)
  expect((await request('/progress?novelId=book', 'DELETE', undefined, 'expired', cookie)).status).toBe(401)
  expect((await db.query<{ deleted_at: number }>('SELECT deleted_at FROM reading_progress')).rows[0]?.deleted_at).toBe(0)
})

it('无凭据不能伪装云端成功；匿名读取兼容，重新确认身份后可以补传', async () => {
  const body = { novelId: 'book', chapterId: 'ch1', clientUpdatedAt: Date.now() + 60_000 }
  expect((await request('/progress', 'POST', body, null)).status).toBe(401)
  expect((await request('/progress?novelId=book', 'DELETE', undefined, null)).status).toBe(401)
  expect((await request('/progress?novelId=book', 'GET', undefined, null)).status).toBe(200)
  const response = await request('/progress', 'POST', body)
  expect(await response.json()).toMatchObject({ success: true, acknowledged: { userId: 'reader', novelId: 'book', clientUpdatedAt: body.clientUpdatedAt } })
})

it('已撤销凭据不能写入；账号不匹配返回 409', async () => {
  await db.query('DELETE FROM user_sessions WHERE token_hash=$1', [await hashToken(tokens.other, loadConfig().sessionHashSalt)])
  try {
    expect((await request('/progress', 'POST', { novelId: 'book', chapterId: 'ch1' }, 'other')).status).toBe(401)
    expect((await request('/progress', 'POST', { novelId: 'book', chapterId: 'ch1' }, 'admin', true)).status).toBe(409)
  } finally {
    const now = Date.now()
    await db.query("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,'other',$2,$3,$3)",
      [await hashToken(tokens.other, loadConfig().sessionHashSalt), now + 86400000, now])
  }
})

it('已删除作品也必须以当前账号和操作时间确认删除', async () => {
  const response = await request('/progress?novelId=missing&clientUpdatedAt=123', 'DELETE')
  expect(await response.json()).toEqual({ success: true, progress: null, tombstone: null, acknowledged: { userId: 'reader', novelId: 'missing', clientUpdatedAt: 123 } })
})

it('成功调用只计一次，缓存复用不占新额度，管理员仍不受读者额度限制', async () => {
  expect((await request('/ai/recap', 'POST', { chapterId: 'ch1' })).status).toBe(200)
  const cached = await request('/ai/recap', 'POST', { chapterId: 'ch1' })
  expect(await cached.json()).toMatchObject({ cached: true })
  expect((await request('/ai/recap', 'POST', { chapterId: 'ch2' })).status).toBe(429)
  expect(mocks.chat).toHaveBeenCalledTimes(1)
  expect((await db.query('SELECT * FROM ai_quota_reservations')).rows).toHaveLength(0)
  expect((await request('/ai/recap', 'POST', { chapterId: 'ch2' }, 'admin')).status).toBe(200)
  expect(await checkQuota(db, 'reader', 1)).toMatchObject({ used: 1, ok: false })
})

it('同章去重不把一个用户的额度拒绝传给其他仍有额度的读者', async () => {
  await reserveReaderQuota(db, 'reader', 1)
  const options = { chapter: { id: 'ch1', novel_id: 'book', title: '第一章', content, sort_order: 1 }, novelTitle: '书院', maxChapterChars: 5000 }
  const outcomes = await Promise.allSettled([
    generateRecap(db, { ...options, userId: 'reader' }),
    generateRecap(db, { ...options, userId: 'other' }),
  ])
  expect(outcomes.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
  expect(mocks.chat).toHaveBeenCalledTimes(1)
  expect((await db.query('SELECT user_id FROM ai_usage')).rows).toEqual([{ user_id: 'other' }])
})

it('调用前校验失败不预留额度', async () => {
  await db.query("UPDATE chapters SET content='短' WHERE id='ch1'")
  try {
    expect((await request('/ai/recap', 'POST', { chapterId: 'ch1' })).status).toBe(422)
    expect(await checkQuota(db, 'reader', 1)).toMatchObject({ used: 0, ok: true })
    expect(mocks.chat).not.toHaveBeenCalled()
  } finally { await db.query("UPDATE chapters SET content=$1 WHERE id='ch1'", [content]) }
})

it('上游超时结果未确认保留当日名额，不伪造费用；下一自然日可用', async () => {
  mocks.chat.mockRejectedValueOnce(new AiError('timeout', 'fixture timeout', 504))
  expect((await request('/ai/recap', 'POST', { chapterId: 'ch1' })).status).toBe(504)
  expect((await request('/ai/recap', 'POST', { chapterId: 'ch2' })).status).toBe(429)
  expect((await db.query('SELECT * FROM ai_usage')).rows).toHaveLength(0)
  expect(await checkQuota(db, 'reader', 1, false, startOfTomorrow() + 1)).toMatchObject({ used: 0, ok: true })
})

it('模型已返回但记账失败时保留预留，不能因本地错误再次放行', async () => {
  const failing: Db = {
    ...db, connect: db.connect.bind(db), end: db.end.bind(db),
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO ai_usage')) throw new Error('synthetic usage persistence failure')
      return db.query(sql, params)
    },
  }
  setDbForTests(failing)
  try { expect((await request('/ai/recap', 'POST', { chapterId: 'ch1' })).status).toBe(502) }
  finally { setDbForTests(db) }
  expect((await request('/ai/recap', 'POST', { chapterId: 'ch2' })).status).toBe(429)
  expect(mocks.chat).toHaveBeenCalledTimes(1)
  expect((await db.query('SELECT * FROM ai_generations')).rows).toHaveLength(0)
})

it('记账后清理中断不会重复计额，幂等记账仍只保留一个调用', async () => {
  const reservation = await reserveReaderQuota(db, 'reader', 1)
  const usage = { ...reservation, userId: 'reader', model: 'fixture', provider: 'fixture', promptTokens: 1, completionTokens: 1 }
  await recordUsage(db, usage)
  await recordUsage(db, usage)
  expect(await checkQuota(db, 'reader', 2)).toMatchObject({ used: 1 })
  expect((await db.query('SELECT * FROM ai_quota_reservations')).rows).toHaveLength(1)
  await settleReaderQuota(db, reservation?.usageId)
  expect((await db.query('SELECT * FROM ai_quota_reservations')).rows).toHaveLength(0)
  expect((await db.query('SELECT * FROM ai_usage')).rows).toHaveLength(1)
})

it('跨零点完成按准入日记账，不挤占新一天的名额', async () => {
  const yesterday = startOfToday() - 1
  const clock = vi.spyOn(Date, 'now').mockReturnValue(yesterday)
  let reservation
  try { reservation = await reserveReaderQuota(db, 'reader', 1) }
  finally { clock.mockRestore() }
  // New-day admission can prune the old reservation before the old response arrives.
  const today = await reserveReaderQuota(db, 'reader', 1)
  await recordUsage(db, { ...reservation, userId: 'reader', model: 'fixture', provider: 'fixture', promptTokens: 1, completionTokens: 1 })
  expect(await checkQuota(db, 'reader', 1)).toMatchObject({ used: 1 })
  expect((await db.query('SELECT id FROM ai_quota_reservations')).rows).toEqual([{ id: today?.usageId }])
})

async function raceCalls(paths: Array<[path: string, body: unknown, who?: keyof typeof tokens]>, expectedStatuses: number[], expectedCalls = expectedStatuses.filter(status => status === 200).length) {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  mocks.chat.mockImplementation(async () => { await held; return reply })
  const finished: number[] = []
  const requests = paths.map(async ([path, body, who]) => {
    const response = await request(path, 'POST', body, who || 'reader')
    finished.push(response.status)
    return response
  })
  let responses: Response[] = []
  try {
    await vi.waitFor(() => {
      expect(mocks.chat).toHaveBeenCalledTimes(expectedCalls)
      if (expectedStatuses.includes(429)) expect(finished).toContain(429)
    })
    await db.query("SELECT id FROM users WHERE id='reader' FOR UPDATE NOWAIT")
  } finally { release(); responses = await Promise.all(requests) }
  expect(responses.map(response => response.status).sort()).toEqual([...expectedStatuses].sort())
}

it.skipIf(!integrationUrl)('真实 PostgreSQL：额度 1 的两个不同章节并发只启动一个模型调用', async () => {
  await raceCalls([['/ai/recap', { chapterId: 'ch1' }], ['/ai/recap', { chapterId: 'ch2' }]], [200, 429])
  expect((await db.query('SELECT * FROM ai_usage')).rows).toHaveLength(1)
})

it.skipIf(!integrationUrl)('真实 PostgreSQL：同章并发复用已有调用，不多占名额', async () => {
  await raceCalls([['/ai/recap', { chapterId: 'ch1' }], ['/ai/recap', { chapterId: 'ch1' }]], [200, 200], 1)
  expect((await db.query('SELECT * FROM ai_usage')).rows).toHaveLength(1)
})

it.skipIf(!integrationUrl)('真实 PostgreSQL：两个剩余名额允许同一用户的两个模型调用同时运行', async () => {
  await saveAiSettings(db, { dailyQuota: 2 })
  await raceCalls([['/ai/recap', { chapterId: 'ch1' }], ['/ai/recap', { chapterId: 'ch2' }]], [200, 200])
  expect(await checkQuota(db, 'reader', 2)).toMatchObject({ used: 2, ok: false })
})

it.skipIf(!integrationUrl)('真实 PostgreSQL：摘要与回来接着读共享同一额度预留', async () => {
  for (const chapterId of ['ch1', 'ch2']) await saveGeneration(db, {
    novelId: 'book', chapterId, kind: 'summary', model: 'fixture', paramsJson: await recapParams(db, 'fixture', content),
    prompt: 'fixture', result: '在书院阅读。', status: 'published', createdBy: 'admin',
  })
  await db.query("INSERT INTO reading_progress(id,user_id,novel_id,chapter_id,scroll_percent,updated_at) VALUES('progress','reader','book','ch2',0.5,$1)", [Date.now() - 30 * 86400000])
  await raceCalls([['/ai/recap', { chapterId: 'ch3' }], ['/ai/catchup', { novelId: 'book' }]], [200, 429])
})

it.skipIf(!integrationUrl)('真实 PostgreSQL：不同用户的名额独立，模型请求期间没有持有用户行锁', async () => {
  await raceCalls([['/ai/recap', { chapterId: 'ch1' }], ['/ai/recap', { chapterId: 'ch2' }, 'other']], [200, 200])
  expect(await checkQuota(db, 'reader', 1)).toMatchObject({ used: 1 })
  expect(await checkQuota(db, 'other', 1)).toMatchObject({ used: 1 })
})

it.skipIf(!integrationUrl)('真实 PostgreSQL：重新建立连接仍保留未确认调用的名额', async () => {
  await reserveReaderQuota(db, 'reader', 1)
  const reopened = new Pool({ connectionString: integrationUrl })
  try { expect(await checkQuota(reopened as unknown as Db, 'reader', 1)).toMatchObject({ used: 1, ok: false }) }
  finally { await reopened.end() }
})
