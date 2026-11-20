import type { Context } from 'hono'
import type { AuthEnv } from '../middlewares/auth'
import { isAdministrator } from '@shared/roles'
import { getDb, type DbClient } from '../db/pool'
import { loadConfig } from '../config'
import { hashToken } from './auth'
import { clientIpFromContext } from './ai/audit-context'
import { resolveContentAccess } from './content-access'

const MINUTE = 60_000
const RETENTION = 48 * 60 * MINUTE
const WINDOWS = [10, 60, 1440] as const
type Subject = 'account' | 'guest' | 'ip'
type Mode = 'observe' | 'enforce'
interface Bucket {
  subject_hash: string
  subject_kind: Subject
  window_minutes: number
  window_start: number
  expires_at: number
  chapter_limit: number
  novel_limit: number
}
interface Count extends Bucket { request_count: number; unique_chapters: number; unique_novels: number }
const DEFAULTS: Record<Subject, readonly number[]> = { guest: [60, 300, 1200], account: [180, 1200, 6000], ip: [720, 4800, 24000] }
const NOVEL_LIMITS: Record<Subject, readonly number[]> = { guest: [6, 20, 80], account: [10, 30, 120], ip: [40, 120, 480] }
const nextCleanup = new WeakMap<DbClient, number>()
const WINDOW_NAMES = ['10_MINUTES', 'HOUR', 'DAY']
const ENV_NAMES: Record<Subject, string> = { guest: 'GUEST', account: 'USER', ip: 'IP' }

export function readingAccessPolicy() {
  const mode: Mode = process.env.CHAPTER_PROTECTION_MODE === 'enforce' ? 'enforce' : 'observe'
  const limits = Object.fromEntries((['guest', 'account', 'ip'] as const).map(kind => [kind, WINDOWS.map((minutes, index) => {
    const configured = Number(process.env[`CHAPTER_${ENV_NAMES[kind]}_UNIQUE_${WINDOW_NAMES[index]}`])
    const chapters = Number.isSafeInteger(configured) && configured > 0 && configured <= 100000 ? configured : DEFAULTS[kind][index]!
    return { minutes, chapters, novels: NOVEL_LIMITS[kind][index]! }
  })])) as Record<Subject, Array<{ minutes: number; chapters: number; novels: number }>>
  return { mode, limits }
}

// Atomically deduplicate resource IDs and increment all identity/window counters in one statement.
// Stop retaining new IDs once a threshold is crossed. Counts saturate at limit + 1 (plus in-flight requests).
const RECORD_SQL = `
WITH inputs AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(subject_hash text, subject_kind text, window_minutes int,
    window_start bigint, expires_at bigint, chapter_limit int, novel_limit int)
), added AS (
  INSERT INTO reading_access_items(subject_hash, window_minutes, window_start, item_kind, item_hash, expires_at)
  SELECT i.subject_hash, i.window_minutes, i.window_start, resource.kind, resource.hash, i.expires_at
  FROM inputs i CROSS JOIN (VALUES ('chapter', $2::text), ('novel', $3::text)) resource(kind, hash)
  LEFT JOIN reading_access_windows w USING(subject_hash, window_minutes, window_start)
  WHERE resource.hash IS NOT NULL AND CASE WHEN resource.kind = 'chapter'
    THEN COALESCE(w.unique_chapters, 0) <= i.chapter_limit
    ELSE COALESCE(w.unique_novels, 0) <= i.novel_limit END
  ON CONFLICT DO NOTHING
  RETURNING subject_hash, window_minutes, window_start, item_kind
), counted AS (
  SELECT subject_hash, window_minutes, window_start,
    COUNT(*) FILTER (WHERE item_kind = 'chapter')::int AS chapters,
    COUNT(*) FILTER (WHERE item_kind = 'novel')::int AS novels
  FROM added GROUP BY subject_hash, window_minutes, window_start
), updated AS (
  INSERT INTO reading_access_windows(subject_hash, subject_kind, window_minutes, window_start, expires_at,
    request_count, unique_chapters, unique_novels, limited_count)
  SELECT i.subject_hash, i.subject_kind, i.window_minutes, i.window_start, i.expires_at,
    1, COALESCE(c.chapters, 0), COALESCE(c.novels, 0), $4::int
  FROM inputs i LEFT JOIN counted c USING(subject_hash, window_minutes, window_start)
  ORDER BY i.subject_hash, i.window_minutes, i.window_start
  ON CONFLICT (subject_hash, window_minutes, window_start) DO UPDATE SET
    request_count = reading_access_windows.request_count + 1,
    unique_chapters = reading_access_windows.unique_chapters + EXCLUDED.unique_chapters,
    unique_novels = reading_access_windows.unique_novels + EXCLUDED.unique_novels,
    limited_count = reading_access_windows.limited_count + EXCLUDED.limited_count
  RETURNING *
)
SELECT u.*, i.chapter_limit, i.novel_limit FROM updated u JOIN inputs i USING(subject_hash, window_minutes, window_start)
`

async function record(c: Context<AuthEnv>, resource?: { chapterId: string; novelId: string }, limited = false) {
  const user = c.get('user')
  if (isAdministrator(user?.role)) return []
  const salt = loadConfig().sessionHashSalt
  const subjects: Array<[Subject, string]> = []
  const accountId = user?.id || (await resolveContentAccess(c)).accountId
  if (accountId) subjects.push(['account', accountId])
  const ip = clientIpFromContext(c)
  if (ip) {
    if (!accountId) subjects.push(['guest', ip])
    subjects.push(['ip', ip])
  }
  // Never substitute an attacker-controlled header or a shared unknown-IP bucket.
  if (!subjects.length) return []
  const now = Date.now()
  await pruneReadingAccess(getDb(), now)
  const policy = readingAccessPolicy()
  const buckets: Bucket[] = []
  for (const [kind, identity] of subjects) {
    const digest = await hashToken(`reading-access:${kind}:${identity}`, salt)
    for (const limit of policy.limits[kind]) {
      const start = Math.floor(now / (limit.minutes * MINUTE)) * limit.minutes * MINUTE
      buckets.push({ subject_hash: digest, subject_kind: kind, window_minutes: limit.minutes, window_start: start,
        expires_at: start + limit.minutes * MINUTE + RETENTION, chapter_limit: limit.chapters, novel_limit: limit.novels })
    }
  }
  const chapterHash = resource ? await hashToken(`chapter:${resource.chapterId}`, salt) : null
  const novelHash = resource ? await hashToken(`novel:${resource.novelId}`, salt) : null
  return (await getDb().query<Count>(RECORD_SQL, [JSON.stringify(buckets), chapterHash, novelHash, limited ? 1 : 0])).rows
}

/** Count minute-limit rejections without looking up or retaining requested resource IDs. */
export async function recordChapterRateLimit(c: Context<AuthEnv>) { await record(c, undefined, true) }

export async function checkChapterProtection(c: Context<AuthEnv>, resource: { chapterId: string; novelId: string }) {
  const counts = await record(c, resource)
  const flagged = counts.filter(row => row.unique_chapters > row.chapter_limit || row.unique_novels > row.novel_limit)
  if (!flagged.length) return null
  const { mode } = readingAccessPolicy()
  const db = getDb()
  await db.query(`UPDATE reading_access_windows w SET flagged_count = w.flagged_count + 1,
    blocked_count = w.blocked_count + $2::int
    FROM jsonb_to_recordset($1::jsonb) AS x(subject_hash text, window_minutes int, window_start bigint)
    WHERE w.subject_hash = x.subject_hash AND w.window_minutes = x.window_minutes AND w.window_start = x.window_start`,
  [JSON.stringify(flagged), mode === 'enforce' ? 1 : 0])
  if (mode !== 'enforce') return null
  const retryAfter = Math.max(1, ...flagged.map(row => Math.ceil((Number(row.window_start) + row.window_minutes * MINUTE - Date.now()) / 1000)))
  return c.json({ error: '章节访问过于频繁，请稍后继续阅读或下载', code: 'content_rate_limited', retryAfter }, 429,
    { 'Retry-After': String(retryAfter), 'Cache-Control': 'private, no-store' })
}

/** Bounded expiry cleanup, at most once a minute per database handle/process. */
async function pruneReadingAccess(db: DbClient, now: number) {
  if ((nextCleanup.get(db) || 0) > now) return
  nextCleanup.set(db, now + MINUTE)
  for (const table of ['reading_access_items', 'reading_access_windows']) {
    await db.query(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE expires_at <= $1 LIMIT 5000)`, [now])
  }
}

export async function readingAccessSummary(db: DbClient, hours: number) {
  const now = Date.now()
  await pruneReadingAccess(db, now)
  const { rows } = await db.query(`SELECT window_start AS "hour", subject_kind AS "subjectKind", COUNT(*)::int AS subjects,
    SUM(request_count)::bigint AS requests, SUM(unique_chapters)::bigint AS "uniqueChapterReads",
    SUM(unique_novels)::bigint AS "uniqueNovelReads", SUM(limited_count)::bigint AS "rateLimited",
    SUM(flagged_count)::bigint AS flagged, SUM(blocked_count)::bigint AS blocked
    FROM reading_access_windows WHERE window_minutes = 60 AND window_start >= $1 AND expires_at > $2
    GROUP BY window_start, subject_kind ORDER BY window_start DESC, subject_kind`,
  [Math.floor(now / (60 * MINUTE)) * 60 * MINUTE - (hours - 1) * 60 * MINUTE, now])
  const signals = await db.query(`SELECT window_minutes AS "windowMinutes", window_start AS "windowStart",
    subject_kind AS "subjectKind", COUNT(*)::int AS subjects, SUM(flagged_count)::bigint AS flagged,
    SUM(blocked_count)::bigint AS blocked
    FROM reading_access_windows WHERE flagged_count > 0 AND window_start + window_minutes * 60000 > $1 AND expires_at > $2
    GROUP BY window_minutes, window_start, subject_kind ORDER BY window_start DESC, window_minutes, subject_kind`,
  [now - hours * 60 * MINUTE, now])
  return { ...readingAccessPolicy(), hours, countsAreCapped: true, byHour: rows, signals: signals.rows }
}
