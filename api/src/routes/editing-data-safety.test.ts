import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { app } from '../app'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import type { ChapterFull } from '@shared/types'

let t: TestDb
const token = 'editing-safety-fixture-'.repeat(4)
function request(route: string, method = 'GET', body?: unknown) {
  return app.request('/api' + route, { method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function chapter() {
  const response = await request('/chapters/general-chapter')
  expect(response.status).toBe(200)
  return (await response.json() as { chapter: ChapterFull }).chapter
}
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  vi.stubEnv('COVER_FETCH_ENABLED', '0')
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  const now = Date.now()
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('editor','editor','admin','unused','unused',$1,$1)", [now])
  await t.db.query("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,'editor',$2,$3,$3)", [await hashToken(token, loadConfig().sessionHashSalt), now + 86400000, now])
  for (const [id, rating] of [['general', 'general'], ['restricted', 'restricted']]) {
    await t.db.query("INSERT INTO novels(id,title,author,content_rating,created_at,updated_at) VALUES($1,$1,'作者',$2,$3,$3)", [id, rating, now])
    await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,'原标题','旧正文',1,$3)", [id + '-chapter', id, now])
  }
})
afterAll(async () => { setDbForTests(null); await t.close(); vi.unstubAllEnvs() })

it('rejects a stale editor without overwriting a newer body, and permits saving after rereading', async () => {
  const stale = await chapter()
  expect(stale.revision).toMatch(/^[a-f0-9]{64}$/)
  const first = await request('/chapters/general-chapter', 'PUT', { baseRevision: stale.revision, content: '另一设备的新正文' })
  expect(first.status).toBe(200)
  const current = (await first.json() as { chapter: ChapterFull }).chapter
  expect(current.revision).not.toBe(stale.revision)
  const conflict = await request('/chapters/general-chapter', 'PUT', { baseRevision: stale.revision, title: '只改标题', content: stale.content })
  expect(conflict.status).toBe(409)
  expect(await chapter()).toEqual(current)
  const fresh = await chapter()
  expect((await request('/chapters/general-chapter', 'PUT', { baseRevision: fresh.revision, title: '新标题' })).status).toBe(200)
  expect(await chapter()).toMatchObject({ title: '新标题', content: current.content })
})
it('requires a precondition and detects every field changed by other writers', async () => {
  expect((await request('/chapters/general-chapter', 'PUT', { content: '旧客户端' })).status).toBe(428)
  for (const sql of ["content = content || '改写'", "title = title || '改名'", 'sort_order = sort_order + 1', "source_url = source_url || 'new'"]) {
    const stale = await chapter()
    await t.db.query('UPDATE chapters SET ' + sql + ' WHERE id=$1', ['general-chapter'])
    const latest = await chapter()
    expect((await request('/chapters/general-chapter', 'PUT', { baseRevision: stale.revision, content: stale.content })).status).toBe(409)
    expect(await chapter()).toEqual(latest)
  }
})
it('detects an edit committed while acquiring the write transaction', async () => {
  const stale = await chapter()
  const connect = t.db.connect.bind(t.db)
  const spy = vi.spyOn(t.db, 'connect').mockImplementationOnce(async () => {
    await t.db.query("UPDATE chapters SET content='等待连接期间的新正文' WHERE id=$1", ['general-chapter'])
    return connect()
  })
  try {
    const response = await request('/chapters/general-chapter', 'PUT', { baseRevision: stale.revision, content: stale.content })
    expect(response.status).toBe(409)
    expect(await chapter()).toMatchObject({ content: '等待连接期间的新正文' })
  } finally { spy.mockRestore() }
})
it('safe-mode bookmark roundtrips and empty replacements preserve hidden bookmarks', async () => {
  for (const id of ['general', 'restricted']) expect((await request('/bookmarks', 'POST', { novelId: id, chapterId: id + '-chapter' })).status).toBe(200)
  const safe = await (await request('/bookmarks?contentMode=safe')).json() as { bookmarks: unknown[] }
  expect(safe.bookmarks).toHaveLength(1)
  expect((await request('/bookmarks?contentMode=safe', 'PUT', safe)).status).toBe(200)
  const all = await (await request('/bookmarks')).json() as { bookmarks: unknown[] }
  expect(all.bookmarks).toHaveLength(2)
  expect((await request('/bookmarks?contentMode=safe', 'PUT', all)).status).toBe(403)
  expect((await (await request('/bookmarks')).json() as { bookmarks: unknown[] }).bookmarks).toHaveLength(2)
  expect((await request('/bookmarks?contentMode=safe', 'PUT', { bookmarks: [] })).status).toBe(200)
  expect((await (await request('/bookmarks')).json() as { bookmarks: { novelId: string }[] }).bookmarks.map(b => b.novelId)).toEqual(['restricted'])
  expect((await request('/bookmarks?contentMode=adult', 'PUT', { bookmarks: [] })).status).toBe(200)
  expect((await (await request('/bookmarks')).json() as { bookmarks: unknown[] }).bookmarks).toEqual([])
})
it('defers restricted statistics in safe mode and stores them exactly once when retried in adult mode', async () => {
  const now = Date.now() - 1000
  const events = ['general', 'restricted'].map(id => ({ id: id + '-event', sessionId: 'session', novelId: id, chapterId: id + '-chapter', start: now - 30000, end: now }))
  const result = await request('/reading-stats/events?contentMode=safe', 'POST', { userId: 'editor', events })
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({ success: true, deferredIds: ['restricted-event'] })
  expect((await t.db.query('SELECT id FROM reading_stat_events')).rows).toEqual([{ id: 'general-event' }])
  for (let i = 0; i < 2; i++) {
    const retry = await request('/reading-stats/events?contentMode=adult', 'POST', { userId: 'editor', events })
    expect(await retry.json()).toEqual({ success: true, deferredIds: [] })
  }
  expect((await t.db.query('SELECT id FROM reading_stat_events')).rows).toHaveLength(2)
})
