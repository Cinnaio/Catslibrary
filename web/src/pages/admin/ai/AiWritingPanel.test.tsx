import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

async function openAnalysis() {
  fireEvent.click(await screen.findByRole('button', { name: /小说分析/ }))
}

describe('AiWritingPanel', () => {
  it.each(['thinking', 'writing'])('shows an explicitly unfinished archive preview during %s', async (phase) => {
    api.getRelationshipProfile.mockResolvedValue({ profile: '', memoryTask: { id: 'live', status: 'running', current: 0, total: 1, step: '', livePreview: { kind: 'text-progress', phase, preview: phase === 'writing' ? '部分档案正文' : '', generatedCharacters: 6, reasoningCharacters: 123, startedAt: 1, updatedAt: 2 } } })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    if (phase === 'thinking') {
      expect(await screen.findByText(/123 个思考字符/)).toBeInTheDocument()
      expect(screen.queryByText('部分档案正文')).not.toBeInTheDocument()
    } else {
      expect(await screen.findByText('部分档案正文')).toBeInTheDocument()
      expect(screen.getByText(/未完成，尚未保存/)).toBeInTheDocument()
    }
  })
  beforeEach(() => {
    vi.clearAllMocks()
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

  it.each([
    { label: '关系画像每批章数', action: '更新关系档案', kind: 'relationship' },
    { label: '情节状态每批章数', action: '更新情节档案', kind: 'plot' },
  ])('$label 清空后可重新输入，不回跳默认值且提交最新数字', async ({ label, action, kind }) => {
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    const input = screen.getByRole('spinbutton', { name: label })
    fireEvent.change(input, { target: { value: '' } })
    expect(input).toHaveValue(null)
    fireEvent.change(input, { target: { value: '7' } })
    expect(input).toHaveValue(7)
    // 直接提交，覆盖没有先手动移开焦点的使用方式。
    fireEvent.click(screen.getByRole('button', { name: action }))
    await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('novel_1', kind, 7, undefined))
  })

  it.each(['关系画像每批章数', '情节状态每批章数'])('%s 在失焦时校正范围并保留最近有效值', async (label) => {
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    const input = screen.getByRole('spinbutton', { name: label })
    for (const [raw, normalized] of [['0', 1], ['35', 30], ['7.5', 7]] as const) {
      fireEvent.change(input, { target: { value: raw } })
      expect(input).toHaveValue(Number(raw))
      fireEvent.blur(input)
      expect(input).toHaveValue(normalized)
    }
    fireEvent.change(input, { target: { value: '' } })
    expect(input).toHaveValue(null)
    fireEvent.blur(input)
    expect(input).toHaveValue(7)
    expect(api.startMemoryTask).not.toHaveBeenCalled()
  })

  it.each([
    { label: '关系画像每批章数', action: '更新关系档案', kind: 'relationship' },
    { label: '情节状态每批章数', action: '更新情节档案', kind: 'plot' },
  ])('$label 清空后直接提交沿用最近有效数字', async ({ label, action, kind }) => {
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    const input = screen.getByRole('spinbutton', { name: label })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: action }))
    await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('novel_1', kind, 7, undefined))
  })

  it('超时诊断显示等待上限与未知用量，不把未收到的响应写成零输出', async () => {
    api.getRelationshipProfile.mockResolvedValue({ profile: '', lastAttempt: { status: 'timeout', maxTokens: 4000, completionTokens: null, reasoningTokens: null, timeoutMs: 450000, elapsedMs: 450001, finishReason: '', updatedAt: 1 }, memoryTask: { id: 'timeout-task', status: 'failed', error: '关系档案请求超时' } })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    expect(await screen.findByText(/最近提取：请求超时 · 等待上限 450 秒/)).toHaveTextContent('用量未确认')
    expect(screen.queryByText(/输出 0 Token/)).not.toBeInTheDocument()
    expect(api.startMemoryTask).not.toHaveBeenCalled()
  })

  it('部分分析显示保存进度与阶段内容，并明确未用于续写', async () => {
    api.getPlotState.mockResolvedValue({
      state: '', effectiveContent: '',
      progress: { complete: false, processedChapters: 17, totalChapters: 47, previewContent: '阶段分析：钥匙来源待确认', targetChapterId: 'c47' },
    })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    expect(await screen.findByText('部分完成')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '情节状态章节覆盖进度' })).toHaveAttribute('value', '17')
    expect(screen.getByText('尚余 30 章；阶段内容仅供查看，完整覆盖目标后才用于续写。')).toBeInTheDocument()
    fireEvent.click(screen.getByText('查看已保存的阶段内容'))
    expect(screen.getByText('阶段分析：钥匙来源待确认')).toBeVisible()
    expect(screen.getByLabelText('可用 0 项小说分析')).toBeInTheDocument()
  })

  it('提交后台任务后只读轮询，完整结果返回后恢复操作', async () => {
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    fireEvent.click(screen.getByRole('button', { name: '更新情节档案' }))
    await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('novel_1', 'plot', 8, undefined))
    expect(await screen.findByRole('button', { name: '暂停更新' })).toBeInTheDocument()
    api.getPlotState.mockResolvedValue({ state: '完整情节档案', effectiveContent: '完整情节档案', source: { coverage: 'full' }, chaptersThrough: 47, memoryTask: { id: 'memory-1', status: 'completed' }, progress: { complete: true, processedChapters: 47, totalChapters: 47 } })
    await waitFor(() => expect(screen.getByText(/档案截至第 47 章/)).toBeInTheDocument(), { timeout: 4000 })
    expect(screen.getByRole('button', { name: '更新情节档案' })).toBeEnabled()
    expect(api.startMemoryTask).toHaveBeenCalledTimes(1)
    expect(api.refreshPlotState).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'plot', label: '情节', get: api.getPlotState, initial: { state: '' } },
    { kind: 'relationship', label: '关系', get: api.getRelationshipProfile, initial: { profile: '' } },
  ])('$kind 可以暂停后台任务并从检查点继续', async ({ kind, label, get, initial }) => {
    get.mockResolvedValue({ ...initial, memoryTask: { id: 'old-task', status: 'running' }, progress: { complete: false, processedChapters: 8, totalChapters: 18, targetChapterId: 'chapter-18' } })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    fireEvent.click(await screen.findByRole('button', { name: '暂停更新' }))
    expect(api.pauseMemory).toHaveBeenCalledWith('novel_1', kind)
    expect(await screen.findByRole('button', { name: '正在暂停…' })).toBeDisabled()
    get.mockResolvedValue({ ...initial, memoryTask: { id: 'old-task', status: 'cancelled' }, progress: { complete: false, paused: true, processedChapters: 8, totalChapters: 18, targetChapterId: 'chapter-18' } })
    await waitFor(() => expect(screen.getByText(/已暂停 · 已保存 8 \/ 18 章/)).toBeInTheDocument(), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: `继续更新${label}档案` }))
    await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('novel_1', kind, kind === 'plot' ? 8 : 10, 'chapter-18'))
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
    fireEvent.click(screen.getByRole('button', { name: '推荐情节' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      writingBrief: expect.objectContaining({ objective: '建立初步信任', forbiddenEvents: '不得揭露真实身份' }),
      timeoutSeconds: 300,
    })))
    api.plotSuggestions.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '按情节推荐生成大纲（单章）' }))
    await waitFor(() => expect(api.plotSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      chapterCount: 1,
      timeoutSeconds: 300,
      writingBrief: expect.objectContaining({ objective: '建立初步信任', forbiddenEvents: '不得揭露真实身份' }),
    })))
    expect(localStorage.getItem('zz-ai-plot-timeout-seconds')).toBe('300')
  })

  it('重新打开页面显示可恢复进度，并沿用原目标而不是新增章节', async () => {
    api.getPlotState.mockResolvedValue({ state: '', progress: { complete: false, processedChapters: 3, totalChapters: 12, targetChapterId: 'saved-target' } })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    expect(await screen.findByText(/可继续 · 已保存 3 \/ 12 章/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续更新情节档案' }))
    await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('novel_1', 'plot', 8, 'saved-target'))
  })

  it('离开页面不自动暂停已提交的后台任务', async () => {
    const view = render(<AiWritingPanel initialNovelId="novel_1" />)
    await openAnalysis()
    await waitFor(() => expect(screen.getByRole('button', { name: '更新情节档案' })).toBeEnabled())
    // 初次选书的档案请求发起后再提交，避免把初始化请求的版本切换混进离页测试。
    await waitFor(() => expect(api.getPlotState).toHaveBeenCalledWith('novel_1'))
    fireEvent.click(screen.getByRole('button', { name: '更新情节档案' }))
    await screen.findByRole('button', { name: '暂停更新' })
    view.unmount()
    expect(api.startMemoryTask).toHaveBeenCalledTimes(1)
    expect(api.pauseMemory).not.toHaveBeenCalled()
    expect(api.refreshPlotState).not.toHaveBeenCalled()
  })

  it('提交响应已完成时立即同步档案，不等待运行中轮询', async () => {
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    api.startMemoryTask.mockResolvedValue({ ok: true, task: { id: 'instant-memory', status: 'completed' } })
    api.getPlotState.mockResolvedValue({ state: '缓存中的完整档案', chaptersThrough: 47, source: { coverage: 'full' }, memoryTask: { id: 'instant-memory', status: 'completed' } })
    fireEvent.click(screen.getByRole('button', { name: '更新情节档案' }))
    expect(await screen.findByText(/档案截至第 47 章/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新情节档案' })).toBeEnabled()
  })

  it('恢复页面中的运行批次可暂停，暂停失败后按钮允许重试', async () => {
    api.getPlotState.mockResolvedValue({ state: '', progress: { running: true, complete: false, processedChapters: 1, totalChapters: 8, targetChapterId: 'c8' } })
    api.pauseMemory.mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ ok: true })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    expect(await screen.findByRole('button', { name: '继续更新情节档案' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '暂停更新' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '暂停更新' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '暂停更新' }))
    await waitFor(() => expect(api.pauseMemory).toHaveBeenCalledTimes(2))
    expect(api.refreshPlotState).not.toHaveBeenCalled()
  })

  it('后台任务失败时显示错误和检查点，允许手动继续且不自动付费重试', async () => {
    api.getPlotState.mockResolvedValue({ state: '', memoryTask: { id: 'failed-memory', status: 'failed', error: '上游超时 HTTP 524' }, progress: { complete: false, processedChapters: 17, totalChapters: 47, targetChapterId: 'c47' } })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    expect(await screen.findByRole('alert')).toHaveTextContent('上游超时 HTTP 524')
    expect(screen.getByRole('button', { name: '继续更新情节档案' })).toBeEnabled()
    expect(api.startMemoryTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '继续更新情节档案' }))
    await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('novel_1', 'plot', 8, 'c47'))
  })

  it('提交期间切换小说，不把旧任务写到新书', async () => {
    const pending = deferred<object>()
    api.startMemoryTask.mockReturnValueOnce(pending.promise)
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    fireEvent.click(screen.getByRole('button', { name: '更新情节档案' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.change(screen.getByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_2' } })
    await waitFor(() => expect(api.getPlotState).toHaveBeenCalledWith('novel_2'))
    await act(async () => pending.resolve({ ok: true, task: { id: 'old-task', status: 'running' } }))
    expect(screen.queryByRole('button', { name: '暂停更新' })).not.toBeInTheDocument()
  })

  it('旧抽样档案显示待初始化，不计入可用记忆', async () => {
    api.getPlotState.mockResolvedValue({ state: '旧抽样情节', chaptersThrough: 8, chapterCount: 80, eligibility: 'legacy_unknown', effectiveContent: '' })
    api.getRelationshipProfile.mockResolvedValue({ profile: '旧抽样关系', eligibility: 'legacy_unknown', effectiveContent: '' })
    await selectNovel()
    switchToContinue()
    await openAnalysis()
    expect(await screen.findAllByText('待初始化')).toHaveLength(2)
    expect(screen.getByLabelText('可用 0 项小说分析')).toBeInTheDocument()
    expect(screen.getByText('当前为旧版取样结果，请更新档案以完成全部历史初始化。')).toBeInTheDocument()
  })

  it('默认进入续写，内容尺度保留在续写基线中，小说分析收纳于弹窗', async () => {
    render(<AiWritingPanel initialNovelId="novel_1" />)

    expect(screen.getByRole('tab', { name: '续写' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('heading', { name: '续写基线' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '内容尺度' })).toBeInTheDocument()

    const baseline = screen.getByRole('heading', { name: '续写基线' }).closest('.ai-writing-baseline')
    expect(baseline?.contains(screen.getByRole('switch', { name: /开启露骨/ }))).toBe(true)

    const analysisBtn = await screen.findByRole('button', { name: /小说分析/ })
    expect(analysisBtn).toBeInTheDocument()
    fireEvent.click(analysisBtn)
    expect(await screen.findByRole('heading', { name: '小说分析' })).toBeInTheDocument()
    expect(screen.getByText('风格画像')).toBeInTheDocument()
  })

  it('从任务页带入小说参数时只在小说列表就绪后预选对应小说', async () => {
    render(<AiWritingPanel initialNovelId="novel_2" />)

    const novelSelect = await screen.findByRole('combobox', { name: '目标小说' })
    await screen.findByRole('option', { name: '第二本书' })
    await waitFor(() => expect(novelSelect).toHaveValue('novel_2'))
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

    await openAnalysis()
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

    const textarea = screen.getByLabelText('本次情节') as HTMLTextAreaElement
    expect(textarea.value).toBe('夭夜在寝宫与他独处，借双修稳固修为。')
  })

  it('填入候选后可以撤销，恢复被覆盖的原文', async () => {
    await selectNovel()

    // 先手写一段内容
    const textarea = screen.getByLabelText('本次情节') as HTMLTextAreaElement
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

    const textarea = screen.getByLabelText('本次情节') as HTMLTextAreaElement
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
