import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchProvider } from '../context/SearchContext'

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: null }),
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
  getRecentHistory: () => [],
  saveHistory: vi.fn(),
  clearHistory: vi.fn(),
}))

import Home from './Home'
import { novelsApi } from '../lib/api'

function SearchLocation() {
  const location = useLocation()
  return <output aria-label="当前地址">{location.search}</output>
}

function renderHome(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SearchProvider>
        <Home />
        <SearchLocation />
      </SearchProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('Home hero search', () => {
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
