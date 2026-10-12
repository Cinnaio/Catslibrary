import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SourceAnalyticsBook, SourceAnalyticsResponse } from '@shared/source-analytics'
const mocks = vi.hoisted(() => ({ analytics: vi.fn() }))
vi.mock('@/lib/api', () => ({ adminApi: { sourceAnalytics: mocks.analytics } }))
vi.mock('@/components/admin/CustomSelect', () => ({
  default: ({ options, value, onChange, ...props }: any) => (
    <select aria-label={props['aria-label']} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/NovelFollowupDialog', () => ({
  default: ({ novel, onClose }: any) => (
    <div role="dialog">
      <h2>追更详情：{novel.title}</h2>
      <button onClick={onClose}>关闭追更</button>
    </div>
  ),
}))
vi.mock('./ChaptersTab', () => ({
  default: ({ mergeNovel, onMergeClose }: any) => (
    <div role="dialog">
      <h2>融合详情：{mergeNovel.title}</h2>
      <button onClick={onMergeClose}>关闭融合</button>
    </div>
  ),
}))
import SourceAnalyticsTab from './SourceAnalyticsTab'
const now = Date.now()
const makeBook = (id: string, paused = false): SourceAnalyticsBook => ({
  id,
  title: paused ? '暂停的作品' : '连载的作品',
  author: '作者',
  status: 'ongoing',
  chapterCount: 90,
  site: 'site.example',
  sourceUrl: 'https://site.example/book',
  sources: [
    { url: 'https://site.example/book', host: 'site.example', kind: '抓取来源' },
    { url: 'https://original.example/book', host: 'original.example', kind: '原作者来源' },
  ],
  sourceCategory: 'configured',
  followupCategory: paused ? 'paused' : 'enabled',
  attention: false,
  active: false,
  intervalHours: 6,
  checkedAt: now,
  nextCheckAt: now + 3600000,
  result: 'no_change',
  message: '暂无新章',
  failures: 0,
  pending: null,
  protected: null,
  updatedAt: now,
})
const counts = { enabled: 1, paused: 1, completed: 0, unconfigured: 0, available: 0 }
function response(params: Record<string, string> = {}): SourceAnalyticsResponse {
  const books = [makeBook('n'), makeBook('paused', true)].filter((b) => !params.followup || b.followupCategory === params.followup)
  return {
    snapshotAt: now,
    view: params.view === 'all' ? 'all' : 'primary',
    total: 2,
    withSource: 2,
    configured: 2,
    attention: 0,
    followups: counts,
    groups: [{ site: 'site.example', total: 2, configured: 2, link: 0, none: 0, followups: counts, attention: 0 }],
    books,
    filteredTotal: books.length,
    page: Number(params.page || 1),
    totalPages: 1,
    limit: 15,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  mocks.analytics.mockImplementation(async (params) => response(params))
})
const show = () =>
  render(
    <MemoryRouter>
      <SourceAnalyticsTab />
    </MemoryRouter>,
  )
it('图表色块联动源站和追更筛选，明细跟随更新', async () => {
  show()
  await screen.findByText('连载的作品')
  fireEvent.click(screen.getByRole('button', { name: 'site.example：手动暂停 1 本' }))
  await waitFor(() =>
    expect(mocks.analytics).toHaveBeenLastCalledWith(expect.objectContaining({ site: 'site.example', followup: 'paused', source: '', page: '1' })),
  )
  await waitFor(() => expect(screen.queryByText('连载的作品')).not.toBeInTheDocument())
  expect(screen.getByText('暂停的作品')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
  expect(await screen.findByText('连载的作品')).toBeVisible()
})
it('全部来源口径、排序和分页参数贯通接口，统计保持全库口径', async () => {
  mocks.analytics.mockImplementation(async (params) => ({ ...response(params), filteredTotal: 31, totalPages: 3 }))
  show()
  await screen.findByText('连载的作品')
  fireEvent.change(screen.getByLabelText('来源统计口径'), { target: { value: 'all' } })
  await waitFor(() => expect(mocks.analytics).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'all', site: '', page: '1' })))
  await screen.findByText(/同一本书在不同站点分别计入/)
  fireEvent.change(screen.getByLabelText('明细排序'), { target: { value: 'next' } })
  await waitFor(() => expect(mocks.analytics).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'next' })))
  await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(mocks.analytics).toHaveBeenLastCalledWith(expect.objectContaining({ page: '2' })))
})
it('书籍详情展示所有来源和未知缺口，能打开追更与融合，并带入来源到抓取中心', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: '连载的作品' }))
  expect(screen.getByRole('heading', { name: '书源与追更详情' })).toBeVisible()
  expect(screen.getByText('尚未核对源站目录')).toBeVisible()
  expect(screen.getByRole('link', { name: 'https://original.example/book' })).toHaveAttribute('href', 'https://original.example/book')
  expect(screen.getByRole('link', { name: '进入抓取中心补充配置' })).toHaveAttribute(
    'href',
    '/admin/scrape?view=center&source=https%3A%2F%2Fsite.example%2Fbook',
  )
  fireEvent.click(screen.getByRole('button', { name: '追更详情与设置' }))
  expect(screen.getByRole('heading', { name: '追更详情：连载的作品' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '关闭追更' }))
  fireEvent.click(screen.getByRole('button', { name: '融合章节名' }))
  expect(await screen.findByRole('heading', { name: '融合详情：连载的作品' })).toBeVisible()
})
it('新筛选失败时不把旧列表当成匹配结果，重试后恢复', async () => {
  show()
  await screen.findByText('连载的作品')
  mocks.analytics.mockRejectedValueOnce(new Error('offline'))
  fireEvent.change(screen.getByLabelText('追更状态筛选'), { target: { value: 'paused' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  expect(screen.queryByText('连载的作品')).not.toBeInTheDocument()
  expect(screen.getByText('筛选结果尚未读取成功')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('暂停的作品')).toBeVisible()
})
it('旧筛选响应晚到时不覆盖新筛选结果', async () => {
  show()
  await screen.findByText('连载的作品')
  let finish!: (data: SourceAnalyticsResponse) => void
  mocks.analytics.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  fireEvent.change(screen.getByLabelText('追更状态筛选'), { target: { value: 'enabled' } })
  mocks.analytics.mockImplementationOnce(async (params) => response(params))
  fireEvent.change(screen.getByLabelText('追更状态筛选'), { target: { value: 'paused' } })
  expect(await screen.findByText('暂停的作品')).toBeVisible()
  await act(async () => finish(response({ followup: 'enabled' })))
  expect(screen.queryByText('连载的作品')).not.toBeInTheDocument()
})
it('读取失败可重试，空书库显示真实空状态', async () => {
  mocks.analytics.mockRejectedValueOnce(new Error('offline'))
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  mocks.analytics.mockResolvedValueOnce({
    ...response(),
    total: 0,
    withSource: 0,
    configured: 0,
    groups: [],
    books: [],
    filteredTotal: 0,
    followups: { enabled: 0, paused: 0, completed: 0, unconfigured: 0, available: 0 },
  })
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('书库还是空的')).toBeVisible()
  expect(screen.getByText('当前筛选没有匹配的小说')).toBeVisible()
})
it('书名搜索有可访问标签并防抖提交，点击图表会清除旧搜索', async () => {
  show()
  await screen.findByText('连载的作品')
  fireEvent.change(screen.getByRole('textbox', { name: '搜索小说' }), { target: { value: '作者' } })
  await waitFor(() => expect(mocks.analytics).toHaveBeenLastCalledWith(expect.objectContaining({ search: '作者', page: '1' })))
  fireEvent.click(screen.getByRole('button', { name: 'site.example：已开启 1 本' }))
  await waitFor(() => expect(mocks.analytics).toHaveBeenLastCalledWith(expect.objectContaining({ search: '', followup: 'enabled', site: 'site.example' })))
  expect(screen.getByRole('textbox', { name: '搜索小说' })).toHaveValue('')
})
