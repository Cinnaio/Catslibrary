import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ index: vi.fn(), list: vi.fn(), get: vi.fn(), update: vi.fn(), batchDelete: vi.fn(), toast: vi.fn(), illustrations: vi.fn(), saveIllustration: vi.fn(), sourcePreview: vi.fn(), sourceApply: vi.fn(), sourceRefresh: vi.fn(), sourceRemap: vi.fn(), confirm: vi.fn() }))
vi.mock('../../lib/api', () => ({ adminApi: { novelIndex: mocks.index }, chaptersApi: { list: mocks.list, get: mocks.get, update: mocks.update, batchDelete: mocks.batchDelete }, illustrationsApi: { list: mocks.illustrations, save: mocks.saveIllustration, imageBlob: async () => new Blob() }, scrapeApi: { sourceSyncPreview: mocks.sourcePreview, sourceSyncApply: mocks.sourceApply, sourceSyncRefresh: mocks.sourceRefresh, sourceSyncRemap: mocks.sourceRemap }, newOperationId: () => 'test' }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: mocks.confirm }) }))
vi.mock('../../components/admin/CustomSelect', () => ({ default: ({ options, onChange }: any) => <select aria-label="选择小说" onChange={e => onChange(e.target.value)}><option value="" />{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
import ChaptersTab from './ChaptersTab'
import { hashParagraphText } from '@shared/thought-anchor'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.index.mockResolvedValue({ novels: [{ id: 'n', title: '测试书', author: '', chapterCount: 1 }] })
  mocks.list.mockResolvedValue({ chapters: [{ id: 'c', novelId: 'n', title: '原章', order: 1, wordCount: 3, createdAt: 1 }] })
  mocks.update.mockResolvedValue({})
  mocks.confirm.mockResolvedValue(true)
  mocks.illustrations.mockResolvedValue({ illustrations: [], chapterRevision: 'revision', contentHash: hashParagraphText('原正文') })
})
it('融合标题没有变化时仍可单独修复序号，默认不勾选且提交前明确确认', async () => {
  mocks.sourcePreview.mockResolvedValue({
    runId: 'sync-order', site: 'po18tw', sourceChapterCount: 46, localChapterCount: 46, matchedSourceCount: 46,
    metadata: { title: '', author: '', description: '', coverUrl: '', categories: [], status: '' },
    changes: [], mappings: [{ sourceChapterKey: 'source-notice', sourceOrder: 45, sourceTitle: '不行了，累累', localChapterIds: ['notice'], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title' }], unmatchedSource: [], unmatchedLocal: [], warnings: [],
    localChapters: [{ id: 'notice', order: 46, title: '不行了，累累' }], sourceChapters: [{ key: 'source-notice', order: 45, title: '不行了，累累' }],
    orderChanges: [{ localChapterId: 'notice', title: '不行了，累累', oldOrder: 46, newOrder: 45 }],
  })
  mocks.sourceApply.mockResolvedValue({ updated: 0, orderUpdated: 1, metadataUpdated: [], mappings: 46 })
  render(<ChaptersTab />)
  await screen.findByRole('option', { name: '测试书' })
  fireEvent.change(screen.getByLabelText('选择小说'), { target: { value: 'n' } })
  fireEvent.click(await screen.findByRole('button', { name: '融合章节名' }))
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  await screen.findByText('核对与调整映射')
  expect(screen.queryByRole('checkbox', { name: /按源站修复/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '章节序号修复' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '同步小说信息' })).toBeDisabled()
  fireEvent.click(screen.getByText('核对与调整映射'))
  const checkbox = screen.getByRole('checkbox', { name: '选择映射：本地 46' })
  expect(checkbox).not.toBeChecked()
  expect(screen.getByText('序号 46 → 45 · 勾选后修复')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 1 项' }))
  expect(checkbox).toBeChecked()
  expect(screen.getByText('序号 46 → 45 · 已选，将修复')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '应用已选更新' }))
  await waitFor(() => expect(mocks.sourceApply).toHaveBeenCalledWith(expect.objectContaining({ runId: 'sync-order', repairOrder: true, confirmedOrderIds: ['notice'], applyMetadata: false })))
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('修复 1 个章节序号') }))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('修复 1 个章节序号'), 'success'))
})
async function open() {
  render(<ChaptersTab />)
  await screen.findByRole('option', { name: '测试书' })
  fireEvent.change(screen.getByLabelText('选择小说'), { target: { value: 'n' } })
  fireEvent.click(await screen.findByRole('button', { name: '编辑：第1章 原章' }))
}
it('正文加载失败后禁止保存，不能覆盖原文', async () => {
  mocks.get.mockRejectedValue(new Error('offline'))
  await open()
  await waitFor(() => expect(mocks.get).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('加载中…')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /^保存$/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  expect(mocks.update).not.toHaveBeenCalled()
})
it('成功加载后允许有意清空正文并保存', async () => {
  mocks.get.mockResolvedValue({ chapter: { content: '原正文' } })
  await open()
  const content = await screen.findByPlaceholderText('章节正文…')
  await waitFor(() => expect(content).toHaveValue('原正文'))
  fireEvent.change(content, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('c', { novelId: 'n', title: '原章', content: '', order: 1 }))
})
it('章节管理可以预览和添加插图，草稿正文未保存时禁止定位', async () => {
  mocks.get.mockResolvedValue({ chapter: { content: '原正文' } })
  await open()
  const content = await screen.findByPlaceholderText('章节正文…')
  await waitFor(() => expect(content).toHaveValue('原正文'))
  fireEvent.click(screen.getByRole('button', { name: '预览与管理插图' }))
  await screen.findByRole('button', { name: '在第 1 段后插图' })
  fireEvent.change(content, { target: { value: '未保存的新正文' } })
  await screen.findByText('正文与已保存章节不同，请先保存正文并重新打开，或重新加载阅读页面。')
  expect(screen.queryByRole('button', { name: '在第 1 段后插图' })).not.toBeInTheDocument()
  expect(mocks.saveIllustration).not.toHaveBeenCalled()
})
it('插图弹窗的保存快捷键只保存插图，不提交或关闭父章节弹窗', async () => {
  mocks.get.mockResolvedValue({ chapter: { content: '原正文' } })
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  mocks.saveIllustration.mockImplementation(async (_chapter, _id, metadata) => ({ ...metadata, id: 'image', chapterId: 'c', assetId: 'asset', width: 20, height: 10, version: 1, order: 1 }))
  await open()
  await waitFor(() => expect(screen.getByPlaceholderText('章节正文…')).toHaveValue('原正文'))
  fireEvent.click(screen.getByRole('button', { name: '预览与管理插图' }))
  fireEvent.click(await screen.findByRole('button', { name: '在第 1 段后插图' }))
  fireEvent.change(screen.getByLabelText('选择图片（也可以在此粘贴）'), { target: { files: [new File(['png'], 'image.png', { type: 'image/png' })] } })
  fireEvent.keyDown(screen.getByLabelText('图注（可选）'), { key: 'Enter', ctrlKey: true })
  await waitFor(() => expect(mocks.saveIllustration).toHaveBeenCalledTimes(1))
  expect(mocks.update).not.toHaveBeenCalled()
  expect(screen.getByPlaceholderText('章节正文…')).toBeInTheDocument()
})


it('全选映射直接加入标题及序号同步，小说信息默认不选且重开时清空', async () => {
  mocks.sourcePreview.mockResolvedValue({
    runId: 'sync-selection', site: 'po18tw', sourceChapterCount: 2, localChapterCount: 2, matchedSourceCount: 2,
    metadata: { title: '源站书名', author: '源站作者', description: '简介', coverUrl: 'https://example.com/cover.png', categories: ['分类'], status: 'ongoing' },
    changes: [{ localChapterId: 'b', localOrder: 4, oldTitle: '旧名', newTitle: '新名', eligible: false, confidence: 'low', partCount: 1 }],
    mappings: [
      { sourceChapterKey: 'sa', sourceOrder: 1, sourceTitle: '相同标题', localChapterIds: ['a'], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title' },
      { sourceChapterKey: 'sb', sourceOrder: 2, sourceTitle: '新名', localChapterIds: ['b'], relation: 'one_to_one', confidence: 'low', matchReason: 'sequence' },
    ],
    localChapters: [{ id: 'a', order: 3, title: '相同标题' }, { id: 'b', order: 4, title: '旧名' }],
    sourceChapters: [{ key: 'sa', order: 1, title: '相同标题' }, { key: 'sb', order: 2, title: '新名' }],
    unmatchedSource: [], unmatchedLocal: [], warnings: [],
    orderChanges: [{ localChapterId: 'a', title: '相同标题', oldOrder: 3, newOrder: 1 }],
  })
  mocks.sourceApply.mockResolvedValue({ updated: 1, orderUpdated: 1, metadataUpdated: [] })
  render(<ChaptersTab />)
  await screen.findByRole('option', { name: '测试书' })
  fireEvent.change(screen.getByLabelText('选择小说'), { target: { value: 'n' } })
  fireEvent.click(await screen.findByRole('button', { name: '融合章节名' }))
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  await screen.findByText('可更新', { exact: false })
  fireEvent.click(screen.getByText('同步小说信息', { selector: 'summary' }))
  for (const name of ['书名', '作者', '简介', '封面链接', '分类', '状态']) {
    expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
  }
  fireEvent.click(screen.getByText('核对与调整映射'))
  expect(screen.getByRole('button', { name: '同步小说信息' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 2 项' }))
  expect(screen.getByText('1 个标题待更新 · 1 个序号修复 · 0 项信息同步')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择映射：本地 3' }))
  expect(screen.getByText('1 个标题待更新 · 0 个序号修复 · 0 项信息同步')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '清空映射选择' }))
  expect(screen.getByRole('button', { name: '同步小说信息' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 2 项' }))
  fireEvent.click(screen.getByRole('button', { name: '应用已选更新' }))
  await waitFor(() => expect(mocks.sourceApply).toHaveBeenCalledWith(expect.objectContaining({
    confirmedChangeIds: ['b'], repairOrder: true, confirmedOrderIds: ['a'], applyMetadata: false, metadataFields: [],
  })))
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('修复 1 个章节序号') }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '应用已选更新' })).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '融合章节名' }))
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  await screen.findByText('可更新', { exact: false })
  fireEvent.click(screen.getByText('同步小说信息', { selector: 'summary' }))
  fireEvent.click(screen.getByRole('button', { name: '全选可用字段' }))
  expect(screen.getByRole('checkbox', { name: '书名' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: /^取消$/ }))
  fireEvent.click(screen.getByRole('button', { name: '融合章节名' }))
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  await screen.findByText('可更新', { exact: false })
  fireEvent.click(screen.getByText('同步小说信息', { selector: 'summary' }))
  expect(screen.getByRole('checkbox', { name: '书名' })).not.toBeChecked()
})

it('102章含未匹配项时全选35项差异，可以提交30个可修复序号并显示5项未修复原因', async () => {
  const shape = (await import('@shared/__fixtures__/source-sync-partial.json')).default
  const localChapters = shape.locals.map((row, i) => ({ id: `partial-${i}`, order: row.order, title: row.sourceOrder === null ? `未匹配公告 ${i}` : `测试故事 ${row.sourceOrder}` }))
  const mappings = shape.locals.flatMap((row, i) => row.sourceOrder === null ? [] : [{ sourceChapterKey: `s${row.sourceOrder}`, sourceOrder: row.sourceOrder, sourceTitle: localChapters[i]!.title, localChapterIds: [localChapters[i]!.id], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title' }])
  const skippedOrders = [80, 81, 87, 85, 83]
  const orderChanges = shape.locals.flatMap((row, i) => row.sourceOrder === null || row.sourceOrder === row.order || skippedOrders.includes(row.order) ? [] : [{ localChapterId: localChapters[i]!.id, title: localChapters[i]!.title, oldOrder: row.order, newOrder: row.sourceOrder }])
  mocks.sourcePreview.mockResolvedValue({
    runId: 'partial-order-run', site: 'po18tw', sourceChapterCount: 106, localChapterCount: 102, matchedSourceCount: 99,
    metadata: { title: '源站书名', author: '源站作者', description: '', coverUrl: '', categories: [], status: 'ongoing' },
    changes: [], mappings, localChapters,
    sourceChapters: shape.sourceOrders.map(order => ({ key: `s${order}`, order, title: `测试故事 ${order}` })),
    unmatchedSource: [], unmatchedLocal: localChapters.filter((_, i) => shape.locals[i]!.sourceOrder === null), warnings: [],
    orderChanges, orderRepairSkipped: localChapters.filter(row => skippedOrders.includes(row.order)).map(row => ({localChapterId: row.id, reason: '未匹配或目标序号占用'})),
  })
  mocks.sourceApply.mockResolvedValue({ updated: 0, orderUpdated: 30, metadataUpdated: [] })
  render(<ChaptersTab />)
  await screen.findByRole('option', { name: '测试书' })
  fireEvent.change(screen.getByLabelText('选择小说'), { target: { value: 'n' } })
  fireEvent.click(await screen.findByRole('button', { name: '融合章节名' }))
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  await screen.findByText('核对与调整映射')
  expect(screen.queryByRole('checkbox', { name: /按源站修复/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: '有差异 35' }))
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 35 项' }))
  expect(screen.getByText('0 个标题待更新 · 30 个序号修复 · 0 项信息同步')).toBeInTheDocument()
  expect(screen.getByText(/所选映射中 5 项暂不修复序号/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '应用已选更新' }))
  await waitFor(() => expect(mocks.sourceApply).toHaveBeenCalledWith(expect.objectContaining({ repairOrder: true, confirmedOrderIds: orderChanges.map(row => row.localChapterId).sort(), applyMetadata: false })))
})

it('小说管理嵌入入口无需加载全库索引，直接使用当前作品并可关闭', async () => {
  const close = vi.fn()
  render(<ChaptersTab mergeNovel={{ id: 'outside-index', title: '索引外的作品', author: '原作者', chapterCount: 88 }} onMergeClose={close} />)
  expect(await screen.findByRole('heading', { name: '融合章节名' })).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveTextContent('索引外的作品')
  expect(screen.getByRole('dialog')).toHaveTextContent('原作者 · 88 章')
  expect(mocks.index).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(close).toHaveBeenCalledTimes(1)
})
it('嵌入融合应用成功通知小说列表刷新并关闭，不加载章节管理列表', async () => {
  const applied = vi.fn(), close = vi.fn()
  mocks.sourcePreview.mockResolvedValue({ runId: 'embedded', site: 'po18tw', sourceChapterCount: 1, localChapterCount: 1, matchedSourceCount: 1,
    metadata: { title: '', author: '', description: '', coverUrl: '', categories: [], status: '' }, changes: [{ localChapterId: 'c', oldTitle: '原章', newTitle: '新章', eligible: true }],
    mappings: [], unmatchedSource: [], unmatchedLocal: [], warnings: [], localChapters: [], sourceChapters: [], orderChanges: [] })
  mocks.sourceApply.mockResolvedValue({ updated: 1, orderUpdated: 0, metadataUpdated: [], mappings: 1 })
  render(<ChaptersTab mergeNovel={{ id: 'n', title: '测试书', author: '', chapterCount: 1 }} onMergeClose={close} onMergeApplied={applied} />)
  await screen.findByRole('heading', { name: '融合章节名' })
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  fireEvent.click(await screen.findByRole('button', { name: '更新 1 个标题' }))
  await waitFor(() => expect(applied).toHaveBeenCalledTimes(1))
  expect(close).toHaveBeenCalledTimes(1)
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.sourcePreview).toHaveBeenCalledWith(expect.objectContaining({ novelId: 'n' }))
})

function workflowPreview(runId = 'workflow') {
  return {
    runId, revision: 0, site: 'po18tw', sourceChapterCount: 1, localChapterCount: 2, matchedSourceCount: 1,
    metadata: { title: '', author: '', description: '', coverUrl: '', categories: [], status: '' },
    changes: [{ localChapterId: 'c', localOrder: 1, oldTitle: '第1章', newTitle: '开始', eligible: true, confidence: 'high' }],
    mappings: [{ sourceChapterKey: 's1', sourceOrder: 1, sourceTitle: '开始', localChapterIds: ['c'], relation: 'one_to_one', confidence: 'high', matchReason: 'chapter-number' }],
    unmatchedSource: [], unmatchedLocal: [{ id: 'junk', order: 2, title: '混入的其他作品' }], warnings: [],
    localChapters: [{ id: 'c', order: 1, title: '第1章' }, { id: 'junk', order: 2, title: '混入的其他作品' }],
    sourceChapters: [{ key: 's1', order: 1, title: '开始', url: '' }], orderChanges: [],
  }
}
async function openWorkflow(preview = workflowPreview()) {
  const close = vi.fn(), applied = vi.fn()
  mocks.sourcePreview.mockResolvedValue(preview)
  render(<ChaptersTab mergeNovel={{ id: 'n', title: '测试书', author: '', chapterCount: 2 }} onMergeClose={close} onMergeApplied={applied} />)
  await screen.findByRole('heading', { name: '融合章节名' })
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/902326' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  fireEvent.click(await screen.findByText('核对与调整映射'))
  return { close, applied }
}
it('融合内预览正文并批量删除杂章后重新匹配，保留弹窗及不变的同步选择', async () => {
  mocks.get.mockResolvedValue({ chapter: { content: '这是混入的其他作品正文' } })
  mocks.batchDelete.mockResolvedValue({ ok: true })
  const next = workflowPreview('cleaned')
  mocks.sourceRefresh.mockResolvedValue({ ...next, localChapterCount: 1, localChapters: [next.localChapters[0]], unmatchedLocal: [] })
  const { close, applied } = await openWorkflow()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择映射：本地 1' }))
  fireEvent.click(screen.getByRole('button', { name: '预览正文：本地 2' }))
  expect(await screen.findByText('这是混入的其他作品正文')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '返回核对' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '标记删除：本地 2' }))
  expect(screen.getByRole('button', { name: '更新 1 个标题' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '删除 1 个杂章并重新匹配' }))
  await waitFor(() => expect(mocks.sourceRefresh).toHaveBeenCalledWith({ runId: 'workflow', revision: 0 }))
  expect(mocks.batchDelete).toHaveBeenCalledWith('n', ['junk'], 'test')
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, items: ['本地 2 · 混入的其他作品'] }))
  await waitFor(() => expect(screen.queryByText('本地 2 · 混入的其他作品')).not.toBeInTheDocument())
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 1' })).toBeChecked()
  expect(screen.getByRole('button', { name: '更新 1 个标题' })).toBeEnabled()
  expect(close).not.toHaveBeenCalled()
  expect(applied).toHaveBeenCalledTimes(1)
  expect(mocks.sourcePreview).toHaveBeenCalledTimes(1)
})
it('取消杂章删除保留选择，不发送删除或重新读取源站请求', async () => {
  mocks.confirm.mockResolvedValueOnce(false)
  await openWorkflow()
  fireEvent.click(screen.getByRole('checkbox', { name: '标记删除：本地 2' }))
  fireEvent.click(screen.getByRole('button', { name: '删除 1 个杂章并重新匹配' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  expect(mocks.batchDelete).not.toHaveBeenCalled()
  expect(mocks.sourceRefresh).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: '标记删除：本地 2' })).toBeChecked()
})
it('杂章已删除但重新匹配失败时禁用旧预览，重试匹配不重复删除', async () => {
  mocks.batchDelete.mockResolvedValue({ ok: true })
  mocks.sourceRefresh.mockRejectedValueOnce(new Error('临时错误'))
  const next = workflowPreview('retried')
  mocks.sourceRefresh.mockResolvedValueOnce({ ...next, localChapters: [next.localChapters[0]], unmatchedLocal: [] })
  await openWorkflow()
  fireEvent.click(screen.getByRole('checkbox', { name: '标记删除：本地 2' }))
  fireEvent.click(screen.getByRole('button', { name: '删除 1 个杂章并重新匹配' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('临时错误')
  expect(screen.getByRole('button', { name: '更新 1 个标题' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '按本地最新目录重新匹配' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(mocks.batchDelete).toHaveBeenCalledTimes(1)
  expect(mocks.sourceRefresh).toHaveBeenCalledTimes(2)
})
it('应用后继续核对复用源站目录生成新预览，不关闭且不重复提交旧更新', async () => {
  mocks.sourceApply.mockResolvedValue({ updated: 1, metadataUpdated: [], mappings: 1 })
  const next = workflowPreview('continued')
  mocks.sourceRefresh.mockResolvedValue({ ...next, localChapters: [{ id: 'c', order: 1, title: '开始' }, next.localChapters[1]], changes: [] })
  const { close, applied } = await openWorkflow()
  fireEvent.click(screen.getByRole('button', { name: '应用后继续核对' }))
  await waitFor(() => expect(mocks.sourceRefresh).toHaveBeenCalledWith({ runId: 'workflow', revision: 0 }))
  await waitFor(() => expect(screen.getByRole('button', { name: '应用后继续核对' })).toBeDisabled())
  expect(close).not.toHaveBeenCalled()
  expect(applied).toHaveBeenCalledTimes(1)
  expect(mocks.sourceApply).toHaveBeenCalledTimes(1)
  expect(mocks.sourcePreview).toHaveBeenCalledTimes(1)
  expect(screen.getByText('本地 1 · 开始')).toBeVisible()
})
it('保存映射保留展开与搜索以及未受影响的确认，仅清除已变化的映射选择', async () => {
  const preview = workflowPreview()
  preview.changes[0]!.eligible = false
  preview.changes.push({ localChapterId: 'junk', localOrder: 2, oldTitle: '混入的其他作品', newTitle: '第二章', eligible: false, confidence: 'high' })
  preview.mappings.push({ sourceChapterKey: 's2', sourceOrder: 2, sourceTitle: '第二章', localChapterIds: ['junk'], relation: 'one_to_one', confidence: 'high', matchReason: 'chapter-number' })
  preview.sourceChapters.push({ key: 's2', order: 2, title: '第二章', url: '' })
  mocks.sourceRemap.mockResolvedValue({ ...preview, revision: 1,
    changes: [{ ...preview.changes[0], newTitle: '新的对应章' }, preview.changes[1]],
    mappings: [{ ...preview.mappings[0], sourceTitle: '新的对应章' }, preview.mappings[1]],
  })
  await openWorkflow({ ...preview, manualMappings: [{ localChapterId: 'c', sourceChapterKey: 's1' }] } as ReturnType<typeof workflowPreview>)
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 2 项' }))
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '第1章' } })
  fireEvent.click(screen.getByRole('button', { name: '恢复自动匹配' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '更新 1 个标题' })).toBeEnabled())
  expect(screen.getByLabelText('搜索本地章节映射')).toHaveValue('第1章')
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 1' })).not.toBeChecked()
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '' } })
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 2' })).toBeChecked()
})
it('暂存映射未保存时禁止应用，放弃暂存后恢复原有更新', async () => {
  await openWorkflow()
  fireEvent.click(screen.getByRole('button', { name: '调整映射：本地 2' }))
  fireEvent.click(screen.getByRole('button', { name: '暂存映射调整' }))
  expect(screen.getByRole('button', { name: '更新 1 个标题' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '按本地最新目录重新匹配' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '放弃暂存调整' }))
  expect(screen.getByRole('button', { name: '更新 1 个标题' })).toBeEnabled()
  expect(mocks.sourceRemap).not.toHaveBeenCalled()
})
