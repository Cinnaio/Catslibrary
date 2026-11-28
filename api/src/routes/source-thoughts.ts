import { Hono } from 'hono'
import { optionalUser, type AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { first } from '../db/query'
import { visibleNovelSql } from '../services/novel-visibility'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import {
  SourceThoughtParentUnavailable,
  ensureSourceThoughtChapter,
  storedSourceChapter,
  sourceSyncStatus,
  savedSourceThoughtCounts,
  readSourceThoughtPage,
  syncSourceThoughtStep,
} from '../services/source-thought-storage'
import { matchSourceParagraphs } from '../services/source-thoughts'

export const sourceThoughtsRoutes = new Hono<AuthEnv>()
sourceThoughtsRoutes.get('/', optionalUser(), async (c) => {
  const chapterId = c.req.query('chapterId') || ''
  const action = c.req.query('action') || 'counts'
  const cursor = c.req.query('cursor') || ''
  if (!chapterId || chapterId.length > 120 || !['counts', 'comments', 'replies'].includes(action) || !/^(?:\d{0,7}|s:[1-9]\d{0,17})$/.test(cursor))
    return c.json({ error: '无效的想法请求' }, 400)
  const readChapter = () =>
    first<{ content: string; source_url: string; book_url: string; content_rating: string }>(
      getDb(),
      `SELECT c.content,c.source_url,n.content_rating,COALESCE(NULLIF(sc.source_url,''),n.source_url,'') AS book_url
     FROM chapters c JOIN novels n ON n.id=c.novel_id LEFT JOIN scrape_configs sc ON sc.novel_id=n.id
     WHERE c.id=$1 AND ${visibleNovelSql(c)}`,
      [chapterId],
    )
  let chapter = await readChapter()
  if (!chapter) return c.json({ error: '章节不存在' }, 404)
  if (chapter.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const headers = contentPolicyHeaders()
  try {
    let snapshot = await ensureSourceThoughtChapter(getDb(), chapterId, c.req.query('refresh') === '1')
    if (!snapshot)
      return action === 'counts'
        ? c.json({ available: false, paragraphs: [], unmatchedCount: 0 }, 200, headers)
        : c.json({ error: '此书源暂不提供段评' }, 404, headers)
    // 冷启动只取段落统计；已有快照立即响应，后续页由持久任务补齐。
    if (!snapshot.paragraphs) {
      await syncSourceThoughtStep(getDb(), chapterId)
      snapshot = await storedSourceChapter(getDb(), chapterId)
      if (!snapshot) return c.json({ error: '章节来源已变化，请重试' }, 409, headers)
    }
    if (!snapshot.paragraphs && ['partial', 'unavailable'].includes(snapshot.state)) throw new Error('Source snapshot not available')
    // 冷读取可能等待来源；返回前重新核对作品权限和来源，防止等待期间改为私密。
    const latest = await readChapter()
    if (!latest) return c.json({ error: '章节不存在' }, 404, headers)
    if (latest.content_rating === 'restricted') {
      const access = await resolveContentAccess(c)
      if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
    }
    if (latest.source_url !== snapshot.chapter_url || latest.book_url !== snapshot.book_url) return c.json({ error: '章节来源已变化，请重试' }, 409, headers)
    chapter = latest
    const source = snapshot.paragraphs || []
    const mapped = matchSourceParagraphs(chapter.content, source)
    if (action === 'counts') {
      const savedCounts = await savedSourceThoughtCounts(getDb(), chapterId)
      return c.json(
        {
          available: true,
          source: { id: snapshot.source_id, label: snapshot.source_label },
          paragraphs: mapped.map((m) => ({
            paragraphIndex: m.paragraphIndex,
            paragraphHash: m.paragraphHash,
            count: Math.max(m.source.count, savedCounts.get(`${m.source.index}:${m.paragraphHash}`) || 0),
          })),
          unmatchedCount: source.filter((p) => p.count > 0 && !mapped.some((m) => m.source.index === p.index)).length,
          sync: await sourceSyncStatus(getDb(), snapshot),
        },
        200,
        headers,
      )
    }
    const rawIndex = c.req.query('paragraphIndex') || ''
    const hash = c.req.query('paragraphHash') || ''
    if (!/^\d{1,5}$/.test(rawIndex)) return c.json({ error: '请选择正文段落' }, 400, headers)
    const anchor = mapped.find((m) => m.paragraphIndex === Number(rawIndex) && m.paragraphHash === hash)
    if (!anchor) return c.json({ error: '原文已变化或无法唯一定位，请重新打开本段想法' }, 409, headers)
    const id = action === 'replies' ? c.req.query('commentId') || '' : ''
    if (action === 'replies' && !/^\d{6,30}$/.test(id)) return c.json({ error: '无效的来源评论' }, 400, headers)
    let page = await readSourceThoughtPage(getDb(), snapshot, anchor.source, cursor, id)
    if (page.items.length === 0 && !page.sync?.complete && snapshot.retry_at <= Date.now()) {
      await syncSourceThoughtStep(getDb(), chapterId, { paragraph: anchor.source, parent: id })
      const current = await storedSourceChapter(getDb(), chapterId)
      if (!current || current.source_key !== snapshot.source_key) return c.json({ error: '章节来源已变化，请重试' }, 409, headers)
      const latestChapter = await readChapter()
      if (!latestChapter) return c.json({ error: '章节不存在' }, 404, headers)
      if (latestChapter.content_rating === 'restricted') {
        const access = await resolveContentAccess(c)
        if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
      }
      if (latestChapter.source_url !== current.chapter_url || latestChapter.book_url !== current.book_url)
        return c.json({ error: '章节来源已变化，请重试' }, 409, headers)
      const currentAnchor = matchSourceParagraphs(latestChapter.content, current.paragraphs || []).find(
        (m) => m.paragraphIndex === Number(rawIndex) && m.paragraphHash === hash,
      )
      if (!currentAnchor) return c.json({ error: '来源原文已变化，请重新打开本段想法' }, 409, headers)
      page = await readSourceThoughtPage(getDb(), current, currentAnchor.source, cursor, id)
    }
    return c.json(page, 200, headers)
  } catch (error) {
    if (error instanceof SourceThoughtParentUnavailable) return c.json({ error: '来源评论不存在或不属于当前段落' }, 404, headers)
    // Never turn upstream failure into a cached zero count or expose credentials/gateway errors.
    return c.json({ error: '来源段评暂时无法加载，请稍后重试；本站想法仍可使用' }, 502, headers)
  }
})
