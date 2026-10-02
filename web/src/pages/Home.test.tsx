import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchProvider } from '../context/SearchContext'
import { ConfirmProvider } from '../components/feedback'

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: { id: 'reader' } }),
}))

vi.mock('../context/ContentPolicyContext', () => {
  const isAllowed = () => true
  return {
    useContentPolicy: () => ({
      mode: 'safe',
      safeMode: true,
      setMode: vi.fn(),
      isAllowed,
      adultContentEnabled: false,
    }),
  }
})

vi.mock('../lib/api', () => ({
  novelsApi: {
    list: vi.fn().mockResolvedValue({ novels: [], totalPages: 1, availableCategories: [] }),
  },
  progressApi: {
    recent: vi.fn().mockResolvedValue({ progress: [], tombstones: [] }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../lib/storage', () => ({
  getRecentHistory: () => [{ novelId: 'recent-book', chapterId: 'chapter-1', novelTitle: '历史作品', timestamp: 1 }],
  saveHistory: vi.fn(),
  clearHistory: vi.fn(),
}))

import Home from './Home'
import { novelsApi, progressApi } from '../lib/api'

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
  vi.clearAllMocks()
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
  it('分类默认收敛、更多标签分组，收起后保留已选条件并可清除', async () => {
    const availableCategories = ['现代', '古言', '校园', '校園', '言情', '玄幻', '仙侠', '重生', '快穿', '甜文', '百合', '简体版', '其他题材', 'h', 'np']
    vi.mocked(novelsApi.list).mockResolvedValue({ novels: [], totalPages: 1, availableCategories, total: 0, page: 1, limit: 20, hasMore: false })
    const user = userEvent.setup()
    renderHome()
    const toggle = await screen.findByRole('button', { name: '更多标签' })
    const common = screen.getByRole('group', { name: '小说分类' })
    expect(within(common).getAllByRole('button')).toHaveLength(12)
    expect(within(common).queryByRole('button', { name: '校園' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '全部分类标签' })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: 'h' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'np' })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: '其他标签' })).getByRole('button', { name: '简体版' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: '简体版', page: 1 })))
    expect(screen.getByRole('region', { name: '全部分类标签' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '收起标签' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '全部分类标签' })).not.toBeInTheDocument())
    expect(within(common).getByRole('button', { name: '简体版' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '取消分类 简体版' }))
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ category: expect.anything() })))
  })

  it('多选标签使用交集请求，再点取消和全部清除，展开区保持打开', async () => {
    vi.mocked(novelsApi.list).mockResolvedValue({
      novels: [],
      totalPages: 1,
      availableCategories: ['校园', '甜文', '简体版'],
      total: 0,
      page: 1,
      limit: 20,
      hasMore: false,
    })
    const user = userEvent.setup()
    renderHome()
    const common = screen.getByRole('group', { name: '小说分类' })
    const campus = await within(common).findByRole('button', { name: '校园' })
    const sweet = within(common).getByRole('button', { name: '甜文' })
    await user.click(campus)
    await user.click(sweet)
    expect(campus).toHaveAttribute('aria-pressed', 'true')
    expect(sweet).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ categories: JSON.stringify(['校园', '甜文']), page: 1 })))
    expect(screen.getByText('已选 · 同时满足')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '更多标签' }))
    await user.click(within(screen.getByRole('group', { name: '其他标签' })).getByRole('button', { name: '简体版' }))
    expect(screen.getByRole('region', { name: '全部分类标签' })).toBeInTheDocument()
    await waitFor(() =>
      expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ categories: JSON.stringify(['校园', '甜文', '简体版']), page: 1 })),
    )
    await user.click(screen.getByRole('button', { name: '取消分类 简体版' }))
    await user.click(sweet)
    expect(sweet).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(novelsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: '校园' })))
    await user.click(within(common).getByRole('button', { name: '全部' }))
    await waitFor(() =>
      expect(novelsApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ category: expect.anything(), categories: expect.anything() })),
    )
    expect(campus).toHaveAttribute('aria-pressed', 'false')
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
