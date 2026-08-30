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
  process.env.COVER_FETCH_ENABLED = '0' // 测试不访问外网
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

interface Novel {
  id: string
  title: string
  author: string
  categories: string[]
  chapterCount: number
}

describe('内容 API 端到端（pglite）', () => {
  let adminToken = ''

  it('bootstrap 管理员并创建小说（分类规范化）', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123', displayName: '站长' }))
    expect(boot.status).toBe(201)
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    const created = await req(
      '/api/novels',
      json('POST', { title: '我的天师女友', author: '不记得了', categories: ['古言1v1兄妹', '穿越'], description: '测试' }, adminToken),
    )
    expect(created.status).toBe(201)
    const { novel } = await jsonOf<{ novel: Novel }>(created)
    expect(novel.id).toMatch(/^novel_/)
    // 分类规范化：古言1v1兄妹 → 古言/1v1/兄妹
    expect(novel.categories).toContain('古言')
    expect(novel.categories).toContain('1v1')
    expect(novel.categories).toContain('兄妹')
  })

  it('非管理员无法创建小说（401/403）', async () => {
    const res = await req('/api/novels', json('POST', { title: 'x', author: 'y' }))
    expect([401, 403]).toContain(res.status)
  })

  it('novels 列表/详情/搜索', async () => {
    const list = await req('/api/novels')
    expect(list.status).toBe(200)
    const data = await jsonOf<{ novels: Novel[]; total: number; availableCategories: string[] }>(list)
    expect(data.total).toBeGreaterThan(0)
    expect(data.availableCategories).toContain('穿越')

    const detail = await req(`/api/novels/${data.novels[0]!.id}`)
    expect(detail.status).toBe(200)

    const search = await req('/api/novels?search=天师')
    const searchData = await jsonOf<{ total: number }>(search)
    expect(searchData.total).toBe(1)
  })

  it('创建章节（单条 + 批量）并维护 chapter_count', async () => {
    const list = await req('/api/novels')
    const { novels } = await jsonOf<{ novels: Novel[] }>(list)
    const novelId = novels[0]!.id

    const single = await req('/api/chapters', json('POST', { novelId, title: '第一章 初遇', content: '<p>正文一</p>' }, adminToken))
    expect(single.status).toBe(201)
    const { chapter } = await jsonOf<{ chapter: { id: string; wordCount: number } }>(single)
    // '<p>正文一</p>'.replace(/<[^>]*>/g,'') = '正文一' → 3 字符
    expect(chapter.wordCount).toBe(3)

    const batch = await req(
      '/api/chapters',
      json('POST', { novelId, chapters: [{ title: '第二章 相知', content: '内容二' }, { title: '第三章 相守', content: '内容三' }] }, adminToken),
    )
    expect(batch.status).toBe(201)
    const batchData = await jsonOf<{ created: number; totalChapters: number }>(batch)
    expect(batchData.created).toBe(2)
    expect(batchData.totalChapters).toBe(3)

    // chapter_count 同步
    const detail = await req(`/api/novels/${novelId}`)
    const { novel } = await jsonOf<{ novel: Novel }>(detail)
    expect(novel.chapterCount).toBe(3)

    // 列表与内容
    const chapters = await req(`/api/chapters?novelId=${novelId}`)
    const chapterData = await jsonOf<{ chapters: Array<{ id: string; title: string }>; total: number }>(chapters)
    expect(chapterData.total).toBe(3)
    expect(chapterData.chapters[0]!.title).toBe('第一章 初遇')

    const content = await req(`/api/chapters/${chapterData.chapters[0]!.id}`)
    const contentData = await jsonOf<{ chapter: { content: string } }>(content)
    expect(contentData.chapter.content).toBe('<p>正文一</p>')
  })

  it('章节更新/删除维护计数，不存在的 novel 创建章节返回 404', async () => {
    const list = await req('/api/novels')
    const { novels } = await jsonOf<{ novels: Novel[] }>(list)
    const novelId = novels[0]!.id
    const chapters = await req(`/api/chapters?novelId=${novelId}`)
    const { chapters: list2 } = await jsonOf<{ chapters: Array<{ id: string }> }>(chapters)
    const first = list2[0]!.id

    const upd = await req(`/api/chapters/${first}`, json('PUT', { title: '第一章 改名', content: '新内容' }, adminToken))
    expect(upd.status).toBe(200)
    const updData = await jsonOf<{ chapter: { title: string; wordCount: number } }>(upd)
    expect(updData.chapter.title).toBe('第一章 改名')

    const del = await req(`/api/chapters/${first}`, json('DELETE', undefined, adminToken))
    expect(del.status).toBe(200)
    const detail = await req(`/api/novels/${novelId}`)
    const { novel } = await jsonOf<{ novel: Novel }>(detail)
    expect(novel.chapterCount).toBe(2)

    const bad = await req('/api/chapters', json('POST', { novelId: 'novel_missing', title: 'x' }, adminToken))
    expect(bad.status).toBe(404)
  })

  it('categories 接口返回全量分类', async () => {
    const res = await req('/api/categories')
    expect(res.status).toBe(200)
    const { categories } = await jsonOf<{ categories: string[] }>(res)
    expect(categories).toContain('穿越')
    expect(categories).toContain('古言')
  })

  it('阅读进度：匿名不落库，登录用户可存/取/删（墓碑）', async () => {
    const list = await req('/api/novels')
    const { novels } = await jsonOf<{ novels: Novel[] }>(list)
    const novelId = novels[0]!.id
    const chapters = await req(`/api/chapters?novelId=${novelId}`)
    const { chapters: list2 } = await jsonOf<{ chapters: Array<{ id: string }> }>(chapters)
    const chapterId = list2[0]!.id

    // 匿名：POST 成功但不落库
    const anon = await req('/api/progress', json('POST', { novelId, chapterId, scrollPercent: 0.5 }))
    expect(anon.status).toBe(200)

    // 登录一个读者
    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['READER-INVITE', Date.now()])
    const reg = await req('/api/auth/register', json('POST', { username: 'reader', password: 'readerpass1', invite: 'READER-INVITE' }))
    const { token } = await jsonOf<{ token: string }>(reg)

    // 登录后匿名进度仍不存在（未落库）
    const before = await req(`/api/progress?novelId=${novelId}`, json('GET', undefined, token))
    const beforeData = await jsonOf<{ progress: unknown }>(before)
    expect(beforeData.progress).toBeNull()

    const save = await req('/api/progress', json('POST', { novelId, chapterId, scrollPercent: 0.66 }, token))
    expect(save.status).toBe(200)

    const load = await req(`/api/progress?novelId=${novelId}`, json('GET', undefined, token))
    const loadData = await jsonOf<{ progress: { scrollPercent: number; chapterId: string } }>(load)
    expect(loadData.progress.scrollPercent).toBeCloseTo(0.66)
    expect(loadData.progress.chapterId).toBe(chapterId)

    // recent
    const recent = await req('/api/progress?recent=1&limit=5', json('GET', undefined, token))
    const recentData = await jsonOf<{ progress: Array<{ novelTitle: string }> }>(recent)
    expect(recentData.progress.length).toBeGreaterThan(0)
    expect(recentData.progress[0]!.novelTitle).toBeTruthy()

    // 墓碑删除
    const del = await req(`/api/progress?novelId=${novelId}`, json('DELETE', undefined, token))
    expect(del.status).toBe(200)
    const after = await req(`/api/progress?novelId=${novelId}`, json('GET', undefined, token))
    const afterData = await jsonOf<{ progress: unknown; tombstone: unknown }>(after)
    expect(afterData.progress).toBeNull()
    expect(afterData.tombstone).not.toBeNull()
  })

  it('cover 懒缓存：无源图且测试禁用外网时返回 502 而非崩溃', async () => {
    const list = await req('/api/novels')
    const { novels } = await jsonOf<{ novels: Novel[] }>(list)
    const res = await req(`/api/cover/${novels[0]!.id}`)
    expect(res.status).toBe(502)
  })

  it('batch-delete 小说级联删除章节', async () => {
    const list = await req('/api/novels')
    const { novels } = await jsonOf<{ novels: Novel[] }>(list)
    const payload = { action: 'batch-delete', novelIds: [novels[0]!.id], operationId: 'content-test-batch-delete-novel-001' }
    const batch = await req('/api/novels', json('POST', payload, adminToken))
    expect(batch.status).toBe(200)

    const detail = await req(`/api/novels/${novels[0]!.id}`)
    expect(detail.status).toBe(404)

    const replay = await req('/api/novels', json('POST', payload, adminToken))
    expect(replay.status).toBe(200)
    expect(replay.headers.get('x-idempotent-replay')).toBe('true')
  })
})
