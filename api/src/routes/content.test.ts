import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { run } from '../db/query'
import { getDefaultCoverImage } from '../default-cover'
import { LEGACY_DEFAULT_COVER_URL } from '@shared/covers'

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
      json(
        'POST',
        { title: '我的天师女友', author: '不记得了', categories: ['古言1v1兄妹', '穿越'], description: '测试', contentRating: 'general' },
        adminToken,
      ),
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
      json(
        'POST',
        {
          novelId,
          chapters: [
            { title: '第二章 相知', content: '内容二' },
            { title: '第三章 相守', content: '内容三' },
          ],
        },
        adminToken,
      ),
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

  it('cover 无源图且禁用外网时仍返回本地花枝封面，并支持条件缓存', async () => {
    const list = await req('/api/novels')
    const { novels } = await jsonOf<{ novels: Novel[] }>(list)
    const res = await req(`/api/cover/${novels[0]!.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from((await getDefaultCoverImage()).data))
    const cached = await req(`/api/cover/${novels[0]!.id}`, { headers: { 'If-None-Match': res.headers.get('etag')! } })
    expect(cached.status).toBe(304)
  })

  it('旧数据库中的 default 和第三方缺省封面均显示新版，真实封面保持原图', async () => {
    const { novels } = await jsonOf<{ novels: Novel[] }>(await req('/api/novels'))
    const id = novels[0]!.id
    const placeholder = Buffer.from((await getDefaultCoverImage()).data)
    for (const source of ['default', LEGACY_DEFAULT_COVER_URL]) {
      await run(t.db, `INSERT INTO novel_covers (data, content_type, source, novel_id, updated_at) VALUES ($1,$2,$3,$4,1)
        ON CONFLICT (novel_id) DO UPDATE SET data=EXCLUDED.data, content_type=EXCLUDED.content_type, source=EXCLUDED.source`, [Buffer.from('old placeholder'), 'image/jpeg', source, id])
      const res = await req(`/api/cover/${id}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(Buffer.from(await res.arrayBuffer())).toEqual(placeholder)
    }
    const original = Buffer.from('original uploaded cover')
    await run(t.db, 'UPDATE novel_covers SET data=$1, content_type=$2, source=$3 WHERE novel_id=$4', [original, 'image/png', 'upload', id])
    const res = await req(`/api/cover/${id}`)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(original)
  })

  it('源封面 URL 为旧缺省图时使用本地资源，并继续校验小说是否存在', async () => {
    const { novels } = await jsonOf<{ novels: Novel[] }>(await req('/api/novels'))
    const id = novels[0]!.id
    await run(t.db, 'DELETE FROM novel_covers WHERE novel_id=$1', [id])
    await run(t.db, 'UPDATE novels SET cover_url=$1 WHERE id=$2', [LEGACY_DEFAULT_COVER_URL, id])
    const res = await req(`/api/cover/${id}`)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from((await getDefaultCoverImage()).data))
    const stored = await t.db.query<{ source: string }>('SELECT source FROM novel_covers WHERE novel_id=$1', [id])
    expect(stored.rows).toHaveLength(0)
    expect((await req('/api/cover/does-not-exist')).status).toBe(404)
  })

  it('校园筛选匹配简繁别名，其他标签仍精确匹配并保留分页与状态', async () => {
    for (const category of ['校园', '校園', '校园生活']) {
      const created = await req(
        '/api/novels',
        json('POST', { title: `别名测试${category}`, author: '测试作者', categories: [category], contentRating: 'general', status: 'ongoing' }, adminToken),
      )
      expect(created.status).toBe(201)
      const { novel } = await jsonOf<{ novel: Novel }>(created)
      // Store raw historical labels: creation normalization can tokenize unknown compound tags.
      await run(t.db, 'UPDATE novels SET categories = $1 WHERE id = $2', [JSON.stringify([category]), novel.id])
    }
    for (const category of ['校园', '校園']) {
      const result = await req(`/api/novels?category=${encodeURIComponent(category)}&status=ongoing&limit=1&search=${encodeURIComponent('别名测试')}`)
      const data = await jsonOf<{ novels: Novel[]; total: number; totalPages: number }>(result)
      expect(data.total).toBe(2)
      expect(data.totalPages).toBe(2)
      expect(data.novels).toHaveLength(1)
      expect(['校园', '校園']).toContain(data.novels[0]!.categories[0])
    }
    const exact = await req(`/api/novels?category=${encodeURIComponent('校园生活')}`)
    expect((await jsonOf<{ total: number }>(exact)).total).toBe(1)
  })

  it('多标签取交集，别名取并集，分页计数与内容访问规则一致', async () => {
    const fixtures = [
      { tags: ['校园', '甜文'], rating: 'general' },
      { tags: ['校園', '甜文'], rating: 'general' },
      { tags: ['校园'], rating: 'general' },
      { tags: ['校园', '甜文'], rating: 'restricted' },
    ]
    for (const [index, fixture] of fixtures.entries()) {
      const response = await req(
        '/api/novels',
        json('POST', { title: `多选交集${index}`, author: '测试', categories: fixture.tags, contentRating: fixture.rating, status: 'ongoing' }, adminToken),
      )
      expect(response.status).toBe(201)
      const { novel } = await jsonOf<{ novel: Novel }>(response)
      await run(t.db, 'UPDATE novels SET categories = $1 WHERE id = $2', [JSON.stringify(fixture.tags), novel.id])
    }
    const query = new URLSearchParams({ categories: JSON.stringify(['校园', '校園', '甜文']), search: '多选交集', status: 'ongoing', limit: '1' })
    const data = await jsonOf<{ novels: Novel[]; total: number; totalPages: number }>(await req(`/api/novels?${query}`))
    expect(data.total).toBe(2)
    expect(data.totalPages).toBe(2)
    expect(data.novels).toHaveLength(1)
    expect(data.novels[0]!.categories).toContain('甜文')
    const second = await jsonOf<{ novels: Novel[]; total: number }>(await req(`/api/novels?${query}&page=2`))
    expect(second.total).toBe(2)
    expect(second.novels[0]!.id).not.toBe(data.novels[0]!.id)
    for (const invalid of ['校园', '{}', '[1]', '[""]', JSON.stringify(Array(65).fill('校园'))]) {
      expect((await req(`/api/novels?categories=${encodeURIComponent(invalid)}`)).status).toBe(400)
    }
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
