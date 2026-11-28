import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchProvider } from '../context/SearchContext'
import { ConfirmProvider } from '../components/feedback'

const policy = vi.hoisted(() => ({ safeMode: true }))

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: { id: 'reader' } }),
  useOptionalSession: () => ({ user: { id: 'reader' }, loading: false }),
}))

vi.mock('../context/ContentPolicyContext', () => {
  const isAllowed = (novel: { contentRating?: string }) => !policy.safeMode || novel.contentRating !== 'restricted'
  return {
    useContentPolicy: () => ({
      mode: policy.safeMode ? 'safe' : 'adult',
      safeMode: policy.safeMode,
      setMode: vi.fn(),
      isAllowed,
      adultContentEnabled: false,
    }),
  }
})

vi.mock('../lib/api', () => ({
  getToken: () => '',
  url: (path: string) => `/api${path}`,
  novelsApi: {
    list: vi.fn().mockResolvedValue({ novels: [], totalPages: 1, availableCategories: [] }),
  },
  progressApi: {
    recent: vi.fn().mockResolvedValue({ progress: [], tombstones: [] }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../lib/storage', () => ({
  isInBookshelf: vi.fn().mockReturnValue(false),
  getNovelHistory: () => null,
  getRecentHistory: () => [{ novelId: 'recent-book', chapterId: 'chapter-1', novelTitle: '历史作品', timestamp: 1 }],
  saveHistory: vi.fn(),
  clearHistory: vi.fn(),
}))

import Home from './Home'
import { novelsApi, progressApi } from '../lib/api'
import type { Novel } from '@shared/types'

function book(id: string, title: string, contentRating: Novel['contentRating'] = 'general'): Novel {
  return { id, title, author: '作者', description: '', coverUrl: '', categories: [], status: 'completed',
    contentRating, sourceUrl: '', chapterCount: 1, remoteChapterCount: 1, updateCheckedAt: 1, createdAt: 1, updatedAt: 1 }
}

function SearchLocation() {
  const location = useLocation()
  return <output aria-label="当前地址">{location.search}</output>
}

function renderHome(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SearchProvider>
        <ConfirmProvider>
          <Home />
        </ConfirmProvider>
        <SearchLocation />
      </SearchProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  policy.safeMode = true
  vi.clearAllMocks()
  vi.mocked(novelsApi.list).mockReset()
  vi.mocked(novelsApi.list).mockResolvedValue({ novels: [], totalPages: 1, availableCategories: [], total: 0, page: 1, limit: 20, hasMore: false })
  localStorage.clear()
})

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('Home hero search', () => {
  it('书库不再追加独立品牌页脚，内容区直接展示目录', () => {
    renderHome()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '全部书库' })).toBeInTheDocument()
    expect(screen.queryByText('把喜欢的故事，慢慢读完')).not.toBeInTheDocument()
  })
  it('安全模式在分页前过滤，当前页补满可见作品并显示过滤后的页数', async () => {
    policy.safeMode = true
    const all = Array.from({ length: 90 }, (_, i) => book(`book-${i}`, `作品${i}`, i % 2 ? 'restricted' : 'general'))
    vi.mocked(novelsApi.list).mockImplementation(async (params = {}) => {
      const visible = params.contentMode === 'safe' ? all.filter(novel => novel.contentRating !== 'restricted') : all
      const page = Number(params.page || 1), limit = Number(params.limit || 20)
      return { novels: visible.slice((page - 1) * limit, page * limit), total: visible.length,
        page, limit, totalPages: Math.ceil(visible.length / limit), hasMore: page * limit < visible.length, availableCategories: [] }
    })
    renderHome()
    await screen.findByText('作品0')
    expect(document.querySelectorAll('.novel-card')).toHaveLength(20)
    expect(screen.getByText('共 3 页')).toBeInTheDocument()
    expect(screen.getByText('作品38')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('作品40')
    expect(document.querySelectorAll('.novel-card')).toHaveLength(20)
    expect(screen.queryByText('作品0')).not.toBeInTheDocument()
  })

  it('拼音搜索包括第100本以后的作品，命中集合先排序再分页', async () => {
    const all = Array.from({ length: 130 }, (_, i) => book(`book-${i}`, i < 100 ? `云海${i}` : `山间${i}`))
    vi.mocked(novelsApi.list).mockImplementation(async (params = {}) => {
      const page = Number(params.page || 1), limit = Number(params.limit || 20)
      return { novels: all.slice((page - 1) * limit, page * limit), total: all.length,
        page, limit, totalPages: Math.ceil(all.length / limit), hasMore: page * limit < all.length, availableCategories: [] }
    })
    renderHome('/?q=shanjian')
    await screen.findByText('山间100', {}, { timeout: 5000 })
    expect(document.querySelectorAll('.novel-card')).toHaveLength(20)
    expect(screen.getByText('共 2 页')).toBeInTheDocument()
    const requests = vi.mocked(novelsApi.list).mock.calls.length
    await userEvent.setup().click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('山间120')
    expect(document.querySelectorAll('.novel-card')).toHaveLength(10)
    expect(screen.queryByText('山间100')).not.toBeInTheDocument()
    expect(novelsApi.list).toHaveBeenCalledTimes(requests)
  })

  it('拼音搜索匹配作者与简介，不会被书名匹配的 Promise 短路', async () => {
    const books = [
      { ...book('author-match', '云海'), author: '山间' },
      { ...book('desc-match', '星辰'), description: '山间故事' },
    ]
    vi.mocked(novelsApi.list).mockResolvedValue({ novels: books, total: 2, page: 1, limit: 100,
      totalPages: 1, hasMore: false, availableCategories: [] })
    renderHome('/?q=shanjian')
    await screen.findByText('云海')
    expect(screen.getByText('星辰')).toBeInTheDocument()
    expect(document.querySelectorAll('.novel-card')).toHaveLength(2)
  })

  it('从成人模式后续页切换安全模式时回到第一页', async () => {
    policy.safeMode = false
    vi.mocked(novelsApi.list).mockResolvedValue({ novels: [book('book-1', '云海')], total: 45,
      page: 1, limit: 20, totalPages: 3, hasMore: true, availableCategories: [] })
    const view = renderHome()
    await screen.findByText('云海')
    await userEvent.setup().click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, contentMode: 'adult' })))
    await act(async () => {
      policy.safeMode = true
      view.rerender(<MemoryRouter><SearchProvider><ConfirmProvider><Home /></ConfirmProvider></SearchProvider><SearchLocation /></MemoryRouter>)
    })
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, contentMode: 'safe' })))
    expect(screen.getByLabelText('跳转到指定页')).toHaveValue(1)
  })

  it('首页收敛常用标签，搜索完整面板并应用后保留已选条件', async () => {
    const availableCategories = ['现代', '古言', '校园', '校園', '言情', '玄幻', '仙侠', '重生', '快穿', '甜文', '百合', '简体版', '其他题材', 'h', 'np', '調教']
    vi.mocked(novelsApi.list).mockResolvedValue({ novels: [], totalPages: 1, availableCategories, total: 0, page: 1, limit: 20, hasMore: false })
    const user = userEvent.setup()
    renderHome()
    const toggle = await screen.findByRole('button', { name: '全部标签' })
    const common = screen.getByRole('group', { name: '小说分类' })
    expect(within(common).getAllByRole('button')).toHaveLength(12)
    expect(screen.queryByRole('button', { name: '校園' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(toggle)
    const dialog = screen.getByRole('dialog', { name: '全部标签' })
    expect(within(dialog).queryByRole('button', { name: 'H' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'NP' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '调教' })).not.toBeInTheDocument()
    const requests = vi.mocked(novelsApi.list).mock.calls.length
    await user.type(within(dialog).getByRole('searchbox', { name: '搜索标签' }), '簡體')
    await user.click(within(dialog).getByRole('button', { name: '简体版' }))
    expect(novelsApi.list).toHaveBeenCalledTimes(requests)
    expect(within(dialog).getByText('已选 1 个标签')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: '简体版', page: 1 })))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
    expect(within(common).queryByRole('button', { name: '简体版' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消分类 简体版' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ category: expect.anything() })))
  })

  it('多选标签使用交集，面板关闭丢弃草稿，重置只在应用后生效', async () => {
    vi.mocked(novelsApi.list).mockResolvedValue({
      novels: [], totalPages: 1, availableCategories: ['校园', '甜文', '系統', '系统'],
      total: 0, page: 1, limit: 20, hasMore: false,
    })
    const user = userEvent.setup()
    renderHome()
    const common = screen.getByRole('group', { name: '小说分类' })
    const campus = await within(common).findByRole('button', { name: '校园' })
    const sweet = within(common).getByRole('button', { name: '甜文' })
    await user.click(campus)
    await user.click(sweet)
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ categories: JSON.stringify(['校园', '甜文']), page: 1 })))
    const requests = vi.mocked(novelsApi.list).mock.calls.length
    await user.click(screen.getByRole('button', { name: '全部标签' }))
    let dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '系统' }))
    await user.keyboard('{Escape}')
    expect(novelsApi.list).toHaveBeenCalledTimes(requests)
    expect(screen.queryByRole('button', { name: '取消分类 系统' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部标签' }))
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '系统' })).toHaveAttribute('aria-pressed', 'false')
    const search = within(dialog).getByRole('searchbox', { name: '搜索标签' })
    await user.type(search, '系統')
    await user.click(within(dialog).getByRole('button', { name: '系统' }))
    await user.clear(search)
    await user.type(search, '不存在的标签')
    expect(within(dialog).getByText('没有找到相关标签')).toBeInTheDocument()
    expect(within(dialog).getByText('已选 3 个标签')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ categories: JSON.stringify(['校园', '甜文', '系统']), page: 1 })))
    await user.click(screen.getByRole('button', { name: '全部标签' }))
    dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '重置' }))
    expect(within(dialog).getByText('不限标签')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '关闭标签筛选' }))
    expect(screen.getByRole('button', { name: '取消分类 系统' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部标签' }))
    dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '重置' }))
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ categories: expect.anything() })))
    expect(campus).toHaveAttribute('aria-pressed', 'false')
    expect(sweet).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('当前筛选')).not.toBeInTheDocument()
  })

  it('面板打开时切回安全模式会丢弃受限草稿，重新打开不显示其别名', async () => {
    policy.safeMode = false
    vi.mocked(novelsApi.list).mockResolvedValue({ novels: [], totalPages: 1, availableCategories: ['校园', 'NP', 'np', '調教'], total: 0, page: 1, limit: 20, hasMore: false })
    const user = userEvent.setup()
    const view = renderHome()
    await user.click(await screen.findByRole('button', { name: '全部标签' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'NP' }))
    await act(async () => {
      policy.safeMode = true
      view.rerender(<MemoryRouter><SearchProvider><ConfirmProvider><Home /></ConfirmProvider></SearchProvider><SearchLocation /></MemoryRouter>)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部标签' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'NP' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '调教' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('不限标签')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ category: expect.anything() })))
  })

  it('已有阅读历史时首页也不显示最近阅读或请求近期进度', async () => {
    renderHome()
    await waitFor(() => expect(novelsApi.list).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: '最近阅读' })).not.toBeInTheDocument()
    expect(screen.queryByText('历史作品')).not.toBeInTheDocument()
    expect(progressApi.recent).not.toHaveBeenCalled()
  })

  it('中央搜索继承分享地址的查询词，提交时修剪查询并保留其他参数', async () => {
    const user = userEvent.setup()
    renderHome('/?q=原查询&v=123')
    const search = screen.getByRole('searchbox', { name: '搜索书名、作者或拼音' })
    expect(search).toHaveValue('原查询')
    await user.clear(search)
    await user.type(search, '  星辰  ')
    await user.click(screen.getByRole('button', { name: '搜索小说' }))
    expect(search).toHaveValue('星辰')
    expect(screen.getByLabelText('当前地址').textContent).toContain('q=%E6%98%9F%E8%BE%B0')
    expect(screen.getByLabelText('当前地址').textContent).toContain('v=123')
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '星辰', page: 1 })))
  })

  it('Ctrl K 聚焦首页搜索框', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('searchbox', { name: '搜索书名、作者或拼音' })).toHaveFocus()
  })

  it('筛选和排序暴露选中状态并使用现有 API 参数', async () => {
    const user = userEvent.setup()
    renderHome()
    const ongoing = within(screen.getByRole('group', { name: '小说状态' })).getByRole('button', { name: '连载中' })
    await user.click(ongoing)
    expect(ongoing).toHaveAttribute('aria-pressed', 'true')
    const titleSort = within(screen.getByRole('group', { name: '小说排序' })).getByRole('button', { name: '按标题' })
    await user.click(titleSort)
    expect(titleSort).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ongoing', sort: 'title', order: 'asc', page: 1 })))
  })

  it('空结果可以清除地址与状态筛选', async () => {
    const user = userEvent.setup()
    renderHome('/?q=未找到')
    await user.click(await screen.findByRole('button', { name: '清除筛选' }))
    expect(screen.getByRole('searchbox', { name: '搜索书名、作者或拼音' })).toHaveValue('')
    expect(screen.getByLabelText('当前地址').textContent).toBe('')
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ search: expect.anything() })))
  })
})
