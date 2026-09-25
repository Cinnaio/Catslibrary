/**
 * /api/novels —— 小说列表/创建/详情/更新/删除 + 管理维护动作（由 Novel-KV 平移）。
 */
import { Hono, type Context } from 'hono'
import { ratingFromRules } from '@shared/restricted-rules'
import { getDb, type DbClient } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { novelToRow, rowToNovel, safeJsonParse, toContentRating, type NovelRow } from '../db/mappers'
import { prefillUnknownContentRatings, undoPrefilledContentRatings } from '../services/content-rating'
import {
  applyContentRatingChange,
  CONTENT_RATING_RULE_VERSION,
  ContentRatingConflictError,
  evidenceForRatingRules,
} from '../services/content-rating-governance'
import { normalizeCategories } from '../services/categories'
import { cacheCoverForNovel } from '../services/covers'
import { newId } from '../services/auth'
import { simplifyNovelForSource } from '../services/zh-convert'
import { escapeLike } from '../services/text'
import { optionalUser, requireAdmin, type AuthEnv } from '../middlewares/auth'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const novelsRoutes = new Hono<AuthEnv>()

const SORT_FIELDS: Record<string, boolean> = { updated_at: true, created_at: true, title: true, author: true, chapter_count: true }
const SORT_ORDERS: Record<string, 'ASC' | 'DESC'> = { asc: 'ASC', desc: 'DESC' }

// ---------- 列表（公开） ----------

novelsRoutes.get('/', optionalUser(), async (c) => {
  const db = getDb()
  const access = await resolveContentAccess(c)
  const canViewRestricted = access.canViewRestricted
  const search = (c.req.query('search') || '').trim()
  const category = c.req.query('category') || ''
  const status = c.req.query('status') || ''
  // 必须区分「未传参」与「显式传 unknown」：前者不筛选，后者是「仅看未标注」。
  // 若这里直接用 toContentRating()，缺省会被归一成 'unknown' 从而变成强制筛选。
  const rawContentRating = (c.req.query('contentRating') || '').trim()
  const contentRating = rawContentRating === 'general' || rawContentRating === 'restricted' || rawContentRating === 'unknown'
    ? rawContentRating
    : ''
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
  if (!canViewRestricted) conditions.push("COALESCE(content_rating, 'unknown') <> 'restricted'")
  // contentRating=unknown 是「仅看未标注」筛选；支撑人工标注作业台。
  if (contentRating) {
    params.push(contentRating)
    conditions.push(`content_rating = $${params.length}`)
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
    availableCategories = await loadAvailableCategories(db, canViewRestricted)
  }

  // 标注进度：让「还剩多少没判」成为可见数字，否则几百本书里挑未标注的无法作业。
  const progressRows = await all<{ content_rating: string; count: number }>(
    db,
    canViewRestricted
      ? 'SELECT content_rating, COUNT(*)::int AS count FROM novels GROUP BY content_rating'
      : "SELECT content_rating, COUNT(*)::int AS count FROM novels WHERE COALESCE(content_rating, 'unknown') <> 'restricted' GROUP BY content_rating",
  )
  const hiddenRestricted = !canViewRestricted && !!(await first<{ exists: boolean }>(db, "SELECT EXISTS (SELECT 1 FROM novels WHERE content_rating = 'restricted') AS exists"))?.exists
  const ratingCounts = { general: 0, restricted: 0, unknown: 0 }
  for (const r of progressRows) {
    ratingCounts[toContentRating(r.content_rating)] += Number(r.count) || 0
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
      ratingCounts,
      hiddenRestricted,
    },
    200,
    contentPolicyHeaders(),
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
  if (body.action === 'prefill-content-rating') return prefillContentRating(c, db, body)
  if (body.action === 'undo-prefill-content-rating') return undoPrefillContentRating(c, db, body)
  return createNovel(c, db, body)
})

// ---------- 详情 / 更新 / 删除 ----------

novelsRoutes.get('/:id', optionalUser(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  if (!id || id.includes('/')) return c.json({ error: 'Invalid novel ID' }, 400)
  const row = await first<NovelRow>(db, 'SELECT * FROM novels WHERE id = $1', [id])
  if (!row) return c.json({ error: 'Novel not found' }, 404)
  if (row.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  }
  return c.json({ novel: rowToNovel(row) }, 200, contentPolicyHeaders())
})

novelsRoutes.put('/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  let result: { novel: NonNullable<ReturnType<typeof rowToNovel>>; coverChanged: boolean } | null
  try {
    result = await withTx(db, async (q) => {
      const currentResult = await q<NovelRow>('SELECT * FROM novels WHERE id = $1 FOR UPDATE', [id])
      const row = currentResult.rows[0]
      if (!row) return null

      const existing = rowToNovel(row)!
      const now = Date.now()
      const title = body.title ?? existing.title
      const author = body.author ?? existing.author
      if (!title || !author) throw new Error('Title and author are required')

      const description = body.description ?? existing.description
      const coverUrl = body.coverUrl ?? existing.coverUrl
      const rawCategories = body.categories ?? existing.categories
      const normalizedCategories = normalizeCategories(rawCategories)
      const categories = JSON.stringify(normalizedCategories)
      const status = body.status ?? existing.status
      const ruleRating = ratingFromRules({ title, description, categories: normalizedCategories })
      const explicitManualRating = body.contentRating === 'general' || body.contentRating === 'restricted'
      const requestedUnknown = body.contentRating === 'unknown'
      const nextRating = explicitManualRating
        ? body.contentRating
        : existing.contentRating === 'unknown'
          ? ruleRating
          : existing.contentRating
      const ratingSource = explicitManualRating || (requestedUnknown && nextRating === 'unknown') ? 'manual' : 'system'
      const ratingReason = explicitManualRating
        ? String(body.contentRatingReason || '管理员通过小说编辑手动修改内容分级')
        : requestedUnknown && nextRating === 'unknown'
          ? '管理员重置为未标注'
          : '元数据变更后重新执行分级规则'
      const ratingChanged = nextRating !== existing.contentRating
      const hasRatingInput = explicitManualRating || requestedUnknown
      const sourceUrl = body.sourceUrl ?? existing.sourceUrl

      await q(
        `UPDATE novels SET title=$1, author=$2, description=$3, cover_url=$4, categories=$5, status=$6,
           source_url=$7, updated_at=$8 WHERE id=$9`,
        [title, author, description, coverUrl, categories, status, sourceUrl, now, id],
      )

      if (hasRatingInput || ratingChanged) {
        await applyContentRatingChange(q, {
          novelId: id,
          rating: nextRating,
          source: ratingSource,
          actorUserId: c.get('user').id,
          reason: ratingReason,
          evidence: body.contentRatingEvidence ?? evidenceForRatingRules({ title, description, categories: normalizedCategories }),
          ruleVersion: ratingSource === 'system' ? CONTENT_RATING_RULE_VERSION : '',
          operationId: String(body.contentRatingOperationId || (ratingChanged ? newId('rating-manual') : row.content_rating_operation_id || '')).trim(),
          expectedRevision: body.contentRatingRevision,
          now,
        })
      }

      const finalResult = await q<NovelRow>('SELECT * FROM novels WHERE id = $1', [id])
      const finalNovel = rowToNovel(finalResult.rows[0])
      if (!finalNovel) return null
      return { novel: finalNovel, coverChanged: coverUrl !== existing.coverUrl }
    })
  } catch (err) {
    if (err instanceof ContentRatingConflictError) {
      return c.json({ error: err.message, code: 'content_rating_conflict', currentRevision: err.currentRevision, currentRating: err.currentRating }, 409)
    }
    if ((err as Error).message === 'Title and author are required') return c.json({ error: (err as Error).message }, 400)
    throw err
  }
  if (!result) return c.json({ error: 'Novel not found' }, 404)

  // 封面源变更时后台刷新封面缓存（失败由 /api/cover/:id 自愈）
  if (result.coverChanged) {
    cacheCoverForNovel(db, id).catch((e) => console.warn('[cover] cache on update failed:', (e as Error).message))
  }
  return c.json({ novel: result.novel })
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
      // Admin forms send unknown by default. It means "not manually reviewed",
      // so the write rules still run. Only explicit general/restricted overrides them.
      contentRating: body.contentRating === 'general' || body.contentRating === 'restricted'
        ? body.contentRating
        : ratingFromRules({
            title: body.title,
            description: body.description || '',
            categories: normalizeCategories(body.categories || []),
          }),
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
  const explicitManualRating = body.contentRating === 'general' || body.contentRating === 'restricted'
  await withTx(db, async (q) => {
    await q(
      `INSERT INTO novels (id, title, author, description, cover_url, categories, status, content_rating, source_url, chapter_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [row.id, row.title, row.author, row.description, row.cover_url, row.categories, row.status, row.content_rating, row.source_url, row.chapter_count, row.created_at, row.updated_at],
    )
    await applyContentRatingChange(q, {
      novelId: id,
      rating: novel.contentRating,
      source: explicitManualRating ? 'manual' : 'system',
      actorUserId: c.get('user').id,
      reason: explicitManualRating ? String(body.contentRatingReason || '管理员创建作品时明确指定内容分级') : '创建作品时执行分级规则',
      evidence: evidenceForRatingRules({ title: novel.title, description: novel.description, categories: novel.categories }),
      ruleVersion: explicitManualRating ? '' : CONTENT_RATING_RULE_VERSION,
      operationId: newId('rating-create'),
    })
  })

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

async function applyRuleRatingAfterMetadata(
  query: DbClient['query'],
  row: { id: string; title: string; description: string; content_rating: string },
  categories: string[],
  actorUserId: string,
  reason: string,
  operationId: string,
): Promise<void> {
  if (row.content_rating !== 'unknown') return
  const nextRating = ratingFromRules({ title: row.title, description: row.description, categories })
  if (nextRating === 'unknown') return
  await applyContentRatingChange(query, {
    novelId: row.id,
    rating: nextRating,
    source: 'system',
    actorUserId,
    reason,
    evidence: evidenceForRatingRules({ title: row.title, description: row.description, categories }),
    ruleVersion: CONTENT_RATING_RULE_VERSION,
    operationId,
  })
}

async function normalizeAllCategories(c: Context, db: ReturnType<typeof getDb>) {
  const rows = await all<{ id: string; title: string; description: string; categories: string; content_rating: string }>(
    db, 'SELECT id, title, description, categories, content_rating FROM novels',
  )
  if (!rows.length) return c.json({ ok: true, total: 0, changed: 0, message: 'No novels found.' })

  const now = Date.now()
  const changed: Array<{ id: string; title: string; before: string[]; after: string[] }> = []
  const updates: Array<{ sql: string; params: unknown[]; row: typeof rows[number]; categories: string[] }> = []

  for (const row of rows) {
    const oldCategories = safeJsonParse<string[]>(row.categories, [])
    const newCategories = normalizeCategories(oldCategories)
    if (JSON.stringify([...oldCategories].sort()) === JSON.stringify([...newCategories].sort())) continue
    updates.push({
      sql: 'UPDATE novels SET categories = $1, updated_at = $2 WHERE id = $3',
      params: [JSON.stringify(newCategories), now, row.id],
      row,
      categories: newCategories,
    })
    changed.push({ id: row.id, title: row.title, before: oldCategories, after: newCategories })
  }

  if (updates.length) {
    await withTx(db, async (q) => {
      const operationId = newId('rating-normalize-categories')
      for (const update of updates) {
        await q(update.sql, update.params)
        await applyRuleRatingAfterMetadata(q, update.row, update.categories, c.get('user').id, '分类规范化后重新执行分级规则', operationId)
      }
    })
  }

  return c.json({ ok: true, total: rows.length, changed: changed.length, details: changed.slice(0, 50) })
}

async function undoNormalizeCategories(c: Context, db: ReturnType<typeof getDb>, changes: unknown) {
  if (!Array.isArray(changes) || !changes.length) return c.json({ error: 'changes array is required' }, 400)
  const rows = await all<{ id: string; title: string; description: string; content_rating: string }>(
    db, 'SELECT id, title, description, content_rating FROM novels',
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  const now = Date.now()
  const updates: Array<{ sql: string; params: unknown[]; row: typeof rows[number]; categories: string[] }> = []
  let restored = 0
  for (const ch of changes) {
    if (!ch.id || !Array.isArray(ch.categories)) continue
    const row = byId.get(ch.id)
    if (!row) continue
    updates.push({
      sql: 'UPDATE novels SET categories = $1, updated_at = $2 WHERE id = $3',
      params: [JSON.stringify(ch.categories), now, ch.id],
      row,
      categories: ch.categories,
    })
    restored++
  }
  if (updates.length) {
    await withTx(db, async (q) => {
      const operationId = newId('rating-undo-normalize')
      for (const update of updates) {
        await q(update.sql, update.params)
        await applyRuleRatingAfterMetadata(q, update.row, update.categories, c.get('user').id, '撤销分类规范化后重新执行分级规则', operationId)
      }
    })
  }
  return c.json({ ok: true, restored })
}

async function replaceCategory(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const from = String(body.from || '').trim()
  const to = String(body.to || '').trim()
  if (!from || !to) return c.json({ error: 'from and to are required' }, 400)
  if (from === to) return c.json({ error: 'from and to must be different' }, 400)

  const rows = await all<{ id: string; title: string; description: string; categories: string; content_rating: string }>(
    db, 'SELECT id, title, description, categories, content_rating FROM novels',
  )
  const now = Date.now()
  const updates: Array<{ sql: string; params: unknown[]; row: typeof rows[number]; categories: string[] }> = []
  const changed: Array<{ id: string; title: string; before: string[]; after: string[] }> = []

  for (const row of rows) {
    const oldCategories = safeJsonParse<string[]>(row.categories, [])
    if (!oldCategories.includes(from)) continue
    const newCategories = normalizeCategories(oldCategories.map((c) => (c === from ? to : c)))
    if (JSON.stringify(oldCategories) === JSON.stringify(newCategories)) continue
    updates.push({
      sql: 'UPDATE novels SET categories = $1, updated_at = $2 WHERE id = $3',
      params: [JSON.stringify(newCategories), now, row.id],
      row,
      categories: newCategories,
    })
    changed.push({ id: row.id, title: row.title, before: oldCategories, after: newCategories })
  }

  if (updates.length) {
    await withTx(db, async (q) => {
      const operationId = newId('rating-replace-category')
      for (const update of updates) {
        await q(update.sql, update.params)
        await applyRuleRatingAfterMetadata(q, update.row, update.categories, c.get('user').id, '替换分类后重新执行分级规则', operationId)
      }
    })
  }
  return c.json({ ok: true, total: rows.length, changed: changed.length, details: changed })
}

/**
 * 存量分级预填：用统一规则（成人标签 OR 限制级文本特征）给未判定的书填初值。
 *
 * 红线：只写 'restricted'，绝不写 'general'。
 * 标签与正则都是枚举法，认不出的一律保持 unknown——若把「未命中」当成「一般」，
 * 等于把漏网永久固化成「已认证安全」，此后不再被检视。general 只能由人工给出。
 *
 * 只改 unknown，已人工判定过的书（general/restricted）绝不覆盖。
 */
async function prefillContentRating(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const result = await prefillUnknownContentRatings(db, {
    dryRun: body?.dryRun === true,
    operationId: String(body?.operationId || '').trim() || undefined,
    actorUserId: c.get('user').id,
  })

  return c.json({
    ok: true,
    ...result,
    dryRun: body?.dryRun === true,
  })
}

/** 预填回滚：只处理仍保留 prefill 来源的记录，不触碰人工改动的值。 */
async function undoPrefillContentRating(c: Context, db: ReturnType<typeof getDb>, body: any) {
  const ids: string[] = Array.isArray(body?.ids)
    ? Array.from(new Set(body.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)))
    : []
  const operationId = String(body?.operationId || '').trim()
  if (!ids.length && !operationId) return c.json({ error: 'ids or operationId is required' }, 400)
  const result = await undoPrefilledContentRatings(db, { ids, operationId, actorUserId: c.get('user').id })
  return c.json({ ok: true, ...result })
}

async function loadAvailableCategories(db: ReturnType<typeof getDb>, includeRestricted = true): Promise<string[]> {
  try {
    const rows = await all<{ categories: string }>(
      db,
      `SELECT DISTINCT categories FROM novels WHERE categories IS NOT NULL AND categories != '[]'${includeRestricted ? '' : " AND COALESCE(content_rating, 'unknown') <> 'restricted'"}`,
    )
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
