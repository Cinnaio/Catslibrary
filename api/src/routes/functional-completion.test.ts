import { afterAll, beforeAll, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { REMEMBER_TTL, ADMIN_SESSION_TTL } from '../services/auth'
let t: TestDb
let token = ''
let userId = ''
const oldUrl = process.env.DATABASE_URL
const call = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db); process.env.DATABASE_URL = 'postgres://test/test'
  const boot = await (await call('/api/auth/bootstrap-admin', 'POST', { username: 'completion', password: 'password123' })).json() as { token: string; user: { id: string } }
  token = boot.token; userId = boot.user.id
  await t.db.query("INSERT INTO novels(id,title,author,content_rating,created_at,updated_at) SELECT 'full-'||i,'书'||i,'作者',CASE WHEN i=0 THEN 'restricted' ELSE 'general' END,1,i FROM generate_series(0,51) i")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) SELECT 'ch-'||i,'full-'||i,'一','正文',1,1 FROM generate_series(0,51) i")
  await t.db.query("INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) SELECT $1,'full-'||i,1,i FROM generate_series(0,51) i", [userId])
  await t.db.query("INSERT INTO thoughts(id,novel_id,chapter_id,user_id,paragraph_index,thought_text,created_at,updated_at) SELECT 't-'||i,'full-'||i,'ch-'||i,$1,0,'想法'||i,i,i FROM generate_series(0,51) i", [userId])
  await t.db.query("INSERT INTO user_bookmarks(id,user_id,novel_id,novel_title,chapter_id,chapter_title,chapter_order,created_at,updated_at) VALUES ('safe-bm',$1,'full-0','受限','ch-0','一',1,1,1)", [userId])
  await call('/api/progress', 'POST', { novelId: 'full-0', chapterId: 'ch-0' })
  await t.db.query("INSERT INTO book_import_runs(id,actor_user_id,source_type,source_label,created_at) SELECT 'run-'||i,$1,'file','test.txt',i FROM generate_series(1,21) i", [userId])
})
afterAll(async () => { setDbForTests(null); if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl; await t.close() })
it('完整书架分页，限制级过滤在计数和分页之前生效（包括管理员安全模式）', async () => {
  const first = await (await call('/api/bookshelf?limit=50')).json() as any
  expect(first.favorites).toHaveLength(50); expect(first.thoughts).toHaveLength(50)
  expect(first.totals).toEqual({ favorites: 52, thoughts: 52 })
  const second = await (await call('/api/bookshelf?limit=50&offset=50')).json() as any
  expect(second.favorites).toHaveLength(2)
  const target = await (await call('/api/bookshelf?novelId=full-0')).json() as any
  expect(target.favorites).toHaveLength(1)
  expect(target.favorites[0].novelId).toBe('full-0')
  expect(new Set([...first.favorites, ...second.favorites].map(x => x.novelId)).size).toBe(52)
  const safe = await (await call('/api/bookshelf?contentMode=safe&offset=50')).json() as any
  expect(safe.totals).toEqual({ favorites: 51, thoughts: 51 })
  expect(safe.favorites).toHaveLength(1)
  expect(safe.favorites[0].novelId).not.toBe('full-0')
  expect(safe.recent).toHaveLength(0)
  const bookmarks = await (await call('/api/bookmarks?contentMode=safe')).json() as any
  expect(bookmarks.bookmarks).toHaveLength(0)
  const recent = await (await call('/api/progress?recent=1&contentMode=safe')).json() as any
  expect(recent.progress).toHaveLength(0)
})
it('导入历史计数与翻页完整，其他账号记录不会出现在列表', async () => {
  await t.db.query("INSERT INTO book_import_runs(id,actor_user_id,created_at) VALUES ('other-run','other-user',100)")
  const first = await (await call('/api/book-import/history?limit=20')).json() as any
  const last = await (await call('/api/book-import/history?limit=20&offset=20')).json() as any
  expect(first.total).toBe(21); expect(first.items).toHaveLength(20)
  expect(last.items).toHaveLength(1); expect(last.items[0].runId).toBe('run-1')
})
it('管理员记住登录及改密码的服务端会话有效期最多八小时', async () => {
  const login = await (await call('/api/auth/login', 'POST', { username: 'completion', password: 'password123', remember: true })).json() as any
  token = login.token
  const sessions = await (await call('/api/auth/sessions')).json() as any
  const current = sessions.sessions.find((x: { current: boolean }) => x.current)
  expect(Number(current.expiresAt) - Number(current.createdAt)).toBe(ADMIN_SESSION_TTL)
  const changed = await (await call('/api/auth/change-password', 'POST', { currentPassword: 'password123', newPassword: 'password456', remember: true })).json() as any
  token = changed.token
  const after = await (await call('/api/auth/sessions')).json() as any
  expect(after.sessions).toHaveLength(1)
  expect(Number(after.sessions[0].expiresAt) - Number(after.sessions[0].createdAt)).toBe(ADMIN_SESSION_TTL)
})
it('普通读者记住登录及改密码仍保持 180 天', async () => {
  await t.db.query("INSERT INTO users(id,username,password_hash,password_salt,password_iterations,role,created_at,updated_at) SELECT 'completion-reader','completion-reader',password_hash,password_salt,password_iterations,'reader',1,1 FROM users WHERE id=$1", [userId])
  const login = await (await call('/api/auth/login', 'POST', { username: 'completion-reader', password: 'password456', remember: true })).json() as any
  const readerCall = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const before = await (await readerCall('/api/auth/sessions')).json() as any
  expect(Number(before.sessions[0].expiresAt) - Number(before.sessions[0].createdAt)).toBe(REMEMBER_TTL)
  const changed = await (await readerCall('/api/auth/change-password', 'POST', { currentPassword: 'password456', newPassword: 'password789', remember: true })).json() as any
  const after = await (await app.request('/api/auth/sessions', { headers: { Authorization: `Bearer ${changed.token}` } })).json() as any
  expect(after.sessions).toHaveLength(1)
  expect(Number(after.sessions[0].expiresAt) - Number(after.sessions[0].createdAt)).toBe(REMEMBER_TTL)
})
it('撤回已经成功但响应丢失时，同一操作 ID 重试返回原结果', async () => {
  await t.db.query("INSERT INTO book_import_runs(id,actor_user_id,status,created_at) VALUES ('rollback-replay',$1,'applied',1)", [userId])
  const first = await call('/api/book-import/rollback-replay/rollback', 'POST', { operationId: 'replay-operation' })
  expect(first.status).toBe(200)
  const replay = await call('/api/book-import/rollback-replay/rollback', 'POST', { operationId: 'replay-operation' })
  expect(replay.status).toBe(200)
  expect(await replay.json()).toEqual(await first.json())
})
