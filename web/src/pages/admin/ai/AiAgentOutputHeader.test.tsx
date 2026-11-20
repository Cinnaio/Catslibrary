import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { AgentAction, AgentArtifact } from '@shared/ai-agent'
import AiAgentOutputHeader from './AiAgentOutputHeader'

const artifact = (id: string): AgentArtifact => ({ task: { id, kind: 'chapter_edit', status: 'completed', step: '', current: 1, total: 1, error: '' }, drafts: [], covers: [] })
const action = (id: string, status: AgentAction['status'] = 'pending'): AgentAction => ({ id, status, kind: 'apply_chapter_edit', title: `保存章节建议${id}`, error: '', createdAt: 1,
  preview: { chapterId: 'chapter', description: `操作${id}的完整影响说明` } })
function open(actions: AgentAction[], currentActionId?: string, selected = artifact('current')) {
  const callbacks = { onSelect: vi.fn(), onClose: vi.fn(), onAction: vi.fn(), onRestore: vi.fn() }
  render(<MemoryRouter><AiAgentOutputHeader {...callbacks} artifacts={[artifact('current')]} artifact={selected} actions={actions}
    currentActionId={currentActionId} workspaceHref="/admin/ai?sub=writing&view=review" busy={false} /></MemoryRouter>)
  return callbacks
}

it('keeps multiple pending actions behind a count and opens the exact saved preview selected by the author', async () => {
  const actions = [action('one'), action('two', 'executing')]
  const callbacks = open(actions, 'one')
  expect(screen.queryByText('操作one的完整影响说明')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '2 项待处理' }))
  const list = await screen.findByRole('dialog', { name: '待确认与执行中的操作' })
  expect(within(list).getByText('操作one的完整影响说明')).toBeInTheDocument()
  await userEvent.click(within(list).getByRole('button', { name: '查看执行状态' }))
  expect(callbacks.onAction).toHaveBeenCalledWith(actions[1])
  expect(callbacks.onRestore).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('retains history and restore-preview access in the overflow menu', async () => {
  const saved = action('saved', 'completed')
  const callbacks = open([saved, action('abandoned', 'rejected')])
  await userEvent.click(screen.getByRole('button', { name: '产出更多操作' }))
  expect(await screen.findByRole('menuitem', { name: '草稿工作区' })).toHaveAttribute('href', '/admin/ai?sub=writing&view=review')
  await userEvent.click(screen.getByRole('menuitem', { name: '采纳与版本记录' }))
  const list = await screen.findByRole('dialog', { name: '采纳与版本记录' })
  expect(within(list).getByText('已放弃')).toBeInTheDocument()
  await userEvent.click(within(list).getByRole('button', { name: '恢复之前版本' }))
  expect(callbacks.onRestore).toHaveBeenCalledWith(saved)
  expect(callbacks.onAction).not.toHaveBeenCalled()
})

it('keeps an older opened artifact selectable alongside the current output list', async () => {
  const callbacks = open([], undefined, artifact('older'))
  await userEvent.click(screen.getByRole('combobox', { name: '切换产出' }))
  const choices = await screen.findAllByRole('option')
  expect(choices).toHaveLength(2)
  await userEvent.click(choices[0]!)
  expect(callbacks.onSelect).toHaveBeenCalledWith('current')
})
