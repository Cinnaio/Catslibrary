import { createHash, randomUUID } from 'node:crypto'
import type { Db, DbClient } from '../db/pool'
import { first, all, withTx } from '../db/query'
import type { SourceThought, SourceThoughtPage, SourceThoughtSync } from '@shared/source-thoughts'
import { hashParagraphText } from '@shared/thought-anchor'
import type { SourceParagraph } from './source-thoughts'
import { adapterForUrl } from './scraper/sources'

const REFRESH_MS = 5 * 60_000
const LEASE_MS = 120_000
const PAGE_SIZE = 20
export interface SourceChapter {
  id: string
  content: string
  chapter_url: string
  book_url: string
}
export interface StoredSourceChapter {
  chapter_id: string
  source_key: string
  source_id: string
  source_label: string
  chapter_url: string
  book_url: string
  paragraphs: SourceParagraph[] | null
  state: SourceThoughtSync['state']
  generation: string
  needs_counts: boolean
  checked_at: number
  updated_at: number
  retry_at: number
  attempts: number
  lease_token: string
  lease_until: number
}
export class SourceThoughtParentUnavailable extends Error {}

interface SourceList {
  chapter_id: string
  parent_id: string
  paragraph_index: number
  paragraph_hash: string
  cursor: string
  seen_cursors: string[]
  page_count: number
  total: number
  complete: boolean
}
export async function sourceChapter(db: DbClient, id: string): Promise<SourceChapter | undefined> {
  return first(
    db,
    `SELECT c.id,c.content,c.source_url AS chapter_url,
    COALESCE(NULLIF(sc.source_url,''),n.source_url,'') AS book_url
    FROM chapters c JOIN novels n ON n.id=c.novel_id LEFT JOIN scrape_configs sc ON sc.novel_id=n.id WHERE c.id=$1`,
    [id],
  )
}
const keyFor = (chapter: SourceChapter, source: string) =>
  createHash('sha256')
    .update(JSON.stringify([source, chapter.chapter_url, chapter.book_url]))
    .digest('hex')
export const storedSourceChapter = (db: DbClient, id: string) =>
  first<StoredSourceChapter>(db, 'SELECT * FROM source_thought_chapters WHERE chapter_id=$1', [id])

/** 调用者持有事务；只登记数据库任务，不在正文入库事务中访问来源。 */
export async function queueSourceThoughtChapter(db: DbClient, chapter: SourceChapter, refresh = false): Promise<StoredSourceChapter | undefined> {
  const adapter = adapterForUrl(chapter.chapter_url)
  const existing = await first<StoredSourceChapter>(db, 'SELECT * FROM source_thought_chapters WHERE chapter_id=$1 FOR UPDATE', [chapter.id])
  const supported = !!adapter?.paragraphComments?.enabled()
  if (!supported && !existing) return
  const sourceId = adapter?.id || existing!.source_id
  const sourceKey = keyFor(chapter, sourceId)
  if (!existing || existing.source_key !== sourceKey) {
    if (existing) await db.query('DELETE FROM source_thought_chapters WHERE chapter_id=$1', [chapter.id])
    if (!supported) return
    await db.query(
      `INSERT INTO source_thought_chapters
      (chapter_id,source_key,source_id,source_label,chapter_url,book_url,generation)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chapter_id) DO NOTHING`,
      [chapter.id, sourceKey, sourceId, adapter!.name, chapter.chapter_url, chapter.book_url, randomUUID()],
    )
  } else if (supported && existing.lease_until <= Date.now()) {
    if (
      (existing.state === 'completed' || (refresh && existing.state === 'partial' && existing.retry_at <= Date.now())) &&
      Date.now() - existing.checked_at >= (refresh ? 120_000 : REFRESH_MS)
    ) {
      await db.query(
        `UPDATE source_thought_chapters SET state='queued',needs_counts=TRUE,generation=$2,retry_at=0,attempts=0
        WHERE chapter_id=$1`,
        [chapter.id, randomUUID()],
      )
    } else if (existing.state !== 'completed' && (existing.state === 'unavailable' || refresh) && existing.retry_at <= Date.now()) {
      await db.query("UPDATE source_thought_chapters SET state='queued',retry_at=0 WHERE chapter_id=$1", [chapter.id])
    }
  }
  return storedSourceChapter(db, chapter.id)
}
export async function ensureSourceThoughtChapter(db: Db, id: string, refresh = false) {
  return withTx(db, async (query) => {
    const client = { query }
    // 与章节入库保持先锁作品、再锁评论任务的顺序；避免来源更换与重建交错。
    await query('SELECT n.id FROM novels n JOIN chapters c ON c.novel_id=n.id WHERE c.id=$1 FOR UPDATE OF n', [id])
    const chapter = await sourceChapter(client, id)
    return chapter ? queueSourceThoughtChapter(client, chapter, refresh) : undefined
  })
}
/** 更新已有作品时补登记旧章节；失败仍由下一次更新或阅读补齐，不改正文任务结果。 */
export async function queueNovelSourceThoughts(db: Db, novelId: string): Promise<void> {
  await withTx(db, async (query) => {
    await query('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [novelId])
    const chapters = await all<SourceChapter>(
      { query },
      `SELECT c.id,'' AS content,c.source_url AS chapter_url,
      COALESCE(NULLIF(sc.source_url,''),n.source_url,'') AS book_url
      FROM chapters c JOIN novels n ON n.id=c.novel_id LEFT JOIN scrape_configs sc ON sc.novel_id=n.id
      WHERE c.novel_id=$1 AND c.source_url<>'' ORDER BY c.sort_order`,
      [novelId],
    )
    for (const chapter of chapters) await queueSourceThoughtChapter({ query }, chapter)
  })
}
export async function sourceSyncStatus(db: DbClient, snapshot: StoredSourceChapter, list?: SourceList): Promise<SourceThoughtSync> {
  const params: unknown[] = [snapshot.chapter_id]
  let where = ''
  if (list) {
    params.push(list.paragraph_index, list.paragraph_hash, list.parent_id)
    where = ' AND paragraph_index=$2 AND paragraph_hash=$3 AND parent_id=$4'
  }
  const count = await first<{ count: number }>(db, `SELECT COUNT(*)::int AS count FROM source_thought_items WHERE chapter_id=$1 AND NOT hidden${where}`, params)
  return {
    state: list?.complete && !snapshot.needs_counts ? 'completed' : snapshot.state,
    savedCount: count?.count || 0,
    updatedAt: snapshot.updated_at,
    complete: list ? list.complete && !snapshot.needs_counts : snapshot.state === 'completed',
  }
}
export async function savedSourceThoughtCounts(db: DbClient, chapterId: string) {
  const rows = await all<{ paragraph_index: number; paragraph_hash: string; count: number }>(
    db,
    `SELECT paragraph_index,paragraph_hash,COUNT(*)::int AS count FROM source_thought_items
     WHERE chapter_id=$1 AND parent_id='' AND NOT hidden GROUP BY paragraph_index,paragraph_hash`,
    [chapterId],
  )
  return new Map(rows.map((row) => [`${row.paragraph_index}:${row.paragraph_hash}`, row.count]))
}
export async function readSourceThoughtPage(
  db: DbClient,
  snapshot: StoredSourceChapter,
  paragraph: SourceParagraph,
  cursor: string,
  parent = '',
): Promise<SourceThoughtPage> {
  const hash = hashParagraphText(paragraph.text)
  const args = [snapshot.chapter_id, paragraph.index, hash, parent]
  const list = await first<SourceList>(
    db,
    `SELECT * FROM source_thought_lists
    WHERE chapter_id=$1 AND paragraph_index=$2 AND paragraph_hash=$3 AND parent_id=$4`,
    args,
  )
  if (parent) {
    const owner = await first(
      db,
      `SELECT id FROM source_thought_items WHERE chapter_id=$1 AND id=$4 AND parent_id=''
      AND paragraph_index=$2 AND paragraph_hash=$3 AND NOT hidden`,
      args,
    )
    if (!owner) throw new SourceThoughtParentUnavailable('Unknown source parent')
  }
  // 本地游标按稳定行序号翻页；上游删除、隐藏或更新前页时不会让后页跳过条目。
  const after = cursor.startsWith('s:') ? cursor.slice(2) : '0'
  const offset = cursor.startsWith('s:') ? 0 : Number(cursor || 0)
  const rows = await all<{ payload: SourceThought; ordinal: string }>(
    db,
    `SELECT payload,ordinal::text AS ordinal FROM source_thought_items
    WHERE chapter_id=$1 AND paragraph_index=$2 AND paragraph_hash=$3 AND parent_id=$4 AND NOT hidden AND ordinal>$5::bigint
    ORDER BY source_thought_items.ordinal LIMIT $6 OFFSET $7`,
    [...args, after, PAGE_SIZE + 1, offset],
  )
  const sync = list ? await sourceSyncStatus(db, snapshot, list) : { state: snapshot.state, savedCount: 0, updatedAt: snapshot.updated_at, complete: false }
  return {
    items: rows.slice(0, PAGE_SIZE).map((row) => row.payload),
    total: Math.max(list?.total || 0, sync.savedCount),
    cursor: rows.length ? `s:${rows[Math.min(rows.length, PAGE_SIZE) - 1]!.ordinal}` : cursor,
    hasMore: rows.length > PAGE_SIZE,
    sync,
  }
}

/** 每次只提交一个来源页；租约/游标随内容原子提交，进程重启最多重复读取当前页。 */
export async function syncSourceThoughtStep(db: Db, chapterId: string, preferred?: { paragraph: SourceParagraph; parent: string }): Promise<boolean> {
  const now = Date.now(),
    token = randomUUID()
  const claimed = await first<StoredSourceChapter>(
    db,
    `UPDATE source_thought_chapters SET lease_token=$2,lease_until=$3,state='syncing'
    WHERE chapter_id=$1 AND state<>'completed' AND retry_at<=$4 AND lease_until<=$4 RETURNING *`,
    [chapterId, token, now + LEASE_MS, now],
  )
  if (!claimed) return false
  const adapter = adapterForUrl(claimed.chapter_url)
  const provider = adapter?.paragraphComments
  if (!provider?.enabled() || adapter?.id !== claimed.source_id) {
    await db.query(
      `UPDATE source_thought_chapters SET state='unavailable',lease_until=0,lease_token='',retry_at=$3
      WHERE chapter_id=$1 AND lease_token=$2`,
      [chapterId, token, now + 60_000],
    )
    return false
  }
  try {
    const context = { chapterUrl: claimed.chapter_url, bookUrl: claimed.book_url }
    let paragraphs: SourceParagraph[] | undefined
    let list: SourceList | undefined
    let page: SourceThoughtPage | undefined
    if (claimed.needs_counts) {
      paragraphs = await provider.paragraphs(context)
      if (
        new Set(paragraphs.map((p) => p.index)).size !== paragraphs.length ||
        paragraphs.some((p) => !Number.isInteger(p.index) || p.index < 0 || !Number.isSafeInteger(p.count) || p.count < 0 || typeof p.text !== 'string')
      )
        throw new Error('Invalid source paragraphs')
    } else {
      if (preferred)
        list = await first<SourceList>(
          db,
          `SELECT * FROM source_thought_lists WHERE chapter_id=$1
        AND paragraph_index=$2 AND paragraph_hash=$3 AND parent_id=$4 AND NOT complete`,
          [chapterId, preferred.paragraph.index, hashParagraphText(preferred.paragraph.text), preferred.parent],
        )
      list ||= await first<SourceList>(
        db,
        `SELECT * FROM source_thought_lists WHERE chapter_id=$1 AND NOT complete
        ORDER BY (parent_id='') DESC,paragraph_index,parent_id LIMIT 1`,
        [chapterId],
      )
      if (list) {
        const paragraph = claimed.paragraphs?.find((p) => p.index === list!.paragraph_index && hashParagraphText(p.text) === list!.paragraph_hash)
        if (!paragraph) throw new Error('Source paragraph changed')
        page = list.parent_id ? await provider.replies(context, list.parent_id, list.cursor) : await provider.comments(context, paragraph, list.cursor)
        if (page.hasMore && (!/^\d{1,7}$/.test(page.cursor) || page.cursor === list.cursor || list.seen_cursors.includes(page.cursor)))
          throw new Error('Repeated source cursor')
        if (!Array.isArray(page.items) || (page.items.length === 0 && (page.hasMore || page.total > 0)) || !Number.isSafeInteger(page.total) || page.total < 0)
          throw new Error('Invalid source page')
      }
    }
    await withTx(db, async (query) => {
      const client = { query }
      // 检查当前来源和租约；迟到响应不能覆盖改源、删除章节或另一个恢复任务。
      await query('SELECT n.id FROM novels n JOIN chapters c ON c.novel_id=n.id WHERE c.id=$1 FOR UPDATE OF n', [chapterId])
      const currentChapter = await sourceChapter(client, chapterId)
      const current = await first<StoredSourceChapter>(client, 'SELECT * FROM source_thought_chapters WHERE chapter_id=$1 FOR UPDATE', [chapterId])
      if (
        !currentChapter ||
        !current ||
        current.lease_token !== token ||
        current.generation !== claimed.generation ||
        current.source_key !== keyFor(currentChapter, current.source_id)
      )
        return
      if (paragraphs) {
        await query('DELETE FROM source_thought_lists WHERE chapter_id=$1', [chapterId])
        for (const p of paragraphs) {
          const hash = hashParagraphText(p.text)
          await query(
            `INSERT INTO source_thought_lists(chapter_id,paragraph_index,paragraph_hash,total,complete)
            VALUES($1,$2,$3,$4,$5)`,
            [chapterId, p.index, hash, p.count, p.count === 0],
          )
          // 不凭首页缺失或计数减少删除已保存评论；已知回复也重新检查。
          const parents = await all<{ id: string; payload: SourceThought }>(
            client,
            `SELECT id,payload FROM source_thought_items
            WHERE chapter_id=$1 AND paragraph_index=$2 AND paragraph_hash=$3 AND parent_id='' AND NOT hidden`,
            [chapterId, p.index, hash],
          )
          for (const parent of parents)
            if (parent.payload.replyCount > 0)
              await query(
                `INSERT INTO source_thought_lists
            (chapter_id,paragraph_index,paragraph_hash,parent_id,total) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
                [chapterId, p.index, hash, parent.id, parent.payload.replyCount],
              )
        }
        await query('UPDATE source_thought_chapters SET paragraphs=$2::jsonb,needs_counts=FALSE,checked_at=$3 WHERE chapter_id=$1', [
          chapterId,
          JSON.stringify(paragraphs),
          Date.now(),
        ])
      }
      if (list && page) {
        for (const item of page.items) {
          if (!/^\d{6,30}$/.test(item.id)) throw new Error('Invalid source comment ID')
          await query(
            `INSERT INTO source_thought_items(chapter_id,id,parent_id,paragraph_index,paragraph_hash,payload,updated_at)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(chapter_id,parent_id,id) DO UPDATE SET
            paragraph_index=excluded.paragraph_index,paragraph_hash=excluded.paragraph_hash,payload=excluded.payload,hidden=FALSE,updated_at=excluded.updated_at`,
            [chapterId, item.id, list.parent_id, list.paragraph_index, list.paragraph_hash, JSON.stringify(item), Date.now()],
          )
          if (!list.parent_id && item.replyCount > 0)
            await query(
              `INSERT INTO source_thought_lists(chapter_id,paragraph_index,paragraph_hash,parent_id,total)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [chapterId, list.paragraph_index, list.paragraph_hash, item.id, item.replyCount],
            )
        }
        for (const id of page.deletedIds || []) {
          await query(
            `UPDATE source_thought_items SET hidden=TRUE WHERE chapter_id=$1 AND paragraph_index=$2 AND paragraph_hash=$3
            AND ((parent_id=$4 AND id=$5) OR ($4='' AND parent_id=$5))`,
            [chapterId, list.paragraph_index, list.paragraph_hash, list.parent_id, id],
          )
          if (!list.parent_id) await query(`UPDATE source_thought_lists SET complete=TRUE WHERE chapter_id=$1 AND parent_id=$2`, [chapterId, id])
        }
        await query(
          `UPDATE source_thought_lists SET cursor=$5,complete=$6,total=$7,page_count=page_count+1,seen_cursors=array_append(seen_cursors,$8)
          WHERE chapter_id=$1 AND paragraph_index=$2 AND paragraph_hash=$3 AND parent_id=$4`,
          [chapterId, list.paragraph_index, list.paragraph_hash, list.parent_id, page.cursor, !page.hasMore, page.total, list.cursor],
        )
      }
      const pending = await first(client, 'SELECT 1 FROM source_thought_lists WHERE chapter_id=$1 AND NOT complete LIMIT 1', [chapterId])
      await query(
        `UPDATE source_thought_chapters SET state=$3,lease_token='',lease_until=0,retry_at=0,attempts=0,updated_at=$4,
        checked_at=CASE WHEN $3='completed' THEN $4 ELSE checked_at END
        WHERE chapter_id=$1 AND lease_token=$2`,
        [chapterId, token, pending ? 'syncing' : 'completed', Date.now()],
      )
    })
    return true
  } catch {
    // 不持久化原始上游错误（可能带凭据），也不清空旧快照。
    await db.query(
      `UPDATE source_thought_chapters SET state='partial',lease_token='',lease_until=0,attempts=attempts+1,retry_at=$3
      WHERE chapter_id=$1 AND lease_token=$2`,
      [chapterId, token, Date.now() + Math.min(3600000, 60_000 * 2 ** Math.min(claimed.attempts, 6))],
    )
    return false
  }
}
export async function runSourceThoughtTick(db: Db): Promise<void> {
  const enrollments = await all<{ chapter_id: string; revision: string }>(
    db,
    'SELECT chapter_id,revision FROM source_thought_enrollments ORDER BY created_at,chapter_id LIMIT 20',
  )
  for (const row of enrollments) {
    await ensureSourceThoughtChapter(db, row.chapter_id)
    await db.query('DELETE FROM source_thought_enrollments WHERE chapter_id=$1 AND revision=$2', [row.chapter_id, row.revision])
  }
  // 正文抓取优先；不让整书评论抢占同一来源的请求额度。
  if (await first(db, "SELECT 1 FROM scrape_jobs WHERE status IN ('starting','running') LIMIT 1")) return
  const next = await first<{ chapter_id: string }>(
    db,
    `SELECT chapter_id FROM source_thought_chapters
    WHERE state<>'completed' AND retry_at<=$1 AND lease_until<=$1 ORDER BY updated_at,chapter_id LIMIT 1`,
    [Date.now()],
  )
  if (next) {
    await ensureSourceThoughtChapter(db, next.chapter_id)
    await syncSourceThoughtStep(db, next.chapter_id)
  }
}
