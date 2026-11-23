import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { KEEPSAKE_MAX_CLOSING, KEEPSAKE_MAX_MOMENTS, type KeepsakeInput, type KeepsakeMoment, type ReadingKeepsake } from '@shared/reading-keepsakes'
import { getDb, type DbClient } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { visibleNovelSql } from '../services/novel-visibility'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'

export const readingKeepsakesRoutes = new Hono<AuthEnv>()
readingKeepsakesRoutes.use('*', requireUser(), async (c, next) => {
  for (const [key, value] of Object.entries(contentPolicyHeaders())) c.header(key, value)
  await next()
})

type Book = { title: string; author: string; cover_url: string; content_rating: string }
async function accessibleBook(c: Context<AuthEnv>) {
  const book = await first<Book>(getDb(), `SELECT n.title,n.author,n.cover_url,n.content_rating FROM novels n
    WHERE n.id=$1 AND ${visibleNovelSql(c)}`, [c.req.param('novelId')])
  if (!book) return { error: c.json({ error: '这本书暂不可访问' }, 404) }
  if (book.content_rating === 'restricted') {
    const access = await resolveContentAccess(c)
    if (!access.canViewRestricted || c.req.query('contentMode') === 'safe') {
      return { error: restrictedContentResponse(c, c.req.query('contentMode') === 'safe' ? 'safe_mode' : access.reason) }
    }
  }
  return { book }
}

async function latest(db: DbClient, userId: string, novelId: string) {
  return first<{ id: string; saved_at: string }>(db, `SELECT id,saved_at FROM reading_keepsakes
    WHERE user_id=$1 AND novel_id=$2 AND deleted_at IS NULL ORDER BY saved_at DESC,id DESC LIMIT 1`, [userId, novelId])
}
async function startedAt(db: DbClient, userId: string, novelId: string, after: number, now: number) {
  const row = await first<{ start: string | null }>(db, `SELECT MIN(started_at) AS start FROM reading_stat_events
    WHERE user_id=$1 AND novel_id=$2 AND started_at>$3 AND started_at<=$4`, [userId, novelId, after, now])
  return row?.start == null ? null : Number(row.start)
}
const momentColumns = `t.id,ch.title AS "chapterTitle",t.selected_text AS "selectedText",t.thought_text AS "thoughtText"`

readingKeepsakesRoutes.get('/:novelId/context', async c => {
  const access = await accessibleBook(c)
  if (access.error) return access.error
  const db = getDb(), userId = c.get('user').id, novelId = c.req.param('novelId')
  const previous = await latest(db, userId, novelId)
  const candidates = await all<KeepsakeMoment>(db, `SELECT ${momentColumns} FROM thoughts t
    JOIN chapters ch ON ch.id=t.chapter_id AND ch.novel_id=t.novel_id
    WHERE t.user_id=$1 AND t.novel_id=$2 AND t.status='visible'
    ORDER BY t.created_at DESC,t.id DESC LIMIT 51`, [userId, novelId])
  return c.json({ novel: { title: access.book.title, author: access.book.author, coverUrl: access.book.cover_url },
    latestId: previous?.id ?? null,
    startedAt: await startedAt(db, userId, novelId, Number(previous?.saved_at ?? 0), Date.now()),
    candidates: candidates.slice(0, 50), candidatesLimited: candidates.length > 50 })
})

readingKeepsakesRoutes.get('/:novelId', async c => {
  const access = await accessibleBook(c)
  if (access.error) return access.error
  const cursor = c.req.query('before')
  const match = cursor?.match(/^(\d{1,16}):([\w-]{8,100})$/)
  if (cursor && !match) return c.json({ error: '翻页位置无效' }, 400)
  const rows = await all<{ snapshot: ReadingKeepsake }>(getDb(), `SELECT snapshot FROM reading_keepsakes
    WHERE user_id=$1 AND novel_id=$2 AND deleted_at IS NULL ${match ? 'AND (saved_at,id)<($3,$4)' : ''}
    ORDER BY saved_at DESC,id DESC LIMIT 11`, [c.get('user').id, c.req.param('novelId'), ...(match ? [Number(match[1]), match[2]] : [])])
  const items = rows.slice(0, 10).map(r => r.snapshot), last = items.at(-1)
  return c.json({ items, nextCursor: rows.length > 10 && last ? `${last.savedAt}:${last.id}` : null })
})

export function parseKeepsakeInput(value: unknown): KeepsakeInput | null {
  if (!value || typeof value !== 'object') return null
  const b = value as Record<string, unknown>
  if (typeof b.id !== 'string' || !/^[\w-]{8,100}$/.test(b.id)
    || !(b.previousId === null || typeof b.previousId === 'string' && /^[\w-]{8,100}$/.test(b.previousId))
    || typeof b.closing !== 'string' || b.closing.length > KEEPSAKE_MAX_CLOSING
    || !Array.isArray(b.momentIds) || b.momentIds.length > KEEPSAKE_MAX_MOMENTS
    || !b.momentIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100)
    || new Set(b.momentIds).size !== b.momentIds.length) return null
  const closing = b.closing.trim()
  if (!closing && !b.momentIds.length) return null
  return { id: b.id, previousId: b.previousId, closing, momentIds: b.momentIds as string[] }
}

readingKeepsakesRoutes.post('/:novelId', bodyLimit({ maxSize: 8 * 1024 }), async c => {
  const access = await accessibleBook(c)
  if (access.error) return access.error
  const input = parseKeepsakeInput(await c.req.json().catch(() => null))
  if (!input) return c.json({ error: '请写下一句话，或选择至多三则想法；寄语限 280 字' }, 422)
  const userId = c.get('user').id, novelId = c.req.param('novelId')
  const hash = createHash('sha256').update(JSON.stringify({ novelId, ...input })).digest('hex')
  const result = await withTx(getDb(), async query => {
    const db: DbClient = { query }
    // Serialize this user's saves so concurrent drafts cannot create duplicate reading rounds.
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const existing = await first<{ snapshot: ReadingKeepsake | null; request_hash: string }>(db,
      'SELECT snapshot,request_hash FROM reading_keepsakes WHERE user_id=$1 AND id=$2', [userId, input.id])
    if (existing && !existing.snapshot) return { error: '这张藏书票已删除，请重新打开后另留一页', status: 410 as const }
    if (existing) return existing.request_hash === hash ? { item: existing.snapshot } : { error: '这次保存的内容已改变，请重新打开余温页', status: 409 as const }
    const previous = await latest(db, userId, novelId)
    if ((previous?.id ?? null) !== input.previousId) return { error: '已经有一张新的藏书票，请重新打开后查看', status: 409 as const }
    const moments = input.momentIds.length ? await all<KeepsakeMoment>(db, `SELECT ${momentColumns} FROM thoughts t
      JOIN chapters ch ON ch.id=t.chapter_id AND ch.novel_id=t.novel_id
      WHERE t.user_id=$1 AND t.novel_id=$2 AND t.status='visible' AND t.id=ANY($3::text[])`, [userId, novelId, input.momentIds]) : []
    if (moments.length !== input.momentIds.length) return { error: '选中的想法已变更或不可用，请重新打开后选择', status: 409 as const }
    const now = Math.max(Date.now(), Number(previous?.saved_at ?? 0) + 1)
    const item: ReadingKeepsake = { id: input.id, novelId, title: access.book.title, author: access.book.author,
      coverUrl: access.book.cover_url, startedAt: await startedAt(db, userId, novelId, Number(previous?.saved_at ?? 0), now), savedAt: now,
      closing: input.closing, moments: input.momentIds.map(id => moments.find(m => m.id === id)!) }
    await query('INSERT INTO reading_keepsakes(user_id,id,novel_id,saved_at,request_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [userId, item.id, novelId, now, hash, JSON.stringify(item)])
    return { item }
  })
  if (result.error) return c.json({ error: result.error }, result.status)
  return c.json({ item: result.item }, 200)
})

readingKeepsakesRoutes.delete('/:novelId/:id', async c => {
  const access = await accessibleBook(c)
  if (access.error) return access.error
  // Erase the private text but retain the request ID so a delayed retry cannot resurrect it.
  await getDb().query('UPDATE reading_keepsakes SET snapshot=NULL,deleted_at=$4 WHERE user_id=$1 AND novel_id=$2 AND id=$3 AND deleted_at IS NULL',
    [c.get('user').id, c.req.param('novelId'), c.req.param('id'), Date.now()])
  return c.json({ ok: true })
})
