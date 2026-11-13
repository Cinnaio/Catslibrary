import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: { id: 'admin', role: 'super_admin' } }) }))

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  scrapePost: vi.fn(),
  toast: vi.fn(),
  sourceCapabilities: vi.fn(),
}))

vi.mock('@/components/feedback', () => ({
  useConfirm: () => ({ confirm: mocks.confirm }),
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils')
  return { ...actual, scrapePost: mocks.scrapePost }
})

import CenterView from './CenterView'
vi.mock('@/lib/api', async (importOriginal) => {
  const api = await importOriginal<typeof import('@/lib/api')>()
  return { ...api, scrapeApi: { ...api.scrapeApi, sourceCapabilities: mocks.sourceCapabilities } }
})

const LIST_URL = 'https://source.example/rank'
const SOURCE = { id: 'fixture', name: '示例书源', search: true, account: false, rankings: [
  { id: 'monthly', label: '示例热门榜 · 月', listUrl: LIST_URL, rankingKind: 'popular', rankingType: 'monthly' },
  { id: 'total', label: '示例收藏榜 · 总', listUrl: LIST_URL, rankingKind: 'saved', rankingType: 'total' },
  { id: 'weekly', label: '示例热门榜 · 周', listUrl: LIST_URL, rankingKind: 'popular', rankingType: 'weekly' },
] }

mocks.sourceCapabilities.mockResolvedValue({ sources: [] })

function renderCenter() {
  return render(<MemoryRouter><CenterView /></MemoryRouter>)
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined

function emptyDiscovery() {
  return { novels: [], total: 0, totalPages: 1, site: '示例书源' }
}

async function selectRanking(label: string) {
  const user = userEvent.setup()
  // 默认停在「链接导入」，先切到「榜单发现」才会渲染榜单控件。
  await user.click(screen.getByRole('tab', { name: '榜单发现' }))
  await user.click(await screen.findByRole('combobox', { name: '选择榜单来源' }))
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }))
}

function lastDiscoverBody() {
  const call = mocks.scrapePost.mock.calls.filter(([body]) => (body as { action?: string }).action === 'discover').pop()
  return (call?.[0] || {}) as Record<string, unknown>
}

describe('CenterView 榜单入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(false)
    mocks.scrapePost.mockResolvedValue(emptyDiscovery())
    mocks.sourceCapabilities.mockResolvedValue({ sources: [SOURCE] })
  })

  it('选中 示例热门榜·月时提交 kind=popular 与 type=monthly', async () => {
    renderCenter()

    await selectRanking('示例热门榜 · 月')
    fireEvent.click(screen.getByRole('button', { name: '加载榜单' }))

    await waitFor(() => expect(lastDiscoverBody().action).toBe('discover'))
    expect(lastDiscoverBody()).toMatchObject({
      listUrl: LIST_URL,
      rankingKind: 'popular',
      rankingType: 'monthly',
    })
  })

  it('选中 示例收藏榜·总时提交 kind=saved 与 type=total', async () => {
    renderCenter()

    await selectRanking('示例收藏榜 · 总')
    fireEvent.click(screen.getByRole('button', { name: '加载榜单' }))

    await waitFor(() => expect(lastDiscoverBody().action).toBe('discover'))
    expect(lastDiscoverBody()).toMatchObject({
      listUrl: LIST_URL,
      rankingKind: 'saved',
      rankingType: 'total',
    })
  })
  it('自定义榜单 URL 不携带榜单参数，按纯地址发现', async () => {
    const user = userEvent.setup()
    renderCenter()

    await user.click(screen.getByRole('tab', { name: '榜单发现' }))
    fireEvent.change(await screen.findByPlaceholderText('也可以粘贴自定义榜单 URL'), { target: { value: 'https://example.com/rank/top' } })
    await user.click(screen.getByRole('button', { name: '加载榜单' }))

    await waitFor(() => expect(lastDiscoverBody().action).toBe('discover'))
    const body = lastDiscoverBody()
    expect(body.listUrl).toBe('https://example.com/rank/top')
    expect(body.rankingKind).toBeUndefined()
    expect(body.rankingType).toBeUndefined()
  })

  it('下拉选中后输入框展示榜单地址，而非内部标识', async () => {
    renderCenter()

    await selectRanking('示例热门榜 · 周')

    expect(screen.getByPlaceholderText('也可以粘贴自定义榜单 URL')).toHaveValue(LIST_URL)
  })
})

it('统计页带入来源只预填链接，不自动分析或启动任务', () => {
  vi.clearAllMocks()
  const previous = window.location.href
  window.history.replaceState({}, '', '/admin/scrape?view=center&source=https%3A%2F%2Fexample.com%2Fbook')
  try {
    renderCenter()
    expect(screen.getByDisplayValue('https://example.com/book')).toBeInTheDocument()
    expect(mocks.scrapePost).not.toHaveBeenCalled()
  } finally { window.history.replaceState({}, '', previous) }
})

it('公开实例保留链接导入和自定义榜单，只在有已安装书源时显示搜索入口', async () => {
  mocks.sourceCapabilities.mockResolvedValue({ sources: [] })
  renderCenter()
  await waitFor(() => expect(mocks.sourceCapabilities).toHaveBeenCalled())
  expect(screen.getByRole('tab', { name: '链接导入' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '作品搜索' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: '榜单发现' }))
  expect(screen.getByPlaceholderText('也可以粘贴自定义榜单 URL')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: '选择榜单来源' })).not.toBeInTheDocument()
})
