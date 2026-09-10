import { createHash } from 'node:crypto'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { AiError } from './client'

/** V1 的画像输入来源。来源只描述真正送进模型的有序样本，不代表画像历史版本。 */
export interface ProfileSource {
  version: 1
  chapterId: string
  chapterTitle: string
  sortOrder: number
  chapterOrdinal: number
  sampleCount: number
  samplePolicyVersion: 1
  fingerprint: string
}

export type ProfileKind = 'style' | 'plot' | 'relationship'
export type ProfileEligibility = 'usable' | 'missing' | 'legacy_unknown' | 'beyond_anchor' | 'stale' | 'source_changed'

export interface ProfileSampleRow {
  id: string
  title: string
  content: string
  sortOrder: number
  chapterOrdinal: number
}

export interface ProfileSample {
  rows: ProfileSampleRow[]
  anchor: ProfileSampleRow
  source: ProfileSource
}

const MAX_SAMPLE_CHAPTERS = 30

/** 统一取得不晚于起点的章节样本。afterChapterId 为空时明确落到最新章节。 */
export async function loadProfileSample(
  db: Db,
  opts: { novelId: string; afterChapterId?: string; sampleCount: number; clean: (text: string) => string },
): Promise<ProfileSample | undefined> {
  const novelId = String(opts.novelId || '').trim()
  if (!novelId) return undefined
  const sampleCount = Math.min(MAX_SAMPLE_CHAPTERS, Math.max(1, Math.trunc(Number(opts.sampleCount) || 1)))
  const requestedAnchor = String(opts.afterChapterId || '').trim()
  const anchor = requestedAnchor
    ? await first<{ id: string; title: string; content: string; sort_order: number }>(
        db,
        'SELECT id, title, content, sort_order FROM chapters WHERE id = $1 AND novel_id = $2',
        [requestedAnchor, novelId],
      )
    : await first<{ id: string; title: string; content: string; sort_order: number }>(
        db,
        'SELECT id, title, content, sort_order FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC, id DESC LIMIT 1',
        [novelId],
      )
  if (requestedAnchor && !anchor) throw new AiError('invalid', '起点章节不存在或不属于该小说', 404)
  if (!anchor) return undefined

  const rows = await all<{ id: string; title: string; content: string; sort_order: number; chapter_ordinal: number }>(
    db,
    `WITH ordered AS (
       SELECT id, title, content, sort_order,
         ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC)::int AS chapter_ordinal
       FROM chapters WHERE novel_id = $1
     )
     SELECT id, title, content, sort_order, chapter_ordinal
     FROM ordered
     WHERE sort_order < $2 OR (sort_order = $2 AND id <= $3)
     ORDER BY sort_order DESC, id DESC
     LIMIT $4`,
    [novelId, Number(anchor.sort_order) || 0, String(anchor.id), sampleCount],
  )
  const ordered = rows
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || ''),
      content: String(row.content || ''),
      sortOrder: Number(row.sort_order) || 0,
      chapterOrdinal: Number(row.chapter_ordinal) || 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const actualAnchor = ordered.find((row) => row.id === String(anchor.id)) || {
    id: String(anchor.id),
    title: String(anchor.title || ''),
    content: String(anchor.content || ''),
    sortOrder: Number(anchor.sort_order) || 0,
    chapterOrdinal: 0,
  }
  if (!actualAnchor.chapterOrdinal) {
    const ordinal = await first<{ chapter_ordinal: number }>(
      db,
      `SELECT COUNT(*)::int AS chapter_ordinal FROM chapters
       WHERE novel_id = $1 AND (sort_order < $2 OR (sort_order = $2 AND id <= $3))`,
      [novelId, actualAnchor.sortOrder, actualAnchor.id],
    )
    actualAnchor.chapterOrdinal = Number(ordinal?.chapter_ordinal) || 0
  }
  const fingerprintInput = ordered
    .map((row) => `${row.id}\u0000${row.sortOrder}\u0000${row.title}\u0000${opts.clean(row.content)}`)
    .join('\u0001')
  const source: ProfileSource = {
    version: 1,
    chapterId: actualAnchor.id,
    chapterTitle: actualAnchor.title,
    sortOrder: actualAnchor.sortOrder,
    chapterOrdinal: actualAnchor.chapterOrdinal,
    sampleCount: ordered.length,
    samplePolicyVersion: 1,
    fingerprint: createHash('sha256').update(fingerprintInput, 'utf8').digest('hex'),
  }
  return { rows: ordered, anchor: actualAnchor, source }
}

export function parseProfileSource(raw: unknown): ProfileSource | undefined {
  if (!raw) return undefined
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    if (source.version !== 1 || source.samplePolicyVersion !== 1) return undefined
    if (typeof source.chapterId !== 'string' || !source.chapterId || typeof source.fingerprint !== 'string' || !source.fingerprint) return undefined
    if (typeof source.chapterTitle !== 'string') return undefined
    const sortOrder = Number(source.sortOrder)
    const chapterOrdinal = Number(source.chapterOrdinal)
    const sampleCount = Number(source.sampleCount)
    if (![sortOrder, chapterOrdinal, sampleCount].every(Number.isFinite) || sampleCount < 0) return undefined
    return {
      version: 1,
      chapterId: source.chapterId,
      chapterTitle: source.chapterTitle,
      sortOrder,
      chapterOrdinal,
      sampleCount,
      samplePolicyVersion: 1,
      fingerprint: source.fingerprint,
    }
  } catch {
    return undefined
  }
}

const PROFILE_TABLES: Record<ProfileKind, string> = {
  style: 'novel_style_profiles',
  plot: 'novel_plot_states',
  relationship: 'novel_relationship_profiles',
}
const PROFILE_COLUMNS: Record<ProfileKind, string> = {
  style: 'profile',
  plot: 'state',
  relationship: 'profile',
}

/** 读取画像来源并与当前起点校验。画像正文仍可展示，只有 usable/较早的安全状态可注入。 */
export async function evaluateProfileSource(
  db: Db,
  opts: { kind: ProfileKind; novelId: string; afterChapterId?: string; clean?: (text: string) => string },
): Promise<{
  profile: string
  source?: ProfileSource
  updatedAt: number
  eligibility: ProfileEligibility
  isOlderThanAnchor: boolean
}> {
  const table = PROFILE_TABLES[opts.kind]
  const contentColumn = PROFILE_COLUMNS[opts.kind]
  const row = await first<{ profile: string; source_json: string; updated_at: number }>(
    db,
    `SELECT ${contentColumn} AS profile, source_json, updated_at FROM ${table} WHERE novel_id = $1`,
    [opts.novelId],
  )
  if (!row) return { profile: '', updatedAt: 0, eligibility: 'missing', isOlderThanAnchor: false }
  const profile = String(row.profile || '')
  const source = parseProfileSource(row.source_json)
  if (!source) return { profile, updatedAt: Number(row.updated_at) || 0, eligibility: 'legacy_unknown', isOlderThanAnchor: false }

  const anchor = await loadProfileSample(db, { novelId: opts.novelId, afterChapterId: opts.afterChapterId, sampleCount: 1, clean: (value) => value })
  if (!anchor) return { profile, source, updatedAt: Number(row.updated_at) || 0, eligibility: 'missing', isOlderThanAnchor: false }
  const sourceAfterAnchor = source.sortOrder > anchor.source.sortOrder
    || (source.sortOrder === anchor.source.sortOrder && source.chapterId.localeCompare(anchor.source.chapterId) > 0)
  const sourceBeforeAnchor = source.sortOrder < anchor.source.sortOrder
    || (source.sortOrder === anchor.source.sortOrder && source.chapterId.localeCompare(anchor.source.chapterId) < 0)
  if (sourceAfterAnchor) {
    return { profile, source, updatedAt: Number(row.updated_at) || 0, eligibility: 'beyond_anchor', isOlderThanAnchor: false }
  }

  let sourceSample: ProfileSample | undefined
  try {
    sourceSample = await loadProfileSample(db, {
      novelId: opts.novelId,
      afterChapterId: source.chapterId,
      sampleCount: source.sampleCount || 1,
      // The fingerprint must use the same cleaner as extraction. Stored sources from
      // this version use the normalized chapter text; callers may supply a no-op when
      // only ordering needs to be checked.
      clean: opts.clean || ((value) => value),
    })
  } catch (err) {
    // The source chapter may have been removed after extraction. Keep the old
    // profile visible, but never treat it as a usable input for a new continuation.
    if (err instanceof AiError && err.status === 404) {
      return { profile, source, updatedAt: Number(row.updated_at) || 0, eligibility: 'source_changed', isOlderThanAnchor: sourceBeforeAnchor }
    }
    throw err
  }
  if (!sourceSample || sourceSample.source.chapterId !== source.chapterId || sourceSample.source.fingerprint !== source.fingerprint) {
    return { profile, source, updatedAt: Number(row.updated_at) || 0, eligibility: 'source_changed', isOlderThanAnchor: sourceBeforeAnchor }
  }
  const older = sourceBeforeAnchor
  const eligibility: ProfileEligibility = older && opts.kind === 'plot' ? 'stale' : 'usable'
  return { profile, source, updatedAt: Number(row.updated_at) || 0, eligibility, isOlderThanAnchor: older }
}

export function sampleText(sample: ProfileSample, clean: (text: string) => string): string {
  return sample.rows.map((row) => `【${row.title}】\n${clean(row.content)}`).join('\n\n')
}
