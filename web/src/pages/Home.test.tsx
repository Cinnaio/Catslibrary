import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SearchProvider } from '../context/SearchContext'

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: null }),
}))

vi.mock('../context/ContentPolicyContext', () => ({
  isRestrictedContent: () => false,
  useContentPolicy: () => ({
    mode: 'safe',
    safeMode: true,
    setMode: vi.fn(),
    isAllowed: () => true,
    adultContentEnabled: false,
  }),
}))

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

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('Home hero search', () => {
  it('从 URL 恢复查询，并在提交与清空时同步 ?q=', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/?q=%E6%97%A7%E6%90%9C%E7%B4%A2']}>
        <SearchProvider>
          <Home />
          <LocationProbe />
        </SearchProvider>
      </MemoryRouter>,
    )

    const input = screen.getByRole('searchbox', { name: '搜索书名、作者或拼音' })
    await waitFor(() => expect(input).toHaveValue('旧搜索'))

    await user.clear(input)
    await user.type(input, '三体')
    await user.click(screen.getByRole('button', { name: '搜索小说' }))

    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId('location-search').textContent || '')
      expect(params.get('q')).toBe('三体')
    })

    await user.clear(input)
    await user.click(screen.getByRole('button', { name: '搜索小说' }))
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(''))
  })
})
