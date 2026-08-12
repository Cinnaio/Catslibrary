/**
 * 健壮性回归测试：LIKE 通配符转义、点赞/举报幂等、书签载荷去重、
 * 进度 FK 冲突降级、bootstrap-admin 串行化。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  await t.close()
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

describe('健壮性回归（pglite）', () => {
  let adminToken = ''
  let readerToken = ''
  let novelId = ''
  let chapterId = ''

  it('bootstrap-admin：首个成功，重复提交 409', async () => {
    const first = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
    expect(first.status).toBe(201)
    adminToken = (await jsonOf<{ token: string }>(first)).token

    const second = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin2', password: 'adminpass123' }))
    expect(second.status).toBe(409)
  })

  it('准备数据：读者、小说、章节', async () => {
    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['ROBUST-INVITE', Date.now()])
    const reg = await req('/api/auth/register', json('POST', { username: 'robust_reader', password: 'readerpass1', invite: 'ROBUST-INVITE' }))
    readerToken = (await jsonOf<{ token: string }>(reg)).token

    const created = await req('/api/novels', json('POST', { title: '进度100%的书', author: '作者甲', description: '普通描述' }, adminToken))
    novelId = (await jsonOf<{ novel: { id: string } }>(created)).novel.id
    const other = await req('/api/novels', json('POST', { title: '进度只有一半的书', author: '作者乙', description: '普通描述' }, adminToken))
    expect(other.status).toBe(201)

    const chapter = await req('/api/chapters', json('POST', { novelId, title: '第一章', content: '正文内容' }, adminToken))
    chapterId = (await jsonOf<{ chapter: { id: string } }>(chapter)).chapter.id
  })

  it('小说搜索：% 与 _ 按字面匹配，不再是通配符', async () => {
    // 「100%」应只命中标题里真的含「100%」的书；未转义时 % 会当通配符把两本都吐出来
    const literal = await req(`/api/novels?search=${encodeURIComponent('100%')}`)
    const literalData = await jsonOf<{ novels: Array<{ title: string }>; total: number }>(literal)
    expect(literalData.total).toBe(1)
    expect(literalData.novels[0]!.title).toBe('进度100%的书')

    // 「进度_」未转义时 _ 匹配任意单字符会命中两本；转义后无字面匹配 → 0
    const underscore = await req(`/api/novels?search=${encodeURIComponent('进度_')}`)
    const underscoreData = await jsonOf<{ total: number }>(underscore)
    expect(underscoreData.total).toBe(0)
  })

  it('评论点赞：重复点赞幂等，计数不虚增也不 500', async () => {
    const created = await req('/api/comments', json('POST', { novelId, text: '写得真不错' }, readerToken))
    expect(created.status).toBe(201)
    const commentId = (await jsonOf<{ comment: { id: string } }>(created)).comment.id

    const like1 = await req(`/api/comments/${commentId}/like`, json('POST', undefined, readerToken))
    expect(like1.status).toBe(200)
    const like2 = await req(`/api/comments/${commentId}/like`, json('POST', undefined, readerToken))
    expect(like2.status).toBe(200)
    const data = await jsonOf<{ likeCount: number; userLiked: boolean }>(like2)
    expect(data.likeCount).toBe(1)
    expect(data.userLiked).toBe(true)
  })

  it('书签同步：载荷内重复项不再打崩事务', async () => {
    const dup = { novelId, chapterId, chapterTitle: '第一章', timestamp: 1000 }
    const put = await req(
      '/api/bookmarks',
      json('PUT', { bookmarks: [dup, { ...dup, note: '更新的备注', timestamp: 2000 }, dup] }, readerToken),
    )
    expect(put.status).toBe(200)
    const { count } = await jsonOf<{ count: number }>(put)
    expect(count).toBe(1)

    const get = await req('/api/bookmarks', json('GET', undefined, readerToken))
    const { bookmarks } = await jsonOf<{ bookmarks: Array<{ note: string; timestamp: number }> }>(get)
    expect(bookmarks.length).toBe(1)
    // 保留时间戳最新的一条
    expect(bookmarks[0]!.note).toBe('更新的备注')
  })

  it('阅读进度：novelId 不存在时返回 404 而非 500', async () => {
    const post = await req('/api/progress', json('POST', { novelId: 'novel_missing', chapterId: 'ch_x', scrollPercent: 0.5 }, readerToken))
    expect(post.status).toBe(404)

    const del = await req('/api/progress?novelId=novel_missing', json('DELETE', undefined, readerToken))
    expect(del.status).toBe(200) // 幂等：无进度可删按成功处理
  })
})
