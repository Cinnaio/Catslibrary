import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, fireEvent, render as renderBase, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const streams = vi.hoisted(() => ({ listeners: new Map<string, (task: unknown) => void>() }))
vi.mock('@/lib/ai-task-stream', () => ({ watchAiTask: (id: string, listener: (task: unknown) => void) => { streams.listeners.set(id, listener); return () => streams.listeners.delete(id) } }))
const api = vi.hoisted(() => ({
  getStyleProfile: vi.fn(),
  refreshStyleProfile: vi.fn(),
  getPlotState: vi.fn(),
  getRelationshipProfile: vi.fn(),
  refreshPlotState: vi.fn(),
  refreshRelationshipProfile: vi.fn(),
  pauseMemory: vi.fn(),
  startMemoryTask: vi.fn(),
  plotSuggestions: vi.fn(),
  continueNovel: vi.fn(),
  chapterNovel: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  request: vi.fn().mockResolvedValue({ reports: [], nextOffset: null, defaults: [] }),
  url: (path: string) => `/api${path}`,
  aiApi: {
    tasks: vi.fn().mockResolvedValue({ items: [] }),
    task: vi.fn().mockResolvedValue({ task: { id: 't1', status: 'running', current: 0, total: 1, step: '' } }),
    generations: vi.fn().mockResolvedValue({ items: [] }),
    writing: {
      getStyleProfile: api.getStyleProfile,
      refreshStyleProfile: api.refreshStyleProfile,
      getPlotState: api.getPlotState,
      getRelationshipProfile: api.getRelationshipProfile,
      refreshPlotState: api.refreshPlotState,
      refreshRelationshipProfile: api.refreshRelationshipProfile,
      pauseMemory: api.pauseMemory,
      startMemoryTask: api.startMemoryTask,
      plotSuggestions: api.plotSuggestions,
      continue: api.continueNovel,
      chapter: api.chapterNovel,
    },
  },
  chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [] }) },
  // 两本小说：切书隔离与在途响应回写都需要真的能切到另一部
  adminApi: {
    novelIndex: vi.fn().mockResolvedValue({
      novels: [
        { id: 'novel_1', title: '测试小说', author: '甲', chapterCount: 1, updatedAt: 1 },
        { id: 'novel_2', title: '第二本书', author: '乙', chapterCount: 1, updatedAt: 1 },
      ],
      hasMore: false,
    }),
  },
  newOperationId: (prefix: string) => `${prefix}-test`,
}))

vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: vi.fn() }),
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))

vi.mock("@/components/shared/SearchSelect", () => ({
  default: (props: { options: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) => (
    <select aria-label="目标小说" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">请选择小说</option>
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))

vi.mock('./AiGenerationsPanel', () => ({
  default: (props: { novelId?: string; status?: string; scope: string }) => (
    <div data-testid="book-generations" data-novel={props.novelId} data-status={props.status} data-scope={props.scope}>本书生成内容</div>
  ),
}))

import AiWritingWorkspace from './AiWritingWorkspace'
const render = (ui: ReactNode, novelId = '') => renderBase(
  <MemoryRouter initialEntries={[`/admin/ai?sub=writing&novel=${novelId}`]}>{ui}</MemoryRouter>,
)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

/** 选中小说并等到画像读取完成，后续断言才有稳定的起点。 */
async function selectNovel(novelId = 'novel_1', title = '测试小说') {
  render(<AiWritingWorkspace />)
  switchToNew()
  await screen.findByRole('option', { name: title })
  fireEvent.change(await screen.findByRole('combobox', { name: '目标小说' }), { target: { value: novelId } })
  await screen.findByText('暂无分析报告，仍可使用正文创作。')
}

/** Radix Tabs 用键盘事件切换，click 不触发；切到续写模式后再断言。 */
function switchToContinue() {
  const tab = screen.getByRole('tab', { name: '续写' })
  tab.focus()
  fireEvent.keyDown(tab, { key: 'Enter' })
  fireEvent.keyDown(tab, { key: ' ' })
}

function switchToNew() {
  const tab = screen.getByRole('tab', { name: '新写' })
  tab.focus()
  fireEvent.keyDown(tab, { key: 'Enter' })
  fireEvent.keyDown(tab, { key: ' ' })
}


describe('AiWritingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streams.listeners.clear()
    api.getPlotState.mockResolvedValue({ state: '', chaptersThrough: 0, chapterCount: 0 })
    api.getRelationshipProfile.mockResolvedValue({ profile: '' })
    api.getStyleProfile.mockResolvedValue({ profile: '' })
    api.refreshPlotState.mockReset()
    api.refreshRelationshipProfile.mockReset()
    api.pauseMemory.mockReset().mockResolvedValue({ ok: true })
    api.startMemoryTask.mockReset().mockResolvedValue({ ok: true, task: { id: 'memory-1', status: 'queued', current: 0, total: 47, step: '', error: '', updatedAt: 1 } })
    api.plotSuggestions.mockResolvedValue({
      suggestions: [
        { direction: '苏越以斗宗身份现身朝堂，当众治愈加刑天。', effect: '绑定皇室' },
        { direction: '夭夜在寝宫与他独处，借双修稳固修为。', effect: '关系推进' },
      ],
      usage: { model: 'm', promptTokens: 1, completionTokens: 1 },
    })
    api.continueNovel.mockResolvedValue({ ok: true, taskId: 't1', batchId: 'b1', total: 1 })
    api.chapterNovel.mockResolvedValue({ ok: true, taskId: 't1', batchId: 'b1', total: 1 })
  })

  it('进阶约束默认收起，折叠后保留并传给推荐和大纲', async () => {
    await selectNovel()
    switchToContinue()
    const details = screen.getByLabelText('进阶约束与材料') as HTMLDetailsElement
    expect(details.open).toBe(false)
    fireEvent.click(details.querySelector('summary')!)
    fireEvent.change(screen.getByLabelText('本次禁止发生的事件'), { target: { value: '不得揭露真实身份' } })
    fireEvent.change(screen.getByLabelText('本章目标'), { target: { value: '建立初步信任' } })
    fireEvent.click(details.querySelector('summary')!)
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toContain('已填写')
    expect((screen.getByLabelText('本次禁止发生的事件') as HTMLTextAreaElement).value).toBe('不得揭露真实身份')
    fireEvent.change(screen.getByLabelText('推荐情节超时'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      writingBrief: expect.objectContaining({ objective: '建立初步信任', forbiddenEvents: '不得揭露真实身份' }),
      timeoutSeconds: 300,
    }), expect.any(Function)))
    api.plotSuggestions.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '整理成大纲' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      chapterCount: 1,
      timeoutSeconds: 300,
      writingBrief: expect.objectContaining({ objective: '建立初步信任', forbiddenEvents: '不得揭露真实身份' }),
    }), expect.any(Function)))
    expect(localStorage.getItem('zz-ai-plot-timeout-seconds')).toBe('300')
  })

  it('从任务页带入小说参数时在共享作品选择中显示对应小说', async () => {
    render(<AiWritingWorkspace />, 'novel_2')

    const novelSelect = await screen.findByRole('combobox', { name: '目标小说' })
    await screen.findByRole('option', { name: '第二本书' })
    await waitFor(() => expect(novelSelect).toHaveValue('novel_2'))
  })

  it('在续写中切换多章规划会露出章节数输入，并将默认规模设为两章', async () => {
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByRole('radio', { name: '多章规划' }))

    const count = screen.getByLabelText('续写章节数') as HTMLInputElement
    expect(count.value).toBe('2')
    expect(screen.getByRole('button', { name: /整理成.*大纲/ })).toBeEnabled()
  })

  it('点击候选项把情节方向填入创作要求', async () => {
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())

    fireEvent.click(await screen.findByText('夭夜在寝宫与他独处，借双修稳固修为。'))

    const textarea = screen.getByLabelText('本次情节') as HTMLTextAreaElement
    expect(textarea.value).toBe('夭夜在寝宫与他独处，借双修稳固修为。')
  })

  it('填入候选后可以撤销，恢复被覆盖的原文', async () => {
    await selectNovel()
    switchToContinue()

    // 先手写一段内容
    const textarea = screen.getByLabelText('本次情节') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '我自己写的创作要求' } })

    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    // 点击候选是整段覆盖，属于高代价动作，必须可回退
    fireEvent.click(await screen.findByText('夭夜在寝宫与他独处，借双修稳固修为。'))
    expect(textarea.value).toBe('夭夜在寝宫与他独处，借双修稳固修为。')

    fireEvent.click(screen.getByRole('button', { name: '撤销填入' }))
    expect(textarea.value).toBe('我自己写的创作要求')
  })

  it('推荐时把侧重与内容参数一并发给后端', async () => {
    await selectNovel()

    fireEvent.change(screen.getByLabelText('推荐侧重点（可选）'), { target: { value: '想写日常互动' } })
    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    expect(api.plotSuggestions.mock.calls[0]![0]).toMatchObject({
      novelId: 'novel_1',
      focus: '想写日常互动',
      contentPreferences: { version: 1, adultContentMode: 'off', intimacyWeight: 'none', adultCharactersConfirmed: false },
    })
  })

  it('生成大纲时把创作要求里选定的情节方向一并下发', async () => {
    api.plotSuggestions.mockResolvedValue({
      suggestions: [],
      outline: '第1章 起\n甲。\n第2章 承\n乙。',
      usage: { model: 'm', promptTokens: 1, completionTokens: 1 },
    })
    await selectNovel()
    switchToContinue()
    fireEvent.click(screen.getByRole('radio', { name: '多章规划' }))

    const textarea = screen.getByLabelText('本次情节') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '夭夜在寝宫与他独处，借双修稳固修为。' } })
    fireEvent.click(screen.getByRole('button', { name: /整理成.*大纲/ }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    // 不传这条方向时后端会绕开用户的选择自行规划，大纲会与选定情节脱节
    expect(api.plotSuggestions.mock.calls[0]![0]).toMatchObject({
      novelId: 'novel_1',
      chapterCount: 2,
      plotDirection: '夭夜在寝宫与他独处，借双修稳固修为。',
    })
  })

  it('创作要求为空时不发送 plotDirection，避免下发空字符串', async () => {
    api.plotSuggestions.mockResolvedValue({
      suggestions: [],
      outline: '第1章 起\n甲。',
      usage: { model: 'm', promptTokens: 1, completionTokens: 1 },
    })
    await selectNovel()
    switchToContinue()
    fireEvent.click(screen.getByRole('radio', { name: '多章规划' }))
    fireEvent.click(screen.getByRole('button', { name: /整理成.*大纲/ }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    expect(api.plotSuggestions.mock.calls[0]![0]).not.toHaveProperty('plotDirection')
  })

  it('开启露骨模式后不再出现成年确认勾选，直接生成', async () => {
    await selectNovel()

    fireEvent.change(screen.getByPlaceholderText(/例如：第一章 雾中来客/), { target: { value: '第一章' } })
    fireEvent.click(screen.getByText('内容尺度', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('switch', { name: /开启露骨/ }))
    expect(screen.queryByRole('checkbox', { name: /已确认本次涉及角色均为成年人/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /生成章节/ }))

    await waitFor(() => expect(api.chapterNovel).toHaveBeenCalled())
    expect(api.chapterNovel.mock.calls[0]![0]).toMatchObject({
      novelId: 'novel_1',
      contentPreferences: {
        version: 1,
        adultContentMode: 'explicit',
        intimacyWeight: 'high',
        adultCharactersConfirmed: true,
        consentRuleTier: 'default',
      },
    })
  })

  it('续写基线中的 R18 参数原样传递，且不含确认勾选', async () => {
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByText('内容尺度', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('switch', { name: /开启露骨/ }))
    expect(screen.queryByRole('checkbox', { name: /已确认本次涉及角色均为成年人/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成续写' }))

    await waitFor(() => expect(api.continueNovel).toHaveBeenCalled())
    expect(api.continueNovel.mock.calls[0]![0]).toMatchObject({
      novelId: 'novel_1',
      contentPreferences: {
        version: 1,
        adultContentMode: 'explicit',
        intimacyWeight: 'high',
        adultCharactersConfirmed: true,
        consentRuleTier: 'default',
      },
    })
  })

  it('生成的大纲填入大纲框并提示章数', async () => {
    api.plotSuggestions.mockResolvedValue({
      suggestions: [],
      outline: '第1章 重返皇城\n苏越带夭夜入城面见加刑天。\n第2章 婚夜\n两人在寝宫独处，约定共进退。',
      usage: { model: 'm', promptTokens: 1, completionTokens: 1 },
    })
    await selectNovel()
    switchToContinue()
    fireEvent.click(screen.getByRole('radio', { name: '多章规划' }))

    fireEvent.click(screen.getByRole('button', { name: /整理成.*大纲/ }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    // 大纲模式要把 chapterCount 一并发给后端，后端据此产出对应章数
    expect(api.plotSuggestions.mock.calls[0]![0]).toMatchObject({ novelId: 'novel_1', chapterCount: 2 })

    const textarea = (await screen.findByLabelText('多章续写大纲')) as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toContain('第1章 重返皇城'))
    expect(textarea.value).toContain('第2章 婚夜')
  })

  it('目标字数清空时允许为空，不被立刻塞回默认值', async () => {
    await selectNovel()

    const input = screen.getByLabelText('目标字数') as HTMLInputElement
    expect(input.value).toBe('2000')

    // 清空的瞬间不得被 300 覆盖：否则数字改不动（先删后打字的常规操作会被打断）
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: '5000' } })
    expect(input.value).toBe('5000')
  })

  it('未失焦就提交时，目标字数按当前文字态归一化后发出', async () => {
    await selectNovel()

    const input = screen.getByLabelText('目标字数') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4500' } })
    // 刻意不触发 blur：用户在输入框里直接点按钮是常规路径
    fireEvent.change(screen.getByPlaceholderText(/例如：第一章 雾中来客/), { target: { value: '第一章' } })
    fireEvent.click(screen.getByRole('button', { name: /生成章节/ }))

    await waitFor(() => expect(api.chapterNovel).toHaveBeenCalled())
    expect(api.chapterNovel.mock.calls[0]![0]).toMatchObject({ novelId: 'novel_1', targetWords: 4500 })
  })

  it('超出范围的目标字数在失焦时被夹回合法区间', async () => {
    await selectNovel()

    const input = screen.getByLabelText('目标字数') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999999' } })
    fireEvent.blur(input)

    expect(input.value).toBe('30000')
  })

  it('大纲手动编辑入口始终存在，寻找灵感后在主区显示候选', async () => {
    await selectNovel()
    switchToContinue()
    expect(screen.getByLabelText('本章大纲（可选）')).toBeInTheDocument()
    expect(document.querySelector('.ai-writing-suggest__item')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item')).toHaveLength(2))
    expect(document.querySelector('#ai-writing-instruction')).toBeInTheDocument()
  })

  it('切换小说时立即清空上一本的候选与撤销记录', async () => {
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2))

    // 候选属于某一部小说，切书后留在右列会被误认成新书的方向
    fireEvent.change(screen.getByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_2' } })
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(0))
    expect(screen.getByLabelText('本章大纲（可选）')).toBeInTheDocument()
  })

  it('切书后在途的候选响应不回写到新书', async () => {
    const pending = deferred<{
      suggestions: Array<{ direction: string; effect: string }>
      usage: { model: string; promptTokens: number; completionTokens: number }
    }>()
    api.plotSuggestions.mockReturnValue(pending.promise)

    await selectNovel()
    switchToContinue()
    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())

    // 慢响应：请求发出后先切到另一本书。
    // 切书 effect 会同步清空候选，故等 value 落地即可确认已切过去。
    const select = screen.getByRole('combobox', { name: '目标小说' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'novel_2' } })
    await waitFor(() => expect(select.value).toBe('novel_2'))

    // 旧书的响应此刻才回来，不得出现在新书的候选列表里。
    // resolve 放在 act 外：act 会等待被丢弃的 promise 链，而该链在守卫处
    // 提前 return，act 内部会一直等下去（实测挂到超时）。
    pending.resolve({
      suggestions: [{ direction: '这是上一本书的情节方向', effect: '不应出现' }],
      usage: { model: 'm', promptTokens: 1, completionTokens: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('这是上一本书的情节方向')).toBeNull()
    expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(0)
    expect(screen.getByLabelText('本章大纲（可选）')).toBeInTheDocument()
    // 在途请求返回时 finally 的守卫会拦住对 busy 的复位，故切书必须自己归零；
    // 否则按钮永久停在「推荐中…」，而新书其实没有任何在途请求。
    expect(screen.getByRole('button', { name: '寻找灵感' })).toBeEnabled()
  })

  it('候选收起后列表隐藏但数据保留，可再次展开', async () => {
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByRole('button', { name: '寻找灵感' }))
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2))

    // 收起只切换显示：此前实现是 setSuggestions([])，会把已取回的结果直接丢掉，
    // 右列随即退回空态，想再看只能重新请求（等于为已拿到的结果重复付费）。
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(0)
    // 关键：不得回到「尚未取候选」的空态，也不得退出分栏
    expect(document.querySelector('.ai-writing-deck-empty')).toBeNull()
    // 收起后要交代「有什么被收起来了」
    expect(screen.getByRole('tab', { name: /灵感候选.*2/ })).toBeInTheDocument()

    // 无需重新请求即可展开回来
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2)
    expect(api.plotSuggestions).toHaveBeenCalledTimes(1)
  })

  it('创作台切换审阅保留构思，并按当前作品查看草稿和产出', async () => {
    await selectNovel()
    switchToContinue()
    fireEvent.change(screen.getByLabelText('本次情节'), { target: { value: '渡口重逢，双方试探' } })
    const activate = (name: string) => {
      const tab = screen.getByRole('tab', { name })
      tab.focus()
      fireEvent.keyDown(tab, { key: 'Enter' })
    }
    activate('草稿审阅')
    expect(screen.getByTestId('book-generations')).toHaveAttribute('data-novel', 'novel_1')
    expect(screen.getByTestId('book-generations')).toHaveAttribute('data-status', 'draft')
    expect(screen.getByTestId('book-generations')).toHaveAttribute('data-scope', 'writing')
    activate('本书产出')
    expect(screen.getByTestId('book-generations')).toHaveAttribute('data-status', 'all')
    activate('构思与生成')
    expect(screen.getByLabelText('本次情节')).toHaveValue('渡口重逢，双方试探')
  })

  it('创作台按作品和新写续写分别保留情节与大纲', async () => {
    await selectNovel()
    fireEvent.change(screen.getByLabelText('本次情节'), { target: { value: '新写的故事' } })
    switchToContinue()
    expect(screen.getByLabelText('本次情节')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('本次情节'), { target: { value: '续写的剧情' } })
    fireEvent.change(screen.getByLabelText('本章大纲（可选）'), { target: { value: '第1章 渡口重逢' } })
    fireEvent.change(screen.getByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_2' } })
    expect(screen.getByLabelText('本次情节')).toHaveValue('')
    expect(screen.getByLabelText('本章大纲（可选）')).toHaveValue('')
    fireEvent.change(screen.getByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_1' } })
    expect(screen.getByLabelText('本次情节')).toHaveValue('续写的剧情')
    expect(screen.getByLabelText('本章大纲（可选）')).toHaveValue('第1章 渡口重逢')
    switchToNew()
    expect(screen.getByLabelText('本次情节')).toHaveValue('新写的故事')
  })

  it('创作台切书后旧大纲请求不能覆盖新书', async () => {
    const pending = deferred<{ suggestions: never[]; outline: string }>()
    api.plotSuggestions.mockReturnValue(pending.promise)
    await selectNovel()
    switchToContinue()
    fireEvent.click(screen.getByRole('button', { name: '整理成大纲' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_2' } })
    await act(async () => { pending.resolve({ suggestions: [], outline: '第1章 旧书的情节' }) })
    expect(screen.getByLabelText('本章大纲（可选）')).toHaveValue('')
    expect(screen.getByRole('button', { name: '整理成大纲' })).toBeEnabled()
  })

})
