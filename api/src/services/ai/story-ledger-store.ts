import type { Db, DbClient } from '../../db/pool'
import { AiError } from './client'
import { all, first } from '../../db/query'
import { cleanStoryText } from './story-memory'
import { loadProfileSample, parseProfileSource, profileSourceForRows, type ProfileSampleRow } from './profile-source'
import { STORY_MEMORY_PROMPT_VERSION } from './story-memory'
import { getAiSettings } from './settings'
import { getMemoryRebuild } from './story-memory-history'
import { renderLedger } from './story-ledger'
import { emptyLedger, ledgerHash, LEDGER_VERSION, LEDGER_PROMPT_VERSION, type ChapterMemory, type LedgerState } from './story-ledger'

interface StoredChapter {
  chapter_id: string
  ordinal: number
  input_revision: string
  payload_json: string
  model: string
  updated_at: number
}
export function chapterInputRevision(row: ProfileSampleRow, previous = '') {
  return ledgerHash([LEDGER_VERSION, LEDGER_PROMPT_VERSION, previous, row.id, row.title, row.sortOrder, cleanStoryText(row.content)])
}
export function chapterOutputRevision(inputRevision: string, payload: ChapterMemory) {
  return ledgerHash([inputRevision, payload])
}

/** Validate the entire dependency prefix. An edit, insertion, deletion or reordered
 * chapter invalidates subsequent extractions, which may have read its facts. */
export async function loadLedgerPrefix(db: DbClient, novelId: string, rows: ProfileSampleRow[]) {
  const saved = new Map(
    (await all<StoredChapter>(db, 'SELECT * FROM novel_story_memory_chapters WHERE novel_id=$1 ORDER BY ordinal', [novelId])).map((r) => [r.chapter_id, r]),
  )
  const state: LedgerState = emptyLedger()
  const entities = new Map<string, LedgerState['entities'][number]>()
  let processed = 0,
    revision = '',
    model = '',
    updatedAt = 0
  for (const row of rows) {
    const stored = saved.get(row.id)
    const inputRevision = chapterInputRevision(row, revision)
    if (!stored || Number(stored.ordinal) !== row.chapterOrdinal || stored.input_revision !== inputRevision) break
    const payload = JSON.parse(stored.payload_json) as ChapterMemory
    if (payload.version !== LEDGER_VERSION) break
    // Fold validated records in place; copying the complete event array at every
    // chapter would make a read quadratic in the length of the novel.
    for (const entity of payload.entities) entities.set(entity.id, entity)
    state.facts.push(...payload.facts)
    revision = chapterOutputRevision(inputRevision, payload)
    processed++
    model = stored.model
    updatedAt = Number(stored.updated_at)
  }
  state.entities = [...entities.values()]
  return { state, processed, revision, model, updatedAt }
}

export async function ledgerAtAnchor(db: Db, novelId: string, afterChapterId?: string) {
  const sample = await loadProfileSample(db, { novelId, afterChapterId, sampleCount: 1, fullHistory: true, clean: cleanStoryText })
  if (!sample) return undefined
  const prefix = await loadLedgerPrefix(db, novelId, sample.rows)
  return { ...prefix, sample, complete: prefix.processed === sample.rows.length }
}

/** Historical projections are only exposed from a fully published, still-valid ledger.
 * A checkpoint or an invalidated rebuild is never promoted by a read. */
export async function readLedgerProfile(db: Db, kind: 'plot' | 'relationship', novelId: string, afterChapterId?: string) {
  if ((await getAiSettings(db)).storyMemoryEngine !== 'incremental') return undefined
  if ((await getMemoryRebuild(db, novelId, 'plot'))?.pending || (await getMemoryRebuild(db, novelId, 'relationship'))?.pending) return undefined
  const table = kind === 'plot' ? 'novel_plot_states' : 'novel_relationship_profiles'
  const column = kind === 'plot' ? 'state' : 'profile'
  const saved = await first<{ profile: string; source_json: string; updated_at: number }>(
    db,
    `SELECT ${column} AS profile,source_json,updated_at FROM ${table} WHERE novel_id=$1`,
    [novelId],
  )
  const formal = parseProfileSource(saved?.source_json)
  if (formal?.memoryEngine !== 'incremental') return undefined
  const full = await ledgerAtAnchor(db, novelId, formal.chapterId).catch((error) => {
    if (error instanceof AiError && error.status === 404) return undefined
    throw error
  })
  if (!full?.complete || full.revision !== formal.ledgerRevision || full.sample.source.fingerprint !== formal.fingerprint) {
    return { profile: saved!.profile, source: formal, updatedAt: Number(saved!.updated_at), eligibility: 'source_changed' as const, isOlderThanAnchor: false }
  }
  const anchorId =
    afterChapterId || (await first<{ id: string }>(db, 'SELECT id FROM chapters WHERE novel_id=$1 ORDER BY sort_order DESC,id DESC LIMIT 1', [novelId]))?.id
  const selected = anchorId === formal.chapterId ? full : await ledgerAtAnchor(db, novelId, anchorId)
  if (!selected?.complete || selected.processed > full.processed) return undefined
  const source = {
    ...profileSourceForRows(selected.sample.rows, cleanStoryText, true),
    extractionPromptVersion: STORY_MEMORY_PROMPT_VERSION,
    memoryEngine: 'incremental' as const,
    ledgerRevision: selected.revision,
    ...(formal.rebuildRevision ? { rebuildRevision: formal.rebuildRevision } : {}),
  }
  return { profile: renderLedger(selected.state, kind), source, updatedAt: Number(saved?.updated_at), eligibility: 'usable' as const, isOlderThanAnchor: false }
}
