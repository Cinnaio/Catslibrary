/**
 * /api/chapters —— 章节列表/内容/创建/更新/删除（由 Novel-KV 平移）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { rowToChapterFull, rowToChapterMeta } from '../db/mappers'
import { newId } from '../services/auth'
import { simplifyChapterForSource } from '../services/zh-convert'
import { invalidateChapter } from '../services/ai/generations'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const chaptersRoutes = new Hono<AuthEnv>()

// ---------- 列表 ----------

chaptersRoutes.get('/', async (c) => {
  const db = getDb()
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId query parameter is required' }, 400)
  // 显式列，绝不 SELECT *：content 是整章正文，避免整本小说被拉走
  const rows = await all<Record<string, unknown>>(
    db,
    'SELECT id, novel_id, title, sort_order, word_count, source_url, created_at FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC',
    [novelId],
  )
  const chapters = rows.map(rowToChapterMeta).filter((ch) => ch !== null)
  return c.json({ chapters, novelId, total: chapters.length }, 200, { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' })
})

// ---------- 创建 / 批量 / 维护（管理员） ----------

chaptersRoutes.post('/', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  if (body.action === 'rename-by-order') return renameChaptersByOrder(c, db, body)
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

chaptersRoutes.get('/:id', async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  if (!id || id.includes('/')) return c.json({ error: 'Invalid chapter ID' }, 400)
  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM chapters WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Chapter not found' }, 404)
  return c.json({ chapter: rowToChapterFull(row) })
})

chaptersRoutes.put('/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM chapters WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Chapter not found' }, 404)

  const existing = rowToChapterFull(row)!
  const body = await c.req.json().catch(() => ({}))
  const now = Date.now()

  const title = body.title ?? existing.title
  const content = body.content ?? existing.content
  const order = body.order ?? existing.order
  const sourceUrl = body.sourceUrl ?? existing.sourceUrl
  const wordCount = content.replace(/<[^>]*>/g, '').length
  const novelId = body.novelId || existing.novelId

  await withTx(db, async (q) => {
    await q('UPDATE chapters SET title=$1, content=$2, sort_order=$3, word_count=$4, source_url=$5 WHERE id=$6', [title, content, order, wordCount, sourceUrl, id])
    await q('UPDATE novels SET updated_at = $1 WHERE id = $2', [now, novelId])
  })

  // 正文真的变了才作废提要缓存：只改标题时读者拿到的回顾依然有效
  if (body.content !== undefined && content !== existing.content) {
    await invalidateChapter(db, 'summary', id)
  }

  return c.json({ chapter: { id, novelId, title, content, order, wordCount, sourceUrl, createdAt: existing.createdAt } })
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
  const ids: string[] = Array.isArray(body.chapterIds)
    ? Array.from(new Set(body.chapterIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)))
    : []
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

// ---------- rename-by-order（管理员：按顺序标题批量重命名） ----------

async function renameChaptersByOrder(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const novelId = body.novelId
  const titles: string[] = Array.isArray(body.titles)
    ? body.titles.map((t: unknown) => String((t as { title?: unknown })?.title ?? t ?? '').trim()).filter(Boolean)
    : []
  const onlyWeakTitles = body.onlyWeakTitles !== false
  const dryRun = body.dryRun !== false
  if (!novelId || titles.length === 0) return c.json({ error: 'novelId and titles are required' }, 400)

  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: 'Novel not found' }, 404)

  const rows = await all<{ id: string; title: string; sort_order: number }>(
    db,
    'SELECT id, title, sort_order FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC',
    [novelId],
  )
  const changes: Array<{ id: string; order: number; oldTitle: string; newTitle: string }> = []
  const contentRows = rows.filter((r) => !isIntroChapterTitle(r.title))
  const collapseSplitContinuations = contentRows.some((r) => getSplitPartMarker(r.title))
  const usedSourceIndexes = new Set<number>()
  let titleIndex = 0
  let skippedIntro = 0
  let splitContinuations = 0
  let lastSourceTitle = ''

  const nextSourceTitle = (): string | undefined => {
    const title = titles[titleIndex]
    if (title) usedSourceIndexes.add(titleIndex++)
    return title
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const oldTitle = row.title || ''
    if (isIntroChapterTitle(oldTitle)) {
      skippedIntro++
      continue
    }
    const splitMarker = getSplitPartMarker(oldTitle)
    const isSplitContinuation = !!(collapseSplitContinuations && splitMarker && lastSourceTitle)
    const newTitle = isSplitContinuation ? appendSplitPart(lastSourceTitle, splitMarker) : nextSourceTitle()
    if (splitMarker) splitContinuations++
    if (!newTitle) continue
    if (!isSplitContinuation) lastSourceTitle = newTitle
    if (oldTitle === newTitle) continue
    if (onlyWeakTitles && !isWeakChapterTitle(oldTitle, row.sort_order || i + 1)) continue
    changes.push({ id: row.id, order: row.sort_order || i + 1, oldTitle, newTitle })
  }

  if (dryRun) {
    return c.json({
      totalChapters: rows.length,
      totalTitles: titles.length,
      skippedIntro,
      splitContinuations,
      matchedTitles: usedSourceIndexes.size,
      changes,
      changed: changes.length,
    })
  }

  const operationKey = idempotencyKeyFromRequest(c, body, ['operationId'])
  const hasSnapshot = Array.isArray(body.confirmedChapterIds)
  const confirmedChapterIds: string[] = hasSnapshot
    ? Array.from(new Set(body.confirmedChapterIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)))
    : []
  if (operationKey && !hasSnapshot) {
    return c.json({ error: '批量改名必须携带确认时的 confirmedChapterIds 快照', code: 'confirmation_snapshot_required' }, 409)
  }
  const targetChanges = hasSnapshot ? changes.filter((change) => confirmedChapterIds.includes(change.id)) : changes
  return withIdempotency(
    db,
    {
      scope: `chapters.rename-by-order.${c.get('user').id}.${novelId}`,
      operationKey,
      payload: { action: 'rename-by-order', novelId, titles, onlyWeakTitles, confirmedChapterIds },
      audit: { actorUserId: c.get('user').id, action: 'rename-chapters-by-order', targetCount: targetChanges.length },
    },
    async () => {
      const now = Date.now()
      await withTx(db, async (q) => {
        for (const ch of targetChanges) await q('UPDATE chapters SET title = $1 WHERE id = $2', [ch.newTitle, ch.id])
        if (targetChanges.length) await q('UPDATE novels SET updated_at = $1 WHERE id = $2', [now, novelId])
      })
      return c.json({ updated: targetChanges.length, changes: targetChanges })
    },
  )
}

function isIntroChapterTitle(title: string): boolean {
  return /^(?:内容简介|作品简介|小说简介|文案|简介|楔子|序章|序言)$/i.test(String(title || '').trim())
}

function getSplitPartMarker(title: string): string {
  const m = String(title || '').trim().match(/[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]\s*$/)
  if (!m || Number.parseInt(m[1]!, 10) <= 1) return ''
  return `${Number.parseInt(m[1]!, 10)}/${Number.parseInt(m[2]!, 10)}`
}

function appendSplitPart(title: string, marker: string): string {
  return String(title || '').trim() + ` (${marker})`
}

function isWeakChapterTitle(title: string, order: number): boolean {
  const t = String(title || '').trim()
  if (!t || /^(正文|无标题|未命名|空标题)$/i.test(t)) return true
  const n = String(order || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    new RegExp('^(?:第\\s*)?' + n + '(?:\\s*[章节回卷集部篇])?(?:\\s*[（(]\\s*\\d+\\s*\\/\\s*\\d+\\s*[)）])?$', 'i').test(t) ||
    /^chapter\s*\d+(?:\s*[（(]\s*\d+\s*\/\s*\d+\s*[)）])?$/i.test(t) ||
    /^第\s*[0-9０-９零一二三四五六七八九十百千万两〇壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?(?:\s*[（(]\s*\d+\s*\/\s*\d+\s*[)）])?$/i.test(t)
  )
}
