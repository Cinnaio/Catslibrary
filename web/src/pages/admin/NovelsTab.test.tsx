import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), toast: vi.fn(), sourcePreview: vi.fn(), sourceApply: vi.fn() }))
vi.mock('../../lib/api', () => ({ adminApi: {}, novelsApi: { list: mocks.list, update: mocks.update }, scrapeApi: { sourceBindings: async () => ({ bindings: [] }), sourceSyncPreview: mocks.sourcePreview, sourceSyncApply: mocks.sourceApply }, authHeaders: () => ({}), url: (x: string) => x, newOperationId: () => 'test' }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }))
vi.mock('../../components/admin/CustomSelect', () => ({ default: ({ options, value, onChange, ...props }: any) => <select aria-labelledby={props['aria-labelledby']} value={value} onChange={e => onChange(e.target.value)}>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
vi.mock('../../components/admin/BookImportDialog', () => ({ default: () => null }))
import NovelsTab from './NovelsTab'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({ novels: [{ id: 'n', title: '测试书', author: '原作者', contentRating: 'general', contentRatingRevision: 7, categories: [] }], total: 1, totalPages: 1 })
  mocks.update.mockResolvedValue({})
})
async function open() {
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑：测试书' }))
}
it('只修改作者不发送旧分级，不覆盖并发审核结果', async () => {
  await open()
  fireEvent.change(screen.getByLabelText('作者'), { target: { value: '新作者' } })
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalled())
  expect(mocks.update.mock.calls[0]![1]).not.toHaveProperty('contentRating')
  expect(mocks.update.mock.calls[0]![1]).toMatchObject({ author: '新作者' })
})
it('修改分级携带打开弹窗时的真实修订号，冲突时保留弹窗和草稿', async () => {
  mocks.update.mockRejectedValueOnce(new Error('作品分级已被其他管理员修改'))
  await open()
  fireEvent.change(screen.getByLabelText('内容分级'), { target: { value: 'restricted' } })
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('n', expect.objectContaining({ contentRating: 'restricted', contentRatingRevision: 7 })))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('分级已被其他管理员修改'), 'error'))
  expect(screen.getByLabelText('内容分级')).toHaveValue('restricted')
})

it('勾选作品后可以打开批量追更设置，范围是已选作品', async () => {
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择小说：测试书' }))
  fireEvent.click(screen.getByRole('button', { name: '批量追更设置' }))
  expect(await screen.findByRole('heading', { name: '批量追更设置' })).toBeInTheDocument()
  expect(screen.getByText('将设置应用到选中的 1 本作品。')).toBeInTheDocument()
})

it('更多操作中的融合章节名直接打开当前作品弹窗，取消后仍保留小说列表', async () => {
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.keyDown(await screen.findByRole('button', { name: '测试书：更多操作' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '融合章节名' }))
  expect(await screen.findByRole('heading', { name: '融合章节名' }, { timeout: 4000 })).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveTextContent('测试书')
  expect(screen.getByRole('dialog')).toHaveTextContent('原作者')
  expect(screen.getByRole('heading', { name: '小说管理', hidden: true })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '章节管理', hidden: true })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('测试书')).toBeVisible()
})

async function openMetadataSync() {
  mocks.sourcePreview.mockResolvedValue({
    runId: 'metadata-only', site: 'po18tw', sourceChapterCount: 0, localChapterCount: 0, matchedSourceCount: 0,
    metadata: { title: '', author: '源站作者', description: '', coverUrl: '', categories: [], status: '' },
    changes: [], mappings: [], unmatchedSource: [], unmatchedLocal: [], warnings: [], orderChanges: [],
  })
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.keyDown(await screen.findByRole('button', { name: '测试书：更多操作' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '融合章节名' }))
  await screen.findByRole('heading', { name: '融合章节名' })
  fireEvent.change(screen.getByLabelText('已有作品链接'), { target: { value: 'https://www.po18.tw/books/123456' } })
  fireEvent.click(screen.getByRole('button', { name: '读取源站' }))
  fireEvent.click(await screen.findByText('同步小说信息', { selector: 'summary' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '作者' }))
  fireEvent.click(screen.getByRole('button', { name: '同步小说信息' }))
}

it('仅同步小说信息后等待列表刷新再关闭弹窗，直接展示最新作者', async () => {
  let resolveRefresh!: (data: unknown) => void
  const refresh = new Promise(resolve => { resolveRefresh = resolve })
  mocks.list.mockResolvedValueOnce({ novels: [{ id: 'n', title: '测试书', author: '原作者', contentRating: 'general', categories: [] }], total: 1, totalPages: 1 })
    .mockReturnValueOnce(refresh)
  mocks.sourceApply.mockResolvedValue({ updated: 0, metadataUpdated: ['author'], mappings: 0 })
  await openMetadataSync()
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  expect(mocks.sourceApply).toHaveBeenCalledWith(expect.objectContaining({ applyMetadata: true, metadataFields: ['author'], confirmedChangeIds: [] }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '更新中…' })).toBeDisabled()
  await act(async () => resolveRefresh({ novels: [{ id: 'n', title: '测试书', author: '源站作者', contentRating: 'general', categories: [] }], total: 1, totalPages: 1 }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('源站作者')).toBeVisible()
  expect(screen.queryByText('原作者')).not.toBeInTheDocument()
})

it('同步失败保留弹窗和勾选信息，不刷新小说列表', async () => {
  mocks.sourceApply.mockRejectedValueOnce(new Error('源站快照已过期'))
  await openMetadataSync()
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('源站快照已过期', 'error'))
  expect(mocks.list).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '作者' })).toBeChecked()
})
