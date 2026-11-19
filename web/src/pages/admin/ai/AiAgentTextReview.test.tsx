import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AiAgentTextReview from './AiAgentTextReview'

function open(before = '共同开头。\n旧段落。\n共同结尾。', after = '共同开头。\n新段落。\n共同结尾。') {
  const onAdopt = vi.fn()
  const onDiscuss = vi.fn()
  render(<AiAgentTextReview title="第十二章 雨夜" before={before} after={after} status="建议已生成 · 尚未写回" actionLabel="预览写回原章" busy={false} onDiscuss={onDiscuss} onAdopt={onAdopt} />)
  return { onAdopt, onDiscuss }
}

describe('Agent suggestion reading', () => {
  it('starts on the new text and allows keyboard switching to the original', async () => {
    open()
    const user = userEvent.setup()
    expect(screen.getByRole('tabpanel', { name: '改写后' })).toHaveTextContent('新段落。')
    expect(screen.queryByRole('tabpanel', { name: '原文' })).not.toBeInTheDocument()
    screen.getByRole('tab', { name: '改写后' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tabpanel', { name: '原文' })).toHaveTextContent('旧段落。')
  })

  it('filters unchanged text in the comparison and restores trigger focus after Escape', async () => {
    const { onAdopt } = open()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: '查看差异' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '第十二章 雨夜 · 改写对比' })
    expect(within(dialog).getByText('旧段落。')).toBeInTheDocument()
    expect(within(dialog).getByText('新段落。')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: '只看改动' }))
    expect(within(dialog).queryByText('共同结尾。')).not.toBeInTheDocument()
    expect(onAdopt).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens the adoption preview only on the explicit action, including empty new content', async () => {
    const { onAdopt } = open('删去的正文。', '')
    expect(screen.getByRole('tabpanel', { name: '改写后' })).toHaveTextContent('新版内容为空。')
    fireEvent.click(screen.getByRole('button', { name: '查看差异' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('此处无新版内容')).toBeInTheDocument()
    expect(onAdopt).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '预览写回原章' }))
    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
