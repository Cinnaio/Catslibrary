import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AuthEnv } from '../middlewares/auth'
import type { UserRow } from './auth'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { checkChapterProtection, recordChapterRateLimit, readingAccessSummary, readingAccessPolicy } from './reading-access'
import { checkContentRate } from './content-rate-limit'

vi.mock('./content-access', () => ({ resolveContentAccess: async () => ({ accountId: undefined }) }))
let t: TestDb
const app = new Hono<AuthEnv>()
app.use('*', async (c, next) => {
  const account = c.req.header('Test-Account')
  if (account) c.set('user', { id: account, role: c.req.header('Test-Admin') ? 'admin' : 'reader' } as UserRow)
  await next()
})
app.get('/read/:novel/:chapter', async c => (await checkChapterProtection(c,
  { chapterId: c.req.param('chapter'), novelId: c.req.param('novel') })) || c.json({ ok: true }))
app.get('/minute', async c => (await checkContentRate(c, 'chapter')) || c.json({ ok: true }))
app.get('/limited', async c => { await recordChapterRateLimit(c); return c.json({ ok: true }) })
const read = (chapter: string, novel = 'novel', headers: Record<string, string> = {}) =>
  app.request('/read/' + novel + '/' + chapter, { headers: { 'CF-Connecting-IP': '192.0.2.1', ...headers } })

beforeAll(async () => {
  t = await createTestDb()
  const connection = await t.db.connect()
  await connection.query(await readFile(new URL('../db/migrations/043_content_access_sessions.sql', import.meta.url), 'utf8').then(sql => sql.slice(sql.indexOf('CREATE TABLE'))))
  await connection.query(await readFile(new URL('../db/migrations/088_reading_access_protection.sql', import.meta.url), 'utf8'))
  connection.release()
  setDbForTests(t.db)
})
beforeEach(async () => {
  vi.stubEnv('TRUST_PROXY', '1')
  vi.stubEnv('CHAPTER_PROTECTION_MODE', 'observe')
  await t.db.query('TRUNCATE reading_access_items, reading_access_windows, content_request_limits')
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => { setDbForTests(null); await t.close() })

describe('普通正文防护：真实 PostgreSQL 计数语义', () => {
  it('观察模式只记录超量，重复章节只计一次且不保存原始身份与资源', async () => {
    vi.stubEnv('CHAPTER_GUEST_UNIQUE_10_MINUTES', '1')
    expect((await read('secret-chapter-a', 'secret-book')).status).toBe(200)
    expect((await read('secret-chapter-a', 'secret-book')).status).toBe(200)
    expect((await read('secret-chapter-b', 'secret-book')).status).toBe(200)
    const rows = (await t.db.query<{ request_count: number; unique_chapters: number; flagged_count: number; blocked_count: number }>(
      "SELECT * FROM reading_access_windows WHERE subject_kind='guest' AND window_minutes=10")).rows
    expect(rows[0]).toMatchObject({ request_count: 3, unique_chapters: 2, flagged_count: 1, blocked_count: 0 })
    const stored = JSON.stringify((await t.db.query('SELECT * FROM reading_access_items')).rows)
    expect(stored).not.toMatch(/192\.0\.2|secret-chapter|secret-book/)
    const summary = await readingAccessSummary(t.db, 24)
    expect(summary.signals).toEqual(expect.arrayContaining([expect.objectContaining({ windowMinutes: 10, subjectKind: 'guest', flagged: 1 })]))
    expect(JSON.stringify(summary)).not.toContain('subject_hash')
  })
  it('启用后对不同章节限流，明确返回等待时间；新窗口可恢复', async () => {
    vi.stubEnv('CHAPTER_PROTECTION_MODE', 'enforce')
    vi.stubEnv('CHAPTER_GUEST_UNIQUE_10_MINUTES', '1')
    expect((await read('a')).status).toBe(200)
    const limited = await read('b')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('cache-control')).toBe('private, no-store')
    expect(await limited.json()).toMatchObject({ code: 'content_rate_limited', retryAfter: Number(limited.headers.get('retry-after')) })
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(Math.floor(now / 600000) * 600000 + 600001)
    try { expect((await read('c')).status).toBe(200) } finally { vi.restoreAllMocks() }
  })
  it('登录账户跨 IP 共享额度，同 IP 的账户另有聚合上限', async () => {
    vi.stubEnv('CHAPTER_PROTECTION_MODE', 'enforce')
    vi.stubEnv('CHAPTER_USER_UNIQUE_10_MINUTES', '1')
    expect((await read('a', 'n', { 'Test-Account': 'reader-a' })).status).toBe(200)
    expect((await read('b', 'n', { 'Test-Account': 'reader-a', 'CF-Connecting-IP': '192.0.2.2' })).status).toBe(429)
    expect((await read('b', 'n', { 'Test-Account': 'reader-b' })).status).toBe(200)
    vi.stubEnv('CHAPTER_IP_UNIQUE_10_MINUTES', '2')
    expect((await read('c', 'n', { 'Test-Account': 'reader-c' })).status).toBe(429)
  })
  it('跨书批量读取同样标记，合法管理员不计数', async () => {
    for (let i = 0; i < 7; i++) await read('c' + i, 'n' + i)
    expect((await readingAccessSummary(t.db, 24)).signals).not.toHaveLength(0)
    await t.db.query('TRUNCATE reading_access_items, reading_access_windows')
    await read('a', 'n', { 'Test-Account': 'admin', 'Test-Admin': '1' })
    expect((await readingAccessSummary(t.db, 24)).byHour).toEqual([])
  })
  it('无可信地址不接受伪造转发头，账号仍可计数', async () => {
    vi.stubEnv('TRUST_PROXY', '0')
    await read('a')
    expect((await readingAccessSummary(t.db, 24)).byHour).toEqual([])
    await read('a', 'n', { 'Test-Account': 'reader' })
    expect((await readingAccessSummary(t.db, 24)).byHour).toEqual([expect.objectContaining({ subjectKind: 'account', requests: 1 })])
  })
  it('分钟拒绝保留统计与 JSON 等待时间，游客／账号额度独立', async () => {
    vi.stubEnv('CHAPTER_GUEST_READ_LIMIT_PER_MINUTE', '1')
    vi.stubEnv('CHAPTER_READ_LIMIT_PER_MINUTE', '2')
    const headers = { 'CF-Connecting-IP': '192.0.2.1' }
    expect((await app.request('/minute', { headers })).status).toBe(200)
    const denied = await app.request('/minute', { headers })
    expect(denied.status).toBe(429)
    expect(await denied.json()).toMatchObject({ code: 'content_rate_limited', retryAfter: Number(denied.headers.get('retry-after')) })
    expect((await app.request('/minute', { headers: { ...headers, 'Test-Account': 'reader' } })).status).toBe(200)
    expect((await readingAccessSummary(t.db, 24)).byHour).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectKind: 'guest', rateLimited: 1, uniqueChapterReads: 0 })]))
  })
  it.each(['HOUR', 'DAY'])('较长的 %s 窗口独立限制，等待时间不会被缩短到十分钟', async window => {
    vi.stubEnv('CHAPTER_PROTECTION_MODE', 'enforce')
    vi.stubEnv('CHAPTER_GUEST_UNIQUE_' + window, '1')
    expect((await read('a')).status).toBe(200)
    const response = await read('b')
    expect(response.status).toBe(429)
    const now = Date.now()
    const size = window === 'HOUR' ? 3600000 : 86400000
    const expected = Math.ceil((Math.floor(now / size) * size + size - now) / 1000)
    expect(Math.abs(Number(response.headers.get('retry-after')) - expected)).toBeLessThanOrEqual(1)
  })
  it('并发重复读取不会重复增加不同章节数或丢失请求计数', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => read('same')))
    expect(responses.every(response => response.status === 200)).toBe(true)
    const { rows } = await t.db.query("SELECT request_count, unique_chapters, unique_novels FROM reading_access_windows WHERE subject_kind='guest' AND window_minutes=60")
    expect(rows).toEqual([{ request_count: 12, unique_chapters: 1, unique_novels: 1 }])
  })

  it('去重记录达到阈值后停止增长，非法配置回退到保守默认值', async () => {
    vi.stubEnv('CHAPTER_GUEST_UNIQUE_10_MINUTES', '1')
    for (let i = 0; i < 8; i++) await read('c' + i)
    const row = (await t.db.query<{ unique_chapters: number }>("SELECT unique_chapters FROM reading_access_windows WHERE subject_kind='guest' AND window_minutes=10")).rows[0]
    expect(row?.unique_chapters).toBe(2)
    vi.stubEnv('CHAPTER_GUEST_UNIQUE_10_MINUTES', 'NaN')
    vi.stubEnv('CHAPTER_PROTECTION_MODE', 'invalid')
    expect(readingAccessPolicy()).toMatchObject({ mode: 'observe', limits: { guest: [{ minutes: 10, chapters: 60 }, { minutes: 60 }, { minutes: 1440 }] } })
  })
})
