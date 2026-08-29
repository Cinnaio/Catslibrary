import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('Home hero search', () => {
  it('首页不再渲染 hero 搜索框', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SearchProvider>
          <Home />
        </SearchProvider>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('searchbox', { name: '搜索书名、作者或拼音' })).toBeNull()
  })
})
