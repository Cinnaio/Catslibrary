import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMemory, AgentMemoryPage } from '@shared/ai-agent'
import AiAgentMemory from './AiAgentMemory'

const mocks = vi.hoisted(() => ({ memories: vi.fn(), createMemory: vi.fn(), changeMemory: vi.fn(), memorySource: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: mocks }))
const memory: AgentMemory = {
  id: 'memory',
  novelId: 'novel',
  sessionId: 'session',
  kind: 'agreement',
  title: '保留悬念',
  content: '不要提前揭晓身份',
  status: 'pending',
  sourceEventId: 1,
  supersedesId: null,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}
const page = (...memories: AgentMemory[]): AgentMemoryPage => ({ memories, hasMore: false, summary: null })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.memories.mockResolvedValue(page(memory))
  mocks.memorySource.mockResolvedValue({ source: { id: 1, sessionId: 'session', content: '请记住，不要提前揭晓身份' } })
})
function open(disabled = false) {
  const onChanged = vi.fn()
  const view = render(<AiAgentMemory key="session" sessionId="session" disabled={disabled} pendingCount={1} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: '作品记忆 · 1 待确认' }))
  return { ...view, onChanged }
}
describe('creative memory management', () => {
  it('shows provenance, confirms explicitly, retains failed edits and archives the new version', async () => {
    const { onChanged } = open()
    const pending = await screen.findByRole('article', { name: '保留悬念' })
    fireEvent.click(within(pending).getByRole('button', { name: '查看来源' }))
    await screen.findByText('请记住，不要提前揭晓身份')
    const active = { ...memory, status: 'active' as const, revision: 2 }
    mocks.changeMemory.mockResolvedValueOnce({ memory: active })
    mocks.memories.mockResolvedValueOnce(page(active))
    fireEvent.click(screen.getByRole('button', { name: '确认记住' }))
    await screen.findByText('已记住')
    expect(mocks.changeMemory).toHaveBeenCalledWith('session', 'memory', 'confirm', 1)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByRole('textbox', { name: '记忆内容' }), { target: { value: '只在结尾揭晓身份' } })
    mocks.changeMemory.mockRejectedValueOnce(new Error('网络中断'))
    fireEvent.click(screen.getByRole('button', { name: '保存并记住' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: '记忆内容' })).toHaveValue('只在结尾揭晓身份')
    const edited = { ...active, id: 'new-memory', content: '只在结尾揭晓身份', revision: 3 }
    mocks.changeMemory.mockResolvedValueOnce({ memory: edited })
    mocks.memories.mockResolvedValueOnce(page(edited))
    fireEvent.click(screen.getByRole('button', { name: '保存并记住' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '记忆内容' })).not.toBeInTheDocument())
    mocks.changeMemory.mockResolvedValueOnce({ memory: { ...edited, status: 'archived' } })
    mocks.memories.mockResolvedValueOnce(page({ ...edited, status: 'archived' }))
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    await screen.findByText('还没有作品记忆。可以手动添加，也可以在聊天中明确提出“请记住”。')
    expect(mocks.changeMemory).toHaveBeenLastCalledWith('session', 'new-memory', 'archive', 3)
    expect(onChanged).toHaveBeenCalledTimes(3)
  })
  it('shows both versions before confirming a replacement', async () => {
    mocks.memories.mockResolvedValue(
      page({ ...memory, supersedesId: 'old' }, { ...memory, id: 'old', title: '旧约定', content: '第三章揭晓身份', status: 'active' }),
    )
    open()
    const pending = await screen.findByRole('article', { name: '保留悬念' })
    expect(within(pending).getByText('第三章揭晓身份')).toBeInTheDocument()
    expect(within(pending).getByRole('button', { name: '确认替换' })).toBeEnabled()
    expect(mocks.changeMemory).not.toHaveBeenCalled()
  })
  it('allows reading during a reply but disables mutations', async () => {
    open(true)
    await screen.findByRole('article', { name: '保留悬念' })
    expect(screen.getByRole('button', { name: '确认记住' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看来源' })).toBeEnabled()
  })
  it('reports loading failure without presenting it as an empty collection', async () => {
    mocks.memories.mockRejectedValueOnce(new Error('读取失败'))
    open()
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '添加约定' })).toBeDisabled()
    expect(screen.queryByText(/还没有作品记忆/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByRole('article', { name: '保留悬念' })
  })
  it('discards a late response after switching conversations', async () => {
    let resolve!: (value: AgentMemoryPage) => void
    mocks.memories.mockImplementationOnce(
      () =>
        new Promise<AgentMemoryPage>((done) => {
          resolve = done
        }),
    )
    const view = open()
    await waitFor(() => expect(mocks.memories).toHaveBeenCalled())
    view.rerender(<AiAgentMemory key="other" sessionId="other" disabled={false} pendingCount={0} onChanged={vi.fn()} />)
    mocks.memories.mockResolvedValueOnce(page())
    fireEvent.click(screen.getByRole('button', { name: '作品记忆' }))
    await screen.findByText(/还没有作品记忆/)
    await act(async () => resolve(page(memory)))
    expect(screen.queryByRole('article', { name: '保留悬念' })).not.toBeInTheDocument()
  })
})
