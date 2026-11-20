import type { GenerationAssociation, GenerationAssociationChange, GenerationBookSnapshot } from '@shared/ai-generation-association'
import type { DbClient } from '../../db/pool'
import { first } from '../../db/query'

export function readBookSnapshot(value: string | undefined, novelId = ''): GenerationBookSnapshot {
  let raw: Partial<GenerationBookSnapshot> = {}
  try { raw = JSON.parse(value || '{}') || {} } catch { /* Legacy metadata can be incomplete. */ }
  return {
    novelId: typeof raw.novelId === 'string' ? raw.novelId : novelId,
    title: typeof raw.title === 'string' ? raw.title : '',
    author: typeof raw.author === 'string' ? raw.author : '',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '',
    ...(raw.anchor?.chapterId ? { anchor: raw.anchor } : {}),
  }
}

export async function captureBookSnapshot(db: DbClient, novelId: string, paramsJson: string, chapterId = ''): Promise<GenerationBookSnapshot> {
  const novel = novelId ? await first<{ title: string; author: string; source_url: string }>(db,
    'SELECT title,author,source_url FROM novels WHERE id=$1', [novelId]) : undefined
  const snapshot: GenerationBookSnapshot = { novelId, title: novel?.title || '', author: novel?.author || '', sourceUrl: novel?.source_url || '' }
  try {
    const anchor = JSON.parse(paramsJson || '{}')?.continuationSnapshot?.anchor
    if (anchor && typeof anchor.chapterId === 'string' && typeof anchor.title === 'string')
      snapshot.anchor = { chapterId: anchor.chapterId, title: anchor.title, sortOrder: Number(anchor.sortOrder) || 0 }
  } catch { /* Do not infer book identity from the model prompt. */ }
  if (!snapshot.anchor && chapterId) {
    const chapter = await first<{ id: string; title: string; sort_order: number }>(db,
      'SELECT id,title,sort_order FROM chapters WHERE id=$1 AND novel_id=$2', [chapterId, novelId])
    if (chapter) snapshot.anchor = { chapterId: chapter.id, title: chapter.title, sortOrder: chapter.sort_order }
  }
  return snapshot
}

export function generationAssociation(row: {
  novel_id: string; novel_title?: string; book_snapshot_json?: string
  association_revision?: number; association_history_json?: GenerationAssociationChange[]
}): GenerationAssociation {
  return {
    state: row.novel_title ? 'linked' : row.novel_id ? 'missing' : 'unassigned',
    source: readBookSnapshot(row.book_snapshot_json, row.novel_id),
    revision: Number(row.association_revision) || 0,
    history: Array.isArray(row.association_history_json) ? row.association_history_json : [],
  }
}
