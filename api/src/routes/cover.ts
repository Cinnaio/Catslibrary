/** /api/cover/:id —— 封面二进制响应（首次读取时懒缓存源图/缺省图）。 */
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { cacheCoverForNovel, coverDataToBody, getStoredCover } from '../services/covers'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import { optionalUser, type AuthEnv } from '../middlewares/auth'

export const coverRoutes = new Hono<AuthEnv>()

coverRoutes.get('/:id', optionalUser(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  if (!id || id.includes('/')) return c.json({ error: 'Invalid novel ID' }, 400)

  const novel = await first<{ id: string; content_rating: string }>(db, 'SELECT id, content_rating FROM novels WHERE id = $1', [id])
  if (!novel) return c.json({ error: 'Novel not found' }, 404)
  if (novel.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }

  let cover = await getStoredCover(db, id)
  // 懒迁移：首次读取时下载源封面（或缺省图）入库
  if (!cover) {
    const cached = await cacheCoverForNovel(db, id)
    if (!cached.ok) return c.json({ error: cached.error || 'Cover not found' }, (cached.status || 404) as 404)
    cover = await getStoredCover(db, id)
  }

  const body = coverDataToBody(cover?.data)
  if (!body) return c.json({ error: 'Cover not found' }, 404)

  const contentType = cover?.content_type || 'image/jpeg'
  const etag = `"${createHash('sha256').update(contentType).update('\0').update(body).digest('hex')}"`
  const cacheHeaders = {
    // Keep the response on private device caches, but re-check authorization
    // with the origin before every reuse. Denials remain no-store above.
    'Cache-Control': 'private, no-cache, must-revalidate',
    Vary: 'Cookie, Authorization, X-Content-Access',
    ETag: etag,
  }
  const ifNoneMatch = c.req.header('If-None-Match')
  if (ifNoneMatch?.split(',').some((candidate) => {
    const tag = candidate.trim()
    return tag === '*' || tag === etag || tag === `W/${etag}`
  })) {
    return c.body(null, 304, cacheHeaders)
  }

  // 封面可能被 AI 采纳/上传替换； ETag 会让磁盘缓存先向服务端校验，
  // 服务端完成受限内容授权检查后再返回 304 或最新图片。
  const responseBody = new Uint8Array(body.byteLength)
  responseBody.set(body)
  return c.body(responseBody, 200, {
    'Content-Type': contentType,
    ...cacheHeaders,
  })
})
