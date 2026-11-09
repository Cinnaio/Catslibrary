import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAction, AgentSessionDetail } from '@shared/ai-agent'
import AiAgentPanel from './AiAgentPanel'

const streams = vi.hoisted(() => ({ watch: vi.fn() }))
vi.mock('@/lib/ai-task-stream', () => ({ watchAiTask: streams.watch }))
const mocks = vi.hoisted(() => ({ get: vi.fn(), sessions: vi.fn(), message: vi.fn(), save: vi.fn(), confirm: vi.fn(), reject: vi.fn(), prepare: vi.fn() }))
const providerMocks = vi.hoisted(() => ({ providerPresets: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: { ...mocks } }))
vi.mock('@/lib/api', () => ({
  aiApi: providerMocks,
  chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [] }) },
  newOperationId: () => `request_${Math.random()}`,
  url: (p: string) => p,
}))
vi.mock('@/lib/admin-novel-index', () => ({
  loadAdminNovelIndex: vi.fn().mockResolvedValue([
    { id: 'novel', title: '雨夜', author: '作者' },
    { id: 'other', title: '晨光', author: '作者' },
  ]),
}))
vi.mock('@/components/shared/SearchSelect', () => ({
  default: ({
    value,
    onChange,
    options,
    placeholder,
  }: {
    value: string
    onChange: (s: string) => void
    options: Array<{ value: string; label: string }>
    placeholder?: string
  }) => (
    <select aria-label={placeholder || '选项'} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">请选择</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

function detail(id = 'session', novelId = 'novel'): AgentSessionDetail {
  return {
    session: {
      id,
      novelId,
      novelTitle: '雨夜',
      title: '讨论情节',
      afterChapterId: 'chapter',
      anchorTitle: '第一章',
      brief: '',
      contentPreferences: { version: 1, adultContentMode: 'off', intimacyWeight: 'none', adultCharactersConfirmed: false },
      activeTaskId: '',
      createdAt: 1,
      updatedAt: 1,
    },
    events: [{ id: 1, role: 'assistant', content: `${id} 的既有回复`, taskId: '', metadata: {}, createdAt: 1 }],
    hasEarlier: false,
    activeTask: null,
    artifacts: [],
    actions: [],
  }
}
function Navigation() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/admin/ai?sub=agent&novel=other&session=other-session')}>切到另一本书</button>
}
function open() {
  return render(
    <MemoryRouter initialEntries={['/admin/ai?sub=agent&novel=novel&session=session']}>
      <Navigation />
      <AiAgentPanel />
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  streams.watch.mockReturnValue(() => {})
  mocks.sessions.mockResolvedValue({ sessions: [], hasMore: false })
  mocks.get.mockResolvedValue(detail())
  mocks.message.mockResolvedValue({ taskId: 'turn', created: true })
  providerMocks.providerPresets.mockResolvedValue({
    presets: [
      { id: 'text-backup', scope: 'text', name: '备用文本', model: 'backup-model', hasApiKey: true, active: false },
      { id: 'image-backup', scope: 'image', name: '封面模型', model: 'image-model', hasApiKey: true, active: false },
    ],
  })
  providerMocks.status.mockResolvedValue({ model: 'default-model', configured: true })
})

describe('creative agent conversation', () => {
  it('selects an existing text preset for the message and changes the retry ID when the selection changes', async () => {
    mocks.message.mockRejectedValueOnce(new Error('连接中断'))
    open()
    const picker = await screen.findByRole('button', { name: '切换模型，当前default-model' })
    fireEvent.pointerDown(picker, { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitemradio', { name: /备用文本/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: /封面模型/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /备用文本/ }))
    const input = screen.getByLabelText('发送给创作助手的消息')
    fireEvent.change(input, { target: { value: '继续讨论动机' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await screen.findByText(/连接中断/)
    expect(mocks.message).toHaveBeenLastCalledWith('session', '继续讨论动机', expect.any(String), 'text-backup')
    const firstId = mocks.message.mock.calls[0]?.[2]
    fireEvent.pointerDown(screen.getByRole('button', { name: '切换模型，当前backup-model' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /跟随默认/ }))
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(mocks.message).toHaveBeenCalledTimes(2))
    expect(mocks.message.mock.calls[1]?.[3]).toBe('')
    expect(mocks.message.mock.calls[1]?.[2]).not.toBe(firstId)
    await waitFor(() => expect(input).toHaveValue(''))
  })
  it('restores the latest conversation preset and locks its picker during an active turn', async () => {
    const data = detail()
    data.events.unshift({
      id: 0,
      role: 'user',
      content: '继续',
      taskId: 'turn',
      metadata: { providerPresetId: 'text-backup', model: 'backup-model' },
      createdAt: 0,
    })
    data.activeTask = { id: 'turn', kind: 'agent_chat', status: 'running', step: '正在整理', current: 0, total: 8, error: '' }
    mocks.get.mockResolvedValue(data)
    open()
    expect(await screen.findByRole('button', { name: '切换模型，当前backup-model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '停止回复' })).toBeEnabled()
    expect(screen.getByLabelText('发送给创作助手的消息')).toBeEnabled()
    const input = screen.getByLabelText('发送给创作助手的消息')
    fireEvent.change(input, { target: { value: '下一轮再讨论' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.message).not.toHaveBeenCalled()
    expect(input).toHaveValue('下一轮再讨论')
  })
  it('renders assistant Markdown with headings, emphasis, lists, tables and literal code', async () => {
    const data = detail()
    data.events[0]!.content = [
      '## 后续情节',
      '',
      '**人物动机**与*情绪*，~~旧方案~~。',
      '',
      '- 第一条线索',
      '- 第二条线索',
      '',
      '1. 铺垫',
      '2. 转折',
      '',
      '> 保留悬念',
      '',
      '| 角色 | 目标 |',
      '| --- | --- |',
      '| 主角 | 寻找真相 |',
      '',
      '- [x] 完成构思',
      '- [ ] 补充对白',
      '',
      '[参考章节](/novel/novel) 和 `chapter_id`',
      '',
      '```html',
      '<b>**这里是代码**</b>',
      '```',
    ].join('\n')
    mocks.get.mockResolvedValue(data)
    open()
    expect(await screen.findByRole('heading', { name: '后续情节', level: 2 })).toBeInTheDocument()
    const log = screen.getByRole('log', { name: '对话记录' })
    expect(within(log).getByText('人物动机').tagName).toBe('STRONG')
    expect(within(log).getByText('情绪').tagName).toBe('EM')
    expect(within(log).getByText('旧方案').tagName).toBe('DEL')
    expect(within(log).getByText('第一条线索').closest('ul')).not.toBeNull()
    expect(within(log).getByText('转折').closest('ol')).not.toBeNull()
    expect(within(log).getByText('保留悬念').closest('blockquote')).not.toBeNull()
    expect(within(within(log).getByRole('table')).getByRole('cell', { name: '寻找真相' })).toBeInTheDocument()
    const checkboxes = within(log).getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
    checkboxes.forEach((checkbox) => expect(checkbox).toBeDisabled())
    expect(within(log).getByRole('link', { name: '参考章节' })).toHaveAttribute('href', '/novel/novel')
    expect(within(log).getByText('chapter_id').tagName).toBe('CODE')
    const code = within(log).getByText('<b>**这里是代码**</b>')
    expect(code.tagName).toBe('CODE')
    expect(code.closest('pre')).not.toBeNull()
    expect(code.querySelector('b')).toBeNull()
  })
  it('does not render raw HTML or unsafe Markdown links in assistant replies', async () => {
    const data = detail()
    data.events[0]!.content = [
      '安全回复',
      '',
      '<script>alert("unsafe")</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '[不安全链接](javascript:alert%281%29)',
      '',
      '[正常链接](https://example.com/story)',
    ].join('\n')
    mocks.get.mockResolvedValue(data)
    open()
    await screen.findByText('安全回复')
    const log = screen.getByRole('log', { name: '对话记录' })
    expect(log.querySelector('script, img, iframe')).toBeNull()
    expect(within(log).getByText('不安全链接').closest('a')).toBeNull()
    const link = within(log).getByRole('link', { name: '正常链接' })
    expect(link).toHaveAttribute('href', 'https://example.com/story')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
  it('keeps user input, activity messages and errors as literal text', async () => {
    const data = detail()
    data.events = [
      { id: 1, role: 'user', content: '## 保留我的 **原文**', taskId: '', metadata: {}, createdAt: 1 },
      { id: 2, role: 'activity', content: '**任务状态**', taskId: '', metadata: {}, createdAt: 2 },
      { id: 3, role: 'assistant', content: '**错误详情**', taskId: '', metadata: { error: true }, createdAt: 3 },
      { id: 4, role: 'assistant', content: '**正常回复**', taskId: '', metadata: {}, createdAt: 4 },
    ]
    mocks.get.mockResolvedValue(data)
    open()
    expect(await screen.findByText('## 保留我的 **原文**')).toBeInTheDocument()
    expect(screen.getByText('**任务状态**')).toBeInTheDocument()
    expect(screen.getByText('**错误详情**')).toBeInTheDocument()
    expect(screen.getByText('正常回复').tagName).toBe('STRONG')
  })
  it('preserves text entered while an earlier message is being submitted', async () => {
    let finish!: () => void
    mocks.message.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ taskId: 'turn', created: true })
        }),
    )
    open()
    await screen.findByText('session 的既有回复')
    const input = screen.getByLabelText('发送给创作助手的消息')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.message).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '先讨论方向' } })
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    expect(mocks.message).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    expect(mocks.message).toHaveBeenCalledTimes(1)
    expect(mocks.message).toHaveBeenLastCalledWith('session', '先讨论方向', expect.any(String), '')
    fireEvent.change(input, { target: { value: '还有人物的动机' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.message).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(input).toHaveValue('还有人物的动机')
  })
  it('preserves the edited settings version and allows discarding a conflicting draft', async () => {
    mocks.save.mockRejectedValueOnce(new Error('会话已变化，请刷新后再保存'))
    open()
    await screen.findByText('session 的既有回复')
    fireEvent.click(screen.getByText(/创作约定与偏好/))
    const brief = screen.getByLabelText('这段对话始终遵循的创作约定')
    fireEvent.change(brief, { target: { value: '保留第一人称' } })
    mocks.get.mockResolvedValue({ ...detail(), session: { ...detail().session, brief: '另一个窗口的约定', updatedAt: 2 } })
    fireEvent.change(screen.getByLabelText('发送给创作助手的消息'), { target: { value: '先聊一聊' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '保存创作约定' }))
    await screen.findByText(/会话已变化/)
    expect(mocks.save).toHaveBeenCalledWith('session', '保留第一人称', detail().session.contentPreferences, 1)
    expect(brief).toHaveValue('保留第一人称')
    fireEvent.click(screen.getByRole('button', { name: '取消调整' }))
    expect(brief).toHaveValue('另一个窗口的约定')
  })
  it('keeps a stable request ID when retrying a lost submission response', async () => {
    mocks.message.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce({ taskId: 'turn', created: false })
    open()
    await screen.findByText('session 的既有回复')
    fireEvent.change(screen.getByLabelText('发送给创作助手的消息'), { target: { value: '帮我讨论后续情节' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText(/连接中断/)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.message).toHaveBeenCalledTimes(2))
    expect(mocks.message.mock.calls[0]?.[2]).toBe(mocks.message.mock.calls[1]?.[2])
    await waitFor(() => expect(screen.getByLabelText('发送给创作助手的消息')).toHaveValue(''))
  })
  it('shows the saved proposal and performs no adoption until explicit confirmation', async () => {
    const action: AgentAction = {
      id: 'action',
      kind: 'apply_rewrite',
      title: '采纳改写到草稿',
      status: 'pending',
      preview: { description: '只修改已选段落', before: '原来的段落', after: '建议的新段落' },
      error: '',
      createdAt: 2,
    }
    mocks.get.mockResolvedValue({ ...detail(), actions: [action] })
    mocks.confirm.mockResolvedValue({ action: { ...action, status: 'completed' } })
    open()
    await screen.findByText('采纳改写到草稿')
    expect(mocks.confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '查看并确认' }))
    expect(await screen.findByText('原来的段落')).toBeInTheDocument()
    expect(screen.getByText('建议的新段落')).toBeInTheDocument()
    expect(mocks.confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认采纳' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('session', 'action'))
  })
  it('does not let a late response replace the newly selected book and conversation', async () => {
    let resolveOld!: (value: AgentSessionDetail) => void
    mocks.get.mockImplementation((id: string) =>
      id === 'session'
        ? new Promise<AgentSessionDetail>((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve(detail('other-session', 'other')),
    )
    open()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('session'))
    fireEvent.click(screen.getByRole('button', { name: '切到另一本书' }))
    await screen.findByText('other-session 的既有回复')
    await act(async () => {
      resolveOld(detail())
      await Promise.resolve()
    })
    expect(screen.queryByText('session 的既有回复')).not.toBeInTheDocument()
    expect(screen.getByText('other-session 的既有回复')).toBeInTheDocument()
  })
})

it('renders a live Markdown reply once, deduplicates its saved round and detaches on book switch', async () => {
  const initial = detail()
  initial.activeTask = { id: 'turn', kind: 'agent_chat', status: 'running', current: 0, total: 8, step: '正在回复', error: '', result: '' }
  mocks.get.mockResolvedValue(initial)
  const stopped = vi.fn()
  streams.watch.mockReturnValue(stopped)
  open()
  await waitFor(() => expect(streams.watch).toHaveBeenCalledWith('turn', expect.any(Function)))
  const emit = streams.watch.mock.calls[0]![1]
  const result = JSON.stringify({ kind: 'text-progress', phase: 'writing', preview: '**正在生成的回复**', generatedCharacters: 11, reasoningCharacters: 0, startedAt: 1, updatedAt: 2, round: 0 })
  act(() => emit({ ...initial.activeTask, result }))
  expect(await screen.findByText('正在生成的回复')).toHaveProperty('tagName', 'STRONG')
  const saved = { ...initial, events: [...initial.events, { id: 2, role: 'assistant' as const, content: '**正在生成的回复**', taskId: 'turn', metadata: { round: 0 }, createdAt: 2 }], activeTask: { ...initial.activeTask!, status: 'completed' as const, result: '' } }
  mocks.get.mockResolvedValue(saved)
  act(() => emit({ ...saved.activeTask }))
  await waitFor(() => expect(screen.getAllByText('正在生成的回复')).toHaveLength(1))
  mocks.get.mockResolvedValue(detail('other-session', 'other'))
  fireEvent.click(screen.getByText('切到另一本书'))
  await screen.findByText('other-session 的既有回复')
  expect(stopped).toHaveBeenCalled()
  expect(screen.queryByText('正在生成的回复')).not.toBeInTheDocument()
})
