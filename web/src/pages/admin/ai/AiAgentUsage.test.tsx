import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentTurnUsage } from '@shared/ai-agent'
import { setStorageUser } from '@/lib/storage'
import AiAgentUsage from './AiAgentUsage'
const current: AgentTurnUsage = {
  taskId: 'turn',
  status: 'running',
  startedAt: 1,
  elapsedMs: 65000,
  tracked: true,
  chatCalls: 2,
  summaryCalls: 1,
  inputTokens: 2000,
  outputTokens: 500,
  unknownTokenCalls: 1,
  costs: [
    { currency: 'USD', amount: 0.01 },
    { currency: 'CNY', amount: 0.03 },
  ],
  unknownCostCalls: 2,
}
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('user_session_marker', 'test-marker')
  setStorageUser('owner')
})
describe('agent usage panel', () => {
  it('separates currencies, incomplete usage and independent generation costs', () => {
    render(<AiAgentUsage turns={[current]} />)
    fireEvent.click(screen.getByText('本轮用量'))
    expect(screen.getByText(/助手 2 次 · 摘要 1 次/)).toBeInTheDocument()
    const details = within(screen.getByRole('region', { name: '本轮用量明细' }))
    expect(details.getByText('已记录输入 Token').nextElementSibling).toHaveTextContent('2,000')
    expect(details.getByText('已记录输出 Token').nextElementSibling).toHaveTextContent('500')
    expect(screen.getByText(/USD 0.01；CNY 0.03/)).toBeInTheDocument()
    expect(screen.getByText(/2 次调用费用未知/)).toBeInTheDocument()
    expect(screen.getByText(/1 次调用未完整回传 Token/)).toBeInTheDocument()
    expect(screen.getByText(/不含独立草稿、封面和分析生成/)).toBeInTheDocument()
  })
  it('keeps reminders opt-in, persists per account and never automatically stops work', () => {
    const view = render(<AiAgentUsage turns={[current]} />)
    expect(screen.queryByText(/达到 .* 的提醒值/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('本轮用量'))
    fireEvent.change(screen.getByLabelText('单轮 Token 提醒值'), { target: { value: '2000' } })
    fireEvent.click(screen.getByText('保存提醒'))
    expect(screen.getByText(/达到 2,000 的提醒值.*不会自动停止任务/)).toBeInTheDocument()
    setStorageUser('other')
    view.rerender(<AiAgentUsage turns={[current]} />)
    expect(screen.queryByText(/达到 .* 的提醒值/)).not.toBeInTheDocument()
    setStorageUser('owner')
    view.rerender(<AiAgentUsage turns={[current]} />)
    expect(screen.getByText(/达到 2,000 的提醒值/)).toBeInTheDocument()
  })
  it('does not present legacy or missing accounting as zero cost', () => {
    render(
      <AiAgentUsage
        turns={[
          { ...current, tracked: false },
          { ...current, taskId: 'pending', chatCalls: 0, summaryCalls: 0, costs: [] },
        ]}
      />,
    )
    fireEvent.click(screen.getByText(/旧轮次未关联用量/))
    expect(screen.getByText(/旧轮次没有精确关联记录/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('之前的用量'))
    expect(screen.getByText(/不能据此认定没有产生费用/)).toBeInTheDocument()
  })
})
