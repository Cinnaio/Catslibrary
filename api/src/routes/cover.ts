/** /api/cover/:id —— 封面二进制响应（首次读取时懒缓存源图/缺省图）。 */
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

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': cover?.content_type || 'image/jpeg',
      // 封面现在可被 AI 采纳/上传替换（可变资源），去掉 immutable；破缓存靠前端 ?v=novel.updatedAt
      ...contentPolicyHeaders(),
    },
  })
})
