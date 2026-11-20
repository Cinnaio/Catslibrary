import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentWritingReference } from '@shared/ai-agent'
import AiAgentWritingReferences, { type WritingReferenceChoice } from './AiAgentWritingReferences'
const mocks = vi.hoisted(() => ({
  writingReferences: vi.fn(),
  createWritingReference: vi.fn(),
  editWritingReference: vi.fn(),
  removeWritingReference: vi.fn(),
}))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: mocks }))
const card: AgentWritingReference = {
  id: 'card',
  title: '雨夜氛围',
  tags: ['氛围'],
  content: '雨声中逐步推进对话。',
  usage: '只参考节奏。',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.writingReferences.mockResolvedValue({ references: [card], hasMore: false })
})
function setup() {
  function Wrapper() {
    const [value, onChange] = useState<WritingReferenceChoice>({ references: [], scope: 'turn' })
    return <AiAgentWritingReferences value={value} onChange={onChange} disabled={false} />
  }
  render(<Wrapper />)
  fireEvent.click(screen.getByRole('button', { name: '写作参考' }))
}
it('selects reference material, changes scope and retains the selection when closing', async () => {
  setup()
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择参考 雨夜氛围' }))
  expect(screen.getByRole('checkbox', { name: '选择参考 雨夜氛围' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '持续用于当前对话' }))
  fireEvent.click(screen.getByRole('button', { name: '完成选择' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('雨夜氛围 · 当前对话')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '写作参考 · 1' }))
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
  expect(screen.getByText('未选择参考，按原书与本轮要求写作。')).toBeInTheDocument()
})
it('preserves a failed edit and saves only after an explicit submit', async () => {
  setup()
  await screen.findByRole('checkbox', { name: '选择参考 雨夜氛围' })
  fireEvent.click(screen.getByRole('button', { name: '查看与编辑' }))
  fireEvent.change(screen.getByRole('textbox', { name: '参考正文' }), { target: { value: '作者自己的新参考素材。' } })
  expect(mocks.editWritingReference).not.toHaveBeenCalled()
  mocks.editWritingReference.mockRejectedValueOnce(new Error('参考版本冲突'))
  fireEvent.click(screen.getByRole('button', { name: '保存参考' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('参考版本冲突')
  expect(screen.getByRole('textbox', { name: '参考正文' })).toHaveValue('作者自己的新参考素材。')
  mocks.editWritingReference.mockResolvedValueOnce({ reference: { ...card, revision: 2 } })
  fireEvent.click(screen.getByRole('button', { name: '保存参考' }))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '参考正文' })).not.toBeInTheDocument())
  expect(mocks.editWritingReference).toHaveBeenLastCalledWith(
    card.id,
    { title: card.title, tags: card.tags, content: '作者自己的新参考素材。', usage: card.usage },
    1,
  )
})
it('requires confirmation before removing a card and stops selecting it afterwards', async () => {
  setup()
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择参考 雨夜氛围' }))
  fireEvent.click(screen.getByRole('button', { name: '移除' }))
  expect(mocks.removeWritingReference).not.toHaveBeenCalled()
  mocks.removeWritingReference.mockResolvedValueOnce({ ok: true })
  mocks.writingReferences.mockResolvedValueOnce({ references: [], hasMore: false })
  fireEvent.click(screen.getByRole('button', { name: '确认移除' }))
  await waitFor(() => expect(mocks.removeWritingReference).toHaveBeenCalledWith(card.id, 1))
  expect(within(screen.getByRole('region', { name: '已选参考' })).queryByText(card.title)).not.toBeInTheDocument()
})
