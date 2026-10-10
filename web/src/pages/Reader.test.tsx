import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  policy: { mode: 'adult', checking: false, policyError: '', adultContentEnabled: true, isAllowed: () => true, setMode: vi.fn(), refreshPolicy: vi.fn() },
  chapter: vi.fn(), novel: vi.fn(),
}))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: null, loading: false }), useOptionalSession: () => ({ user: null }) }))
vi.mock('../context/ContentPolicyContext', () => ({ useContentPolicy: () => mocks.policy }))
vi.mock('../components/feedback', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('../hooks/useBookmarks', () => ({ useBookmarks: () => ({ bookmarks: [], change: vi.fn(), reload: vi.fn() }) }))
vi.mock('../hooks/useProgressSync', () => ({ useProgressSync: () => ({ queue: vi.fn(), flush: vi.fn() }) }))
vi.mock('../hooks/useThoughtImages', () => ({ useThoughtImages: () => ({ images: [], loading: false }) }))
vi.mock('../hooks/useReaderSettings', () => ({
  useReaderSettings: () => ({ settings: {}, set: vi.fn(), fontSize: 2, pageMode: false }),
  FONT_SIZES: ['1rem', '1rem', '1rem'], PAGE_WIDTHS: { standard: '680px' }, AUTO_SCROLL_SPEEDS: { off: 0 },
}))
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  chaptersApi: { get: mocks.chapter, list: vi.fn().mockResolvedValue({ chapters: [] }) },
  novelsApi: { get: mocks.novel },
  thoughtsApi: { chapter: vi.fn().mockResolvedValue({ thoughts: [] }), list: vi.fn().mockResolvedValue({ thoughts: [] }) },
}))
vi.mock('../components/ThemeMenu', () => ({ ThemeMenu: () => null }))
vi.mock('../components/reader/ChapterRecap', () => ({ default: () => null }))
vi.mock('../components/reader/ThoughtPanel', () => ({ default: () => null }))
import Reader from './Reader'

function readerTree() {
  return <MemoryRouter initialEntries={['/read/book/chapter']}><Routes><Route path="/read/:novelId/:chapterId" element={<Reader />} /></Routes></MemoryRouter>
}

function mount() { return render(readerTree()) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.policy.mode = 'adult'
  mocks.policy.checking = false
  mocks.policy.policyError = ''
  mocks.chapter.mockResolvedValue({ chapter: { id: 'chapter', novelId: 'book', title: '测试章节', content: '正文', order: 1 } })
  mocks.novel.mockRejectedValue(new TypeError('Failed to fetch'))
})

describe('阅读器访问状态', () => {
  it('小说信息网络失败展示加载失败，重试重新请求小说信息', async () => {
    mount()
    await screen.findByRole('heading', { name: '加载失败' })
    expect(screen.queryByText('内容安全模式已拦截')).not.toBeInTheDocument()
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说', contentRating: 'restricted' } })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(mocks.novel).toHaveBeenCalledTimes(2))
    await screen.findByText('正文')
    expect(screen.queryByRole('heading', { name: '加载失败' })).not.toBeInTheDocument()
  })

  it('后台检查临时失败显示独立状态页，恢复后显示原正文且不重新加载章节', async () => {
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说', contentRating: 'restricted' } })
    const view = mount()
    await screen.findByText('正文')
    const requests = mocks.chapter.mock.calls.length
    mocks.policy.policyError = '访问权限验证暂时失败'
    view.rerender(readerTree())
    expect(screen.queryByText('正文')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '内容模式检查暂时失败' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('page-state')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.policy.refreshPolicy).toHaveBeenCalledOnce()
    mocks.policy.policyError = ''
    view.rerender(readerTree())
    expect(screen.getByText('正文')).toBeInTheDocument()
    await act(async () => {})
    expect(mocks.chapter.mock.calls.length).toBe(requests)
  })

  it('小说信息明确拒绝权限才显示 R18 阻挡', async () => {
    mocks.novel.mockRejectedValue(Object.assign(new Error('拒绝'), { status: 403, data: { code: 'restricted_content' } }))
    mount()
    await screen.findByRole('heading', { name: '内容安全模式已拦截' })
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
  })

  it('正在恢复权限时等待，不提前加载或展示阻挡', async () => {
    mocks.policy.checking = true
    mount()
    expect(screen.getByRole('heading', { name: '正在确认访问权限' })).toBeInTheDocument()
    await act(async () => {})
    expect(mocks.chapter).not.toHaveBeenCalled()
  })

  it('首次授权检查失败显示重试入口，不展示内容和解锁提示', async () => {
    mocks.policy.mode = 'safe'
    mocks.policy.policyError = '访问权限验证暂时失败'
    mount()
    expect(screen.getByRole('heading', { name: '访问权限暂时无法确认' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.policy.refreshPolicy).toHaveBeenCalledOnce()
    expect(mocks.chapter).not.toHaveBeenCalled()
  })
})
