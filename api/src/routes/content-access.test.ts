import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { createSession } from '../services/sessions'
import { loadConfig } from '../config'
import { setAdultContentEnabled } from '../services/content-policy'
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
  vi.stubEnv('TURNSTILE_SITE_KEY', 'fixture-site')
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'fixture-secret')
  vi.stubEnv('TURNSTILE_HOSTNAMES', 'read.example.com')
  const consumed = new Set<string>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const token = (JSON.parse(String(init.body)) as { response: string }).response
      const success = typeof token === 'string' && token.startsWith('valid-') && !consumed.has(token)
      consumed.add(token)
      return new Response(JSON.stringify({ success, hostname: 'read.example.com', action: 'r18_unlock' }))
    }),
  )
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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

  it('仅登录且通过人机验证后签发会话凭证；阅读设置不能旁路授权', async () => {
    expect((await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-guest' }))).status).toBe(401)
    const invalid = await req('/api/content-policy/unlock', json('POST', { confirmed: false }, readerToken))
    expect(invalid.status).toBe(400)

    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-first' }, readerToken))
    expect(unlock.status).toBe(200)
    const cookie = cookiePair(unlock)
    expect(cookie).toMatch(/^zhizhou_adult_access=v2\./)
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
    expect(readerSettings.status).toBe(403)
    const accountDetail = await req(`/api/novels/${restrictedId}`, json('GET', undefined, readerToken))
    expect(accountDetail.status).toBe(200)
  })

  it('原生验证页仅公开站点公钥，配置关闭时不提供验证页面', async () => {
    const page = await req('/api/content-policy/native-challenge')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('cache-control')).toContain('no-store')
    expect(page.headers.get('x-robots-tag')).toContain('noindex')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const html = await page.text()
    expect(html).toContain('fixture-site')
    expect(html).toContain("action:'r18_unlock'")
    expect(html).toContain('messageHandlers?.adultChallenge')
    expect(html).not.toContain('fixture-secret')
    expect(page.headers.get('set-cookie')).toBeNull()
    await setAdultContentEnabled(false)
    expect((await req('/api/content-policy/native-challenge')).status).toBe(403)
    await setAdultContentEnabled(true)
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    expect((await req('/api/content-policy/native-challenge')).status).toBe(503)
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'fixture-secret')
  })

  it('原生 Bearer 会话无需 Cookie 即可在线阅读，安全下载仍拒绝限制级正文', async () => {
    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-native-online' }, readerToken))
    expect(unlock.status).toBe(200)
    const online = await req(`/api/chapters/${restrictedChapterId}?contentMode=adult`, json('GET', undefined, readerToken))
    expect(online.status).toBe(200)
    expect(online.headers.get('cache-control')).toContain('no-store')
    const favorites = await req('/api/bookshelf', json('POST', { novelId: restrictedId }, readerToken))
    expect(favorites.status).toBe(200)
    const shelf = await jsonOf<{ favorites: Array<{ novelId: string; contentRating: string }> }>(
      await req('/api/bookshelf?contentMode=adult', json('GET', undefined, readerToken)),
    )
    expect(shelf.favorites.find((item) => item.novelId === restrictedId)?.contentRating).toBe('restricted')
    for (const token of [readerToken, adminToken]) {
      expect((await req(`/api/chapters/${restrictedChapterId}?contentMode=safe`, json('GET', undefined, token))).status).toBe(403)
      expect((await req(`/api/chapters?novelId=${restrictedId}&contentMode=safe`, json('GET', undefined, token))).status).toBe(403)
      expect((await req('/api/chapters/chapter_general_access_test?contentMode=safe', json('GET', undefined, token))).status).toBe(200)
    }
    // 字号等移动端阅读设置同步，不应撤销独立的会话授权。
    expect(
      (await req('/api/auth/reader-settings', json('PUT', { device: 'mobile', settings: { fontSize: '3' }, updatedAt: { fontSize: Date.now() } }, readerToken)))
        .status,
    ).toBe(200)
    expect((await req('/api/content-policy/refresh', json('POST', undefined, readerToken))).status).toBe(200)
  })

  it('账号内容模式跨设备共享，但恢复状态只认可当前会话授权', async () => {
    expect((await req('/api/content-policy/status')).status).toBe(401)
    const { rows } = await t.db.query<{ id: string }>("SELECT id FROM users WHERE username='access-reader'")
    const otherToken = await createSession(t.db, rows[0]!.id, 'status-other-device', loadConfig().sessionHashSalt)
    type Status = { contentMode: string; sessionAuthorized: boolean; expiresIn: number }
    const current = await req('/api/content-policy/status', json('GET', undefined, readerToken))
    expect(current.status).toBe(200)
    expect(current.headers.get('cache-control')).toContain('no-store')
    const currentBody = await jsonOf<Status>(current)
    expect(currentBody).toMatchObject({ contentMode: 'adult', sessionAuthorized: true })
    expect(currentBody.expiresIn).toBeGreaterThan(0)
    expect(currentBody.expiresIn).toBeLessThanOrEqual(86400)
    expect(await jsonOf<Status>(await req('/api/content-policy/status', json('GET', undefined, otherToken)))).toMatchObject({
      contentMode: 'adult',
      sessionAuthorized: false,
      expiresIn: 0,
    })
    // 管理员的后台权限不等于阅读模式已经开启。
    expect(await jsonOf<Status>(await req('/api/content-policy/status', json('GET', undefined, adminToken)))).toMatchObject({
      contentMode: 'safe',
      sessionAuthorized: false,
      expiresIn: 0,
    })
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    expect(await jsonOf<Status>(await req('/api/content-policy/status', json('GET', undefined, readerToken)))).toMatchObject({
      contentMode: 'adult',
      sessionAuthorized: false,
      expiresIn: 0,
    })
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'fixture-secret')
    await t.db.query('UPDATE user_sessions SET adult_access_until=1 WHERE user_id=$1', [rows[0]!.id])
    expect(await jsonOf<Status>(await req('/api/content-policy/status', json('GET', undefined, readerToken)))).toMatchObject({
      contentMode: 'adult',
      sessionAuthorized: false,
      expiresIn: 0,
    })
    expect((await req('/api/content-policy/lock', json('POST', undefined, otherToken))).status).toBe(200)
    for (const token of [readerToken, otherToken]) {
      expect(await jsonOf<Status>(await req('/api/content-policy/status', json('GET', undefined, token)))).toMatchObject({
        contentMode: 'safe',
        sessionAuthorized: false,
        expiresIn: 0,
      })
    }
  })

  it('全站关闭时即使持有旧凭证也不能读取限制级内容，管理员仍可在后台查看', async () => {
    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-disabled' }, readerToken))
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
    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-lock' }, readerToken))
    const cookie = cookiePair(unlock)
    const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')
    expect((await req(`/api/novels/${restrictedId}`, json('GET', undefined, undefined, tampered))).status).toBe(403)

    const lock = await req('/api/content-policy/lock', json('POST', undefined, readerToken, cookie))
    expect(lock.status).toBe(200)
    expect(String(lock.headers.get('set-cookie'))).toContain('Max-Age=0')
    expect((await req(`/api/novels/${restrictedId}`)).status).toBe(403)
    expect((await req(`/api/novels/${restrictedId}`, json('GET', undefined, undefined, cookie))).status).toBe(403)
  })

  it('旧匿名签名、成人查询参数和账号偏好不能授予权限', async () => {
    const payload = `v1.${Math.floor(Date.now() / 1000) + 86400}`
    const signature = createHmac('sha256', `${process.env.SESSION_HASH_SALT || 'zhi-zhou'}\u0000content-access-v1`)
      .update(payload)
      .digest('base64url')
    const cookie = `zhizhou_adult_access=${payload}.${signature}`
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))).status).toBe(403)
    const list = await jsonOf<{ novels: Novel[] }>(
      await req('/api/novels?contentMode=adult&contentRating=restricted', json('GET', undefined, undefined, cookie)),
    )
    expect(list.novels).toHaveLength(0)
    await t.db.query('UPDATE users SET reader_settings = \'{"contentMode":"adult"}\' WHERE username = \'access-reader\'')
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, readerToken))).status).toBe(403)
    expect((await req('/api/content-policy/refresh', json('POST', {}, readerToken))).status).toBe(403)
  })

  it('安全模式不能获取单本进度或通过批量书签写入 R18 记录', async () => {
    expect((await req(`/api/progress?novelId=${restrictedId}`, json('GET', undefined, readerToken))).status).toBe(403)
    expect((await req('/api/progress', json('POST', { novelId: restrictedId, chapterId: restrictedChapterId }, readerToken))).status).toBe(403)
    expect((await req('/api/bookmarks', json('PUT', { bookmarks: [{ novelId: restrictedId, chapterId: restrictedChapterId }] }, readerToken))).status).toBe(403)
    expect((await req('/api/bookmarks', json('PUT', { bookmarks: [{ novelId: generalId, chapterId: restrictedChapterId }] }, readerToken))).status).toBe(400)
  })

  it('缺配置或缺验证令牌时拒绝解锁', async () => {
    await t.db.query('DELETE FROM content_request_limits')
    expect((await req('/api/content-policy/unlock', json('POST', { confirmed: true }, readerToken))).status).toBe(403)
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    expect((await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-missing-config' }, readerToken))).status).toBe(503)
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'fixture-secret')
  })

  it('令牌不可重复验证，安全设置撤销、无效身份、注销均使旧凭证失效', async () => {
    await t.db.query('DELETE FROM content_request_limits')
    const body = { confirmed: true, turnstileToken: 'valid-replay' }
    const unlocked = await req('/api/content-policy/unlock', json('POST', body, readerToken))
    expect(unlocked.status).toBe(200)
    const cookie = cookiePair(unlocked)
    expect((await req('/api/content-policy/unlock', json('POST', body, readerToken))).status).toBe(403)
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, 'invalid-bearer', cookie))).status).toBe(403)
    const settings = await req('/api/auth/reader-settings', json('PUT', { settings: { contentMode: 'safe' }, updatedAt: { contentMode: 1 } }, readerToken))
    expect(settings.status).toBe(200)
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))).status).toBe(403)
    const again = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-logout' }, readerToken))
    expect(again.status).toBe(200)
    const logoutCookie = cookiePair(again)
    expect((await req('/api/auth/logout', json('POST', {}, readerToken))).status).toBe(200)
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, logoutCookie))).status).toBe(403)
  })

  it('新会话、禁用账号、过期会话/授权都不能借用已有 Cookie；受限封面也受保护', async () => {
    await t.db.query('DELETE FROM content_request_limits')
    const { rows } = await t.db.query<{ id: string }>("SELECT id FROM users WHERE username = 'access-reader'")
    const userId = rows[0]!.id
    readerToken = await createSession(t.db, userId, 'first-device', loadConfig().sessionHashSalt)
    const unlock = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-session-check' }, readerToken))
    expect(unlock.status).toBe(200)
    const cookie = cookiePair(unlock)
    const otherToken = await createSession(t.db, userId, 'second-device', loadConfig().sessionHashSalt)
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, otherToken, cookie))).status).toBe(403)
    await t.db.query("INSERT INTO novel_covers(novel_id,data,content_type,source,updated_at) VALUES ($1,$2,'image/png','fixture',1)", [
      restrictedId,
      Buffer.from([1, 2, 3]),
    ])
    const cover = await req(`/api/cover/${restrictedId}`, json('GET', undefined, undefined, cookie))
    expect(cover.status).toBe(200)
    expect(cover.headers.get('cache-control')).toContain('no-store')
    const conditional = json('GET', undefined, otherToken, cookie)
    conditional.headers = { ...conditional.headers, 'If-None-Match': cover.headers.get('etag')! }
    expect((await req(`/api/cover/${restrictedId}`, conditional)).status).toBe(403)
    await t.db.query("UPDATE users SET status='disabled' WHERE id=$1", [userId])
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))).status).toBe(403)
    await t.db.query("UPDATE users SET status='active' WHERE id=$1", [userId])
    await t.db.query('UPDATE user_sessions SET adult_access_until=1 WHERE user_id=$1', [userId])
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))).status).toBe(403)
    await t.db.query('UPDATE user_sessions SET adult_access_until=$1, expires_at=1 WHERE user_id=$2', [Date.now() + 60000, userId])
    expect((await req(`/api/chapters/${restrictedChapterId}`, json('GET', undefined, undefined, cookie))).status).toBe(403)
  })

  it('安全模式批量同步不会删除隐藏的 R18 书签，且书签元数据取自数据库', async () => {
    await t.db.query('DELETE FROM content_request_limits')
    const { rows } = await t.db.query<{ id: string }>("SELECT id FROM users WHERE username='access-reader'")
    readerToken = await createSession(t.db, rows[0]!.id, 'bookmark-device', loadConfig().sessionHashSalt)
    expect((await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-bookmarks' }, readerToken))).status).toBe(200)
    expect(
      (
        await req(
          '/api/bookmarks',
          json('PUT', { bookmarks: [{ novelId: restrictedId, chapterId: restrictedChapterId, novelTitle: '伪造标题' }] }, readerToken),
        )
      ).status,
    ).toBe(200)
    const { rows: saved } = await t.db.query<{ novel_title: string }>('SELECT novel_title FROM user_bookmarks WHERE user_id=$1', [rows[0]!.id])
    expect(saved[0]!.novel_title).toBe('受限作品')
    await req('/api/content-policy/lock', json('POST', {}, readerToken))
    expect((await req('/api/bookmarks', json('PUT', { bookmarks: [] }, readerToken))).status).toBe(200)
    const visible = await jsonOf<{ bookmarks: unknown[] }>(await req('/api/bookmarks', json('GET', undefined, readerToken)))
    expect(visible.bookmarks).toHaveLength(0)
    expect((await t.db.query('SELECT id FROM user_bookmarks WHERE user_id=$1', [rows[0]!.id])).rows).toHaveLength(1)
  })

  it('正文按账号限流，改用 Cookie 不能绕过；匿名按可信 IP 限流', async () => {
    await t.db.query('DELETE FROM content_request_limits')
    vi.stubEnv('CHAPTER_READ_LIMIT_PER_MINUTE', '1')
    expect((await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-limit' }, readerToken))).status).toBe(200)
    const refresh = await req('/api/content-policy/refresh', json('POST', {}, readerToken))
    expect(refresh.status).toBe(200)
    const cookie = cookiePair(refresh)
    expect((await req('/api/chapters/chapter_general_access_test', json('GET', undefined, readerToken))).status).toBe(200)
    const limited = await req('/api/chapters/chapter_general_access_test', json('GET', undefined, undefined, cookie))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    vi.stubEnv('TRUST_PROXY', 'true')
    const headers = { 'CF-Connecting-IP': '192.0.2.70' }
    expect((await req('/api/chapters/chapter_general_access_test', { headers })).status).toBe(200)
    expect((await req('/api/chapters/chapter_general_access_test', { headers })).status).toBe(200)
    expect((await req('/api/chapters/chapter_general_access_test', { headers })).status).toBe(429)
  })

  it('验证过程中全站关闭不能留下新授权，重新开放也不会恢复旧授权', async () => {
    await t.db.query('DELETE FROM content_request_limits')
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await setAdultContentEnabled(false)
      return new Response(JSON.stringify({ success: true, hostname: 'read.example.com', action: 'r18_unlock' }))
    })
    const response = await req('/api/content-policy/unlock', json('POST', { confirmed: true, turnstileToken: 'valid-race' }, readerToken))
    expect(response.status).toBe(403)
    expect((await jsonOf<{ reason: string }>(response)).reason).toBe('site_disabled')
    expect((await t.db.query('SELECT token_hash FROM user_sessions WHERE adult_access_until > 0')).rows).toHaveLength(0)
    await setAdultContentEnabled(true)
    expect((await req('/api/content-policy/refresh', json('POST', {}, readerToken))).status).toBe(403)
  })
})
