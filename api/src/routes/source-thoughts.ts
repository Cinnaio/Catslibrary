import { Hono } from 'hono'
import { optionalUser, type AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { visibleNovelSql } from '../services/novel-visibility'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import { adapterForUrl } from '../services/scraper/sources'
import { matchSourceParagraphs } from '../services/source-thoughts'

export const sourceThoughtsRoutes = new Hono<AuthEnv>()
sourceThoughtsRoutes.get('/', optionalUser(), async c => {
  const chapterId = c.req.query('chapterId') || ''
  const action = c.req.query('action') || 'counts'
  const cursor = c.req.query('cursor') || ''
  if (!chapterId || chapterId.length > 120 || !['counts', 'comments', 'replies'].includes(action) || !/^\d{0,7}$/.test(cursor)) return c.json({ error: '无效的想法请求' }, 400)
  const chapter = await first<{ content: string; source_url: string; book_url: string; content_rating: string }>(getDb(),
    `SELECT c.content,c.source_url,n.content_rating,COALESCE(NULLIF(sc.source_url,''),n.source_url,'') AS book_url
     FROM chapters c JOIN novels n ON n.id=c.novel_id LEFT JOIN scrape_configs sc ON sc.novel_id=n.id
     WHERE c.id=$1 AND ${visibleNovelSql(c)}`, [chapterId])
  if (!chapter) return c.json({ error: '章节不存在' }, 404)
  if (chapter.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const adapter = adapterForUrl(chapter.source_url || '')
  const provider = adapter?.paragraphComments
  const headers = contentPolicyHeaders()
  try {
    if (!provider?.enabled()) return action === 'counts'
      ? c.json({ available: false, paragraphs: [], unmatchedCount: 0 }, 200, headers)
      : c.json({ error: '此书源暂不提供段评' }, 404, headers)
    const context = { chapterUrl: chapter.source_url, bookUrl: chapter.book_url }
    const source = await provider.paragraphs(context)
    const mapped = matchSourceParagraphs(chapter.content, source)
    if (action === 'counts') return c.json({ available: true, source: { id: adapter!.id, label: adapter!.name },
      paragraphs: mapped.map(m => ({ paragraphIndex: m.paragraphIndex, paragraphHash: m.paragraphHash, count: m.source.count })),
      unmatchedCount: source.filter(p => p.count > 0 && !mapped.some(m => m.source.index === p.index)).length,
    }, 200, headers)
    const rawIndex = c.req.query('paragraphIndex') || ''
    const hash = c.req.query('paragraphHash') || ''
    if (!/^\d{1,5}$/.test(rawIndex)) return c.json({ error: '请选择正文段落' }, 400, headers)
    const anchor = mapped.find(m => m.paragraphIndex === Number(rawIndex) && m.paragraphHash === hash)
    if (!anchor) return c.json({ error: '原文已变化或无法唯一定位，请重新打开本段想法' }, 409, headers)
    if (action === 'comments') return c.json(await provider.comments(context, anchor.source, cursor), 200, headers)
    const id = c.req.query('commentId') || ''
    if (!/^\d{6,30}$/.test(id)) return c.json({ error: '无效的来源评论' }, 400, headers)
    return c.json(await provider.replies(context, id, cursor), 200, headers)
  } catch {
    // Never turn upstream failure into a cached zero count or expose credentials/gateway errors.
    return c.json({ error: '来源段评暂时无法加载，请稍后重试；本站想法仍可使用' }, 502, headers)
  }
})
