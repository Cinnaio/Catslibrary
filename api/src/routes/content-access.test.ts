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

interface Novel {
  id: string
  contentRating: string
}

function json(method: string, body?: unknown, token?: string, cookie?: string): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

const req = (path: string, init?: RequestInit) => app.request(path, init)
const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T

function cookiePair(response: Response): string {
  return String(response.headers.get('set-cookie') || '').split(';', 1)[0] ?? ''
}

describe('限制级内容服务端访问闭环', () => {
  let adminToken = ''
  let readerToken = ''
  let restrictedId = ''
  let generalId = ''
  let restrictedChapterId = ''

  it('准备管理员、作品和章节 fixture', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'access-admin', password: 'adminpass123', displayName: '访问测试管理员' }))
    expect(boot.status).toBe(201)
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['ACCESS-INVITE', Date.now()])
    const reader = await req('/api/auth/register', json('POST', { username: 'access-reader', password: 'readerpass123', invite: 'ACCESS-INVITE' }))
    expect(reader.status).toBe(201)
    readerToken = (await jsonOf<{ token: string }>(reader)).token

    const restricted = await req('/api/novels', json('POST', { title: '受限作品', author: '作者', categories: ['h'], contentRating: 'restricted' }, adminToken))
    expect(restricted.status).toBe(201)
    restrictedId = (await jsonOf<{ novel: Novel }>(restricted)).novel.id

    const general = await req('/api/novels', json('POST', { title: '一般作品', author: '作者', categories: ['悬疑'], contentRating: 'general' }, adminToken))
    expect(general.status).toBe(201)
    generalId = (await jsonOf<{ novel: Novel }>(general)).novel.id

    restrictedChapterId = 'chapter_restricted_access_test'
    await t.db.query(
      `INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [restrictedChapterId, restrictedId, '受限章节', '受限正文', 1, 4, '', Date.now()],
    )
    await t.db.query(
      `INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['chapter_general_access_test', generalId, '一般章节', '一般正文', 1, 4, '', Date.now()],
    )
  })

  it('匿名安全请求在服务端过滤列表，并拦截详情、章节、封面和作品关联接口', async () => {
    const list = await req('/api/novels?limit=100')
    expect(list.status).toBe(200)
    const listBody = await jsonOf<{ novels: Novel[]; total: number }>(list)
    expect(listBody.novels.some((novel) => novel.id === restrictedId)).toBe(false)
    expect(listBody.novels.some((novel) => novel.id === generalId)).toBe(true)
    expect(listBody.total).toBe(1)
    expect(list.headers.get('cache-control')).toContain('private')

    const detail = await req(`/api/novels/${restrictedId}`)
    expect(detail.status).toBe(403)
    expect((await jsonOf<{ code: string }>(detail)).code).toBe('restricted_content')

    const chapterList = await req(`/api/chapters?novelId=${encodeURIComponent(restrictedId)}`)
    expect(chapterList.status).toBe(403)

    const chapter = await req(`/api/chapters/${restrictedChapterId}`)
    expect(chapter.status).toBe(403)
    expect((await jsonOf<{ code: string }>(chapter)).code).toBe('restricted_content')

    const cover = await req(`/api/cover/${encodeURIComponent(restrictedId)}`)
    expect(cover.status).toBe(403)

    const categories = await jsonOf<{ categories: string[] }>(await req('/api/categories'))
    expect(categories.categories).not.toContain('h')

    const rating = await req(`/api/ratings?novelId=${encodeURIComponent(restrictedId)}`)
    expect(rating.status).toBe(403)

    const comments = await req(`/api/comments?novelId=${encodeURIComponent(restrictedId)}`)
    expect(comments.status).toBe(403)

    const thoughts = await req(`/api/thoughts?chapterId=${encodeURIComponent(restrictedChapterId)}`)
    expect(thoughts.status).toBe(403)
    const thoughtPost = await req(
      '/api/thoughts',
      json('POST', { novelId: restrictedId, chapterId: restrictedChapterId, paragraphIndex: 0, thoughtText: '不应写入受限作品段评' }),
    )
    expect(thoughtPost.status).toBe(403)

    const recap = await req(`/api/ai/recap?chapterId=${encodeURIComponent(restrictedChapterId)}`, json('GET', undefined, readerToken))
    expect(recap.status).toBe(403)
    const catchup = await req('/api/ai/catchup', json('POST', { novelId: restrictedId }, readerToken))
    expect(catchup.status).toBe(403)

    const bookshelf = await req('/api/bookshelf', json('POST', { novelId: restrictedId }, readerToken))
    expect(bookshelf.status).toBe(403)
  })

  it('一般作品仍可匿名读取，且受策略影响的响应不使用公共缓存', async () => {
    const detail = await req(`/api/novels/${generalId}`)
    expect(detail.status).toBe(200)
    expect(detail.headers.get('cache-control')).toContain('private')

    const chapters = await req(`/api/chapters?novelId=${encodeURIComponent(generalId)}`)
    expect(chapters.status).toBe(200)
    expect(chapters.headers.get('cache-control')).toContain('private')

    const chapter = await req('/api/chapters/chapter_general_access_test')
    expect(chapter.status).toBe(200)
    expect((await jsonOf<{ chapter: { content: string } }>(chapter)).chapter.content).toBe('一般正文')
  })

  it('确认成年后由服务端签发凭证，受限作品的全部入口才能读取', async () => {
    const invalid = await req('/api/content-policy/unlock', json('POST', { confirmed: false }))
    expect(invalid.status).toBe(400)

    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true }))
    expect(unlock.status).toBe(200)
    const cookie = cookiePair(unlock)
    expect(cookie).toMatch(/^zhizhou_adult_access=v1\./)
    expect(String(unlock.headers.get('set-cookie'))).toContain('HttpOnly')

    const detail = await req(`/api/novels/${restrictedId}`, json('GET', undefined, undefined, cookie))
    expect(detail.status).toBe(200)

    const chapterList = await req(`/api/chapters?novelId=${encodeURIComponent(restrictedId)}`, json('GET', undefined, undefined, cookie))
    expect(chapterList.status).toBe(200)

    const chapter = await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))
    expect(chapter.status).toBe(200)
    expect((await jsonOf<{ chapter: { content: string } }>(chapter)).chapter.content).toBe('受限正文')

    const categories = await jsonOf<{ categories: string[] }>(await req('/api/categories', json('GET', undefined, undefined, cookie)))
    expect(categories.categories).toContain('h')

    const rating = await req(`/api/ratings?novelId=${encodeURIComponent(restrictedId)}`, json('GET', undefined, undefined, cookie))
    expect(rating.status).toBe(200)

    const readerSettings = await req(
      '/api/auth/reader-settings',
      json('PUT', { settings: { contentMode: 'adult' }, updatedAt: { contentMode: Date.now() } }, readerToken),
    )
    expect(readerSettings.status).toBe(200)
    const accountDetail = await req(`/api/novels/${restrictedId}`, json('GET', undefined, readerToken))
    expect(accountDetail.status).toBe(200)
  })

  it('全站关闭时即使持有旧凭证也不能读取限制级内容，管理员仍可在后台查看', async () => {
    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true }))
    const cookie = cookiePair(unlock)
    await t.db.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('adult_content_enabled', 'false', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [Date.now()],
    )

    const blocked = await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))
    expect(blocked.status).toBe(403)

    const admin = await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, adminToken))
    expect(admin.status).toBe(200)

    await t.db.query("UPDATE app_settings SET value = 'true', updated_at = $1 WHERE key = 'adult_content_enabled'", [Date.now()])
  })

  it('篡改或清除凭证后恢复服务端拦截', async () => {
    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true }))
    const cookie = cookiePair(unlock)
    const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')
    expect((await req(`/api/novels/${restrictedId}`, json('GET', undefined, undefined, tampered))).status).toBe(403)

    const lock = await req('/api/content-policy/lock', json('POST', undefined, undefined, cookie))
    expect(lock.status).toBe(200)
    expect(String(lock.headers.get('set-cookie'))).toContain('Max-Age=0')
    expect((await req(`/api/novels/${restrictedId}`)).status).toBe(403)
  })
})
