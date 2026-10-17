import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BookImportAiReview, BookImportPreview } from '@shared/types'
const api = vi.hoisted(() => ({ previewFile: vi.fn(), selectTarget: vi.fn(), aiReview: vi.fn(), applyAiReview: vi.fn(), commit: vi.fn(), getPreview: vi.fn() }))
vi.mock('@/lib/api', () => ({ bookImportApi: api }))
import BookImportDialog from './BookImportDialog'
const original: BookImportPreview = {
  runId: 'run',
  revision: 0,
  sourceType: 'file',
  sourceLabel: '样本.txt',
  sourceUrl: '',
  canResplit: true,
  book: { title: '样本', author: '作者', chapters: [{ title: '第一章', order: 1, content: '正文' }] },
  candidates: [],
  targetNovelId: null,
  targetNovel: null,
  metadataDiff: [],
  warnings: [],
  chapters: [
    { id: 'chapter', status: 'new', incomingOrder: 1, incomingTitle: '第一章', incomingContent: '正文', confidence: 'high', reason: '新增', selected: true },
  ],
  summary: { newCount: 1, changedCount: 0, unchangedCount: 0, conflictCount: 0 },
  diagnostics: {
    stats: {
      parser: 'text',
      totalLines: 4,
      headingLines: 1,
      volumeHeadingLines: 0,
      mergedHeadingLines: 0,
      frontMatterLines: 2,
      droppedEmptyChapters: 0,
      chapterCount: 1,
      chapterChars: { min: 2, median: 2, max: 2 },
      frontMatterChars: 4,
      numbering: { detected: 1, min: 1, max: 1, missing: 0, duplicated: 0 },
    },
    uncertain: [{ line: 1, raw: '序章', verdict: 'prose', rule: 'prose', confidence: 'low', rejectedBy: 'unnumbered-heading-shape' }],
    uncertainTotal: 1,
    anomalies: [],
    heuristicVersion: 2,
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollTo = vi.fn()
  api.previewFile.mockResolvedValue(structuredClone(original))
})
it('附加源直接核对章节，作品信息禁用且提交不携带元数据修改', async () => {
  api.commit.mockRejectedValue(new Error('测试停止提交'))
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={{...original,targetNovelId:'bound-book',supplementary:{bindingId:'binding',fileKey:'file'}}}/>)
  expect(screen.getByRole('tab',{name:/作品信息/})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:/确认导入/}))
  await waitFor(()=>expect(api.commit).toHaveBeenCalledWith('run',expect.objectContaining({targetNovelId:'bound-book',metadataFields:[]})))
})
async function openDiff() {
  render(<BookImportDialog open onOpenChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('选择书籍文件'), { target: { files: [new File(['序章'], '样本.txt', { type: 'text/plain' })] } })
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
  fireEvent.click(await screen.findByRole('button', { name: '查看差异' }))
  fireEvent.mouseDown(await screen.findByRole('tab', { name: '解析检查' }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole('button', { name: /展开明细/ }))
}
it('唯一候选也可以改为新建作品，并使用新目标预览提交', async () => {
  const novel = { id: 'older-book', title: '样本', author: '作者', chapterCount: 10 } as NonNullable<BookImportPreview['targetNovel']>
  api.previewFile.mockResolvedValue({ ...original, candidates: [{ novel, matchReason: 'title-author', score: 95 }], targetNovelId: novel.id, targetNovel: novel })
  api.selectTarget.mockResolvedValue({ ...original, revision: 1 })
  api.commit.mockRejectedValue(new Error('测试停止提交'))
  render(<BookImportDialog open onOpenChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('选择书籍文件'), { target: { files: [new File(['正文'], '样本.txt')] } })
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
  fireEvent.click(await screen.findByRole('button', { name: /新建作品/ }))
  fireEvent.click(screen.getByRole('button', { name: '查看差异' }))
  await screen.findByText(/提交后会创建新的书库作品/)
  expect(api.selectTarget).toHaveBeenCalledWith('run', null, 0)
  fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))
  await screen.findByText('测试停止提交')
  expect(api.commit).toHaveBeenCalledWith('run', expect.objectContaining({ targetNovelId: null, revision: 1 }))
})
it('复核期间禁止提交和返回，完成后使用新版本逐条采纳并提示重新核对', async () => {
  let resolve!: (review: BookImportAiReview) => void
  api.aiReview.mockImplementation(
    () =>
      new Promise<BookImportAiReview>((done) => {
        resolve = done
      }),
  )
  api.applyAiReview.mockResolvedValue({
    ...original,
    revision: 2,
    aiReview: null,
    boundaryOverrides: [{ line: 1, verdict: 'heading', source: 'ai', updatedAt: 1 }],
  })
  await openDiff()
  fireEvent.click(screen.getByRole('button', { name: '运行 AI 复核' }))
  expect(screen.getByRole('button', { name: /确认导入/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: '返回' })).toBeDisabled()
  expect(screen.getByRole('tab', { name: /章节差异/ })).toBeDisabled()
  await act(async () =>
    resolve({
      revision: 1,
      reviewedAt: 1,
      model: 'm',
      heuristicVersion: 2,
      candidateCount: 1,
      projectedChapterCount: 2,
      reviewedLines: [1],
      suggestions: [{ line: 1, raw: '序章', heuristic: 'prose', verdict: 'heading', confidence: 'low', reason: '待复核' }],
      usage: { promptTokens: 1, completionTokens: 1, costMillicents: 0 },
    }),
  )
  expect(api.aiReview).toHaveBeenCalledWith('run', 0)
  fireEvent.click(screen.getByRole('button', { name: /按建议重新识别章节/ }))
  await screen.findByText(/章节和作品信息的勾选已重置/)
  expect(api.applyAiReview).toHaveBeenCalledWith('run', 1, [1])
})
it('预览版本冲突提供刷新入口，刷新后重新核对', async () => {
  api.aiReview.mockRejectedValue(new Error('预览版本已变化，请重新预览'))
  api.getPreview.mockResolvedValue({ ...original, revision: 3 })
  await openDiff()
  fireEvent.click(screen.getByRole('button', { name: '运行 AI 复核' }))
  fireEvent.click(await screen.findByRole('button', { name: '加载最新预览' }))
  await screen.findByText('已加载最新预览，请重新核对勾选。')
  expect(api.getPreview).toHaveBeenCalledWith('run')
})
