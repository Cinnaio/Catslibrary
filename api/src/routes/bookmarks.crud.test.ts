import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('../middlewares/auth', () => ({ requireUser: () => async (c: any, next: () => Promise<void>) => { c.set('user', { id: c.req.header('X-Test-User') || 'a' }); await next() } }))
vi.mock('../services/content-access', () => ({ contentPolicyHeaders: () => ({}), resolveContentAccess: async () => ({ canViewRestricted: true }) }))
import { bookmarksRoutes } from './bookmarks'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
let t: TestDb
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  for (const id of ['a', 'b']) await t.db.query("INSERT INTO users (id, username, password_hash, password_salt, role, created_at, updated_at) VALUES ($1, $1, 'x', 'salt', 'reader', 1, 1)", [id])
  await t.db.query("INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ('n','书','作者',1,1)")
  for (const id of ['c1','c2']) await t.db.query("INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ($1,'n',$1,'正文',1,1)",[id])
})
afterAll(async () => { setDbForTests(null); await t.close() })
function request(method: string, body: unknown, user = 'a') {
  return bookmarksRoutes.request('/', { method, headers: { 'Content-Type': 'application/json', 'X-Test-User': user }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
}
async function list(user = 'a') { return (await (await request('GET', undefined, user)).json()) as { bookmarks: Array<{ id: string; chapterId: string; note: string }> } }
it('单条写入持久化、重复请求幂等、删除不会波及其它书签或其它用户', async () => {
  for (const chapterId of ['c1','c2']) expect((await request('POST', { novelId: 'n', chapterId, note: '初始' })).status).toBe(200)
  expect((await request('POST', { novelId: 'n', chapterId: 'c1', note: '更新' })).status).toBe(200)
  expect((await list()).bookmarks).toHaveLength(2)
  expect((await list()).bookmarks.find(b => b.chapterId === 'c1')?.note).toBe('更新')
  await request('POST', { novelId: 'n', chapterId: 'c1' }, 'b')
  await request('DELETE', { novelId: 'n', chapterId: 'c1' })
  await request('DELETE', { novelId: 'n', chapterId: 'c1' })
  expect((await list()).bookmarks.map(b => b.chapterId)).toEqual(['c2'])
  expect((await list('b')).bookmarks.map(b => b.chapterId)).toEqual(['c1'])
})
it('无效全量载荷不删除已有书签，回传服务端 ID 不会重复加前缀', async () => {
  const before = (await list()).bookmarks
  expect((await request('PUT', { bookmarks: [{}] })).status).toBe(400)
  expect((await list()).bookmarks).toEqual(before)
  for (let i = 0; i < 3; i++) {
    const data = await list()
    expect((await request('PUT', data)).status).toBe(200)
    expect((await list()).bookmarks[0]?.id).toBe(before[0]?.id)
  }
})
it('不存在或不匹配的章节不能创建书签，明确空数组仅清理本人', async () => {
  expect((await request('POST', { novelId: 'missing', chapterId: 'c1' })).status).toBe(404)
  expect((await request('POST', { novelId: 'n', chapterId: 'missing' })).status).toBe(404)
  expect((await request('PUT', { bookmarks: [] })).status).toBe(200)
  expect((await list()).bookmarks).toEqual([])
  expect((await list('b')).bookmarks).toHaveLength(1)
})
