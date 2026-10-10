import { createHash, randomUUID } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import type { Db, DbClient } from '../db/pool'
import { withTx } from '../db/query'
import type { LegacyReadingData, LegacyReadingEntry, ReadingDataItem, ReadingDataPreview, ReadingDataResult } from '@shared/reading-data'

type Query = DbClient['query']
interface PlanEntry {
  item: ReadingDataItem
  previous?: Record<string, unknown>
  incoming?: LegacyReadingEntry
}
interface Plan {
  entries: PlanEntry[]
  hasMore: boolean
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stale = () => new HTTPException(409, { message: '数据已变化或预览已过期，请重新检查后确认' })

async function repairPlan(query: Query, userId: string, allowed: boolean): Promise<Plan> {
  const entries: PlanEntry[] = []
  const bookmarks = await query<Record<string, unknown>>(
    `SELECT to_jsonb(b) AS previous, n.title, ch.title AS chapter_title, ch.sort_order,
      CASE WHEN n.id IS NULL OR ch.id IS NULL THEN 'remove' ELSE 'refresh' END AS action
     FROM user_bookmarks b LEFT JOIN novels n ON n.id=b.novel_id
     LEFT JOIN chapters ch ON ch.id=b.chapter_id AND ch.novel_id=b.novel_id
     WHERE b.user_id=$1 AND ($2 OR COALESCE(n.content_rating,'unknown')<>'restricted')
       AND (n.id IS NULL OR ch.id IS NULL OR b.novel_title<>n.title OR b.chapter_title<>ch.title OR b.chapter_order<>ch.sort_order)
     ORDER BY b.id LIMIT 101`,
    [userId, allowed],
  )
  for (const row of bookmarks.rows) {
    const previous = row.previous as Record<string, unknown>
    entries.push({
      previous,
      item: {
        kind: 'bookmark',
        novelId: String(previous.novel_id),
        chapterId: String(previous.chapter_id),
        novelTitle: String(row.title || '已删除作品'),
        chapterTitle: String(row.chapter_title || ''),
        action: row.action as 'remove' | 'refresh',
        detail: row.action === 'remove' ? '删除失效或章节错配的书签' : '更新作品名、章节名和章节顺序，保留备注',
      },
    })
  }
  const progress = await query<Record<string, unknown>>(
    `SELECT to_jsonb(p) AS previous, n.title, ch.title AS chapter_title,
      CASE WHEN ch.id IS NULL THEN 'clear' ELSE 'normalize' END AS action
     FROM reading_progress p JOIN novels n ON n.id=p.novel_id
     LEFT JOIN chapters ch ON ch.id=p.chapter_id AND ch.novel_id=p.novel_id
     WHERE p.user_id=$1 AND p.deleted_at=0 AND ($2 OR n.content_rating<>'restricted')
       AND (ch.id IS NULL OR p.scroll_percent<0 OR p.scroll_percent>1 OR p.scroll_percent='NaN'::real)
     ORDER BY p.id LIMIT 101`,
    [userId, allowed],
  )
  for (const row of progress.rows) {
    const previous = row.previous as Record<string, unknown>
    entries.push({
      previous,
      item: {
        kind: 'progress',
        novelId: String(previous.novel_id),
        chapterId: String(previous.chapter_id),
        novelTitle: String(row.title),
        chapterTitle: String(row.chapter_title || ''),
        action: row.action as 'clear' | 'normalize',
        detail: row.action === 'clear' ? '清除失效或章节错配的进度，并同步清除标记' : '将阅读百分比修正到有效范围',
      },
    })
  }
  return { entries: entries.slice(0, 100), hasMore: entries.length > 100 }
}

async function restorePlan(query: Query, userId: string, allowed: boolean, data: LegacyReadingData): Promise<Plan> {
  const entries: PlanEntry[] = []
  const all = [...data.bookmarks, ...data.progress, ...data.bookshelf]
  const novelIds = [...new Set(all.map((entry) => entry.novelId))]
  const chapterIds = [...new Set(all.flatMap((entry) => (entry.chapterId ? [entry.chapterId] : [])))]
  const novels = new Map(
    (
      await query<{ id: string; title: string; content_rating: string }>('SELECT id,title,content_rating FROM novels WHERE id=ANY($1::text[])', [novelIds])
    ).rows.map((row) => [row.id, row]),
  )
  const chapters = new Map(
    (await query<{ id: string; novel_id: string; title: string }>('SELECT id,novel_id,title FROM chapters WHERE id=ANY($1::text[])', [chapterIds])).rows.map(
      (row) => [row.id, row],
    ),
  )
  for (const [key, kind] of [
    ['bookmarks', 'bookmark'],
    ['progress', 'progress'],
    ['bookshelf', 'bookshelf'],
  ] as const) {
    if (!data[key].length) continue
    const table = kind === 'bookmark' ? 'user_bookmarks' : kind === 'progress' ? 'reading_progress' : 'user_bookshelf'
    const existing = new Set(
      (
        await query<{ novel_id: string; chapter_id?: string }>(
          `SELECT novel_id${kind === 'bookmark' ? ',chapter_id' : ''} FROM ${table} WHERE user_id=$1 AND novel_id=ANY($2::text[])`,
          [userId, data[key].map((entry) => entry.novelId)],
        )
      ).rows.map((row) => JSON.stringify([row.novel_id, kind === 'bookmark' ? row.chapter_id : ''])),
    )
    for (const incoming of data[key]) {
      const novel = novels.get(incoming.novelId)
      const readable = !!novel && (allowed || novel.content_rating !== 'restricted')
      const candidate = incoming.chapterId ? chapters.get(incoming.chapterId) : undefined
      const chapter = readable && kind !== 'bookshelf' && candidate?.novel_id === incoming.novelId ? candidate : undefined
      const available = readable && (kind === 'bookshelf' || !!chapter)
      const exists = existing.has(JSON.stringify([incoming.novelId, kind === 'bookmark' ? incoming.chapterId : '']))
      const restore = available && !exists
      entries.push({
        incoming,
        item: {
          kind,
          novelId: incoming.novelId,
          chapterId: incoming.chapterId || '',
          novelTitle: readable ? novel!.title : '不可恢复的记录',
          chapterTitle: chapter?.title || '',
          action: restore ? 'restore' : 'skip',
          detail: !available
            ? '作品或章节不存在、关联不匹配，或当前阅读模式无权访问'
            : exists
              ? '账号已有记录，保留当前数据（包括已清除的进度）'
              : '添加到当前账号',
        },
      })
    }
  }
  return { entries, hasMore: false }
}

function token(userId: string, allowed: boolean, expiresAt: number, plan: Plan) {
  return digest({ userId, allowed, expiresAt, plan })
}
export async function previewReadingData(db: Db, userId: string, allowed: boolean, data?: LegacyReadingData): Promise<ReadingDataPreview> {
  return withTx(db, async (query) => {
    await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    const plan = data ? await restorePlan(query, userId, allowed, data) : await repairPlan(query, userId, allowed)
    const expiresAt = Date.now() + 10 * 60000
    return { userId, expiresAt, previewToken: token(userId, allowed, expiresAt, plan), items: plan.entries.map((e) => e.item), hasMore: plan.hasMore }
  })
}

export async function applyReadingData(
  db: Db,
  userId: string,
  allowed: boolean,
  request: {
    operationId: string
    previewToken: string
    expiresAt: number
    data?: LegacyReadingData
  },
): Promise<ReadingDataResult> {
  const kind = request.data ? 'restore' : 'repair'
  const requestHash = digest({ userId, allowed, kind, request })
  try {
    return await withTx(db, async (query) => {
      await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      const previous = (
        await query<{ request_hash: string; result: string }>('SELECT request_hash,result FROM reading_data_operations WHERE user_id=$1 AND operation_id=$2', [
          userId,
          request.operationId,
        ])
      ).rows[0]
      if (previous) {
        if (previous.request_hash !== requestHash) throw new HTTPException(409, { message: '操作标识已用于其他请求，请重新预览' })
        return JSON.parse(previous.result) as ReadingDataResult
      }
      if (request.expiresAt < Date.now() || request.expiresAt > Date.now() + 10 * 60000) throw stale()
      const plan = request.data ? await restorePlan(query, userId, allowed, request.data) : await repairPlan(query, userId, allowed)
      if (request.previewToken !== token(userId, allowed, request.expiresAt, plan)) throw stale()
      const result: ReadingDataResult = { operationId: request.operationId, kind, changed: 0, skipped: 0, clearedNovelIds: [], createdAt: Date.now() }
      for (const entry of plan.entries) {
        const { item, incoming, previous } = entry
        if (item.action === 'skip') {
          result.skipped++
          continue
        }
        let count = 0
        const now = Date.now()
        if (incoming) {
          const time = Math.max(1, Math.min(now, incoming.timestamp || now))
          if (item.kind === 'bookmark')
            count =
              (
                await query(
                  `INSERT INTO user_bookmarks(id,user_id,novel_id,novel_title,chapter_id,chapter_title,chapter_order,note,created_at,updated_at)
             SELECT $1,$2,n.id,n.title,ch.id,ch.title,ch.sort_order,$5,$6,$6 FROM novels n JOIN chapters ch ON ch.novel_id=n.id
             WHERE n.id=$3 AND ch.id=$4 ON CONFLICT DO NOTHING RETURNING id`,
                  [`bm_${randomUUID()}`, userId, item.novelId, item.chapterId, incoming.note || '', time],
                )
              ).rowCount || 0
          else if (item.kind === 'progress')
            count =
              (
                await query(
                  `INSERT INTO reading_progress(id,user_id,novel_id,chapter_id,scroll_percent,updated_at,deleted_at)
             VALUES($1,$2,$3,$4,$5,$6,0) ON CONFLICT DO NOTHING RETURNING id`,
                  [`prog_${randomUUID()}`, userId, item.novelId, item.chapterId, incoming.scrollPercent || 0, time],
                )
              ).rowCount || 0
          else
            count =
              (
                await query(
                  'INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING RETURNING novel_id',
                  [userId, item.novelId, time],
                )
              ).rowCount || 0
        } else if (item.action === 'remove') {
          count =
            (
              await query('DELETE FROM user_bookmarks b WHERE b.user_id=$1 AND b.id=$2 AND to_jsonb(b)=$3::jsonb RETURNING id', [
                userId,
                previous!.id,
                JSON.stringify(previous),
              ])
            ).rowCount || 0
        } else if (item.action === 'refresh') {
          count =
            (
              await query(
                `UPDATE user_bookmarks b SET novel_title=n.title,chapter_title=ch.title,chapter_order=ch.sort_order
             FROM novels n,chapters ch WHERE b.user_id=$1 AND b.id=$2 AND to_jsonb(b)=$3::jsonb
               AND n.id=b.novel_id AND ch.id=b.chapter_id AND ch.novel_id=n.id RETURNING b.id`,
                [userId, previous!.id, JSON.stringify(previous)],
              )
            ).rowCount || 0
        } else {
          const time = Math.max(now, Number(previous!.updated_at) + 1)
          count =
            (
              await query(
                item.action === 'clear'
                  ? "UPDATE reading_progress p SET chapter_id='',scroll_percent=0,updated_at=$4,deleted_at=$4 WHERE p.user_id=$1 AND p.id=$2 AND to_jsonb(p)=$3::jsonb RETURNING id"
                  : 'UPDATE reading_progress p SET scroll_percent=$5,updated_at=$4 WHERE p.user_id=$1 AND p.id=$2 AND to_jsonb(p)=$3::jsonb RETURNING id',
                [
                  userId,
                  previous!.id,
                  JSON.stringify(previous),
                  time,
                  ...(item.action === 'normalize'
                    ? [Number.isFinite(Number(previous!.scroll_percent)) ? Math.min(1, Math.max(0, Number(previous!.scroll_percent))) : 0]
                    : []),
                ],
              )
            ).rowCount || 0
          result.clearedNovelIds.push(item.novelId)
        }
        if (!count && !incoming) throw stale()
        result.changed += count
        if (!count) result.skipped++
      }
      await query('INSERT INTO reading_data_operations(id,user_id,operation_id,kind,request_hash,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        randomUUID(),
        userId,
        request.operationId,
        kind,
        requestHash,
        JSON.stringify(result),
        result.createdAt,
      ])
      return result
    })
  } catch (error) {
    if (['40001', '23503', '23505'].includes(String((error as { code?: string }).code))) throw stale()
    throw error
  }
}
