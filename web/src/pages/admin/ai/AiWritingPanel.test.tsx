import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getStyleProfile: vi.fn(),
  refreshStyleProfile: vi.fn(),
  getPlotState: vi.fn(),
  getRelationshipProfile: vi.fn(),
  plotSuggestions: vi.fn(),
  continueNovel: vi.fn(),
  chapterNovel: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  aiApi: {
    tasks: vi.fn().mockResolvedValue({ items: [] }),
    task: vi.fn().mockResolvedValue({ task: { id: 't1', status: 'running', current: 0, total: 1, step: '' } }),
    generations: vi.fn().mockResolvedValue({ items: [] }),
    writing: {
      getStyleProfile: api.getStyleProfile,
      refreshStyleProfile: api.refreshStyleProfile,
      getPlotState: api.getPlotState,
      getRelationshipProfile: api.getRelationshipProfile,
      plotSuggestions: api.plotSuggestions,
      continue: api.continueNovel,
      chapter: api.chapterNovel,
    },
  },
  chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [] }) },
  // 两本小说：切书隔离与在途响应回写都需要真的能切到另一部
  novelsApi: {
    list: vi.fn().mockResolvedValue({
      novels: [
        { id: 'novel_1', title: '测试小说' },
        { id: 'novel_2', title: '第二本书' },
      ],
    }),
  },
  newOperationId: (prefix: string) => `${prefix}-test`,
}))

vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: vi.fn() }),
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))

vi.mock('@/components/admin/CustomSelect', () => ({
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

import AiWritingPanel from './AiWritingPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

/** 选中小说并等到画像读取完成，后续断言才有稳定的起点。 */
async function selectNovel(novelId = 'novel_1', title = '测试小说') {
  render(<AiWritingPanel />)
  switchToNew()
  await screen.findByRole('option', { name: title })
  fireEvent.change(await screen.findByRole('combobox', { name: '目标小说' }), { target: { value: novelId } })
  await waitFor(() => expect(api.getStyleProfile).toHaveBeenCalledWith(novelId))
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
    api.getPlotState.mockResolvedValue({ state: '', chaptersThrough: 0, chapterCount: 0 })
    api.getRelationshipProfile.mockResolvedValue({ profile: '' })
    api.getStyleProfile.mockResolvedValue({ profile: '' })
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

  it('默认进入续写，并把内容尺度和小说分析放在创作要求之前', () => {
    render(<AiWritingPanel />)

    expect(screen.getByRole('tab', { name: '续写' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('heading', { name: '续写基线' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '内容尺度' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '小说分析' })).toBeInTheDocument()

    const baseline = screen.getByRole('heading', { name: '续写基线' }).closest('.ai-writing-baseline')
    expect(baseline?.contains(screen.getByRole('switch', { name: /开启露骨/ }))).toBe(true)
    expect(baseline?.contains(screen.getByText('风格画像'))).toBe(true)
  })

  it('在续写中切换多章规划会露出章节数输入，并将默认规模设为两章', async () => {
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByRole('button', { name: '多章规划' }))

    const count = screen.getByLabelText('续写章节数') as HTMLInputElement
    expect(count.value).toBe('2')
    expect(screen.getByText('多章续写大纲')).toBeInTheDocument()
  })

  it('重新提取完成后不应被在途的旧风格画像读取覆盖', async () => {
    const initialProfile = deferred<{ profile: string }>()
    api.getStyleProfile.mockReturnValue(initialProfile.promise)
    api.refreshStyleProfile.mockResolvedValue({ profile: '最新风格画像' })

    render(<AiWritingPanel />)
    await screen.findByRole('option', { name: '测试小说' })
    fireEvent.change(await screen.findByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_1' } })
    await waitFor(() => expect(api.getStyleProfile).toHaveBeenCalledWith('novel_1'))

    fireEvent.click(screen.getByRole('button', { name: '提取风格画像' }))
    await waitFor(() => expect(api.refreshStyleProfile).toHaveBeenCalledWith('novel_1'))
    // 画像默认折叠，正文不在 DOM 中；展开后才能断言竞态结果。
    // 这条用例守护的是「在途旧请求不得覆盖新结果」，与折叠无关，故只补一步展开。
    fireEvent.click(screen.getByRole('button', { name: /风格画像/ }))
    await screen.findByText('最新风格画像')

    act(() => initialProfile.resolve({ profile: '' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('最新风格画像')).toBeInTheDocument()
  })

  it('点击候选项把情节方向填入创作要求', async () => {
    await selectNovel()

    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())

    fireEvent.click(await screen.findByText('夭夜在寝宫与他独处，借双修稳固修为。'))

    const textarea = screen.getByLabelText('创作要求') as HTMLTextAreaElement
    expect(textarea.value).toBe('夭夜在寝宫与他独处，借双修稳固修为。')
  })

  it('填入候选后可以撤销，恢复被覆盖的原文', async () => {
    await selectNovel()

    // 先手写一段内容
    const textarea = screen.getByLabelText('创作要求') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '我自己写的创作要求' } })

    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
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
    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))

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
    fireEvent.click(screen.getByRole('button', { name: '多章规划' }))

    const textarea = screen.getByLabelText('创作要求') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '夭夜在寝宫与他独处，借双修稳固修为。' } })
    fireEvent.click(screen.getByRole('button', { name: /按情节推荐生成大纲/ }))

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
    fireEvent.click(screen.getByRole('button', { name: '多章规划' }))
    fireEvent.click(screen.getByRole('button', { name: /按情节推荐生成大纲/ }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    expect(api.plotSuggestions.mock.calls[0]![0]).not.toHaveProperty('plotDirection')
  })

  it('开启露骨模式后不再出现成年确认勾选，直接生成', async () => {
    await selectNovel()

    fireEvent.change(screen.getByPlaceholderText(/例如：第一章 雾中来客/), { target: { value: '第一章' } })
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
    fireEvent.click(screen.getByRole('button', { name: '多章规划' }))

    fireEvent.click(screen.getByRole('button', { name: /按情节推荐生成大纲/ }))

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

  it('未取候选时右列显示内联提示，取回后替换为候选列表', async () => {
    await selectNovel()

    // 未取候选时不占一整块空态：改为一行提示，且此时不分栏（左列独占整幅）
    const aside = document.querySelector('.ai-writing-brief-layout__aside')
    expect(aside?.querySelector('.ai-writing-suggest-placeholder')).toBeTruthy()
    expect(aside?.querySelector('.ai-writing-suggest__item')).toBeNull()
    expect(document.querySelector('.ai-writing-brief-layout')?.classList.contains('is-aside-empty')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())

    await waitFor(() => {
      expect(document.querySelector('.ai-writing-suggest-placeholder')).toBeNull()
      expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2)
    })
    // 取回候选后进入分栏，候选与创作要求同处一个容器，点选无需滚动即可看到左侧变化
    expect(document.querySelector('.ai-writing-brief-layout')?.classList.contains('is-aside-empty')).toBe(false)
    expect(document.querySelector('.ai-writing-brief-layout')?.contains(document.querySelector('#ai-writing-instruction'))).toBe(true)
  })

  it('切换小说时立即清空上一本的候选与撤销记录', async () => {
    await selectNovel()

    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2))

    // 候选属于某一部小说，切书后留在右列会被误认成新书的方向
    fireEvent.change(screen.getByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_2' } })
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(0))
    expect(document.querySelector('.ai-writing-suggest-placeholder')).toBeTruthy()
    expect(document.querySelector('.ai-writing-brief-layout')?.classList.contains('is-aside-empty')).toBe(true)
  })

  it('切书后在途的候选响应不回写到新书', async () => {
    const pending = deferred<{
      suggestions: Array<{ direction: string; effect: string }>
      usage: { model: string; promptTokens: number; completionTokens: number }
    }>()
    api.plotSuggestions.mockReturnValue(pending.promise)

    await selectNovel()
    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
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
    expect(document.querySelector('.ai-writing-suggest-placeholder')).toBeTruthy()
    // 在途请求返回时 finally 的守卫会拦住对 busy 的复位，故切书必须自己归零；
    // 否则按钮永久停在「推荐中…」，而新书其实没有任何在途请求。
    expect(screen.getByRole('button', { name: '推荐情节' })).toBeEnabled()
  })

  it('候选收起后列表隐藏但数据保留，可再次展开', async () => {
    await selectNovel()

    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
    await waitFor(() => expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2))

    // 收起只切换显示：此前实现是 setSuggestions([])，会把已取回的结果直接丢掉，
    // 右列随即退回空态，想再看只能重新请求（等于为已拿到的结果重复付费）。
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(0)
    // 关键：不得回到「尚未取候选」的空态，也不得退出分栏
    expect(document.querySelector('.ai-writing-suggest-placeholder')).toBeNull()
    expect(document.querySelector('.ai-writing-brief-layout')?.classList.contains('is-aside-empty')).toBe(false)
    // 收起后要交代「有什么被收起来了」
    expect(screen.getByText(/已取回 2 条方向/)).toBeTruthy()

    // 无需重新请求即可展开回来
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(document.querySelectorAll('.ai-writing-suggest__item').length).toBe(2)
    expect(api.plotSuggestions).toHaveBeenCalledTimes(1)
  })
})
