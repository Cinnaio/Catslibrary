import { expect, it } from 'vitest'
import type { SourceSyncPreview } from './api'
import { unchangedSourceSyncIds } from './source-sync-selection'

const preview = {
  localChapters: [{ id: 'a', order: 1, title: '旧标题' }, { id: 'b', order: 2, title: '第二章' }],
  mappings: [
    { localChapterIds: ['a'], sourceChapterKey: 's1', sourceOrder: 1, sourceTitle: '新标题', confidence: 'high', relation: 'one_to_one', matchReason: 'manual' },
    { localChapterIds: ['b'], sourceChapterKey: 's2', sourceOrder: 2, sourceTitle: '第二章', confidence: 'high', relation: 'one_to_one', matchReason: 'exact-title' },
  ],
  changes: [{ localChapterId: 'a', oldTitle: '旧标题', newTitle: '新标题', eligible: false }], orderChanges: [],
} as unknown as SourceSyncPreview

it('保留完全不变的确认，更新目标及序号变化时要求重新选择', () => {
  expect(unchangedSourceSyncIds(preview, { ...preview, revision: 2 })).toEqual(new Set(['a', 'b']))
  expect(unchangedSourceSyncIds(preview, { ...preview, mappings: [
    { ...preview.mappings[0]!, sourceChapterKey: 's3' }, preview.mappings[1]!,
  ] })).toEqual(new Set(['b']))
  expect(unchangedSourceSyncIds(preview, { ...preview, orderChanges: [{ localChapterId: 'b', title: '第二章', oldOrder: 2, newOrder: 3 }] })).toEqual(new Set(['a']))
})

it('删除或应用后的章节不沿用原有勾选与人工确认', () => {
  expect(unchangedSourceSyncIds(preview, { ...preview, localChapters: [preview.localChapters![1]!] })).toEqual(new Set(['b']))
  expect(unchangedSourceSyncIds(preview, { ...preview, changes: [] })).toEqual(new Set(['b']))
})
