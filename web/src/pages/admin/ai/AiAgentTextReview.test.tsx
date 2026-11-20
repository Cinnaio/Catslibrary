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
  it('keeps stable choices through filtering, previews merged text, and refuses an unchanged result', async () => {
    const onAdopt = vi.fn()
    const before = '开头。\n第一旧段。\n共同段。\n第二旧段。\n结尾。'
    const after = '开头。\n第一新段。\n共同段。\n第二新段。\n结尾。'
    render(<AiAgentTextReview title="选择改动" before={before} after={after} status="待选择" actionLabel="预览采纳"
      busy={false} selectionRevision="revision" onDiscuss={vi.fn()} onAdopt={onAdopt} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '查看差异' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /采用第 2 处改动/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: '只看改动' }))
    expect(within(dialog).getByRole('checkbox', { name: /采用第 1 处改动/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /采用第 2 处改动/ })).not.toBeChecked()
    expect(onAdopt).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: '全部保留原文' }))
    expect(within(dialog).getByRole('button', { name: '预览所选结果' })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /采用第 1 处改动/ }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('tabpanel', { name: '合并结果' })).toHaveTextContent('第一新段。')
    expect(screen.getByRole('tabpanel', { name: '合并结果' })).toHaveTextContent('第二旧段。')
    await user.click(screen.getByRole('button', { name: '预览所选结果' }))
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith({ version: 1, revision: 'revision', acceptedChanges: [0] })
  })

  it('shows and locks the persisted partial result after adoption', async () => {
    const onAdopt = vi.fn()
    render(<AiAgentTextReview title="已采纳" before={'旧一。\n共同段。\n旧二。'} after={'新一。\n共同段。\n新二。'}
      status="已采纳" actionLabel="查看采纳记录" busy={false} selectionRevision="revision" selectionLocked
      savedSelection={{ version: 1, revision: 'revision', acceptedChanges: [1] }} onDiscuss={vi.fn()} onAdopt={onAdopt} />)
    expect(screen.getByRole('tabpanel', { name: '合并结果' })).toHaveTextContent('旧一。')
    expect(screen.getByRole('tabpanel', { name: '合并结果' })).toHaveTextContent('新二。')
    fireEvent.click(screen.getByRole('button', { name: '查看差异' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: /采用第 1 处改动/ })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '查看采纳记录' }))
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith()
  })

})
