import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { AgentAction } from '@shared/ai-agent'
import AiAgentActionDialog from './AiAgentActionDialog'

const source = (): AgentAction => ({ id: 'saved-preview', kind: 'apply_chapter_edit', title: '保存改写到原章节', status: 'pending', createdAt: 1, error: '',
  preview: { chapterId: 'chapter', chapterTitle: '第十二章 雨夜', description: '确认后更新本章已选内容，修改前版本保留。', before: '共同开头。\n原文段落。\n共同结尾。', after: '共同开头。\n修改后的段落。\n共同结尾。' } })
function open(action = source(), busy = false) {
  const callbacks = { onClose: vi.fn(), onReject: vi.fn(), onConfirm: vi.fn() }
  const props = { ...callbacks, action, novelTitle: '雨夜来信', busy }
  const result = render(<AiAgentActionDialog {...props} />)
  return { ...callbacks, action, ...result, props }
}

it('shows the saved target and aligned texts, and filtering differences never adopts the action', async () => {
  const callbacks = open()
  const dialog = screen.getByRole('dialog', { name: '核对原章改写' })
  expect(within(dialog).getByText('雨夜来信')).toBeInTheDocument()
  expect(within(dialog).getByText('第十二章 雨夜')).toBeInTheDocument()
  expect(within(dialog).getByText('确认后更新本章已选内容，修改前版本保留。')).toBeInTheDocument()
  expect(within(dialog).getByText('原文段落。')).toBeInTheDocument()
  expect(within(dialog).getByText('修改后的段落。')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('checkbox', { name: '只看改动' }))
  expect(within(dialog).queryByText('共同结尾。')).not.toBeInTheDocument()
  expect(callbacks.onConfirm).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole('button', { name: '确认写回原章节' }))
  expect(callbacks.onConfirm).toHaveBeenCalledWith(callbacks.action)
})

it('distinguishes returning to reading from rejecting the saved proposal', async () => {
  const callbacks = open()
  await userEvent.click(screen.getByRole('button', { name: '返回阅读' }))
  expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  expect(callbacks.onReject).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '暂不采纳' }))
  expect(callbacks.onReject).toHaveBeenCalledWith(callbacks.action)
  expect(callbacks.onConfirm).not.toHaveBeenCalled()
})

it('blocks closing and duplicate confirmation while saving, then retains the original preview on failure', async () => {
  const callbacks = open(source(), true)
  expect(screen.getByRole('button', { name: '正在处理…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '返回阅读' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  expect(callbacks.onClose).not.toHaveBeenCalled()
  callbacks.rerender(<AiAgentActionDialog {...callbacks.props} busy={false} error="作品版本已变化，请重新核对" />)
  expect(screen.getByRole('alert')).toHaveTextContent('作品版本已变化，请重新核对')
  expect(screen.getByText('修改后的段落。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认写回原章节' })).toBeEnabled()
})

it('keeps a complete deletion reviewable and labels an explicit restore separately', () => {
  const action = source()
  action.kind = 'restore_chapter'
  action.preview.after = ''
  open(action)
  expect(screen.getByRole('dialog', { name: '核对章节恢复' })).toBeInTheDocument()
  expect(screen.getByText('此处无新版内容')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认恢复原章节' })).toBeInTheDocument()
})

it('preserves publication position text and renders a new chapter without a fabricated original', () => {
  const action = source()
  action.kind = 'publish_draft'
  action.preview = { description: '追加在第三章之后，当前末章已核对。', draftId: 'draft', after: '待发布的完整章节。' }
  open(action)
  expect(screen.getByText('追加在第三章之后，当前末章已核对。')).toBeInTheDocument()
  expect(screen.getByText('待发布的完整章节。')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: '只看改动' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认按此位置发布' })).toBeInTheDocument()
})

it('requires explicit permission to resume an executing action and keeps completed records read-only', () => {
  const action = { ...source(), status: 'executing' as const }
  const callbacks = open(action)
  expect(screen.queryByRole('button', { name: '核对并继续采纳' })).not.toBeInTheDocument()
  callbacks.rerender(<AiAgentActionDialog {...callbacks.props} action={{ ...action, canResume: true }} />)
  expect(screen.getByRole('button', { name: '核对并继续采纳' })).toBeEnabled()
  callbacks.rerender(<AiAgentActionDialog {...callbacks.props} action={{ ...action, status: 'completed' }} />)
  expect(screen.getByRole('dialog', { name: '查看原章改写记录' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /确认写回|核对并继续/ })).not.toBeInTheDocument()
  expect(callbacks.onConfirm).not.toHaveBeenCalled()
})

it('preserves cover previews and names the actual cover adoption action', () => {
  const action = { ...source(), kind: 'adopt_cover' as const, preview: { candidateId: 'cover', description: '替换当前封面，旧封面保留历史。' } }
  const callbacks = { onClose: vi.fn(), onReject: vi.fn(), onConfirm: vi.fn() }
  render(<AiAgentActionDialog {...callbacks} action={action} novelTitle="雨夜来信" busy={false} coverUrl="/test-cover.png" />)
  expect(screen.getByRole('img', { name: '准备采纳的封面候选' })).toHaveAttribute('src', '/test-cover.png')
  expect(screen.getByRole('button', { name: '确认设为封面' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: '只看改动' })).not.toBeInTheDocument()
  expect(callbacks.onConfirm).not.toHaveBeenCalled()
})
