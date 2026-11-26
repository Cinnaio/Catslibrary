import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { all, first } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { contentPolicyHeaders } from '../services/content-access'
import { visibleNovelSql } from '../services/novel-visibility'

export const bookshelfWidgetsRoutes = new Hono<AuthEnv>()
bookshelfWidgetsRoutes.use('*', requireUser(), async (c, next) => {
  for (const [key, value] of Object.entries(contentPolicyHeaders())) c.header(key, value)
  await next()
})
type WidgetItem = { id: string; novelId: string; title: string; author: string; chapterId: string; chapterTitle: string; chapterOrder: number; text: string; scrollPercent: number }
const columns = `n.id AS "novelId",n.title,n.author,ch.id AS "chapterId",ch.title AS "chapterTitle",ch.sort_order AS "chapterOrder"`
bookshelfWidgetsRoutes.get('/', async c => {
  // Desktop and lock-screen snapshots never contain restricted works, even in adult mode.
  const filter = `${visibleNovelSql(c)} AND COALESCE(n.content_rating,'unknown') <> 'restricted'`
  const [reading, quotes] = await Promise.all([
    first<WidgetItem>(getDb(), `SELECT n.id AS id,${columns},'' AS text,rp.scroll_percent AS "scrollPercent"
      FROM reading_progress rp JOIN novels n ON n.id=rp.novel_id JOIN chapters ch ON ch.id=rp.chapter_id AND ch.novel_id=n.id
      WHERE rp.user_id=$1 AND COALESCE(rp.deleted_at,0)=0 AND ${filter}
      ORDER BY rp.updated_at DESC,n.id LIMIT 1`, [c.get('user').id]),
    all<WidgetItem>(getDb(), `SELECT t.id,${columns},LEFT(t.selected_text,240) AS text,0 AS "scrollPercent"
      FROM thoughts t JOIN novels n ON n.id=t.novel_id JOIN chapters ch ON ch.id=t.chapter_id AND ch.novel_id=n.id
      WHERE t.user_id=$1 AND t.status='visible' AND LENGTH(TRIM(t.selected_text))>0 AND ${filter}
      ORDER BY t.created_at DESC,t.id LIMIT 20`, [c.get('user').id]),
  ])
  return c.json({ reading: reading ?? null, quotes })
})
bookshelfWidgetsRoutes.get('/open', async c => {
  const id = c.req.query('id'), kind = c.req.query('kind')
  if (!id || id.length > 200 || !['continue','quote'].includes(kind || '')) return c.json({ error: '小组件入口无效' }, 400)
  const filter = `${visibleNovelSql(c)} AND COALESCE(n.content_rating,'unknown') <> 'restricted'`
  const item = kind === 'quote'
    ? await first<WidgetItem>(getDb(), `SELECT t.id,${columns},LEFT(t.selected_text,240) AS text,0 AS "scrollPercent"
        FROM thoughts t JOIN novels n ON n.id=t.novel_id JOIN chapters ch ON ch.id=t.chapter_id AND ch.novel_id=n.id
        WHERE t.user_id=$1 AND t.id=$2 AND t.status='visible' AND LENGTH(TRIM(t.selected_text))>0 AND ${filter}`, [c.get('user').id,id])
    : await first<WidgetItem>(getDb(), `SELECT n.id AS id,${columns},'' AS text,rp.scroll_percent AS "scrollPercent"
        FROM reading_progress rp JOIN novels n ON n.id=rp.novel_id JOIN chapters ch ON ch.id=rp.chapter_id AND ch.novel_id=n.id
        WHERE rp.user_id=$1 AND n.id=$2 AND COALESCE(rp.deleted_at,0)=0 AND ${filter}`, [c.get('user').id,id])
  if (!item) return c.json({ error: '这条阅读记录或划句已移除，或作品暂不可访问，请回书架选择' }, 404)
  return c.json({ item })
})
