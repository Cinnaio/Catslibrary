import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import * as webpush from 'web-push'
vi.mock('../middlewares/auth', () => ({
  optionalUser: () => async (c: any, next: () => Promise<void>) => {
    c.set('user', { id: 'a', role: 'admin' })
    await next()
  },
  requireUser: () => async (c: any, next: () => Promise<void>) => {
    const id = c.req.header('X-Test-User')
    if (!id) return c.json({ error: 'login' }, 401)
    c.set('user', { id, role: id === 'a' ? 'admin' : 'reader' })
    await next()
  },
}))
vi.mock('../services/content-access', () => ({
  contentPolicyHeaders: () => ({ 'Cache-Control': 'private, no-store' }),
  restrictedContentResponse: (c: any) => c.json({ error: 'restricted' }, 403),
  resolveContentAccess: async (c: any) => ({ canViewRestricted: c.req.header('X-Adult') === 'yes' }),
}))
import { notifyFollowupReaders } from '../services/notification-followups'
import { commentsRoutes } from './comments'
import { notificationRoutes } from './notifications'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { runNotificationTick, validPushEndpoint } from '../services/notification-push'
import { defaultNotificationSettings, quietUntil } from '../services/notifications'
let t: TestDb
const tokens = { a: 'a'.repeat(64), b: 'b'.repeat(64) }
function request(path: string, method = 'GET', body?: unknown, user = 'a', adult = false) {
  return notificationRoutes.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Test-User': user,
      Authorization: 'Bearer ' + (tokens[user as 'a' | 'b'] || ''),
      ...(adult ? { 'X-Adult': 'yes' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function data(path = '/', user = 'a', adult = false) {
  return (await (await request(path, 'GET', undefined, user, adult)).json()) as any
}
async function reply(id = 'reply', user = 'b', status = 'visible') {
  await t.db.query(
    "INSERT INTO novel_comments(id,novel_id,user_id,parent_id,comment_text,status,created_at,updated_at) VALUES($1,'n',$2,'parent','新的回复',$3,1,1)",
    [id, user, status],
  )
}
async function subscribe(user = 'a', endpoint = 'https://web.push.apple.com/token') {
  const r = await request(
    '/subscriptions',
    'POST',
    { endpoint, applicationServerKey: process.env.WEB_PUSH_PUBLIC_KEY, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) }, name: '测试设备' },
    user,
  )
  expect(r.status).toBe(200)
  return ((await r.json()) as { id: string }).id
}
beforeAll(async () => {
  vi.stubEnv('WEB_PUSH_CONFIG_FILE', path.join(tmpdir(), `cats-notification-test-${randomUUID()}.json`))
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  const keys = webpush.generateVAPIDKeys()
  vi.stubEnv('WEB_PUSH_PUBLIC_KEY', keys.publicKey)
  vi.stubEnv('WEB_PUSH_PRIVATE_KEY', keys.privateKey)
  vi.stubEnv('WEB_PUSH_SUBJECT', 'mailto:test@example.com')
  for (const id of ['a', 'b'])
    await t.db.query("INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES($1,$1,'x','x',$2,1,1)", [
      id,
      id === 'a' ? 'admin' : 'reader',
    ])
  await t.db.query("INSERT INTO novels(id,title,author,created_at,updated_at,content_rating,visibility) VALUES('n','测试书','作者',1,1,'general','public')")
}, 30000)
beforeEach(async () => {
  await t.db.query('DELETE FROM notification_book_watches')
  await t.db.query('DELETE FROM user_bookshelf')
  await t.db.query('DELETE FROM scrape_jobs')
  await t.db.query('DELETE FROM chapters')
  await t.db.query('DELETE FROM scrape_configs')
  await t.db.query('DELETE FROM notification_deliveries')
  await t.db.query('DELETE FROM notifications')
  await t.db.query('DELETE FROM notification_subscriptions')
  await t.db.query('DELETE FROM notification_settings')
  await t.db.query('DELETE FROM user_sessions')
  await t.db.query('DELETE FROM novel_comments')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query("UPDATE novels SET visibility='public',content_rating='general',source_chapter_snapshot=NULL")
  await t.db.query("UPDATE users SET role='admin' WHERE id='a'")
  for (const id of ['a', 'b'])
    await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,1)', [
      await hashToken(tokens[id as 'a' | 'b'], loadConfig().sessionHashSalt),
      id,
      Date.now() + 86400000,
    ])
  await t.db.query("INSERT INTO novel_comments(id,novel_id,user_id,comment_text,created_at,updated_at) VALUES('parent','n','a','父评论',1,1)")
})
afterAll(async () => {
  setDbForTests(null)
  await t.close()
  vi.unstubAllEnvs()
})
it('creates one owner-scoped reply, ignores self replies, and synchronizes read state', async () => {
  await reply('self', 'a')
  expect((await data()).items).toHaveLength(0)
  await reply()
  await t.db.query("UPDATE novel_comments SET status='visible' WHERE id='reply'")
  const list = await data()
  expect(list.items).toHaveLength(1)
  expect(list.unread).toBe(1)
  expect((await data('/', 'b')).items).toHaveLength(0)
  const id = list.items[0].id
  expect((await request('/' + id, 'GET', undefined, 'b')).status).toBe(404)
  expect((await data('/' + id)).href).toBe('/novel/n?comment=parent')
  await request('/read', 'POST', { id }, 'b')
  expect((await data()).unread).toBe(1)
  await request('/read', 'POST', { id })
  expect((await data()).unread).toBe(0)
})
it('creates notifications only when a moderated reply becomes visible', async () => {
  await reply('reply', 'b', 'hidden')
  expect((await data()).items).toHaveLength(0)
  await t.db.query("UPDATE novel_comments SET status='visible' WHERE id='reply'")
  expect((await data()).items).toHaveLength(1)
  await t.db.query("UPDATE novel_comments SET status='hidden' WHERE id='reply'")
  expect((await data()).items).toHaveLength(0)
})
it('rolls back messages and delivery jobs with the source transaction', async () => {
  await subscribe()
  await t.db.query('BEGIN')
  await reply()
  expect((await data()).items).toHaveLength(1)
  await t.db.query('ROLLBACK')
  expect((await data()).items).toHaveLength(0)
  expect((await t.db.query('SELECT * FROM notification_deliveries')).rows).toHaveLength(0)
})
it('revokes metadata and previews when content becomes restricted or access changes', async () => {
  await reply()
  const id = (await data()).items[0].id
  await t.db.query("UPDATE novels SET content_rating='restricted'")
  expect((await data()).items).toHaveLength(0)
  expect((await data('/', 'a', true)).items).toHaveLength(1)
  expect((await request('/' + id + '/preview')).status).toBe(404)
  await t.db.query("UPDATE novels SET content_rating='general',visibility='admin'")
  await t.db.query("UPDATE users SET role='reader' WHERE id='a'")
  expect((await data()).items).toHaveLength(0)
})
it('task completion, failures and repeated terminal updates are deduplicated', async () => {
  await t.db.query("INSERT INTO ai_tasks(id,user_id,novel_id,kind,status,created_at,updated_at) VALUES('task','a','n','novel_analysis','running',1,1)")
  await t.db.query("UPDATE ai_tasks SET status='failed',error='网络错误' WHERE id='task'")
  await t.db.query("UPDATE ai_tasks SET status='failed' WHERE id='task'")
  const list = await data()
  expect(list.items).toHaveLength(1)
  expect(list.items[0].title).toBe('AI 任务未能完成')
  expect((await data('/' + list.items[0].id)).text).toBe('网络错误')
  await t.db.query("DELETE FROM ai_tasks WHERE id='task'")
  expect((await data()).items).toHaveLength(0)
})
it('validates settings, keeps optimistic revision, and defaults to private previews', async () => {
  const settings = (await data('/settings')).settings
  expect(settings.preview).toBe(false)
  expect((await request('/settings', 'PUT', { ...settings, timeZone: 'invalid/zone' })).status).toBe(400)
  expect((await request('/settings', 'PUT', { ...settings, quietEnabled: true, quietStart: '08:00' })).status).toBe(400)
  expect((await request('/settings', 'PUT', { ...settings, preview: true })).status).toBe(200)
  expect((await request('/settings', 'PUT', settings)).status).toBe(409)
  await reply()
  const id = (await data()).items[0].id
  expect((await data('/' + id + '/preview')).body).toBe('测试书')
})
it('binds subscriptions to sessions and rejects endpoint takeover and arbitrary outbound URLs', async () => {
  const id = await subscribe()
  expect((await data('/settings')).devices[0].current).toBe(true)
  const body = {
    endpoint: 'https://web.push.apple.com/token',
    applicationServerKey: process.env.WEB_PUSH_PUBLIC_KEY,
    keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
  }
  expect((await request('/subscriptions', 'POST', body, 'b')).status).toBe(409)
  for (const endpoint of [
    'http://web.push.apple.com/x',
    'https://127.0.0.1/x',
    'https://web.push.apple.com.evil.test/x',
    'https://a@web.push.apple.com/x',
    'https://web.push.apple.com:8443/x',
  ])
    expect(validPushEndpoint(endpoint)).toBe(false)
  await request('/subscriptions/' + id, 'DELETE', undefined, 'b')
  expect((await data('/settings')).devices).toHaveLength(1)
  await t.db.query("DELETE FROM user_sessions WHERE user_id='a'")
  expect((await data('/settings')).devices).toHaveLength(0)
})
it('queues per device, skips disabled categories and retries transient failures', async () => {
  await subscribe()
  await reply()
  const send = vi.fn().mockRejectedValueOnce({ statusCode: 503 }).mockResolvedValue({ statusCode: 201 })
  await runNotificationTick(t.db, send)
  expect(send).toHaveBeenCalledTimes(1)
  expect(JSON.parse(send.mock.calls[0]![1] as string)).toEqual({ id: (await data()).items[0].id })
  await t.db.query('UPDATE notification_deliveries SET available_at=0')
  await runNotificationTick(t.db, send)
  expect(send).toHaveBeenCalledTimes(2)
  await runNotificationTick(t.db, send)
  expect(send).toHaveBeenCalledTimes(2)
  const settings = (await data('/settings')).settings
  await request('/settings', 'PUT', { ...settings, replies: false })
  await reply('reply2')
  await runNotificationTick(t.db, send)
  expect(send).toHaveBeenCalledTimes(2)
})
it('drops expired endpoints, skips read messages and rate limits test notifications', async () => {
  const deviceId = await subscribe()
  await reply()
  await request('/read', 'POST', { all: true })
  const send = vi.fn().mockRejectedValue({ statusCode: 410 })
  await runNotificationTick(t.db, send)
  expect(send).not.toHaveBeenCalled()
  expect((await request('/test', 'POST', { deviceId })).status).toBe(200)
  expect((await request('/test', 'POST', { deviceId })).status).toBe(429)
  await runNotificationTick(t.db, send)
  expect(send).toHaveBeenCalledTimes(1)
  expect((await data('/settings')).devices).toHaveLength(0)
})
it('handles overnight quiet hours and DST in the configured timezone', () => {
  const settings = { ...defaultNotificationSettings, quietEnabled: true }
  const now = Date.parse('2026-11-26T15:15:00Z')
  expect(quietUntil(settings, now)).toBe(Date.parse('2026-11-27T00:00:00Z'))
  expect(quietUntil(settings, Date.parse('2026-11-26T04:00:00Z'))).toBe(Date.parse('2026-11-26T04:00:00Z'))
  expect(quietUntil({ ...settings, timeZone: 'America/New_York', quietStart: '01:00', quietEnd: '03:00' }, Date.parse('2026-11-01T05:30:00Z'))).toBe(
    Date.parse('2026-11-01T08:00:00Z'),
  )
})

it('subscribes to favorites, combines only new saved chapters, and ignores historical imports', async () => {
  await t.db.query("INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) VALUES('a','n',1,1)")
  await t.db.query("INSERT INTO scrape_configs(novel_id,source_url,updated_at) VALUES('n','https://source.test/book',1)")
  await t.db.query('UPDATE novels SET source_chapter_snapshot=$1::jsonb', [JSON.stringify([{ url: 'old', title: '旧章', order: 1 }])])
  expect((await request('/watches/n', 'PUT', { enabled: true })).status).toBe(200)
  expect((await request('/watches/n', 'PUT', { enabled: true }, 'b')).status).toBe(404)
  const now = Date.now() + 1000
  await t.db.query("INSERT INTO scrape_jobs(id,novel_id,status,started_at,updated_at) VALUES('job','n','completed',1,1)")
  for (const [index, url] of ['old', 'new1', 'new2'].entries()) {
    await t.db.query("INSERT INTO chapters(id,novel_id,title,source_url,sort_order,created_at) VALUES($1,'n',$1,$1,$2,$3)", [url, index + 1, now])
    await t.db.query("INSERT INTO scrape_job_items(id,job_id,novel_id,chapter_url,status,finished_at,updated_at) VALUES($1,'job','n',$1,'saved',$2,$2)", [
      url,
      now,
    ])
  }
  expect((await data()).items).toHaveLength(0)
  await notifyFollowupReaders(t.db.query.bind(t.db), 'n', 'job', now)
  const list = await data()
  expect(list.items).toHaveLength(1)
  expect(list.items[0].title).toContain('2 章')
  await notifyFollowupReaders(t.db.query.bind(t.db), 'n', 'job', now)
  expect((await data()).items).toHaveLength(1)
  await t.db.query("DELETE FROM user_bookshelf WHERE user_id='a'")
  expect((await data()).items).toHaveLength(0)
})
it('unknown directories establish a baseline without sending historical chapter notifications', async () => {
  await t.db.query("INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) VALUES('a','n',1,1)")
  await request('/watches/n', 'PUT', { enabled: true })
  await t.db.query('UPDATE novels SET source_chapter_snapshot=$1::jsonb', [JSON.stringify([{ url: 'old' }])])
  await notifyFollowupReaders(t.db.query.bind(t.db), 'n', 'initial', Date.now())
  expect((await data()).items).toHaveLength(0)
  const row = (await t.db.query<{ known_urls: string[] }>('SELECT known_urls FROM notification_book_watches')).rows[0]!
  expect(row.known_urls).toEqual(['old'])
})

it('preserves a known empty directory across checks so the first new chapter can notify', async () => {
  await t.db.query("INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) VALUES('a','n',1,1)")
  await t.db.query("UPDATE novels SET source_chapter_snapshot='[]'::jsonb")
  await request('/watches/n', 'PUT', { enabled: true })
  await notifyFollowupReaders(t.db.query.bind(t.db), 'n', 'empty', Date.now())
  expect((await t.db.query<{ known_urls: unknown }>('SELECT known_urls FROM notification_book_watches')).rows[0]!.known_urls).toEqual([])
})

it('loads the exact comment thread even when it is outside the first comment page', async () => {
  await reply()
  for (let i = 0; i < 21; i++)
    await t.db.query("INSERT INTO novel_comments(id,novel_id,user_id,comment_text,created_at,updated_at) VALUES($1,'n','a','其他评论',$2,$2)", [
      'other' + i,
      100 + i,
    ])
  const response = await commentsRoutes.request('/?novelId=n&focusId=parent')
  expect(response.status).toBe(200)
  const body = (await response.json()) as { comments: Array<{ id: string; replies: Array<{ id: string }> }> }
  expect(body.comments.map((c) => c.id)).toEqual(['parent'])
  expect(body.comments[0]!.replies[0]!.id).toBe('reply')
})

it('stops old-key delivery, rejects stale registration, and restores delivery after resubscribing', async () => {
  await subscribe()
  await reply()
  const oldPublic = process.env.WEB_PUSH_PUBLIC_KEY!,
    oldPrivate = process.env.WEB_PUSH_PRIVATE_KEY!
  const next = webpush.generateVAPIDKeys(),
    send = vi.fn().mockResolvedValue({ statusCode: 201 })
  try {
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', next.publicKey)
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', next.privateKey)
    expect((await data('/settings')).devices).toHaveLength(0)
    await runNotificationTick(t.db, send)
    expect(send).not.toHaveBeenCalled()
    expect(
      (
        await request('/subscriptions', 'POST', {
          endpoint: 'https://web.push.apple.com/new',
          applicationServerKey: oldPublic,
          keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
        })
      ).status,
    ).toBe(409)
    await subscribe('a', 'https://web.push.apple.com/new')
    await reply('new-reply')
    await runNotificationTick(t.db, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect((await data('/settings')).devices).toHaveLength(1)
  } finally {
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', oldPublic)
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', oldPrivate)
  }
})
