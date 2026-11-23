import type { AnalysisKind, AnalysisNote, AnalysisRequest, AnalysisSource } from '@shared/novel-analysis'
import { ANALYSIS_KINDS } from '@shared/novel-analysis'
import type { AiReasoningMode } from '@shared/ai-text-progress'
import type { DbClient } from '../../db/pool'
import { all, run } from '../../db/query'
import { textProvider } from './client'
import { analysisPrompt, sharedAnalysisReadingPrompt } from './novel-analysis-prompts'
import { analysisHash, ANALYSIS_PIECE_CHARS } from './novel-analysis-source'

export const sharesAnalysisReading = (kind: AnalysisKind) => ['plot', 'characters', 'relationships'].includes(kind)

/** No credentials are persisted. Bump the pipeline version when generation semantics change. */
export function analysisGenerationKey(reasoningMode: AiReasoningMode) {
  const provider = textProvider()
  return analysisHash({ pipeline: 1, baseUrl: provider.baseUrl, model: provider.model, reasoningMode,
    pieceChars: ANALYSIS_PIECE_CHARS, sharedAnalysisReadingPrompt,
    prompts: Object.keys(ANALYSIS_KINDS).map(kind => ['reading', 'condense', 'direct', 'report', 'final'].map(stage =>
      analysisPrompt(stage as Parameters<typeof analysisPrompt>[0], kind as AnalysisKind))) })
}

/** Source labels and selection-relative positions may change; exact text and chapter revisions may not. */
export const analysisSourceKey = (source: AnalysisSource) => analysisHash([
  source.chapterId, source.revision, source.part, source.offset, source.endOffset, source.text,
])
export const analysisReuseKey = (request: AnalysisRequest, sources: AnalysisSource[], generationKey: string) =>
  analysisHash([request, sources.map(analysisSourceKey), generationKey])

type CachedReading = { source_keys: string[]; source_ids: string[]; content: string }
const sourceLabels = (content: string) => [...content.matchAll(/\[\[(S[1-9]\d*)\]\]/g)].map(match => match[1]!)
function completeReading(group: AnalysisSource[], content: string) {
  const labels = new Set(sourceLabels(content))
  return content.trim().length > 0 && content.length <= 30_000
    && [...labels].every(id => group.some(source => source.id === id))
    && group.every(source => !source.text.trim() || labels.has(source.id))
}

/** Only reuse complete groups wholly contained in this frozen range. Rebase citations to this report. */
export async function loadSharedAnalysisReadings(db: DbClient, novelId: string, generationKey: string,
  sources: AnalysisSource[], alreadyRead: Set<string>): Promise<AnalysisNote[]> {
  const byKey = new Map(sources.map((source, index) => [analysisSourceKey(source), { source, index }]))
  const rows = await all<CachedReading>(db, 'SELECT source_keys,source_ids,content FROM novel_analysis_readings '
    + 'WHERE novel_id=$1 AND generation_key=$2 AND source_keys <@ $3::text[] '
    + 'ORDER BY cardinality(source_keys) DESC,updated_at DESC,group_key LIMIT $4',
  [novelId, generationKey, [...byKey.keys()], sources.length * 4])
  const covered = new Set(alreadyRead)
  const notes: AnalysisNote[] = []
  for (const row of rows) {
    const mapped = row.source_keys.map(key => byKey.get(key))
    if (!mapped.length || mapped.length !== row.source_ids.length || mapped.some(item => !item || covered.has(item.source.id))) continue
    if (mapped.some((item, i) => i > 0 && item!.index !== mapped[i - 1]!.index + 1)) continue
    const group = mapped.map(item => item!.source)
    const ids = new Map(row.source_ids.map((id, i) => [id, group[i]!.id]))
    if (sourceLabels(row.content).some(id => !ids.has(id))) continue
    const content = row.content.replace(/\[\[(S[1-9]\d*)\]\]/g, (_citation, id: string) => '[[' + ids.get(id)! + ']]')
    if (!completeReading(group, content)) continue
    notes.push({ sourceIds: group.map(source => source.id), content })
    group.forEach(source => covered.add(source.id))
  }
  return notes.sort((a, b) => sources.findIndex(source => source.id === a.sourceIds[0]) - sources.findIndex(source => source.id === b.sourceIds[0]))
}

/** Called inside the owning task's checkpoint transaction, after its cancellation/ownership checks. */
export async function saveSharedAnalysisReading(db: DbClient, novelId: string, generationKey: string,
  sources: AnalysisSource[], content: string) {
  if (!completeReading(sources, content)) return
  const keys = sources.map(analysisSourceKey)
  await run(db, 'INSERT INTO novel_analysis_readings(novel_id,generation_key,group_key,source_keys,source_ids,content,updated_at) '
    + 'VALUES($1,$2,$3,$4::text[],$5::text[],$6,$7) '
    + 'ON CONFLICT(novel_id,generation_key,group_key) DO UPDATE SET source_ids=EXCLUDED.source_ids,content=EXCLUDED.content,updated_at=EXCLUDED.updated_at',
  [novelId, generationKey, analysisHash(keys), keys, sources.map(source => source.id), content, Date.now()])
}
