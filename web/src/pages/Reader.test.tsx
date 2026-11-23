import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import type { UserRole } from '@shared/roles'
import { readEdgeData } from '../lib/edge'
import { hashParagraphText } from '@shared/thought-anchor'
import type { StoryEchoSource } from '@shared/story-echoes'

expect.extend(matchers)

const mocks = vi.hoisted(() => ({
  policy: { mode: 'adult', checking: false, policyError: '', adultContentEnabled: true, isAllowed: () => true, setMode: vi.fn(), refreshPolicy: vi.fn() },
  chapter: vi.fn(), novel: vi.fn(), chapters: vi.fn(), thoughts: vi.fn(),
  session: { user: null as null | { id: string; role: UserRole }, loading: false },
  playing: false, dispose: vi.fn(), stats: vi.fn(), echoEnabled: false, echoes: vi.fn(),
}))
vi.mock('../context/SessionContext', () => ({ useSession: () => mocks.session, useOptionalSession: () => mocks.session }))
vi.mock('../hooks/useAiStatus', () => ({
  useAiStatus: () => ({ features: { storyEchoes: mocks.echoEnabled } }),
  loadAiStatus: () => Promise.resolve({ quota: { limit: 10, used: 0 } }),
}))
vi.mock('../lib/story-echoes', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/story-echoes')>(), findStoryEchoes: mocks.echoes,
}))
vi.mock('../hooks/useReadingStats', () => ({ useReadingStats: mocks.stats }))
vi.mock('../lib/edge-audio', () => ({ EdgeAudio: class {
  start() { mocks.playing = true; return Promise.resolve(true) }
  startHeartbeat() { mocks.playing = true; return Promise.resolve(true) }
  stopHeartbeat() {}
  stop() { mocks.playing = false }
  dispose() { mocks.playing = false; mocks.dispose() }
} }))
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
  thoughtsApi: { chapter: mocks.thoughts, list: mocks.thoughts },
}))
vi.mock('../components/ThemeMenu', () => ({ ThemeMenu: () => null }))
vi.mock('../components/reader/ChapterRecap', () => ({ default: () => null }))
vi.mock('../components/reader/ThoughtPanel', () => ({ default: () => null }))
import Reader from './Reader'

function readerTree() {
  return <MemoryRouter initialEntries={['/read/book/chapter']}><Link to="/read/book/second">测试切章</Link><Link to="/read/book/chapter">测试返回</Link><Routes><Route path="/read/:novelId/:chapterId" element={<Reader />} /></Routes></MemoryRouter>
}

function mount() { return render(readerTree()) }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.session = { user: null, loading: false }
  mocks.playing = false
  mocks.echoEnabled = false
  mocks.thoughts.mockResolvedValue({ thoughts: [] })
  mocks.policy.mode = 'adult'
  mocks.policy.checking = false
  mocks.policy.policyError = ''
  mocks.chapter.mockResolvedValue({ chapter: { id: 'chapter', novelId: 'book', title: '测试章节', content: '正文', order: 1 } })
  mocks.novel.mockRejectedValue(new TypeError('Failed to fetch'))
  mocks.chapters.mockReset().mockResolvedValue({ chapters: [] })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('阅读器节拍指令', () => {
  beforeEach(() => { mocks.session = { user: { id: 'reader', role: 'admin' }, loading: false } })

  it('桌面面板互斥，关闭后回焦且只在展开时暂停阅读统计', async () => {
    const user = userEvent.setup()
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    mount()
    await screen.findByText('正文')
    await user.click(screen.getByRole('button', { name: '阅读设置' }))
    const trigger = within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '节拍指令' })
    await user.click(trigger)
    expect(screen.queryByRole('dialog', { name: '阅读设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '节拍指令' })).toBeInTheDocument()
    expect(mocks.stats.mock.lastCall?.[0].enabled).toBe(false)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: '节拍指令' })).not.toBeInTheDocument()
    expect(mocks.stats.mock.lastCall?.[0].enabled).toBe(true)
  })

  it('手机入口可用，跨断点关闭时焦点回到当前可见入口', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('innerWidth', 390)
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    mount()
    await screen.findByText('正文')
    const trigger = within(screen.getByRole('group', { name: '阅读快捷工具' })).getByRole('button', { name: '节拍指令' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '节拍指令' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    vi.stubGlobal('innerWidth', 1024)
    fireEvent(window, new Event('resize'))
    await user.keyboard('{Escape}')
    expect(within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '节拍指令' })).toHaveFocus()
  })

  it('收起面板与同书切章加载保持计时，结束复用本机记录且离开释放声音', async () => {
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    vi.stubGlobal('AudioContext', class {})
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const view = mount()
    await screen.findByText('正文')
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    fireEvent.click(within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '节拍指令' }))
    fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('switch', { name: /^节拍声/ }))
    fireEvent.click(screen.getByRole('switch', { name: /^红色时的心跳/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始这一局' })) })
    fireEvent.click(screen.getByRole('button', { name: '收起，继续阅读' }))
    const renders = mocks.stats.mock.calls.length
    act(() => vi.advanceTimersByTime(1000))
    expect(mocks.stats).toHaveBeenCalledTimes(renders)
    expect(mocks.playing).toBe(true)
    let finish!: (data: unknown) => void
    mocks.chapter.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('link', { name: '测试切章' }))
    await act(async () => {})
    act(() => vi.advanceTimersByTime(1000))
    await act(async () => finish({ chapter: { id: 'second', novelId: 'book', title: '下一章', content: '第二章正文', order: 2 } }))
    expect(screen.getByText('第二章正文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开节拍指令，剩余 04:58' })).toBeInTheDocument()
    expect(readEdgeData('user:reader').data.history).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '打开节拍指令，剩余 04:58' }))
    fireEvent.click(screen.getByRole('button', { name: '不玩了' }))
    expect(readEdgeData('user:reader').data.history).toEqual([expect.objectContaining({ elapsedMs: 2000, ending: 'ended' })])
    fireEvent.click(screen.getByRole('button', { name: '再来一次' }))
    view.unmount()
    expect(mocks.playing).toBe(false)
    expect(mocks.dispose).toHaveBeenCalled()
    expect(readEdgeData('user:reader').data.history).toHaveLength(1)
  })

  it('后台暂停、恢复权限失败与账号切换不会留下隐藏计时', async () => {
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const view = mount()
    await screen.findByText('正文')
    fireEvent.click(within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '节拍指令' }))
    fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))
    fireEvent.click(screen.getByRole('button', { name: '收起，继续阅读' }))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByRole('button', { name: '继续节拍指令' })).toBeInTheDocument()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.click(screen.getByRole('button', { name: '继续节拍指令' }))
    mocks.policy.policyError = '权限检查失败'
    view.rerender(readerTree())
    expect(screen.queryByRole('group', { name: '阅读节拍指令控制' })).not.toBeInTheDocument()
    mocks.policy.policyError = ''
    view.rerender(readerTree())
    await screen.findByText('正文')
    expect(screen.queryByRole('group', { name: '阅读节拍指令控制' })).not.toBeInTheDocument()
    mocks.session = { user: { id: 'new-reader', role: 'super_admin' }, loading: false }
    view.rerender(readerTree())
    await screen.findByText('正文')
    fireEvent.click(within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '节拍指令' }))
    expect(screen.getByRole('button', { name: '开始这一局' })).toBeInTheDocument()
    expect(readEdgeData('user:reader').data.history).toHaveLength(0)
    expect(readEdgeData('user:new-reader').data.history).toHaveLength(0)
    mocks.policy.mode = 'safe'
    view.rerender(readerTree())
    expect(screen.queryByRole('dialog', { name: '节拍指令' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '节拍指令' })).not.toBeInTheDocument()
  })

  it('撤销管理员角色后关闭节拍并清理本局，普通读者仍可阅读', async () => {
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    const view = mount()
    await screen.findByText('正文')
    fireEvent.click(within(screen.getByRole('group', { name: '阅读工具' })).getByRole('button', { name: '节拍指令' }))
    fireEvent.click(screen.getByRole('button', { name: '开始这一局' }))

    mocks.session.user = { id: 'reader', role: 'reader' }
    view.rerender(readerTree())
    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '节拍指令' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '节拍指令' })).not.toBeInTheDocument()
    expect(readEdgeData('user:reader').data.history).toHaveLength(0)

    mocks.session.user = { id: 'reader', role: 'admin' }
    view.rerender(readerTree())
    expect(screen.queryByRole('group', { name: '阅读节拍指令控制' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '节拍指令' })).not.toBeInTheDocument()
  })
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


describe('回声原文导航刷新', () => {
  it.each(['chapter', 'second'])('跳转 %s 重新读取正文，返回原选段也不使用旧缓存', async (targetID) => {
    mocks.session = { user: { id: 'reader', role: 'admin' }, loading: false }
    mocks.echoEnabled = true
    mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说' } })
    const first = '她把银铃留在窗边。', selected = '他再次拿起那枚银铃。'
    let currentContent = `${first}\n${selected}`, earlierContent = first
    mocks.chapter.mockImplementation((id: string) => Promise.resolve({ chapter: {
      id, novelId: 'book', title: id === 'chapter' ? '当前章' : '前文章',
      content: id === 'chapter' ? currentContent : earlierContent, order: id === 'chapter' ? 2 : 1,
    } }))
    const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(40, 80, 120, 20) })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const view = mount()
    try {
      await screen.findByText(selected)
      if (targetID === 'second') {
        fireEvent.click(screen.getByRole('link', { name: '测试切章' }))
        await screen.findByText(first)
        fireEvent.click(screen.getByRole('link', { name: '测试返回' }))
        await screen.findByText(selected)
      }
      const source: StoryEchoSource = { chapterId: targetID, chapterTitle: '前文', chapterOrder: targetID === 'chapter' ? 2 : 1,
        paragraphIndex: 0, paragraphHash: hashParagraphText(first), quote: first }
      mocks.echoes.mockResolvedValue({ anchor: source, items: [{ source, explanation: '银铃可能呼应前文。' }],
        cached: false, generated: true, searchedChapters: 1, candidateCount: 1, limited: false, omitted: 0, model: 'test' })
      const paragraph = screen.getByText(selected)
      await waitFor(() => expect(paragraph).toHaveAttribute('data-paragraph-hash'))
      const range = document.createRange()
      range.setStart(paragraph.firstChild!, 0); range.setEnd(paragraph.firstChild!, selected.length)
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
      fireEvent.mouseUp(paragraph)
      fireEvent.click(await screen.findByRole('button', { name: '故事里的回声' }))
      fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' }))
      const openSource = await screen.findByRole('button', { name: /回到原文/ })
      const changed = `${first}这处正文已更新。`
      if (targetID === 'chapter') currentContent = `${changed}\n${selected}`
      else earlierContent = changed
      const calls = mocks.chapter.mock.calls.filter(([id]) => id === targetID).length
      fireEvent.click(openSource)
      await screen.findByText(changed)
      expect(mocks.chapter.mock.calls.filter(([id]) => id === targetID)).toHaveLength(calls + 1)
      await waitFor(() => expect(screen.getByRole('region', { name: '本章搜索定位' })).toHaveTextContent('正文可能已更新'))
      currentContent = `${first}\n${selected}原选段也已更新。`
      const returnCalls = mocks.chapter.mock.calls.filter(([id]) => id === 'chapter').length
      fireEvent.click(screen.getByRole('button', { name: '返回回声选段' }))
      await screen.findByText(`${selected}原选段也已更新。`)
      expect(mocks.chapter.mock.calls.filter(([id]) => id === 'chapter')).toHaveLength(returnCalls + 1)
      expect(screen.queryByRole('button', { name: '返回回声选段' })).not.toBeInTheDocument()
    } finally {
      view.unmount()
      window.getSelection()?.removeAllRanges()
      if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect)
      else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    }
  })
})
