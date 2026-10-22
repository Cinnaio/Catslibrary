import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BookImportAiReview, BookImportPreview } from '@shared/types'

// 章节核对里的共享下拉走 Popover + cmdk，jsdom 缺这两个浏览器 API。
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined
const api = vi.hoisted(() => ({ previewZip: vi.fn(), previewFile: vi.fn(), selectTarget: vi.fn(), aiReview: vi.fn(), applyAiReview: vi.fn(), commit: vi.fn(), getPreview: vi.fn(), resolveChapter: vi.fn() }))
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
it('同章不同正文版本互斥选择，提交只携带最后确认的版本', async () => {
  const chapters = [
    { ...original.chapters[0]!, id: 'version-a', incomingTitle: '第1章 初见（版本一）', selected: false, variantGroup: 'same-chapter' },
    { ...original.chapters[0]!, id: 'version-b', incomingTitle: '第1章 初见（版本二）', selected: false, variantGroup: 'same-chapter' },
  ]
  api.commit.mockRejectedValue(new Error('测试停止提交'))
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={{ ...original, chapters, summary: { ...original.summary, newCount: 2 } }} />)
  fireEvent.mouseDown(screen.getByRole('tab', { name: /章节差异/ }), { button: 0, ctrlKey: false })
  const first = screen.getByRole('checkbox', { name: '新增章节：第1章 初见（版本一）' })
  const second = screen.getByRole('checkbox', { name: '新增章节：第1章 初见（版本二）' })
  fireEvent.click(first)
  expect(first).toBeChecked()
  fireEvent.click(second)
  expect(first).not.toBeChecked()
  expect(second).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))
  await waitFor(() => expect(api.commit).toHaveBeenCalledWith('run', expect.objectContaining({ selectedChapterIds: ['version-b'] })))
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

it('需确认章节保持保护，并提供可见的核对处理入口', async () => {
  const chapter = { ...original.chapters[0]!, id: 'blocked-middle', status: 'conflict' as const, selected: false, incomingTitle: '第0058章 56、总是发情', reason: '新增条目位于已有章节之间，或没有可靠的本地对应关系，请先核对边界与融合映射' }
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={{ ...original, targetNovelId: 'bound-book', supplementary: { bindingId: 'binding', fileKey: 'file' }, chapters: [chapter], summary: { newCount: 0, changedCount: 0, unchangedCount: 0, conflictCount: 1 } }} />)
  expect(screen.getByRole('checkbox', { name: `需确认章节：${chapter.incomingTitle}` })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /第0058章/ }))
  expect(screen.getByRole('button', { name: '核对章节对应关系' })).toBeEnabled()
})

it('人工确认新章位置后更新预览并解锁勾选，最终确认前不写入章节', async () => {
  const conflict = { ...original.chapters[0]!, id: 'chapter-2', status: 'conflict' as const, selected: false, incomingTitle: '第0058章 56、总是发情', reason: '中间未匹配章节' }
  const localChapters = [{ id: 'before', title: '前一章', order: 57 }, { id: 'after', title: '后一章', order: 58 }]
  const preview = { ...original, targetNovelId: 'bound', supplementary: { bindingId: 'binding', fileKey: 'file' }, chapters: [conflict], localChapters, summary: { newCount: 0, changedCount: 0, unchangedCount: 0, conflictCount: 1 } }
  api.resolveChapter.mockResolvedValue({ ...preview, revision: 1, chapterResolutions: [{ chapterId: 'chapter-2', action: 'insert', afterChapterId: 'before' }], chapters: [{ ...conflict, status: 'new', selected: true, incomingOrder: 58 }], summary: original.summary })
  api.commit.mockRejectedValue(new Error('测试停止写入'))
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={preview} />)
  fireEvent.click(screen.getByRole('button', { name: '核对章节对应关系' }))
  fireEvent.click(screen.getByRole('radio', { name: '这是新增章节' }))
  fireEvent.click(screen.getByRole('combobox', { name: '插入位置' }))
  fireEvent.click(screen.getByRole('option', { name: /放在后面：57 · 前一章/ }))
  expect(screen.getByRole('combobox', { name: '插入位置' })).toHaveTextContent(/放在后面：57 · 前一章/)
  expect(screen.getByText(/预计新增序号：58/)).toBeVisible()
  expect(screen.getByText('预计顺延 1 个已有章节的序号')).toBeVisible()
  expect(api.commit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存确认并更新预览' }))
  const checkbox = await screen.findByRole('checkbox', { name: '新增章节：第0058章 56、总是发情' })
  expect(checkbox).toBeEnabled()
  expect(checkbox).toBeChecked()
  expect(api.resolveChapter).toHaveBeenCalledWith('run', { chapterId: 'chapter-2', action: 'insert', afterChapterId: 'before', revision: 0 })
  expect(api.commit).not.toHaveBeenCalled()
  fireEvent.click(checkbox)
  expect(screen.getByRole('button', { name: /确认导入/ })).toBeDisabled()
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))
  await waitFor(() => expect(api.commit).toHaveBeenCalledWith('run', expect.objectContaining({ revision: 1, selectedChapterIds: ['chapter-2'], metadataFields: [], targetNovelId: 'bound' })))
})
it('人工确认请求失败保留处理选择，并提供重新读取本地章节入口', async () => {
  const chapter = { ...original.chapters[0]!, status: 'conflict' as const, selected: false }
  api.resolveChapter.mockRejectedValue(new Error('本地章节已变化，请重新生成预览'))
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={{ ...original, targetNovelId: 'bound', localChapters: [{ id: 'local', title: '本地第一章', order: 1 }], chapters: [chapter] }} />)
  fireEvent.click(screen.getByRole('button', { name: '核对章节对应关系' }))
  fireEvent.click(screen.getByRole('radio', { name: '对应已有章节' }))
  fireEvent.click(screen.getByRole('combobox', { name: '对应的本地章节' }))
  fireEvent.click(screen.getByRole('option', { name: /1 · 本地第一章/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存确认并更新预览' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('本地章节已变化')
  expect(screen.getByRole('combobox', { name: '对应的本地章节' })).toHaveTextContent('1 · 本地第一章')
  expect(screen.getByRole('button', { name: '重新读取本地章节' })).toBeEnabled()
  expect(screen.getByRole('checkbox', { name: '需确认章节：第一章' })).toBeDisabled()
})

it('旧预览先重新读取本地章节，再打开确认入口', async () => {
  const chapter = { ...original.chapters[0]!, status: 'conflict' as const, selected: false }
  const next = { ...original, revision: 2, targetNovelId: 'bound', localChapters: [{ id: 'local', title: '本地第一章', order: 1 }], chapters: [chapter] }
  api.selectTarget.mockResolvedValue(next)
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={{ ...original, targetNovelId: 'bound', chapters: [chapter] }} />)
  fireEvent.click(screen.getByRole('button', { name: '核对章节对应关系' }))
  await screen.findByRole('radio', { name: '这是新增章节' })
  expect(api.selectTarget).toHaveBeenCalledWith('run', 'bound', 0)
  expect(screen.getByText(/已重新读取本地章节，尚未导入/)).toBeVisible()
})

it('连续确认第二章可选择第一章，保留取消勾选并按实际选择提交', async () => {
  const first = { ...original.chapters[0]!, id: 'first', incomingTitle: '补章一', incomingOrder: 58, status: 'new' as const }
  const second = { ...first, id: 'second', incomingTitle: '补章二', incomingOrder: 59, status: 'conflict' as const, selected: false }
  const preview: BookImportPreview = { ...original, revision: 1, targetNovelId: 'book', supplementary: { bindingId: 'binding', fileKey: 'file' }, chapters: [first, second], chapterResolutions: [{ chapterId: 'first', action: 'insert', afterChapterId: 'local' }], localChapters: [{ id: 'local', title: '本地前文', order: 57 }, { id: 'end', title: '本地后文', order: 58 }] }
  api.resolveChapter.mockResolvedValue({ ...preview, revision: 2, chapters: [first, { ...second, status: 'new', selected: true }], chapterResolutions: [...preview.chapterResolutions!, { chapterId: 'second', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'first' }] })
  api.commit.mockRejectedValue(new Error('停止实际写入'))
  render(<BookImportDialog open onOpenChange={vi.fn()} initialPreview={preview} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '新增章节：补章一' }))
  const row = screen.getByRole('checkbox', { name: '需确认章节：补章二' }).closest('.book-import__chapter-row') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: '核对章节对应关系' }))
  fireEvent.click(screen.getByRole('radio', { name: '这是新增章节' }))
  fireEvent.click(screen.getByRole('combobox', { name: '插入位置' }))
  fireEvent.click(screen.getByRole('option', { name: /补章一.*本轮新增，未勾选/ }))
  expect(screen.getByRole('combobox', { name: '插入位置' })).toHaveTextContent(/补章一.*本轮新增，未勾选/)
  expect(screen.getByText(/预计新增序号：58/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存确认并更新预览' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '新增章节：补章二' })).toBeChecked())
  expect(screen.getByRole('checkbox', { name: '新增章节：补章一' })).not.toBeChecked()
  expect(api.resolveChapter).toHaveBeenCalledWith('run', { chapterId: 'second', revision: 1, action: 'insert', afterChapterId: null, afterIncomingChapterId: 'first' })
  expect(screen.getByText('预计导入序号：58')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /确认导入/ }))
  await waitFor(() => expect(api.commit).toHaveBeenCalledWith('run', expect.objectContaining({ selectedChapterIds: ['second'], revision: 2 })))
})

it('ZIP 先展示可选书单，逐本确认并可跳过，不自动提交', async () => {
  const second = { ...structuredClone(original), runId: 'run-two', book: { ...original.book, title: '第二本' } }
  api.previewZip.mockResolvedValue({ previews: [structuredClone(original), second] })
  api.getPreview.mockResolvedValue(second)
  render(<BookImportDialog open onOpenChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('选择书籍文件'), { target: { files: [new File(['zip'], '批量.zip', { type: 'application/zip' })] } })
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
  expect(await screen.findByRole('checkbox', { name: '导入书籍：第二本' })).toBeChecked()
  expect(api.commit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '开始逐本核对' }))
  expect(await screen.findByRole('button', { name: '查看差异' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /跳过本书，查看下一本/ }))
  await waitFor(() => expect(api.getPreview).toHaveBeenCalledWith('run-two'))
  expect(api.commit).not.toHaveBeenCalled()
  expect(await screen.findByText(/第 2 \/ 2 本/)).toBeInTheDocument()
})

it('ZIP 可只选指定一本；提交后再导入清空上一批状态', async () => {
  const second = { ...structuredClone(original), runId: 'only-two', book: { ...original.book, title: '指定作品' } }
  api.previewZip.mockResolvedValue({ previews: [structuredClone(original), second] })
  api.commit.mockResolvedValue({ runId: 'only-two', batchId: 'only-two', novelId: 'new', novelCreated: true, created: 1, updated: 0, skipped: 0, metadataUpdated: [], conflicts: [] })
  render(<BookImportDialog open onOpenChange={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('选择书籍文件'), { target: { files: [new File(['zip'], '批量.zip', { type: 'application/zip' })] } })
  expect(screen.queryByText('补充来源链接')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: '导入书籍：样本' }))
  fireEvent.click(screen.getByRole('button', { name: '开始逐本核对' }))
  fireEvent.click(await screen.findByRole('button', { name: '查看差异' }))
  fireEvent.click(await screen.findByRole('button', { name: /确认导入/ }))
  await waitFor(() => expect(api.commit).toHaveBeenCalledWith('only-two', expect.anything()))
  fireEvent.click(await screen.findByRole('button', { name: '再导入一本' }))
  expect(screen.getByRole('button', { name: '生成预览' })).toBeDisabled()
  expect(screen.queryByLabelText('ZIP 书籍清单')).not.toBeInTheDocument()
})
