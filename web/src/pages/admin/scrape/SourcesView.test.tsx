import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  scrapePost: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../../../components/feedback', () => ({
  useConfirm: () => ({ confirm: mocks.confirm }),
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils')
  return { ...actual, scrapePost: mocks.scrapePost }
})

import SourcesView from './SourcesView'

const initialSources = [
  {
    host: 'full.example.com',
    name: '完整书源',
    encoding: 'utf-8',
    support: 'full',
    confidence: 86,
    enabled: true,
    connectivity: 'reachable' as const,
    chapterList: '.list a',
  },
]

const filteredSources = [
  {
    host: 'partial.example.com',
    name: '部分书源',
    encoding: 'utf-8',
    support: 'partial',
    confidence: 64,
    enabled: true,
    connectivity: 'reachable' as const,
    chapterList: '.chapter a',
  },
]

function listResponse(sources: typeof initialSources) {
  return {
    sources,
    total: sources.length,
    enabledCount: sources.filter((source) => source.enabled).length,
    bySupport: { full: sources.filter((source) => source.support === 'full').length, partial: sources.filter((source) => source.support === 'partial').length },
    unreachableCount: 0,
    totalPages: 1,
    matchedTotal: sources.length,
  }
}

describe('SourcesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(false)
  })

  it('切换筛选后保留管理内容区滚动位置', async () => {
    const user = userEvent.setup()
    let resolveFiltered!: (value: ReturnType<typeof listResponse>) => void
    const filteredRequest = new Promise<ReturnType<typeof listResponse>>((resolve) => {
      resolveFiltered = resolve
    })

    mocks.scrapePost.mockImplementation((body: Record<string, unknown>) => {
      if (body.support === 'partial') return filteredRequest
      return Promise.resolve(listResponse(initialSources))
    })

    const { container } = render(
      <div className="admin-layout__content">
        <SourcesView active />
      </div>,
    )

    await waitFor(() => expect(screen.getByText('完整书源')).toBeInTheDocument())

    const scrollHost = container.querySelector<HTMLElement>('.admin-layout__content')!
    scrollHost.scrollTop = 640
    await user.click(screen.getByRole('tab', { name: '部分支持' }))

    await waitFor(() => {
      expect(mocks.scrapePost).toHaveBeenCalledWith(expect.objectContaining({ action: 'list-sources', support: 'partial' }))
    })

    expect(screen.getByText('完整书源')).toBeInTheDocument()
    expect(container.querySelector('.source-panel__table-wrapper')).toHaveAttribute('aria-busy', 'true')

    // 真实滚动容器在列表切换为加载状态时可能被浏览器夹回顶部。
    scrollHost.scrollTop = 0
    resolveFiltered(listResponse(filteredSources))

    await waitFor(() => expect(screen.getByText('部分书源')).toBeInTheDocument())
    expect(scrollHost.scrollTop).toBe(640)
  })
})
