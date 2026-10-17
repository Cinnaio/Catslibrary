import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { supplementaryCatalog } from '@shared/supplementary-source'
const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  files: vi.fn(),
  bind: vi.fn(),
  unbind: vi.fn(),
  preview: vi.fn(),
  upload: vi.fn(),
  novelIndex: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ supplementarySourceApi: mocks, adminApi: { novelIndex: mocks.novelIndex } }))
vi.mock('./BookImportDialog', () => ({
  default: ({ initialPreview, onOpenChange }: { initialPreview: { runId: string }; onOpenChange: (open: boolean) => void }) => (
    <div role="dialog" aria-label="章节预览">
      {initialPreview.runId}
      <button onClick={() => onOpenChange(false)}>返回附加源</button>
    </div>
  ),
}))
import SupplementarySourcesDialog from './SupplementarySourcesDialog'
const source = {
  id: 'source',
  name: '微博10月',
  url: 'https://dudu88.lanzov.com/bMonth',
  hasPassword: false,
  enabled: false,
  intervalHours: 6,
  checkedAt: 0,
  nextCheckAt: 0,
  status: 'ok',
  error: '',
  fileCount: 1,
}
const file = {
  key: 'file',
  url: 'https://dudu88.lanzov.com/iFile',
  name: '[更2] 来源书名 作者：甲.txt',
  folder: '1016',
  size: '1 M',
  title: '来源书名',
  author: '甲',
  revision: 2,
}
const binding = { id: 'binding', sourceId: 'source', novelId: 'novel', novelTitle: '站内书名', aliasTitle: '来源书名', aliasAuthor: '甲', candidates: [file] }
beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  mocks.overview.mockResolvedValue({ sources: [source], bindings: [binding] })
  mocks.files.mockResolvedValue(supplementaryCatalog([file]))
  mocks.novelIndex.mockResolvedValue({ novels: [{ id: 'novel', title: '站内书名', author: '甲', chapterCount: 1 }] })
  mocks.preview.mockResolvedValue({ runId: 'preview-run' })
  mocks.upload.mockResolvedValue({ runId: 'manual-run' })
})
it('首次添加默认不启用定时检查，明确只检查目录', async () => {
  mocks.overview.mockResolvedValue({ sources: [], bindings: [] })
  mocks.save.mockResolvedValue({ id: 'created' })
  render(<SupplementarySourcesDialog onClose={vi.fn()} onCompleted={vi.fn()} />)
  const input = await screen.findByLabelText('来源名称')
  fireEvent.change(input, { target: { value: '微博目录' } })
  fireEvent.change(screen.getByLabelText('蓝奏文件夹链接'), { target: { value: source.url } })
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存来源' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, intervalHours: 6, name: '微博目录' })))
})
it('候选版本只作为线索，自动下载预览使用已确认的绑定与文件', async () => {
  render(<SupplementarySourcesDialog onClose={vi.fn()} onCompleted={vi.fn()} />)
  expect(await screen.findByText('站内书名')).toBeVisible()
  expect(screen.getByText(/文件名进度仅供参考/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '下载并预览' }))
  expect(await screen.findByRole('dialog', { name: '章节预览' })).toBeVisible()
  expect(mocks.preview).toHaveBeenCalledWith('binding', 'file')
})
it('下载失败后仍可上传所选版本，并保留原文件入口', async () => {
  mocks.preview.mockRejectedValue(new Error('蓝奏需要浏览器验证，请手动下载后上传'))
  render(<SupplementarySourcesDialog onClose={vi.fn()} onCompleted={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '下载并预览' }))
  expect(await screen.findByText('蓝奏需要浏览器验证，请手动下载后上传')).toBeVisible()
  expect(screen.getByRole('link', { name: '原文件' })).toHaveAttribute('href', file.url)
  fireEvent.click(screen.getByRole('button', { name: '上传对应文件' }))
  const upload = new File(['第一章 山雨\n正文'], file.name)
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [upload] } })
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith('binding', 'file', upload))
  expect(await screen.findByText('manual-run')).toBeVisible()
})
it('检查失败不清空旧目录，显示旧快照边界', async () => {
  mocks.overview.mockResolvedValue({ sources: [{ ...source, status: 'error', error: '上游请求失败' }], bindings: [binding] })
  render(<SupplementarySourcesDialog onClose={vi.fn()} onCompleted={vi.fn()} />)
  expect(await screen.findByText(/下方保留上次成功的文件清单/)).toBeVisible()
  expect(screen.getByText('站内书名')).toBeVisible()
})
it('同书不同日期归并显示，展开后可以绑定旧版本并提示目录未读全', async () => {
  const old = { ...file, key: 'older', name: '[更1] 来源书名 作者：甲.txt', folder: '1015', revision: 1, incomplete: true }
  mocks.files.mockResolvedValue(supplementaryCatalog([old, file]))
  mocks.bind.mockResolvedValue({ sources: [source], bindings: [{ ...binding, candidates: [file, old] }] })
  render(<SupplementarySourcesDialog onClose={vi.fn()} onCompleted={vi.fn()} />)
  fireEvent.mouseDown(await screen.findByRole('tab', { name: '目录文件与绑定' }), { button: 0, ctrlKey: false })
  expect(await screen.findByText(/已发现 1 本书籍、2 个文件/)).toBeVisible()
  expect(screen.getAllByRole('button', { name: '绑定已有书籍' })).toHaveLength(1)
  fireEvent.click(screen.getByText('查看 2 个已发现版本'))
  expect(screen.getByText(old.name)).toBeVisible()
  expect(screen.getByText(/目录后续分页未完成/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: `绑定此版本：${old.folder} ${old.name}` }))
  await waitFor(() => expect(screen.getByRole('option', { name: /站内书名/ })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('选择对应作品'), { target: { value: 'novel' } })
  fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))
  await waitFor(() => expect(mocks.bind).toHaveBeenCalledWith('source', 'novel', 'older'))
  expect(await screen.findByLabelText('候选版本')).toHaveValue('older')
})
