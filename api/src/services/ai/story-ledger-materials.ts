import type { Db } from '../../db/pool'
import { AiError } from './client'
import type { EffectiveProfileResult } from './profile-overrides'
import { ledgerAtAnchor } from './story-ledger-store'
import { renderLedger } from './story-ledger'
import { selectWritingLedger, type WritingMemoryQuery } from './writing-memory'

/** Manual corrections remain whole. Automatic selection keeps complete evidence
 * records and reports omitted records; the full ledger is never rewritten. */
export async function selectLedgerMaterials(
  db: Db,
  novelId: string,
  anchor: string,
  query: string,
  profiles: {
    plot: EffectiveProfileResult
    relationship: EffectiveProfileResult
  },
  writingQuery?: WritingMemoryQuery,
) {
  if (![profiles.plot, profiles.relationship].some((p) => p.source?.memoryEngine === 'incremental' && p.effectiveOrigin === 'automatic')) return undefined
  const ledger = await ledgerAtAnchor(db, novelId, anchor)
  if (!ledger?.complete) throw new AiError('conflict', '章节记忆来源在取材期间发生变化，请更新记忆后重新预览', 409)
  const { state: relevant, ...selection } = selectWritingLedger(ledger.state, writingQuery || { context: '', instruction: query })
  const selected: Partial<Record<'plot' | 'relationship', string>> = {}
  for (const kind of ['plot', 'relationship'] as const) {
    const profile = profiles[kind]
    if (profile.effectiveOrigin !== 'automatic') continue
    if (profile.source?.ledgerRevision !== ledger.revision) throw new AiError('conflict', '章节记忆版本已变化，请重新预览', 409)
    // Do not substitute material if an archive has been changed outside this engine.
    if (profile.effectiveContent !== renderLedger(ledger.state, kind)) throw new AiError('conflict', '章节记忆与正式档案不一致，请更新后重新预览', 409)
    selected[kind] = renderLedger(relevant, kind, true)
  }
  return { selected, revision: ledger.revision, ...selection }
}
