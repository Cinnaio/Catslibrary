import { afterAll, beforeAll, expect, it } from 'vitest'
import { app } from '../app'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { createSession } from '../services/sessions'
import { loadConfig } from '../config'
import type { ReadingStats } from '@shared/reading-stats'
let t: TestDb, token: string, userId: string, otherToken: string
const call = (path: string, method = 'GET', body?: unknown, auth = token) =>
  app.request(`/api/reading-stats${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  await t.db.query(
    "INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES('stats-user','stats-user','test','test','reader',1,1),('stats-other','stats-other','test','test','reader',1,1)",
  )
  userId = 'stats-user'
  token = await createSession(t.db, userId, 'stats-test', loadConfig().sessionHashSalt)
  otherToken = await createSession(t.db, 'stats-other', 'stats-test', loadConfig().sessionHashSalt)
  for (const [id, rating] of [
    ['n', 'general'],
    ['secret', 'restricted'],
  ]) {
    await t.db.query("INSERT INTO novels(id,title,author,content_rating,created_at,updated_at) VALUES($1,$1,'作者',$2,1,1)", [id, rating])
    await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,'章','正文',1,1)", [`${id}-c`, id])
  }
})
afterAll(async () => {
  setDbForTests(null)
  await t.close()
})
it('requires authentication, validates duration and rejects mismatched accounts', async () => {
  expect((await call('', 'GET', undefined, '')).status).toBe(401)
  expect((await call('/events', 'POST', { events: [] })).status).toBe(400)
  const now = Date.now(),
    event = { id: 'bad', sessionId: 's', novelId: 'n', chapterId: 'n-c', start: now - 60000, end: now }
  expect((await call('/events', 'POST', { userId, events: [event] })).status).toBe(400)
  expect((await call('/events', 'POST', { userId: 'other', events: [{ ...event, start: now - 30000 }] })).status).toBe(409)
  expect((await call('?start=abc')).status).toBe(400)
})
it('persists idempotently, merges parallel time and isolates accounts', async () => {
  const now = Date.now() - 10000
  const events = [
    { id: 'first', sessionId: 'session-one', novelId: 'n', chapterId: 'n-c', start: now - 40000, end: now - 10000 },
    { id: 'second', sessionId: 'session-two', novelId: 'n', chapterId: 'n-c', start: now - 30000, end: now },
  ]
  for (let i = 0; i < 2; i++) expect((await call('/events?contentMode=safe', 'POST', { userId, events })).status).toBe(200)
  const stats = (await (await call(`?start=${now - 60000}&end=${now}`)).json()) as ReadingStats
  expect(stats).toMatchObject({ milliseconds: 40000, sessions: 2, chapters: 1 })
  expect(stats.novels).toHaveLength(1)
  expect((await call('')).headers.get('Cache-Control')).toContain('no-store')
  const other = (await (await call('', 'GET', undefined, otherToken)).json()) as ReadingStats
  expect(other.milliseconds).toBe(0)
})
it('does not accept inaccessible or mismatched chapters and filters historical restricted records', async () => {
  const now = Date.now() - 1000
  const events = [
    { id: 'secret', sessionId: 'restricted', novelId: 'secret', chapterId: 'secret-c', start: now - 30000, end: now },
    { id: 'wrong-chapter', sessionId: 'wrong', novelId: 'n', chapterId: 'secret-c', start: now - 30000, end: now },
  ]
  expect((await call('/events?contentMode=safe', 'POST', { userId, events })).status).toBe(200)
  expect((await t.db.query("SELECT id FROM reading_stat_events WHERE id IN ('secret','wrong-chapter')")).rows).toHaveLength(0)
  await t.db.query(
    "INSERT INTO reading_stat_events(user_id,id,session_id,novel_id,chapter_id,started_at,ended_at,created_at) VALUES($1,'old-secret','old-secret','secret','secret-c',$2,$3,$3)",
    [userId, now - 30000, now],
  )
  const stats = (await (await call('?contentMode=safe')).json()) as ReadingStats
  expect(stats.novels.every((n) => n.id !== 'secret')).toBe(true)
})

it('preserves reading facts after deleting a novel, without exposing its old title or a live link', async () => {
  const now = Date.now() - 1000
  await t.db.query("INSERT INTO novels(id,title,author,content_rating,created_at,updated_at) VALUES('gone','旧标题','作者','general',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('gone-c','gone','章','正文',1,1)")
  const events = [{ id: 'gone-event', sessionId: 'gone-session', novelId: 'gone', chapterId: 'gone-c', start: now - 30000, end: now }]
  expect((await call('/events?contentMode=safe', 'POST', { userId, events })).status).toBe(200)
  await t.db.query("DELETE FROM novels WHERE id='gone'")
  const stats = (await (await call('?contentMode=safe')).json()) as ReadingStats
  expect(stats.novels.find((n) => n.id === 'gone')).toMatchObject({ title: '已删除作品', available: false, milliseconds: 30000 })
})
