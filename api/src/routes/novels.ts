/**
 * /api/novels —— 小说列表/创建/详情/更新/删除 + 管理维护动作（由 Novel-KV 平移）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { novelToRow, rowToNovel, safeJsonParse, type NovelRow } from '../db/mappers'
import { normalizeCategories } from '../services/categories'
import { cacheCoverForNovel } from '../services/covers'
import { newId } from '../services/auth'
import { simplifyNovelForSource } from '../services/zh-convert'
import { escapeLike } from '../services/text'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const novelsRoutes = new Hono<AuthEnv>()

const SORT_FIELDS: Record<string, boolean> = { updated_at: true, created_at: true, title: true, author: true, chapter_count: true }
const SORT_ORDERS: Record<string, 'ASC' | 'DESC'> = { asc: 'ASC', desc: 'DESC' }

// ---------- 列表（公开） ----------

novelsRoutes.get('/', async (c) => {
  const db = getDb()
  const search = (c.req.query('search') || '').trim()
  const category = c.req.query('category') || ''
  const status = c.req.query('status') || ''
  const quality = c.req.query('quality') || ''
  const page = Number.parseInt(c.req.query('page') || '1', 10) || 1
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10) || 50, 100)

  const sort = SORT_FIELDS[c.req.query('sort') || ''] ? c.req.query('sort')! : 'updated_at'
  const order = SORT_ORDERS[c.req.query('order') || ''] || 'DESC'

  const conditions: string[] = []
  const params: unknown[] = []
  if (search) {
    // 用户输入的 % / _ 按字面匹配；trigram 索引（011 迁移）加速三列 %LIKE%
    const like = `%${escapeLike(search)}%`
    conditions.push('(title LIKE $1 OR author LIKE $2 OR description LIKE $3)')
    params.push(like, like, like)
  }
  if (category) {
    params.push(`%"${escapeLike(category)}"%`)
    conditions.push(`categories LIKE $${params.length}`)
  }
  if (status) {
    params.push(status)
    conditions.push(`status = $${params.length}`)
  }
  if (quality === 'uncategorized') conditions.push("(categories = '[]' OR categories = '' OR categories IS NULL)")
  if (quality === 'missing_cover') {
    conditions.push("NULLIF(TRIM(cover_url), '') IS NULL AND NOT EXISTS (SELECT 1 FROM novel_covers WHERE novel_covers.novel_id = novels.id)")
  }
  if (quality === 'missing_description') conditions.push("NULLIF(TRIM(description), '') IS NULL")
  if (quality === 'stale_ongoing') {
    params.push(Date.now() - 30 * 86400000)
    conditions.push(`status = 'ongoing' AND updated_at < $${params.length}`)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (page - 1) * limit

  const count = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM novels ${where}`, params)
  const total = count?.total || 0

  const { rows } = await db.query<NovelRow>(
    `SELECT * FROM novels ${where} ORDER BY ${sort} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  const novels = rows.map(rowToNovel).filter((n) => n !== null)

  // 分类筛选 UI 用的全量分类集合（管理列表用 includeCategories=0 走 /api/categories）
  let availableCategories: string[] = []
  if (c.req.query('includeCategories') !== '0') {
    availableCategories = await loadAvailableCategories(db)
  }

  return c.json(
    {
      novels,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + limit < total,
      availableCategories,
    },
    200,
    { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' },
  )
})

// ---------- 创建 + 管理维护动作（管理员） ----------

novelsRoutes.post('/', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  if (body.action === 'normalize-categories') return normalizeAllCategories(c, db)
  if (body.action === 'normalize-categories-undo') return undoNormalizeCategories(c, db, body.changes)
  if (body.action === 'replace-category') return replaceCategory(c, db, body)
  if (body.action === 'batch-delete') return batchDeleteNovels(c, db, body)
  return createNovel(c, db, body)
})

// ---------- 详情 / 更新 / 删除 ----------

novelsRoutes.get('/:id', async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  if (!id || id.includes('/')) return c.json({ error: 'Invalid novel ID' }, 400)
  const row = await first<NovelRow>(db, 'SELECT * FROM novels WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Novel not found' }, 404)
  return c.json({ novel: rowToNovel(row) })
})

novelsRoutes.put('/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const row = await first<NovelRow>(db, 'SELECT * FROM novels WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Novel not found' }, 404)

  const existing = rowToNovel(row)!
  const body = await c.req.json().catch(() => ({}))
  const now = Date.now()

  const title = body.title ?? existing.title
  const author = body.author ?? existing.author
  if (!title || !author) return c.json({ error: 'Title and author are required' }, 400)

  const description = body.description ?? existing.description
  const coverUrl = body.coverUrl ?? existing.coverUrl
  const rawCategories = body.categories ?? existing.categories
  const categories = JSON.stringify(normalizeCategories(rawCategories))
  const status = body.status ?? existing.status
  const sourceUrl = body.sourceUrl ?? existing.sourceUrl

  await run(
    db,
    'UPDATE novels SET title=$1, author=$2, description=$3, cover_url=$4, categories=$5, status=$6, source_url=$7, updated_at=$8 WHERE id=$9',
    [title, author, description, coverUrl, categories, status, sourceUrl, now, id],
  )

  // 封面源变更时后台刷新封面缓存（失败由 /api/cover/:id 自愈）
  if (coverUrl !== existing.coverUrl) {
    cacheCoverForNovel(db, id).catch((e) => console.warn('[cover] cache on update failed:', (e as Error).message))
  }

  const updated = {
    ...existing,
    title,
    author,
    description,
    coverUrl,
    categories: normalizeCategories(rawCategories),
    status,
    sourceUrl,
    updatedAt: now,
  }
  return c.json({ novel: updated })
})

novelsRoutes.delete('/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const deleted = await run(db, 'DELETE FROM novels WHERE id = $1', [id])
  if (deleted === 0) return c.json({ error: 'Novel not found' }, 404)
  return c.json({ success: true })
})

// ---------- 内部辅助 ----------

async function createNovel(c: Context, db: ReturnType<typeof getDb>, body: any) {
  if (!body.title || !body.author) return c.json({ error: 'Title and author are required' }, 400)

  const id = newId('novel')
  const now = Date.now()
  const sourceUrl = body.sourceUrl || ''

  const novel = simplifyNovelForSource(
    {
      id,
      title: body.title,
      author: body.author,
      description: body.description || '',
      coverUrl: body.coverUrl || '',
      categories: normalizeCategories(body.categories || []),
      status: body.status || 'ongoing',
      sourceUrl,
      chapterCount: 0,
      remoteChapterCount: 0,
      updateCheckedAt: 0,
      createdAt: now,
      updatedAt: now,
    },
    sourceUrl,
  )

  const row = novelToRow(novel)
  await db.query(
    `INSERT INTO novels (id, title, author, description, cover_url, categories, status, source_url, chapter_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [row.id, row.title, row.author, row.description, row.cover_url, row.categories, row.status, row.source_url, row.chapter_count, row.created_at, row.updated_at],
  )

  // 封面后台缓存；创建响应不等外部图片下载
  cacheCoverForNovel(db, id).catch((e) => console.warn('[cover] cache on create failed:', (e as Error).message))

  return c.json({ novel }, 201)
}

async function batchDeleteNovels(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const ids: string[] = Array.isArray(body.novelIds)
    ? Array.from(new Set(body.novelIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)))
    : []
  if (!ids.length) return c.json({ error: 'novelIds array is required' }, 400)
  const operationKey = idempotencyKeyFromRequest(c, body, ['operationId'])
  return withIdempotency(
    db,
    {
      scope: `novels.batch-delete.${c.get('user').id}`,
      operationKey,
      payload: { action: 'batch-delete', novelIds: ids },
      audit: { actorUserId: c.get('user').id, action: 'batch-delete-novels', targetCount: ids.length },
    },
    async () => {
      const deleted = await run(db, `DELETE FROM novels WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids)
      return c.json({ success: true, deleted, novelIds: ids })
    },
  )
}

async function normalizeAllCategories(c: Context, db: ReturnType<typeof getDb>) {
  const rows = await all<{ id: string; title: string; categories: string }>(db, 'SELECT id, title, categories FROM novels')
  if (!rows.length) return c.json({ ok: true, total: 0, changed: 0, message: 'No novels found.' })

  const now = Date.now()
  const changed: Array<{ id: string; title: string; before: string[]; after: string[] }> = []
  const updates: Array<[string, unknown[]]> = []

  for (const row of rows) {
    const oldCategories = safeJsonParse<string[]>(row.categories, [])
    const newCategories = normalizeCategories(oldCategories)
    if (JSON.stringify([...oldCategories].sort()) === JSON.stringify([...newCategories].sort())) continue
    updates.push(['UPDATE novels SET categories = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(newCategories), now, row.id]])
    changed.push({ id: row.id, title: row.title, before: oldCategories, after: newCategories })
  }

  if (updates.length) {
    await withTx(db, async (q) => {
      for (const [sql, p] of updates) await q(sql, p)
    })
  }

  return c.json({ ok: true, total: rows.length, changed: changed.length, details: changed.slice(0, 50) })
}

async function undoNormalizeCategories(c: Context, db: ReturnType<typeof getDb>, changes: unknown) {
  if (!Array.isArray(changes) || !changes.length) return c.json({ error: 'changes array is required' }, 400)
  const now = Date.now()
  const updates: Array<[string, unknown[]]> = []
  let restored = 0
  for (const ch of changes) {
    if (!ch.id || !Array.isArray(ch.categories)) continue
    updates.push(['UPDATE novels SET categories = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(ch.categories), now, ch.id]])
    restored++
  }
  if (updates.length) {
    await withTx(db, async (q) => {
      for (const [sql, p] of updates) await q(sql, p)
    })
  }
  return c.json({ ok: true, restored })
}

async function replaceCategory(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const from = String(body.from || '').trim()
  const to = String(body.to || '').trim()
  if (!from || !to) return c.json({ error: 'from and to are required' }, 400)
  if (from === to) return c.json({ error: 'from and to must be different' }, 400)

  const rows = await all<{ id: string; title: string; categories: string }>(db, 'SELECT id, title, categories FROM novels')
  const now = Date.now()
  const updates: Array<[string, unknown[]]> = []
  const changed: Array<{ id: string; title: string; before: string[]; after: string[] }> = []

  for (const row of rows) {
    const oldCategories = safeJsonParse<string[]>(row.categories, [])
    if (!oldCategories.includes(from)) continue
    const newCategories = normalizeCategories(oldCategories.map((c) => (c === from ? to : c)))
    if (JSON.stringify(oldCategories) === JSON.stringify(newCategories)) continue
    updates.push(['UPDATE novels SET categories = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(newCategories), now, row.id]])
    changed.push({ id: row.id, title: row.title, before: oldCategories, after: newCategories })
  }

  if (updates.length) {
    await withTx(db, async (q) => {
      for (const [sql, p] of updates) await q(sql, p)
    })
  }
  return c.json({ ok: true, total: rows.length, changed: changed.length, details: changed })
}

async function loadAvailableCategories(db: ReturnType<typeof getDb>): Promise<string[]> {
  try {
    const rows = await all<{ categories: string }>(db, `SELECT DISTINCT categories FROM novels WHERE categories IS NOT NULL AND categories != '[]'`)
    const set = new Set<string>()
    for (const row of rows) {
      try {
        const arr = safeJsonParse<string[]>(row.categories, [])
        arr.forEach((c) => {
          if (c) set.add(c)
        })
      } catch {
        /* skip */
      }
    }
    return [...set].sort((a, b) => a.length - b.length || a.localeCompare(b))
  } catch {
    return []
  }
}
