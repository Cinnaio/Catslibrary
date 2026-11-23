import { visibleNovelSql } from '../services/novel-visibility'
/**
 * /api/chapters —— 章节列表/内容/创建/更新/删除（由 Novel-KV 平移）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { rowToChapterFull, rowToChapterMeta } from '../db/mappers'
import { newId } from '../services/auth'
import { chapterWriteRevision } from '../services/chapter-write-revision'
import { simplifyChapterForSource } from '../services/zh-convert'
import { optionalUser, requireAdmin, type AuthEnv } from '../middlewares/auth'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'
import { checkContentRate } from '../services/content-rate-limit'
import { checkChapterProtection } from '../services/reading-access'
import { getReadingAccessSettings } from '../services/reading-access-settings'
import { isAdministrator } from '@shared/roles'
import { chapterIllustrationsRoutes } from './chapter-illustrations'
import { BOOK_SEARCH_MAX_QUERY } from '@shared/book-search'
import { parseSearchCursor, searchableChapterText, searchBook } from '../services/book-search'

export const chaptersRoutes = new Hono<AuthEnv>()
chaptersRoutes.route('/', chapterIllustrationsRoutes)

// Keep the named route ahead of /:id. All snippets use the same visibility/access gate as chapter reads.
chaptersRoutes.get('/search', optionalUser(), async c => {
  const novelId = (c.req.query('novelId') || '').trim()
  const query = (c.req.query('q') || '').trim()
  const cursor = parseSearchCursor(c.req.query('cursor') || '')
  if (!novelId || !query || query.length > BOOK_SEARCH_MAX_QUERY || !cursor)
    return c.json({ error: `请输入 1–${BOOK_SEARCH_MAX_QUERY} 字的关键词和有效作品` }, 400)
  const db = getDb()
  const novel = await first<{ content_rating: string }>(db, `SELECT content_rating FROM novels WHERE id=$1 AND ${visibleNovelSql(c, 'novels')}`, [novelId])
  if (!novel) return c.json({ error: '作品不存在或不可访问' }, 404)
  if (novel.content_rating === 'restricted') {
    if (c.req.query('contentMode') === 'safe') return restrictedContentResponse(c, 'safe_mode')
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const limited = await checkContentRate(c, 'book-search')
  if (limited) return limited
  return c.json(await searchBook(db, novelId, query, cursor, c.req.raw.signal), 200, contentPolicyHeaders())
})

// ---------- 列表 ----------

chaptersRoutes.get('/', optionalUser(), async (c) => {
  const db = getDb()
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId query parameter is required' }, 400)
  const novel = await first<{ id: string; content_rating: string }>(db, `SELECT id, content_rating FROM novels WHERE id = $1 AND ${visibleNovelSql(c, 'novels')}`, [novelId])
  if (!novel) return c.json({ error: 'Novel not found' }, 404)
  if (novel.content_rating === 'restricted') {
    if (c.req.query('contentMode') === 'safe') return restrictedContentResponse(c, 'safe_mode')
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  // 显式列，绝不 SELECT *：content 是整章正文，避免整本小说被拉走
  const rows = await all<Record<string, unknown>>(
    db,
    'SELECT id, novel_id, title, sort_order, word_count, source_url, created_at FROM chapters WHERE novel_id = $1 ORDER BY sort_order, id',
    [novelId],
  )
  const chapters = rows.map(rowToChapterMeta).filter((ch) => ch !== null)
  return c.json({ chapters, novelId, total: chapters.length }, 200, contentPolicyHeaders())
})

// ---------- 创建 / 批量 / 维护（管理员） ----------

chaptersRoutes.post('/', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  if (body.action === 'batch-delete') return deleteChaptersBatch(c, db, body)
  if (body.chapters && Array.isArray(body.chapters)) return createChaptersBatch(c, db, body.novelId, body.chapters)
  return createChapter(c, db, body)
})

chaptersRoutes.delete('/', requireAdmin(), async (c) => {
  const db = getDb()
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId query parameter is required' }, 400)
  const deleted = await run(db, 'DELETE FROM chapters WHERE novel_id = $1', [novelId])
  const now = Date.now()
  await run(db, 'UPDATE novels SET chapter_count = 0, updated_at = $1 WHERE id = $2', [now, novelId])
  return c.json({ success: true, deleted })
})

// ---------- 详情 / 更新 / 删除 ----------

chaptersRoutes.get('/:id', optionalUser(), async (c) => {
  const policy = isAdministrator(c.get('user')?.role) ? undefined : await getReadingAccessSettings()
  const limited = await checkContentRate(c, 'chapter', policy)
  if (limited) return limited
  const db = getDb()
  const id = c.req.param('id')
  if (!id || id.includes('/')) return c.json({ error: 'Invalid chapter ID' }, 400)
  const row = await first<Record<string, unknown>>(
    db,
    `SELECT c.*, n.content_rating
     FROM chapters c
     JOIN novels n ON n.id = c.novel_id
     WHERE c.id = $1 AND ${visibleNovelSql(c)}`,
    [id],
  )
  if (!row) return c.json({ error: 'Chapter not found' }, 404)
  if (row.content_rating === 'restricted') {
    if (c.req.query('contentMode') === 'safe') return restrictedContentResponse(c, 'safe_mode')
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  const protection = await checkChapterProtection(c, { chapterId: id, novelId: String(row.novel_id) }, policy)
  if (protection) return protection
  const chapter = rowToChapterFull(row)!
  const revision = chapterWriteRevision(chapter)
  // Native search navigation reads the exact same visible text used by the search service.
  if (c.req.query('format') === 'text') chapter.content = searchableChapterText(chapter.content)
  return c.json({ chapter: { ...chapter, revision } }, 200, contentPolicyHeaders())
})

chaptersRoutes.put('/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (typeof body?.baseRevision !== 'string' || !body.baseRevision) {
    return c.json({ error: '缺少章节版本，请更新客户端并重新读取章节后再保存', code: 'chapter_revision_required' }, 428)
  }

  return withTx(db, async (q) => {
    // Read and compare under the same row lock as the write. Other writers need no revision column.
    const { rows } = await q<Record<string, unknown>>('SELECT * FROM chapters WHERE id = $1 FOR UPDATE', [id])
    const existing = rowToChapterFull(rows[0])
    if (!existing) return c.json({ error: 'Chapter not found' }, 404)
    if (body.baseRevision !== chapterWriteRevision(existing)) {
      return c.json({ error: '章节已被其他操作更新，本次未保存。当前草稿仍保留，请先备份草稿，再重新打开章节核对最新内容。', code: 'chapter_conflict' }, 409)
    }
    const novelId = body.novelId || existing.novelId
    if (novelId !== existing.novelId) return c.json({ error: 'Chapter does not belong to this novel' }, 400)
    const title = body.title ?? existing.title
    const content = body.content ?? existing.content
    const order = body.order ?? existing.order
    const sourceUrl = body.sourceUrl ?? existing.sourceUrl
    if (typeof title !== 'string' || typeof content !== 'string' || typeof sourceUrl !== 'string' || !Number.isSafeInteger(order)) {
      return c.json({ error: '章节字段无效' }, 400)
    }
    const wordCount = content.replace(/<[^>]*>/g, '').length
    const updated = await q<Record<string, unknown>>(
      'UPDATE chapters SET title=$1, content=$2, sort_order=$3, word_count=$4, source_url=$5 WHERE id=$6 RETURNING *',
      [title, content, order, wordCount, sourceUrl, id],
    )
    await q('UPDATE novels SET updated_at = $1 WHERE id = $2', [Date.now(), novelId])
    // 正文变化时由数据库触发器在同一事务内作废提要；标题更新不作废。
    const chapter = rowToChapterFull(updated.rows[0])!
    return c.json({ chapter: { ...chapter, revision: chapterWriteRevision(chapter) } })
  })
})

chaptersRoutes.delete('/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const row = await first<{ novel_id: string }>(db, 'SELECT novel_id FROM chapters WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Chapter not found' }, 404)
  const novelId = row.novel_id
  const now = Date.now()
  await withTx(db, async (q) => {
    await q('DELETE FROM chapters WHERE id = $1', [id])
    await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
  })
  return c.json({ success: true })
})

// ---------- 内部辅助 ----------

async function createChapter(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const novelId = body.novelId
  const title = body.title
  if (!novelId || !title) return c.json({ error: 'novelId and title are required' }, 400)

  const id = newId('ch')
  const now = Date.now()
  const sourceUrl = body.sourceUrl || ''
  const chapter = simplifyChapterForSource({ title, content: body.content || '', sourceUrl }, sourceUrl)
  const content = chapter.content || ''
  const order = body.order || 1
  const wordCount = content.replace(/<[^>]*>/g, '').length

  try {
    await withTx(db, async (q) => {
      await q(
        `INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, novelId, chapter.title, content, order, wordCount, sourceUrl, now],
      )
      await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
    })
  } catch (err) {
    // FK 违反（novel_id 不存在）→ 404；PG 错误码 23503
    const msg = (err as Error)?.message || ''
    if ((err as { code?: string })?.code === '23503' || /foreign key/i.test(msg)) {
      return c.json({ error: 'Novel not found' }, 404)
    }
    throw err
  }

  return c.json({ chapter: { id, novelId, title: chapter.title, content, order, wordCount, sourceUrl, createdAt: now } }, 201)
}

async function createChaptersBatch(c: Context, db: ReturnType<typeof getDb>, novelId: string, chaptersArr: unknown[]) {
  if (!novelId || !Array.isArray(chaptersArr) || chaptersArr.length === 0) {
    return c.json({ error: 'novelId and chapters array are required' }, 400)
  }
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: 'Novel not found' }, 404)

  const now = Date.now()
  const metas: Array<{ id: string; novelId: string; title: string; order: number; wordCount: number; sourceUrl: string; createdAt: number }> = []
  const inserts: Array<[string, unknown[]]> = []

  for (const ch of chaptersArr as Array<Record<string, unknown>>) {
    const id = newId('ch')
    const sourceUrl = String(ch.sourceUrl || '')
    const chapter = simplifyChapterForSource({ title: String(ch.title || ''), content: String(ch.content || ''), sourceUrl }, sourceUrl)
    const content = chapter.content || ''
    const order = Number(ch.order) || 1
    const wordCount = content.replace(/<[^>]*>/g, '').length
    metas.push({ id, novelId, title: chapter.title, order, wordCount, sourceUrl, createdAt: now })
    inserts.push([
      `INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, novelId, chapter.title, content, order, wordCount, sourceUrl, now],
    ])
  }

  await withTx(db, async (q) => {
    for (const [sql, p] of inserts) await q(sql, p)
    await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
  })

  const total = (await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM chapters WHERE novel_id = $1', [novelId]))?.total || 0
  return c.json({ created: metas.length, chapterIds: metas.map((m) => m.id), totalChapters: total }, 201)
}

async function deleteChaptersBatch(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const novelId = String(body.novelId || '').trim()
  const ids: string[] = Array.isArray(body.chapterIds) ? Array.from(new Set(body.chapterIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))) : []
  if (!novelId || !ids.length) return c.json({ error: 'novelId and chapterIds are required' }, 400)
  const operationKey = idempotencyKeyFromRequest(c, body, ['operationId'])
  return withIdempotency(
    db,
    {
      scope: `chapters.batch-delete.${c.get('user').id}.${novelId}`,
      operationKey,
      payload: { action: 'batch-delete', novelId, chapterIds: ids },
      audit: { actorUserId: c.get('user').id, action: 'batch-delete-chapters', targetCount: ids.length },
    },
    async () => {
      const now = Date.now()
      await withTx(db, async (q) => {
        await q(`DELETE FROM chapters WHERE novel_id = $1 AND id IN (${ids.map((_, i) => `$${i + 2}`).join(',')})`, [novelId, ...ids])
        await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
      })
      return c.json({ success: true, novelId, chapterIds: ids })
    },
  )
}
