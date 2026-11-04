import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ list: vi.fn(), exportBooks: vi.fn(), update: vi.fn(), toast: vi.fn(), sourcePreview: vi.fn(), sourceApply: vi.fn() }))
vi.mock('../../lib/api', () => ({ adminApi: {}, novelsApi: { list: mocks.list, exportBooks: mocks.exportBooks, update: mocks.update, visibility: vi.fn().mockResolvedValue({ visibility: 'public', revision: 0, users: [], audit: [] }) }, scrapeApi: { sourceBindings: async () => ({ bindings: [] }), sourceSyncPreview: mocks.sourcePreview, sourceSyncApply: mocks.sourceApply }, authHeaders: () => ({}), url: (x: string) => x, newOperationId: () => 'test' }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }))
vi.mock("@/components/shared/SearchSelect", () => ({ default: ({ options, value, onChange, ...props }: any) => <select aria-labelledby={props['aria-labelledby']} value={value} onChange={e => onChange(e.target.value)}>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
vi.mock('../../components/admin/BookImportDialog', () => ({ default: () => null }))
import NovelsTab from './NovelsTab'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({ novels: [{ id: 'n', title: '测试书', author: '原作者', contentRating: 'general', contentRatingRevision: 7, categories: [] }], total: 1, totalPages: 1 })
  mocks.update.mockResolvedValue({})
})
async function open() {
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑：测试书' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /^保存$/ })).toBeEnabled())
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

it('小说列表使用当前封面端点，而不是原始入库封面 URL', async () => {
  mocks.list.mockResolvedValueOnce({
    novels: [{ id: 'n', title: '测试书', author: '原作者', coverUrl: 'https://source.example/original-cover.jpg', updatedAt: 42, contentRating: 'general', categories: [] }],
    total: 1,
    totalPages: 1,
  })
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)

  const image = await screen.findByAltText('测试书')
  expect(image.getAttribute('src')).toBe('/cover/n?v=42&cover=4')
  expect(image.getAttribute('src')).not.toBe('https://source.example/original-cover.jpg')
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

it('更多操作中的生成 AI 封面进入封面子页并携带当前作品', async () => {
  render(
    <MemoryRouter initialEntries={['/admin/novels']}>
      <NovelsTab />
      <LocationProbe />
    </MemoryRouter>,
  )
  fireEvent.keyDown(await screen.findByRole('button', { name: '测试书：更多操作' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '生成 AI 封面' }))
  expect(await screen.findByTestId('location')).toHaveTextContent('/admin/ai?sub=cover&novel=n')
})

it('编辑小说弹窗中的 AI 封面入口也进入封面子页并携带当前作品', async () => {
  await open()
  expect(screen.getByRole('link', { name: 'AI 绘制新封面' })).toHaveAttribute('href', '/admin/ai?sub=cover&novel=n')
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


it('单本更多操作导出指定作品，下载使用服务端文件名', async () => {
  const create = vi.fn().mockReturnValue('blob:export')
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn() })
  let downloadedName = ''
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadedName = this.download })
  mocks.exportBooks.mockResolvedValue({ blob: new Blob(['正文']), filename: '测试书.txt' })
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.keyDown(await screen.findByRole('button', { name: '测试书：更多操作' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '导出 TXT' }))
  await waitFor(() => expect(mocks.exportBooks).toHaveBeenCalledWith(['n'], false))
  await waitFor(() => expect(click).toHaveBeenCalled())
  expect(downloadedName).toBe('测试书.txt')
  click.mockRestore()
  vi.unstubAllGlobals()
})

it('导出所选按勾选范围请求 ZIP，失败保留选择并提示', async () => {
  mocks.exportBooks.mockRejectedValueOnce(new Error('所选正文超过 64 MiB'))
  mocks.list.mockResolvedValue({ novels: [{ id: 'n', title: '测试书', categories: [] }, { id: 'other', title: '未选作品', categories: [] }], total: 2, totalPages: 1 })
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择小说：测试书' }))
  fireEvent.click(screen.getByRole('button', { name: '导出所选（ZIP）' }))
  await waitFor(() => expect(mocks.exportBooks).toHaveBeenCalledWith(['n'], true))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('所选正文超过 64 MiB', 'error'))
  expect(screen.getByRole('checkbox', { name: '选择小说：测试书' })).toBeChecked()
})


it('单本书籍包入口请求 ZIP，包含封面采用导出接口的默认打包选项', async () => {
  mocks.exportBooks.mockRejectedValueOnce(new Error('测试中止下载'))
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.keyDown(await screen.findByRole('button', { name: '测试书：更多操作' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '导出书籍包（含封面）' }))
  await waitFor(() => expect(mocks.exportBooks).toHaveBeenCalledWith(['n'], true))
})
