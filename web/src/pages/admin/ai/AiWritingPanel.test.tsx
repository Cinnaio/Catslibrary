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
  novelsApi: { list: vi.fn().mockResolvedValue({ novels: [{ id: 'novel_1', title: '测试小说' }] }) },
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
      {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

import AiWritingPanel from './AiWritingPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

/** 选中小说并等到画像读取完成，后续断言才有稳定的起点。 */
async function selectNovel() {
  render(<AiWritingPanel />)
  await screen.findByRole('option', { name: '测试小说' })
  fireEvent.change(await screen.findByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_1' } })
  await waitFor(() => expect(api.getStyleProfile).toHaveBeenCalledWith('novel_1'))
}

/** Radix Tabs 用键盘事件切换，click 不触发；切到续写模式后再断言。 */
function switchToContinue() {
  const tab = screen.getByRole('tab', { name: '续写' })
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

    const textarea = screen.getByPlaceholderText(/人物、风格、冲突、节奏或本次剧情目标/) as HTMLTextAreaElement
    expect(textarea.value).toBe('夭夜在寝宫与他独处，借双修稳固修为。')
  })

  it('推荐时把侧重与内容参数一并发给后端', async () => {
    await selectNovel()

    fireEvent.change(screen.getByPlaceholderText(/推荐侧重点/), { target: { value: '想写日常互动' } })
    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    expect(api.plotSuggestions.mock.calls[0]![0]).toMatchObject({
      novelId: 'novel_1',
      focus: '想写日常互动',
      contentPreferences: { version: 1, adultContentMode: 'off', intimacyWeight: 'none', adultCharactersConfirmed: false },
    })
  })

  it('开启露骨模式但未确认成年角色时不发起生成', async () => {
    await selectNovel()

    fireEvent.change(screen.getByPlaceholderText(/例如：第一章 雾中来客/), { target: { value: '第一章' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /开启露骨/ }))
    fireEvent.click(screen.getByRole('button', { name: /生成章节/ }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.chapterNovel).not.toHaveBeenCalled()
  })

  it('确认成年角色后按放宽档传参', async () => {
    await selectNovel()

    fireEvent.change(screen.getByPlaceholderText(/例如：第一章 雾中来客/), { target: { value: '第一章' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /开启露骨/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认本次涉及角色均为成年人/ }))
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

  it('生成的大纲填入大纲框并提示章数', async () => {
    api.plotSuggestions.mockResolvedValue({
      suggestions: [],
      outline: '第1章 重返皇城\n苏越带夭夜入城面见加刑天。\n第2章 婚夜\n两人在寝宫独处，约定共进退。',
      usage: { model: 'm', promptTokens: 1, completionTokens: 1 },
    })
    await selectNovel()
    switchToContinue()

    fireEvent.click(screen.getByRole('button', { name: /按情节推荐生成大纲/ }))

    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalled())
    // 大纲模式要把 chapterCount 一并发给后端，后端据此产出对应章数
    expect(api.plotSuggestions.mock.calls[0]![0]).toMatchObject({ novelId: 'novel_1', chapterCount: 1 })

    const textarea = await screen.findByPlaceholderText(/第1章 重返皇城/) as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toContain('第1章 重返皇城'))
    expect(textarea.value).toContain('第2章 婚夜')
  })
})
