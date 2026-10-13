import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { SourceSyncChange, SourceSyncPreview } from '@/lib/api'
import ChapterMergePreview from './ChapterMergePreview'

function change(overrides: Partial<SourceSyncChange> & { localChapterId: string }): SourceSyncChange {
  return {
    localOrder: 1, oldTitle: '原章节名', newTitle: '新章节名', sourceOrder: 1, sourceTitle: '新章节名',
    relation: 'one_to_one', partIndex: 1, partCount: 1, confidence: 'high', eligible: true, ...overrides,
  }
}

/** 真实书形态：5 条 change 全部 eligible=true，其中 1 条是「84.首长和太子」这类导入编号清理。 */
const preview = {
  runId: 'run', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: 'https://www.po18.tw/books/1',
  metadata: { title: '', author: '', description: '', coverUrl: '', categories: [], status: '' },
  sourceChapterCount: 182, localChapterCount: 181, splitLocalChapterCount: 0, matchedSourceCount: 179,
  unmatchedSource: [], unmatchedLocal: [], warnings: [],
  mappings: [
    { sourceChapterKey: 's84', sourceOrder: 84, sourceTitle: '首长和太子', sourceUrl: '', localChapterIds: ['l85'], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title' },
    { sourceChapterKey: 's78', sourceOrder: 78, sourceTitle: '被迫穿上情趣旗袍（微H）', sourceUrl: '', localChapterIds: ['l79'], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title' },
    { sourceChapterKey: 's9', sourceOrder: 9, sourceTitle: '第九个故事', sourceUrl: '', localChapterIds: ['l9'], relation: 'one_to_one', confidence: 'law', matchReason: 'sequence' },
  ],
  changes: [
    change({ localChapterId: 'l85', localOrder: 85, oldTitle: '84.首长和太子', newTitle: '首长和太子', sourceOrder: 84, sourceTitle: '首长和太子', titleUpdateReasons: ['import-prefix'], matchReason: 'exact-title', matchEvidence: '清理导入编号、空白和常见标点后，完整标题一致。' }),
    change({ localChapterId: 'l79', localOrder: 79, oldTitle: '被迫穿上情趣旗袍', newTitle: '被迫穿上情趣旗袍（微H）', sourceOrder: 78, sourceTitle: '被迫穿上情趣旗袍（微H）', titleUpdateReasons: ['rating-marker'], matchReason: 'exact-title', matchEvidence: '清理导入编号、空白和常见标点后，完整标题一致。' }),
  ],
  onlyWeakTitles: false,
  orderChanges: [], revision: 0,
  localChapters: [{ id: 'l9', order: 9, title: '第九节' }],
  sourceChapters: [],
  manualMappings: [],
} as unknown as SourceSyncPreview

function renderPreview(overrides: Partial<SourceSyncPreview> = {}, confirmedManualIds = new Set<string>()) {
  const onFieldsChange = vi.fn(), onConfirmedManualIdsChange = vi.fn(), onSelectedMappingsChange = vi.fn(), onRemap = vi.fn()
  const result = render(<ChapterMergePreview
    preview={{ ...preview, ...overrides }}
    fields={[]} onFieldsChange={onFieldsChange}
    confirmedManualIds={confirmedManualIds} onConfirmedManualIdsChange={onConfirmedManualIdsChange}
    disabled={false} onRemap={onRemap} onSelectedMappingsChange={onSelectedMappingsChange}
  />)
  return { ...result, onFieldsChange, onConfirmedManualIdsChange, onSelectedMappingsChange, onRemap }
}

it('高置信度确定修正全部计入自动更新，并在行内解释为何无需人工确认', () => {
  renderPreview()
  // 顶部汇总与筛选计数都基于 eligible。
  expect(screen.getByRole('heading', { name: /可更新 2 个章节名/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '自动更新 2' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '人工核对 0' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '自动更新 2' }))
  expect(screen.getByText('自动更新：清理导入编号')).toBeInTheDocument()
  expect(screen.getByText('自动更新：同步源站章节标记')).toBeInTheDocument()
  // 确定的修正不需要逐条勾选。
  expect(screen.queryByRole('checkbox', { name: /确认更新第 85 章/ })).not.toBeInTheDocument()
})

it('人工核对分组保留勾选、确认本页、确认全部筛选结果与清空确认', () => {
  const manualChanges: SourceSyncChange[] = [
    change({ localChapterId: 'm1', localOrder: 5, oldTitle: '旧名一', newTitle: '新名一', eligible: false, confidence: 'medium', matchReason: 'sequence' }),
    change({ localChapterId: 'm2', localOrder: 6, oldTitle: '旧名二', newTitle: '新名二', eligible: false, confidence: 'low', matchReason: 'manual', matchEvidence: '管理员指定的对应关系。' }),
  ]
  const { onConfirmedManualIdsChange } = renderPreview({ changes: manualChanges })
  expect(screen.getByRole('button', { name: '自动更新 0' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '人工核对 2' })).toBeInTheDocument()
  expect(screen.getByText('已人工确认 0 / 2 个标题')).toBeInTheDocument()
  // 逐条勾选。
  fireEvent.click(screen.getByRole('checkbox', { name: '确认更新第 5 章' }))
  expect(onConfirmedManualIdsChange).toHaveBeenLastCalledWith(new Set(['m1']))
  // 确认本页 / 确认全部筛选结果 / 清空人工确认三处入口都必须在。
  const page = screen.getByRole('button', { name: '确认本页 2 项' })
  const all = screen.getByRole('button', { name: '确认全部筛选结果 2 项' })
  expect(page).toBeEnabled()
  expect(all).toBeEnabled()
  fireEvent.click(page)
  expect(onConfirmedManualIdsChange).toHaveBeenLastCalledWith(new Set(['m1', 'm2']))
  // 清空人工确认：受控组件把当前确认集合整体交还调用方重置。
  fireEvent.click(screen.getByRole('button', { name: '清空人工确认' }))
  expect(onConfirmedManualIdsChange).toHaveBeenLastCalledWith(new Set(['m1', 'm2']))
})

it('已确认的人工项计入可更新数量，未确认时保持原样', () => {
  const changes: SourceSyncChange[] = [
    change({ localChapterId: 'l85', localOrder: 85, oldTitle: '84.首长和太子', newTitle: '首长和太子', matchReason: 'exact-title' }),
    change({ localChapterId: 'm1', localOrder: 5, oldTitle: '旧名一', newTitle: '新名一', eligible: false, confidence: 'medium', matchReason: 'sequence' }),
  ]
  const { rerender, onFieldsChange, onConfirmedManualIdsChange } = renderPreview({ changes })
  expect(screen.getByRole('heading', { name: /可更新 1 个章节名/ })).toBeInTheDocument()
  expect(screen.getByText(/1 个可自动更新；1 个需人工核对，已确认 0 个。未确认的标题保持原样。/)).toBeInTheDocument()
  rerender(<ChapterMergePreview
    preview={{ ...preview, changes }} fields={[]} onFieldsChange={onFieldsChange}
    confirmedManualIds={new Set(['m1'])} onConfirmedManualIdsChange={onConfirmedManualIdsChange}
    disabled={false} onRemap={vi.fn()} onSelectedMappingsChange={vi.fn()}
  />)
  expect(screen.getByRole('heading', { name: /可更新 2 个章节名/ })).toBeInTheDocument()
  expect(screen.getByText('已人工确认 1 / 1 个标题')).toBeInTheDocument()
  // 已确认的项无需再次勾选，确认按钮随之停用（剩余未确认数为 0）。
  expect(screen.getByRole('button', { name: '确认本页 0 项' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '确认全部筛选结果 0 项' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: '确认更新第 5 章' })).toBeChecked()
})

it('人工指定的映射仍留在人工核对分组，不因 eligible 放宽被自动应用', () => {
  const manual = change({ localChapterId: 'manual', localOrder: 30, oldTitle: '甲', newTitle: '乙', eligible: false, confidence: 'high', matchReason: 'manual', matchEvidence: '管理员指定的对应关系，应用标题前仍需勾选确认。' })
  renderPreview({ changes: [manual] })
  expect(screen.getByRole('button', { name: '人工核对 1' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '确认更新第 30 章' })).not.toBeChecked()
  expect(screen.queryByText(/自动更新：/)).not.toBeInTheDocument()
})

it('没有标题变化时显示完成状态，未匹配章仍引导核对且不渲染空表头', () => {
  renderPreview({ changes: [], unmatchedLocal: [{id:'game',order:112,title:'游戏'}] })
  expect(screen.getByText('已匹配章节暂无需要同步的章节名。')).toBeInTheDocument()
  expect(screen.getByText('仍有 1 个本地章节未匹配，可继续核对映射。')).toBeInTheDocument()
  expect(screen.queryByText('原章节名', {exact:true})).not.toBeInTheDocument()
  expect(screen.queryByRole('group', {name:'标题变化筛选'})).not.toBeInTheDocument()
})
