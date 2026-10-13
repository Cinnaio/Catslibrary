import type { SourceSyncPreview } from './api'

/** 只保留目录、对应关系与实际更新均未变化的确认，防止沿用旧目标。 */
export function unchangedSourceSyncIds(previous: SourceSyncPreview, next: SourceSyncPreview): Set<string> {
  function signatures(preview: SourceSyncPreview) {
    const mappings = new Map(preview.mappings.flatMap(row => row.localChapterIds.map(id => [id, row] as const)))
    const changes = new Map(preview.changes.map(row => [row.localChapterId, row]))
    const orders = new Map(preview.orderChanges?.map(row => [row.localChapterId, row]) || [])
    return new Map((preview.localChapters || []).map(local => {
      const mapping = mappings.get(local.id), change = changes.get(local.id), order = orders.get(local.id)
      return [local.id, JSON.stringify([local.order, local.title, mapping?.sourceChapterKey, mapping?.sourceTitle,
        mapping?.sourceOrder, mapping?.confidence, mapping?.relation, mapping?.matchReason,
        change?.oldTitle, change?.newTitle, change?.eligible, order?.oldOrder, order?.newOrder])]
    }))
  }
  const before = signatures(previous), after = signatures(next)
  return new Set([...after].filter(([id, signature]) => before.get(id) === signature).map(([id]) => id))
}
