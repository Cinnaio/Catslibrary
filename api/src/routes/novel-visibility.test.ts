import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { createWebRoutes } from './web'
import { fileURLToPath } from 'node:url'

let t: TestDb
const tokens = { admin: 'a'.repeat(64), allowed: 'b'.repeat(64), other: 'c'.repeat(64) }
interface FixtureResponse extends Response {
  json(): Promise<{
    total: number; totalPages: number; novels: Array<{ id: string }>; availableCategories: string[];
    categories: string[]; ratingCounts: Record<string, number>; hiddenRestricted: boolean;
    novel: { id: string; title: string; visibility: string; visibilityRevision: number };
    thought: { id: string }; comment: { id: string };
    revision: number; audit: Array<Record<string, unknown>>; favorites: unknown[]; bookmarks: unknown[];
    progress: unknown[] & { scrollPercent: number };
  }>
}
function req(path: string, who?: keyof typeof tokens, method = 'GET', body?: unknown) {
  return app.request(`/api${path}`, { method, headers: {
    ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), 'Content-Type': 'application/json',
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) as Promise<FixtureResponse>
}
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  const now = Date.now()
  for (const [id, token] of Object.entries(tokens)) {
    await t.db.query(`INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at)
      VALUES($1,$1,$2,'unused','unused',$3,$3)`, [id, id === 'admin' ? 'admin' : 'reader', now])
    await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,$2,$3,$4,$4)',
      [await hashToken(token, loadConfig().sessionHashSalt), id, now + 86400000, now])
  }
  for (const [id, visibility, rating] of [['public', 'public', 'general'], ['secret', 'selected', 'general'], ['admin-book', 'admin', 'general'], ['secret-r18', 'selected', 'restricted']]) {
    await t.db.query(`INSERT INTO novels(id,title,author,categories,content_rating,visibility,created_at,updated_at)
      VALUES($1,$1,'作者',$2,$3,$4,$5,$5)`, [id, JSON.stringify([id + '-tag']), rating, visibility, now])
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$1,$3,1,$4)',
      [id + '-ch', id, '私密测试正文', now])
    if (visibility === 'selected') await t.db.query('INSERT INTO novel_access_grants(novel_id,user_id,created_at) VALUES($1,$2,$3)', [id, 'allowed', now])
  }
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  await t.close()
})

describe('书籍可见范围与分级独立', () => {
  it('游客、无授权读者的详情和正文与不存在资源返回同样 404', async () => {
    for (const who of [undefined, 'other'] as const) {
      for (const [actual, missing] of [['/novels/secret', '/novels/missing'], ['/chapters/secret-ch', '/chapters/missing']]) {
        const response = await req(actual!, who)
        const absent = await req(missing!, who)
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual(await absent.json())
      }
    }
  })
  it('列表、分页、分类与分级统计只包含可见作品，不提示私密作品存在', async () => {
    const response = await req('/novels?limit=1', 'other')
    const data = await response.json()
    expect(data.total).toBe(1)
    expect(data.totalPages).toBe(1)
    expect(data.novels.map((n: { id: string }) => n.id)).toEqual(['public'])
    expect(data.availableCategories).toEqual(['public-tag'])
    expect(data.ratingCounts).toEqual({ general: 1, restricted: 0, unknown: 0 })
    expect(data.hiddenRestricted).toBe(false)
    expect((await (await req('/categories', 'other')).json()).categories).toEqual(['public-tag'])
  })
  it('指定用户能读一般私密作品，仍需满足限制级条件；管理员可审核全部作品', async () => {
    expect((await req('/novels/secret', 'allowed')).status).toBe(200)
    expect((await req('/chapters/secret-ch', 'allowed')).status).toBe(200)
    expect((await req('/novels/admin-book', 'allowed')).status).toBe(404)
    expect((await req('/novels/secret-r18', 'allowed')).status).toBe(403)
    expect((await req('/novels/secret-r18', 'other')).status).toBe(404)
    expect((await req('/novels/secret-r18', 'admin')).status).toBe(200)
    expect((await req('/novels/admin-book', 'admin')).status).toBe(200)
  })
  it('封面、目录、评论、评分、段评和 AI 缓存入口不泄露私密内容', async () => {
    for (const path of ['/cover/secret', '/chapters?novelId=secret', '/comments?novelId=secret', '/ratings?novelId=secret', '/thoughts?chapterId=secret-ch', '/ai/recap?chapterId=secret-ch']) {
      expect((await req(path, 'other')).status, path).toBe(404)
    }
  })

  it('私密封面禁止本地缓存，未授权条件请求也不能得到 304', async () => {
    const cover = await req('/cover/secret', 'allowed')
    expect(cover.status).toBe(200)
    expect(cover.headers.get('Cache-Control')).toContain('no-store')
    const response = await app.request('/api/cover/secret', { headers: {
      Authorization: `Bearer ${tokens.other}`, 'If-None-Match': cover.headers.get('ETag')!,
    } })
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })

  it('Cookie 会话有效，显式无效 Bearer 不回退到已授权 Cookie', async () => {
    const cookie = `zz_session=${tokens.allowed}`
    expect((await app.request('/api/novels/secret', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await app.request('/api/novels/secret', { headers: { Cookie: cookie, Authorization: 'Bearer invalid' } })).status).toBe(404)
  })

  it('正文插图与段评图片绑定所属作品，不能凭图片 ID 绕过可见范围', async () => {
    const now = Date.now()
    await t.db.query(`INSERT INTO chapter_illustration_assets(id,chapter_id,data,width,height,created_at)
      VALUES('private-asset','secret-ch',$1,1,1,$2)`, [new Uint8Array([1, 2, 3]), now])
    await t.db.query(`INSERT INTO chapter_illustrations(id,chapter_id,asset_id,size,anchor,chapter_revision,sort_order,created_at,updated_at)
      VALUES('private-illustration','secret-ch','private-asset','medium','{}','fixture',1,$1,$1)`, [now])
    const thought = await req('/thoughts', 'allowed', 'POST', { novelId: 'secret', chapterId: 'secret-ch', paragraphIndex: 0, thoughtText: '私密段评内容' })
    expect(thought.status).toBe(201)
    const thoughtId = (await thought.json()).thought.id
    await t.db.query('INSERT INTO thought_images(thought_id,data,content_type,created_at) VALUES($1,$2,$3,$4)', [thoughtId, new Uint8Array([1, 2, 3]), 'image/png', now])
    for (const path of ['/chapters/secret-ch/illustrations', '/chapters/secret-ch/illustrations/private-illustration/image', `/thoughts/image/${thoughtId}`]) {
      expect((await req(path, 'allowed')).status, path).toBe(200)
      expect((await req(path, 'other')).status, path).toBe(404)
      expect((await req(path)).status, path).toBe(404)
    }
  })

  it('无授权用户不能通过收藏、社区写入、AI 回顾和旧数据恢复探测作品', async () => {
    for (const [path, body] of [
      ['/bookshelf', { novelId: 'secret' }],
      ['/comments', { novelId: 'secret', text: '不能发表的评论' }],
      ['/thoughts', { novelId: 'secret', chapterId: 'secret-ch', paragraphIndex: 0, thoughtText: '不能发表的段评' }],
      ['/ai/catchup', { novelId: 'secret' }],
    ] as const) expect((await req(path, 'other', 'POST', body)).status, path).toBe(404)
    const preview = await req('/reading-data/restore/preview', 'other', 'POST', { data: {
      bookmarks: [{ novelId: 'secret', chapterId: 'secret-ch' }], progress: [], bookshelf: [],
    } })
    expect(preview.status).toBe(200)
    const data = JSON.parse(await preview.text()) as { items: Array<{ novelTitle: string; action: string; chapterTitle: string }> }
    expect(data.items[0]).toMatchObject({ action: 'skip', novelTitle: '不可恢复的记录', chapterTitle: '' })
  })

  it('初始 HTML、网站地图及分享元信息隐藏私密书籍，无 SEO origin 时仍返回 404', async () => {
    const root = fileURLToPath(new URL('../test/seo', import.meta.url))
    const web = createWebRoutes({ root, origin: () => 'https://read.example.com', db: () => t.db, configured: () => true })
    const sitemap = await (await web.request('/sitemaps/novels-1.xml')).text()
    expect(sitemap).toContain('/novel/public')
    expect(sitemap).not.toContain('secret')
    expect(sitemap).not.toContain('admin-book')
    const response = await web.request('/novel/secret')
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('secret-tag')
    const authorized = await web.request('/novel/secret', { headers: { Authorization: `Bearer ${tokens.allowed}` } })
    expect(authorized.status).toBe(200)
    expect(authorized.headers.get('X-Robots-Tag')).toBe('noindex, follow')
    expect(await authorized.text()).not.toContain('<h1>secret</h1>')
    const noSeo = createWebRoutes({ root, origin: () => '', db: () => t.db, configured: () => true })
    expect((await noSeo.request('/novel/secret')).status).toBe(404)
    expect((await noSeo.request('/read/secret/secret-ch')).status).toBe(404)
  })

  it('仅管理员可管理授权；非法用户导致整个创建或编辑回滚', async () => {
    expect((await req('/novels/secret/visibility', 'allowed')).status).toBe(403)
    const revision = (await (await req('/novels/secret/visibility', 'admin')).json()).revision
    const invalid = await req('/novels/secret', 'admin', 'PUT', {
      title: '不得落库', visibility: 'selected', visibilityRevision: revision, allowedUserIds: ['missing-user'],
    })
    expect(invalid.status).toBe(400)
    expect((await (await req('/novels/secret', 'admin')).json()).novel.title).toBe('secret')
    const create = await req('/novels', 'admin', 'POST', { title: '失败创建', author: '作者', visibility: 'selected', allowedUserIds: ['missing-user'] })
    expect(create.status).toBe(400)
    expect((await t.db.query("SELECT id FROM novels WHERE title='失败创建'")).rows).toHaveLength(0)
    expect((await req('/novels/secret', 'allowed', 'PUT', { visibility: 'public', visibilityRevision: revision })).status).toBe(403)
  })

  it('撤销后立即拒绝请求、隐藏书架与进度，空书签同步不删除隐藏记录；重新授权恢复', async () => {
    const bookmark = { novelId: 'secret', chapterId: 'secret-ch', id: 'private-bm', note: '保留记录' }
    expect((await req('/bookmarks', 'allowed', 'POST', bookmark)).status).toBe(200)
    expect((await req('/bookshelf', 'allowed', 'POST', { novelId: 'secret' })).status).toBe(200)
    expect((await req('/progress', 'allowed', 'POST', { novelId: 'secret', chapterId: 'secret-ch', scrollPercent: 0.5 })).status).toBe(200)
    const settings = await (await req('/novels/secret/visibility', 'admin')).json()
    const change = { visibility: 'admin', allowedUserIds: [], visibilityRevision: settings.revision }
    const response = await req('/novels/secret', 'admin', 'PUT', change)
    expect(response.status).toBe(200)
    expect((await req('/chapters/secret-ch', 'allowed')).status).toBe(404)
    expect((await (await req('/bookshelf', 'allowed')).json()).favorites).toHaveLength(0)
    expect((await (await req('/bookmarks', 'allowed')).json()).bookmarks).toHaveLength(0)
    expect((await (await req('/progress?recent=1', 'allowed')).json()).progress).toHaveLength(0)
    expect((await (await req('/progress?novelId=secret', 'allowed')).json()).progress).toBeNull()
    expect(await (await req('/thoughts?mine=1', 'allowed')).text()).not.toContain('私密段评内容')
    await t.db.query("UPDATE user_bookmarks SET novel_title='旧书名' WHERE novel_id='secret'")
    expect(await (await req('/reading-data/check', 'allowed')).text()).not.toContain('secret')
    expect((await req('/bookmarks', 'allowed', 'PUT', { bookmarks: [] })).status).toBe(200)
    expect((await t.db.query("SELECT id FROM user_bookmarks WHERE novel_id='secret'")).rows).toHaveLength(1)
    expect((await req('/novels/secret', 'admin', 'PUT', change)).status).toBe(409)
    const updated = await (await req('/novels/secret/visibility', 'admin')).json()
    expect(updated.audit[0]).toMatchObject({ actorUserId: 'admin', previousVisibility: 'selected', visibility: 'admin' })
    expect((await req('/novels/secret', 'admin', 'PUT', { visibility: 'selected', allowedUserIds: ['allowed'], visibilityRevision: updated.revision })).status).toBe(200)
    expect((await (await req('/bookmarks', 'allowed')).json()).bookmarks).toHaveLength(1)
    expect((await (await req('/bookshelf', 'allowed')).json()).favorites).toHaveLength(1)
    expect((await (await req('/progress?novelId=secret', 'allowed')).json()).progress.scrollPercent).toBe(0.5)
    await t.db.query("UPDATE users SET status='disabled' WHERE id='allowed'")
    expect((await req('/novels/secret', 'allowed')).status).toBe(404)
    await t.db.query("UPDATE users SET status='active' WHERE id='allowed'")
  })

  it('私密创建不会短暂公开，旧编辑载荷不修改已有可见范围', async () => {
    const response = await req('/novels', 'admin', 'POST', { title: '创建即私密', author: '作者', contentRating: 'general', visibility: 'selected', allowedUserIds: ['allowed'] })
    expect(response.status).toBe(201)
    const { novel } = await response.json()
    expect(novel.visibility).toBe('selected')
    expect(novel.visibilityRevision).toBe(1)
    expect((await req(`/novels/${novel.id}`)).status).toBe(404)
    expect((await req(`/novels/${novel.id}`, 'allowed')).status).toBe(200)
    expect((await req(`/novels/${novel.id}`, 'admin', 'PUT', { description: '普通元数据更新' })).status).toBe(200)
    expect((await req(`/novels/${novel.id}`)).status).toBe(404)
  })

  it('历史阅读统计隐藏失去授权的作品，离线队列也不能继续写入新记录', async () => {
    const now = Date.now() - 1000
    const event = { id: 'private-stat', sessionId: 'private-session', novelId: 'secret', chapterId: 'secret-ch', start: now - 30000, end: now }
    expect((await req('/reading-stats/events', 'allowed', 'POST', { userId: 'allowed', events: [event] })).status).toBe(200)
    const before = JSON.parse(await (await req('/reading-stats', 'allowed')).text()) as { novels: unknown[] }
    expect(before.novels).toHaveLength(1)
    await t.db.query("DELETE FROM novel_access_grants WHERE novel_id='secret' AND user_id='allowed'")
    const hidden = JSON.parse(await (await req('/reading-stats', 'allowed')).text()) as { novels: unknown[]; milliseconds: number }
    expect(hidden.novels).toHaveLength(0)
    expect(hidden.milliseconds).toBe(0)
    expect((await req('/reading-stats/events', 'allowed', 'POST', { userId: 'allowed', events: [{ ...event, id: 'private-stat-denied' }] })).status).toBe(200)
    expect((await t.db.query("SELECT id FROM reading_stat_events WHERE id='private-stat-denied'")).rows).toHaveLength(0)
    await t.db.query("INSERT INTO novel_access_grants(novel_id,user_id,created_at) VALUES('secret','allowed',$1)", [Date.now()])
  })
})
