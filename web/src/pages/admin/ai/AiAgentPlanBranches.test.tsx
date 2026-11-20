import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentChapterPlan, AgentChapterPlanBranchState } from '@shared/ai-agent'
import { Dialog } from '@/components/ui/dialog'
import AiAgentPlanBranches from './AiAgentPlanBranches'

const api = vi.hoisted(() => ({ planBranches: vi.fn(), savePlanBranch: vi.fn(), selectPlanBranch: vi.fn(), removePlanBranch: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: api }))
const plan: AgentChapterPlan = { version: 1, revision: 2, updatedAt: 1, title: '雨夜', goal: '先向同伴求助', beats: '核对信件\n共同赴约', characters: '', ending: '同伴认出笔迹', constraints: '不揭露身份', targetWords: 3000 }
const branch = { id: 'branch-a', name: '独自行动', plan: { ...plan, revision: 1, goal: '独自赴约', beats: '查验封口\n独自赴约', ending: '第二个地址', targetWords: 2300 }, source: 'saved' as const, createdAt: 1 }
const initial: AgentChapterPlanBranchState = { plan, branches: [branch] }
function setup(disabled = false) {
  const p = { sessionId: 'session', disabled, onBusyChange: vi.fn(), onBack: vi.fn(), onChanged: vi.fn(), onSelected: vi.fn() }
  const view = render(<Dialog open><AiAgentPlanBranches {...p} /></Dialog>)
  return { p, view, user: userEvent.setup() }
}
beforeEach(() => {
  vi.resetAllMocks()
  api.planBranches.mockResolvedValue(initial)
})
it('compares the current and saved route and filters unchanged fields without mutating plans', async () => {
  const { user } = setup()
  await screen.findByRole('button', { name: '独自行动' })
  const goals = screen.getByRole('region', { name: '章节目标对比' })
  expect(within(goals).getByText('先向同伴求助')).toBeInTheDocument()
  expect(within(goals).getByText('独自赴约')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: '只看不同' }))
  expect(screen.queryByRole('region', { name: '章节标题对比' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '本章约束对比' })).not.toBeInTheDocument()
  expect(api.selectPlanBranch).not.toHaveBeenCalled()
  expect(api.savePlanBranch).not.toHaveBeenCalled()
})
it('saves a named server-side snapshot and retains its operation id after an ambiguous failure', async () => {
  const saved = { ...initial, branches: [branch, { ...branch, id: 'branch-b', name: '同伴路线', plan }] }
  api.savePlanBranch.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce(saved)
  const { p, user } = setup()
  await screen.findByRole('button', { name: '独自行动' })
  await user.type(screen.getByLabelText('分支名称'), '同伴路线')
  await user.click(screen.getByRole('button', { name: '保存当前计划为分支' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('网络中断')
  expect(screen.getByLabelText('分支名称')).toHaveValue('同伴路线')
  expect(screen.getByRole('button', { name: '设为当前计划' })).toBeDisabled()
  const args = api.savePlanBranch.mock.calls[0]!
  expect(args).toEqual(['session', '同伴路线', 2, expect.any(String)])
  await user.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(p.onChanged).toHaveBeenCalledWith(plan))
  expect(api.savePlanBranch.mock.calls[1]).toEqual(args)
  expect(screen.getByLabelText('分支名称')).toHaveValue('')
  expect(p.onSelected).not.toHaveBeenCalled()
})
it('switches only after explicit selection and returns to plan review without starting generation', async () => {
  const selected = { ...branch.plan, revision: 3, sourceBranch: { id: branch.id, name: branch.name } }
  api.selectPlanBranch.mockResolvedValue({ plan: selected, branches: initial.branches })
  const { p, user } = setup()
  await screen.findByRole('button', { name: '独自行动' })
  expect(api.selectPlanBranch).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '设为当前计划' }))
  await waitFor(() => expect(p.onSelected).toHaveBeenCalledOnce())
  expect(api.selectPlanBranch).toHaveBeenCalledExactlyOnceWith('session', branch.id, 2, expect.any(String))
  expect(p.onChanged).toHaveBeenCalledWith(selected)
  expect(p.onBusyChange.mock.calls).toEqual([[true], [false]])
})
it('refreshes a stale plan after conflict before allowing another switch', async () => {
  api.selectPlanBranch.mockRejectedValueOnce(Object.assign(new Error('当前计划已变化'), { status: 409 }))
  const { user } = setup()
  await screen.findByRole('button', { name: '独自行动' })
  await user.click(screen.getByRole('button', { name: '设为当前计划' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('当前计划已变化')
  api.planBranches.mockResolvedValue({ ...initial, plan: { ...plan, revision: 4 } })
  await user.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByText('当前计划 · 第 4 版《雨夜》 · 分支 1/8')
  api.selectPlanBranch.mockResolvedValue({ ...initial, plan: { ...branch.plan, revision: 5 } })
  await user.click(screen.getByRole('button', { name: '设为当前计划' }))
  await waitFor(() => expect(api.selectPlanBranch).toHaveBeenCalledTimes(2))
  expect(api.selectPlanBranch.mock.calls[1]![2]).toBe(4)
  expect(api.selectPlanBranch.mock.calls[1]![3]).not.toBe(api.selectPlanBranch.mock.calls[0]![3])
})
it('requires a named confirmation before removing a branch and keeps the current plan', async () => {
  api.removePlanBranch.mockResolvedValue({ plan, branches: [] })
  const { p, user } = setup()
  await screen.findByRole('button', { name: '独自行动' })
  await user.click(screen.getByRole('button', { name: '移除分支' }))
  expect(api.removePlanBranch).not.toHaveBeenCalled()
  expect(screen.getByRole('group', { name: '移除分支确认' })).toHaveTextContent('独自行动')
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(api.removePlanBranch).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '移除分支' }))
  await user.click(screen.getByRole('button', { name: '确认移除' }))
  expect(await screen.findByText('还没有保存的分支')).toBeInTheDocument()
  expect(api.removePlanBranch).toHaveBeenCalledExactlyOnceWith('session', branch.id)
  expect(p.onChanged).toHaveBeenCalledWith(plan)
})
it('keeps unavailable lists distinct from empty lists and prevents mutation while a turn is active', async () => {
  api.planBranches.mockRejectedValueOnce(new Error('读取失败'))
  const { user } = setup(true)
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败')
  expect(screen.queryByText('还没有保存的分支')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存当前计划为分支' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByRole('button', { name: '独自行动' })
  expect(screen.getByRole('button', { name: '保存当前计划为分支' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '设为当前计划' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '移除分支' })).toBeDisabled()
})
it('shows loading and ignores a late read after closing the comparison', async () => {
  let resolve!: (value: AgentChapterPlanBranchState) => void
  api.planBranches.mockReturnValue(new Promise<AgentChapterPlanBranchState>(done => { resolve = done }))
  const { view, p } = setup()
  expect(screen.getByRole('status')).toHaveTextContent('正在读取章节分支')
  view.unmount()
  await act(async () => resolve(initial))
  expect(p.onChanged).not.toHaveBeenCalled()
})
it('disables duplicate selection for an identical branch and blocks saving past capacity', async () => {
  api.planBranches.mockResolvedValue({ plan, branches: Array.from({ length: 8 }, (_, i) => ({ ...branch, id: 'branch-' + i, name: '方案' + i, plan })) })
  const { user } = setup()
  await screen.findByRole('button', { name: '方案0' })
  expect(screen.getByRole('button', { name: '设为当前计划' })).toBeDisabled()
  await user.type(screen.getByLabelText('分支名称'), '超限方案')
  expect(screen.getByRole('button', { name: '保存当前计划为分支' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: '只看不同' }))
  expect(screen.getByText('这个分支与当前计划的内容相同。')).toBeInTheDocument()
})
