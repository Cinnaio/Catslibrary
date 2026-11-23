import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentChapterPlan } from '@shared/ai-agent'
import AiAgentChapterPlan from './AiAgentChapterPlan'

const api = vi.hoisted(() => ({ saveChapterPlan: vi.fn(), planBranches: vi.fn(), selectPlanBranch: vi.fn(), outline: vi.fn(), applyOutlineChapter: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: api }))
const plan: AgentChapterPlan = { version: 1, revision: 3, updatedAt: 1, title: '雨夜', goal: '发现线索', beats: '归家\n拆信', characters: '', ending: '门外响起脚步', constraints: '不揭露身份', targetWords: 2000 }
const props = () => ({ sessionId: 'session', plan, disabled: false, onChanged: vi.fn(), onStart: vi.fn().mockResolvedValue(undefined), onDiscuss: vi.fn().mockResolvedValue(undefined) })
beforeEach(() => vi.clearAllMocks())
it('reads a saved plan and starts writing only after explicit confirmation', async () => {
  const p = props()
  const user = userEvent.setup()
  render(<AiAgentChapterPlan {...p} />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  expect(screen.getByText('发现线索')).toBeInTheDocument()
  expect(screen.getByText('尚未决定')).toBeInTheDocument()
  expect(p.onStart).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认计划并写作' }))
  expect(p.onStart).toHaveBeenCalledExactlyOnceWith(plan)
})
it('saves edits against the read revision and requires reviewing the saved result before writing', async () => {
  const p = props()
  const user = userEvent.setup()
  api.saveChapterPlan.mockResolvedValue({ plan: { ...plan, title: '新雨夜', revision: 4 } })
  render(<AiAgentChapterPlan {...p} />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  await user.click(screen.getByRole('button', { name: '编辑计划' }))
  await user.clear(screen.getByLabelText('章节标题（必填）'))
  await user.type(screen.getByLabelText('章节标题（必填）'), '新雨夜')
  expect(screen.queryByRole('button', { name: '确认计划并写作' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '保存计划' }))
  await waitFor(() => expect(p.onChanged).toHaveBeenCalledOnce())
  expect(api.saveChapterPlan).toHaveBeenCalledWith('session', expect.objectContaining({ title: '新雨夜' }), 3)
  expect(p.onStart).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认计划并写作' }))
  expect(p.onStart).toHaveBeenCalledWith(expect.objectContaining({ title: '新雨夜', revision: 4 }))
})
it('keeps conflicting edits for correction and never sends them for generation', async () => {
  const p = props()
  const user = userEvent.setup()
  api.saveChapterPlan.mockRejectedValue(new Error('章节计划已变化，请重新读取后编辑'))
  const view = render(<AiAgentChapterPlan {...p} />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  await user.click(screen.getByRole('button', { name: '编辑计划' }))
  await user.type(screen.getByLabelText('章节目标（必填）'), '并保留悬念')
  view.rerender(<AiAgentChapterPlan {...p} plan={{ ...plan, revision: 4 }} />)
  await user.click(screen.getByRole('button', { name: '保存计划' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('章节计划已变化')
  expect(screen.getByLabelText('章节目标（必填）')).toHaveValue('发现线索并保留悬念')
  expect(api.saveChapterPlan).toHaveBeenCalledWith('session', expect.anything(), 3)
  expect(p.onStart).not.toHaveBeenCalled()
})
it('offers planning without creating a draft and blocks invalid manual plans', async () => {
  const p = props()
  const user = userEvent.setup()
  render(<AiAgentChapterPlan {...p} plan={null} />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  expect(screen.getByRole('button', { name: '保存计划' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '请助手拟定计划' }))
  expect(p.onDiscuss).toHaveBeenCalledWith(expect.stringContaining('暂不生成正文'))
  expect(p.onStart).not.toHaveBeenCalled()
  expect(api.saveChapterPlan).not.toHaveBeenCalled()
})

it('returns a selected branch to plan review and confirms only the new revision', async () => {
  const p = props()
  const user = userEvent.setup()
  const alternative = { ...plan, goal: '先找同伴', revision: 1 }
  const branch = { id: 'route-b', name: '同伴路线', plan: alternative, source: 'saved', createdAt: 1 }
  const next = { ...alternative, revision: 4, sourceBranch: { id: branch.id, name: branch.name } }
  api.planBranches.mockResolvedValue({ plan, branches: [branch] })
  api.selectPlanBranch.mockResolvedValue({ plan: next, branches: [branch] })
  render(<AiAgentChapterPlan {...p} branchesAvailable />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  await user.click(screen.getByRole('button', { name: '分支对比' }))
  await screen.findByRole('button', { name: '同伴路线' })
  expect(screen.queryByRole('button', { name: '确认计划并写作' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '设为当前计划' }))
  await screen.findByRole('button', { name: '确认计划并写作' })
  expect(p.onStart).not.toHaveBeenCalled()
  expect(screen.getByText('先找同伴')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '确认计划并写作' }))
  expect(p.onStart).toHaveBeenCalledExactlyOnceWith(next)
})
it('hides branch management on an older API and while there are unsaved edits', async () => {
  const p = props()
  const user = userEvent.setup()
  const view = render(<AiAgentChapterPlan {...p} />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  expect(screen.queryByRole('button', { name: '分支对比' })).not.toBeInTheDocument()
  view.rerender(<AiAgentChapterPlan {...p} branchesAvailable />)
  expect(screen.getByRole('button', { name: '分支对比' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '编辑计划' }))
  expect(screen.queryByRole('button', { name: '分支对比' })).not.toBeInTheDocument()
  expect(api.planBranches).not.toHaveBeenCalled()
})

it('brings a selected outline chapter to the plan editor flow before any writing call', async () => {
  const p = props()
  const user = userEvent.setup()
  api.outline.mockResolvedValue({ outline: { revision: 7, chapters: [
    { title: '藏钥匙', goal: '留下伏笔', beats: '把钥匙放进信封' },
    { title: '开信封', goal: '认出钥匙', beats: '在码头拆信' },
    { title: '乘船', goal: '离开雨港', beats: '买船票' },
  ] } })
  const next = { ...plan, title: '藏钥匙', goal: '留下伏笔', revision: 4, constraints: '将认出钥匙留到后章。' }
  api.applyOutlineChapter.mockResolvedValue({ plan: next })
  render(<AiAgentChapterPlan {...p} outlineAvailable />)
  await user.click(screen.getByRole('button', { name: /章节计划/ }))
  await user.click(screen.getByRole('button', { name: '多章大纲' }))
  const select = await screen.findAllByRole('button', { name: '选作章节计划' })
  await user.click(select[0]!)
  expect(api.applyOutlineChapter).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认设为章节计划' }))
  expect(api.applyOutlineChapter).toHaveBeenCalledWith('session', 0, 7, 3)
  expect(await screen.findByText('将认出钥匙留到后章。')).toBeInTheDocument()
  expect(p.onStart).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认计划并写作' }))
  expect(p.onStart).toHaveBeenCalledExactlyOnceWith(next)
})
