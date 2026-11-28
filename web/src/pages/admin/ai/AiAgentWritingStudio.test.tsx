import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { studioBlank, type StudioCard } from '@shared/ai-writing-studio'
import AiAgentWritingStudio from './AiAgentWritingStudio'
const api = vi.hoisted(() => ({ writingStudio: vi.fn(), saveWritingCard: vi.fn(), changeWritingCard: vi.fn(), writingCardVersions: vi.fn(), assembleScenes: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: api }))
const scene: StudioCard = { ...studioBlank('scene'), id: 'scene', title: '门前的争执', values: { ...studioBlank('scene').values, goal: '试探对方', prose: '她停在门前。' }, revision: 2, status: 'active', locked: false, origin: 'author', createdAt: 1, updatedAt: 2 }
beforeEach(() => { vi.resetAllMocks(); api.writingStudio.mockResolvedValue({ cards: [structuredClone(scene)], contextOmitted: [] }) })
async function show(cards?: StudioCard[]) {
  if (cards) api.writingStudio.mockResolvedValue({ cards, contextOmitted: [] })
  const props = { sessionId: 'session', disabled: false, onChanged: vi.fn(), onDiscuss: vi.fn() }
  render(<AiAgentWritingStudio {...props} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '写作工坊' }))
  await screen.findByRole('heading', { name: cards?.[0]?.title || scene.title })
  return { user, props }
}
it('preserves author input on a stale-version error and does not auto-save while opening', async () => {
  const { user } = await show()
  expect(api.saveWritingCard).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '编辑' }))
  await user.clear(screen.getByLabelText('标题'))
  await user.type(screen.getByLabelText('标题'), '更克制的争执')
  api.saveWritingCard.mockRejectedValue(new Error('内容已变化，请重新核对'))
  await user.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('标题')).toHaveValue('更克制的争执')
  expect(api.saveWritingCard.mock.calls[0]?.[2]).toMatchObject({ id: 'scene', revision: 2 })
})
it('keeps locked scenes read-only while offering an explicit unlock', async () => {
  await show([{ ...scene, locked: true }])
  expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '移除' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: '请助手写这一场' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '解锁场景' })).toBeEnabled()
})
it('requires an explicit author choice to accept a proposal and never accepts stale evidence', async () => {
  const card = { ...scene, status: 'proposed' as const, origin: 'assistant' as const }
  const { user } = await show([card])
  expect(api.changeWritingCard).not.toHaveBeenCalled()
  api.changeWritingCard.mockResolvedValue({ card: { ...card, status: 'active', revision: 3 } })
  await user.click(screen.getByRole('button', { name: '采纳这项建议' }))
  await waitFor(() => expect(api.changeWritingCard).toHaveBeenCalledWith('session', expect.objectContaining({ id: 'scene', revision: 2 }), 'accept'))
})
it('shows stale-source notices and blocks adopting a stale proposal', async () => {
  await show([{ ...scene, status: 'proposed', stale: true }])
  expect(screen.getByRole('button', { name: '采纳这项建议' })).toBeDisabled()
})
it('prepares scene writing in the existing composer and only assembles after preview confirmation', async () => {
  const { user, props } = await show()
  await user.click(screen.getByRole('button', { name: '请助手写这一场' }))
  expect(props.onDiscuss).toHaveBeenCalledWith(expect.stringContaining('cardId=scene'))
  expect(api.assembleScenes).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '写作工坊' }))
  await screen.findByRole('heading', { name: scene.title })
  await user.click(screen.getByRole('button', { name: '合成章节' }))
  await user.type(screen.getByLabelText('章节标题'), '雨停之前')
  expect(api.assembleScenes).not.toHaveBeenCalled()
  api.assembleScenes.mockResolvedValue({ draftId: 'draft', taskId: 'task' })
  await user.click(screen.getByRole('button', { name: '确认合成草稿' }))
  await waitFor(() => expect(api.assembleScenes).toHaveBeenCalledWith('session', '雨停之前', [{ id: 'scene', revision: 2 }]))
})
