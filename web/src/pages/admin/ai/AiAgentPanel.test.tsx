import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAction, AgentSessionDetail } from '@shared/ai-agent'
import AiAgentPanel from './AiAgentPanel'

const mocks = vi.hoisted(() => ({ get: vi.fn(), sessions: vi.fn(), message: vi.fn(), save: vi.fn(), confirm: vi.fn(), reject: vi.fn(), prepare: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: { ...mocks } }))
vi.mock('@/lib/api', () => ({
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
  mocks.sessions.mockResolvedValue({ sessions: [], hasMore: false })
  mocks.get.mockResolvedValue(detail())
  mocks.message.mockResolvedValue({ taskId: 'turn', created: true })
})

describe('creative agent conversation', () => {
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
    fireEvent.change(input, { target: { value: '先讨论方向' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    fireEvent.change(input, { target: { value: '还有人物的动机' } })
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
