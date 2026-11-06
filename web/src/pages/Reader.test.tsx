import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  policy: { mode: 'adult', checking: false, policyError: '', adultContentEnabled: true, isAllowed: () => true, setMode: vi.fn(), refreshPolicy: vi.fn() },
  chapter: vi.fn(), novel: vi.fn(), chapters: vi.fn(),
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
  FONT_LABELS: ['15', '18', '20', '23', '27', '32'],
}))
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  chaptersApi: { get: mocks.chapter, list: mocks.chapters },
  novelsApi: { get: mocks.novel },
  thoughtsApi: { chapter: vi.fn().mockResolvedValue({ thoughts: [] }), list: vi.fn().mockResolvedValue({ thoughts: [] }) },
}))
vi.mock('../components/ThemeMenu', () => ({ ThemeMenu: () => null }))
vi.mock('../components/reader/ChapterRecap', () => ({ default: () => null }))
vi.mock('../components/reader/ThoughtPanel', () => ({ default: () => null }))
import Reader from './Reader'

function readerTree() {
  return <MemoryRouter initialEntries={['/read/book/chapter']}><Link to="/read/book/second">测试切章</Link><Routes><Route path="/read/:novelId/:chapterId" element={<Reader />} /></Routes></MemoryRouter>
}

function mount() { return render(readerTree()) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.policy.mode = 'adult'
  mocks.policy.checking = false
  mocks.policy.policyError = ''
  mocks.chapter.mockResolvedValue({ chapter: { id: 'chapter', novelId: 'book', title: '测试章节', content: '正文', order: 1 } })
  mocks.novel.mockRejectedValue(new TypeError('Failed to fetch'))
  mocks.chapters.mockReset().mockResolvedValue({ chapters: [] })
})

describe('阅读器访问状态', () => {
  it('手机书签备注独立于桌面工具组，取消后回到仍可见的工具栏', async () => {
    const user = userEvent.setup()
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    mount()
    await screen.findByText('正文')
    await user.click(screen.getByRole('button', { name: '显示阅读工具栏' }))
    const toolbar = screen.getByRole('toolbar', { name: '移动端阅读工具栏' })
    const bookmark = within(toolbar).getByRole('button', { name: '添加书签' })
    await user.click(bookmark)
    const note = screen.getByRole('dialog', { name: '添加书签备注' })
    expect(note.closest('.reader-controls')).toBeNull()
    expect(toolbar).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByLabelText('书签备注（可选）')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(bookmark).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: '添加书签备注' })).not.toBeInTheDocument()
  })

  it('阅读工具面板互斥，Escape 从输入框及设置内关闭并恢复入口焦点', async () => {
    const user = userEvent.setup()
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    mount()
    await screen.findByText('正文')
    const settings = screen.getByRole('button', { name: '阅读设置' })
    await user.click(settings)
    expect(screen.getByRole('dialog', { name: '阅读设置' })).toBeInTheDocument()
    const chapters = screen.getByRole('button', { name: '章节目录，当前第1章' })
    await user.click(chapters)
    expect(screen.queryByRole('dialog', { name: '阅读设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: '搜索章节' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(chapters).toHaveFocus()
    expect(screen.queryByRole('searchbox', { name: '搜索章节' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '书签列表' }))
    expect(screen.getByRole('dialog', { name: '书签列表' })).toBeInTheDocument()
    await user.click(settings)
    expect(screen.queryByRole('dialog', { name: '书签列表' })).not.toBeInTheDocument()
    screen.getByRole('switch', { name: '显示插图' }).focus()
    await user.keyboard('{Escape}')
    expect(settings).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: '阅读设置' })).not.toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: '阅读设置' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '书内正文搜索' }))
    expect(screen.queryByRole('dialog', { name: '阅读设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '书内正文搜索' })).toBeInTheDocument()
  })

  it('慢目录不阻塞已授权正文，切章复用小说上下文和目录请求', async () => {
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    let finish!: (data: { chapters: [] }) => void
    mocks.chapters.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    mount()
    await screen.findByText('正文')
    mocks.chapter.mockResolvedValue({ chapter: { id: 'second', novelId: 'book', title: '下一章', content: '第二章正文', order: 2 } })
    fireEvent.click(screen.getByRole('link', { name: '测试切章' }))
    await screen.findByText('第二章正文')
    expect(mocks.novel).toHaveBeenCalledOnce()
    expect(mocks.chapters).toHaveBeenCalledOnce()
    await act(async () => finish({ chapters: [] }))
  })

  it('内容模式变化后不复用之前的访问上下文', async () => {
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    const view = mount()
    await screen.findByText('正文')
    mocks.policy.mode = 'safe'
    mocks.novel.mockRejectedValue(Object.assign(new Error('拒绝'), { status: 403, data: { code: 'restricted_content' } }))
    view.rerender(readerTree())
    await screen.findByRole('heading', { name: '内容安全模式已拦截' })
    expect(mocks.novel).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('正文')).not.toBeInTheDocument()
  })

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
