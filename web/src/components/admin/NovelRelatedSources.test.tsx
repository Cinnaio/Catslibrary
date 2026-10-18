import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ overview: vi.fn(), sourceBindings: vi.fn(), updated: vi.fn() }))
vi.mock('@/lib/api', () => ({ supplementarySourceApi: { overview: mocks.overview }, scrapeApi: { sourceBindings: mocks.sourceBindings } }))
vi.mock('./SupplementarySourcesDialog', () => ({
  default: ({ novel, initialSourceId, onClose }: any) => (
    <div role="dialog" aria-label="文件更新">
      <span>
        {novel.id}:{initialSourceId}
      </span>
      <button onClick={onClose}>返回来源设置</button>
    </div>
  ),
}))
vi.mock('@/pages/admin/ChaptersTab', () => ({
  default: ({ mergeNovel, onMergeClose }: any) => (
    <div role="dialog" aria-label="目录融合">
      <span>
        {mergeNovel.id} · {mergeNovel.chapterCount}
      </span>
      <button onClick={onMergeClose}>返回更新设置</button>
    </div>
  ),
}))
import NovelRelatedSources from './NovelRelatedSources'
const novel = { id: 'txt', title: 'TXT 书', author: '甲', chapterCount: 52 }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.overview.mockResolvedValue({
    sources: [{ id: 'folder', name: '共享书单', enabled: true, intervalHours: 6, checkedAt: 1, nextCheckAt: 2, status: 'partial', error: '' }],
    bindings: [
      { id: 'binding', sourceId: 'folder', novelId: 'txt', candidates: [{ key: 'file' }] },
      { id: 'other', sourceId: 'folder', novelId: 'other', candidates: [] },
    ],
  })
  mocks.sourceBindings.mockResolvedValue({
    bindings: [{ id: 'reference', site: 'PO18', sourceUrl: 'https://www.po18.tw/books/123', isPrimary: true, lastSyncedAt: 1 }],
  })
})
it('附加源和参考目录独立显示，候选文件不计为已确认新增章', async () => {
  render(<NovelRelatedSources novel={novel} onUpdated={mocks.updated} />)
  expect(await screen.findByText('共享书单')).toBeVisible()
  expect(screen.getByText('部分目录未完整读取', { exact: false })).toBeVisible()
  expect(screen.getByText('1 个版本 · 以预览为准')).toBeVisible()
  expect(screen.getByText(/跟随来源设置 · 每 6 小时/)).toBeVisible()
  expect(await screen.findByText('https://www.po18.tw/books/123')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看候选版本' }))
  expect(await screen.findByRole('dialog', { name: '文件更新' })).toHaveTextContent('txt:folder')
  fireEvent.click(screen.getByRole('button', { name: '返回来源设置' }))
  await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
  expect(mocks.updated).toHaveBeenCalledOnce()
})
it('融合直接携带当前书与章节数量，不切换目标或开启正文追更', async () => {
  render(<NovelRelatedSources novel={novel} onUpdated={mocks.updated} />)
  fireEvent.click(screen.getByRole('button', { name: '读取参考目录并预览' }))
  expect(await screen.findByRole('dialog', { name: '目录融合' })).toHaveTextContent('txt · 52')
  fireEvent.click(screen.getByRole('button', { name: '返回更新设置' }))
  await waitFor(() => expect(mocks.updated).toHaveBeenCalledOnce())
})
it('附加源读取失败仍可使用参考目录，支持单独重试', async () => {
  mocks.overview.mockRejectedValueOnce(new Error('附加源读取失败'))
  render(<NovelRelatedSources novel={novel} onUpdated={mocks.updated} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('附加源读取失败')
  expect(screen.getByText('https://www.po18.tw/books/123')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新读取附加源' }))
  expect(await screen.findByText('共享书单')).toBeVisible()
})
