import { randomUUID } from 'node:crypto'
import type { DbClient } from '../../db/pool'
import { first, run } from '../../db/query'

export type MemoryKind = 'plot' | 'relationship'
export interface MemorySnapshot {
  id: string
  content: string
  source_json: string
  model: string
  role: string
  created_at: number
  reusable: boolean
}
export function getMemoryRebuild(db: DbClient, novelId: string, kind: MemoryKind) {
  return first<{ revision: string; pending: boolean; from_chapter_id: string; target_chapter_id: string }>(
    db,
    'SELECT revision, pending, from_chapter_id, target_chapter_id FROM novel_story_memory_rebuilds WHERE novel_id=$1 AND kind=$2',
    [novelId, kind],
  )
}

/** A bounded history: keep 16 batch checkpoints and 8 prior formal archives per kind. */
export async function saveMemorySnapshot(
  db: DbClient,
  novelId: string,
  kind: MemoryKind,
  role: 'checkpoint' | 'archive',
  value: { content: string; source_json: string; model: string },
) {
  if (!value.content.trim()) return
  const existing = await first(
    db,
    'SELECT id FROM novel_story_memory_snapshots WHERE novel_id=$1 AND kind=$2 AND role=$3 AND content=$4 AND source_json=$5 LIMIT 1',
    [novelId, kind, role, value.content, value.source_json],
  )
  if (existing) return
  await run(db, 'INSERT INTO novel_story_memory_snapshots (id,novel_id,kind,role,content,source_json,model,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    randomUUID(),
    novelId,
    kind,
    role,
    value.content,
    value.source_json,
    value.model,
    Date.now(),
  ])
  await run(
    db,
    `DELETE FROM novel_story_memory_snapshots WHERE novel_id=$1 AND kind=$2 AND role=$3 AND id NOT IN
    (SELECT id FROM novel_story_memory_snapshots WHERE novel_id=$1 AND kind=$2 AND role=$3 ORDER BY created_at DESC,id DESC LIMIT $4)`,
    [novelId, kind, role, role === 'checkpoint' ? 16 : 8],
  )
}
