import { afterAll, beforeAll, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb
let token: string
const oldUrl = process.env.DATABASE_URL
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const boot = await call('/api/auth/bootstrap-admin', 'POST', { username: 'contracts', password: 'adminpass123' })
  token = (await data(boot)).token
  await t.db.query("INSERT INTO novels (id,title,author,created_at,updated_at,content_rating) VALUES ('contract-a','书','作者',1,1,'general'),('contract-b','书B','作者',1,1,'general')")
  await t.db.query("INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ('contract-c1','contract-a','一','正文',1,1),('contract-c2','contract-a','二','正文',2,1),('contract-wrong','contract-b','一','正文',1,1)")
})
afterAll(async () => {
  setDbForTests(null); if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl
  await t.close()
})
function call(path: string, method = 'GET', body?: unknown) {
  return app.request(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
}
it('进度按操作时间更新，乱序旧请求与相同版本重试不覆盖新位置', async () => {
  await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId: 'contract-c2', scrollPercent: .8, clientUpdatedAt: 200 })
  const late = await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId: 'contract-c1', scrollPercent: .1, clientUpdatedAt: 100 })
  expect((await data(late)).skipped).toBe(true)
  const same = await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId: 'contract-c1', clientUpdatedAt: 200 })
  expect((await data(same)).skipped).toBe(true)
  expect((await data(await call('/api/progress?novelId=contract-a'))).progress).toMatchObject({ chapterId: 'contract-c2', updatedAt: 200 })
})
it('删除墓碑阻止旧进度复活；同一时间删除优先；新阅读可恢复', async () => {
  await call('/api/progress?novelId=contract-a&clientUpdatedAt=300', 'DELETE')
  for (const time of [250, 300]) {
    const response = await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId: 'contract-c1', clientUpdatedAt: time })
    expect((await data(response)).tombstone).toMatchObject({ deletedAt: 300 })
  }
  await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId: 'contract-c1', clientUpdatedAt: 400 })
  const olderDelete = await call('/api/progress?novelId=contract-a&clientUpdatedAt=350', 'DELETE')
  expect((await data(olderDelete)).progress).toMatchObject({ chapterId: 'contract-c1', updatedAt: 400 })
})
it('进度拒绝不存在或属于其他作品的章节', async () => {
  for (const chapterId of ['missing', 'contract-wrong']) {
    const response = await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId, clientUpdatedAt: 500 })
    expect(response.status).toBe(404)
  }
})
it('显式 unknown 重置分级，旧版本修改返回冲突且不写入元数据', async () => {
  for (const contentRatingRevision of [undefined, -1, '0', null]) {
    expect((await call('/api/novels/contract-b', 'PUT', { contentRating: 'restricted', contentRatingRevision })).status).toBe(400)
  }
  const reset = await call('/api/novels/contract-b', 'PUT', { contentRating: 'unknown', contentRatingRevision: 0 })
  expect((await data(reset)).novel.contentRating).toBe('unknown')
  const conflict = await call('/api/novels/contract-b', 'PUT', { author: '旧弹窗', contentRating: 'general', contentRatingRevision: 0 })
  expect(conflict.status).toBe(409)
  expect((await data(await call('/api/novels/contract-b'))).novel.author).toBe('作者')
})
it('只改元数据不重写人工分级；分级预填不改变内容更新时间', async () => {
  const before = (await t.db.query<{ updated_at: number }>("SELECT updated_at FROM novels WHERE id='contract-a'")).rows[0]!.updated_at
  const { applyContentRatingChange } = await import('../services/content-rating-governance')
  const { withTx } = await import('../db/query')
  await withTx(t.db, q => applyContentRatingChange(q, { novelId: 'contract-a', rating: 'restricted', source: 'manual', actorUserId: 'admin' }))
  expect((await t.db.query<{ updated_at: number }>("SELECT updated_at FROM novels WHERE id='contract-a'")).rows[0]!.updated_at).toBe(before)
  const response = await call('/api/novels/contract-a', 'PUT', { author: '新作者' })
  expect((await data(response)).novel.contentRating).toBe('restricted')
})
it('所有章节删除入口均清理书签并写进度墓碑，旧写入不能恢复入口', async () => {
  await t.db.query("INSERT INTO user_bookmarks (id,user_id,novel_id,novel_title,chapter_id,chapter_title,chapter_order,created_at,updated_at) SELECT 'contract-bm',id,'contract-a','书','contract-c1','一',1,1,1 FROM users LIMIT 1")
  await call('/api/chapters/contract-c1', 'DELETE')
  expect((await t.db.query("SELECT id FROM user_bookmarks WHERE id='contract-bm'")).rows).toHaveLength(0)
  const state = await data(await call('/api/progress?novelId=contract-a'))
  expect(state.progress).toBeNull()
  expect(state.tombstone).toBeTruthy()
  expect((await call('/api/progress', 'POST', { novelId: 'contract-a', chapterId: 'contract-c1', clientUpdatedAt: 500 })).status).toBe(404)
})

async function data(response: Response): Promise<{ token: string; skipped: boolean; progress: unknown; tombstone: unknown; novel: { contentRating: string; author: string } }> { return response.json() as never }
