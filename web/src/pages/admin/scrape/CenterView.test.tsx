import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  scrapePost: vi.fn(),
  toast: vi.fn(),
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
import { POPO_RANKING_LIST_URL, RANKING_SITES } from './utils'

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined

function emptyDiscovery() {
  return { novels: [], total: 0, totalPages: 1, site: 'POPO' }
}

async function selectRanking(label: string) {
  const user = userEvent.setup()
  // 默认停在「链接导入」，先切到「榜单发现」才会渲染榜单控件。
  await user.click(screen.getByRole('tab', { name: '榜单发现' }))
  await user.click(await screen.findByRole('combobox', { name: '选择榜单来源' }))
  // 选项可访问名 = label + sub（如「POPO 珍珠榜 · 月 po18.tw」），用正则匹配 label。
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
  })

  it('POPO 榜单面板覆盖 5 个榜单 × 周/月/总', () => {
    const popo = RANKING_SITES.filter((site) => site.ranking)
    expect(popo).toHaveLength(15)
    // 值必须唯一，否则下拉里同 kind 的周/月/总会互相覆盖。
    expect(new Set(popo.map((site) => site.value)).size).toBe(15)
    expect(popo.every((site) => site.listUrl === POPO_RANKING_LIST_URL)).toBe(true)
  })

  it('选中 POPO 珍珠榜·月时提交 kind=pearl 与 type=monthly', async () => {
    render(<CenterView />)

    await selectRanking('POPO 珍珠榜 · 月')
    fireEvent.click(screen.getByRole('button', { name: '加载榜单' }))

    await waitFor(() => expect(lastDiscoverBody().action).toBe('discover'))
    expect(lastDiscoverBody()).toMatchObject({
      listUrl: POPO_RANKING_LIST_URL,
      rankingKind: 'pearl',
      rankingType: 'monthly',
    })
  })

  it('选中 POPO 收藏榜·总时提交 kind=stocked 与 type=total', async () => {
    render(<CenterView />)

    await selectRanking('POPO 收藏榜 · 总')
    fireEvent.click(screen.getByRole('button', { name: '加载榜单' }))

    await waitFor(() => expect(lastDiscoverBody().action).toBe('discover'))
    expect(lastDiscoverBody()).toMatchObject({
      listUrl: POPO_RANKING_LIST_URL,
      rankingKind: 'stocked',
      rankingType: 'total',
    })
  })
  it('自定义榜单 URL 不携带榜单参数，按纯地址发现', async () => {
    const user = userEvent.setup()
    render(<CenterView />)

    await user.click(screen.getByRole('tab', { name: '榜单发现' }))
    fireEvent.change(await screen.findByPlaceholderText('也可以粘贴自定义榜单 URL'), { target: { value: 'https://example.com/rank/top' } })
    await user.click(screen.getByRole('button', { name: '加载榜单' }))

    await waitFor(() => expect(lastDiscoverBody().action).toBe('discover'))
    const body = lastDiscoverBody()
    expect(body.listUrl).toBe('https://example.com/rank/top')
    expect(body.rankingKind).toBeUndefined()
    expect(body.rankingType).toBeUndefined()
  })

  it('下拉选中后输入框展示 POPO 表单页地址，而非内部标识', async () => {
    render(<CenterView />)

    await selectRanking('POPO 人气榜 · 周')

    expect(screen.getByPlaceholderText('也可以粘贴自定义榜单 URL')).toHaveValue(POPO_RANKING_LIST_URL)
  })
})
