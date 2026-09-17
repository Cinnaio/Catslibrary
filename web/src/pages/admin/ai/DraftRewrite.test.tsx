import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  rewriteDraft: vi.fn(),
  applyDraftRewrite: vi.fn(),
  task: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  aiApi: {
    writing: {
      rewriteDraft: api.rewriteDraft,
      applyDraftRewrite: api.applyDraftRewrite,
    },
    task: api.task,
  },
  newOperationId: (prefix: string) => `${prefix}-test`,
}))

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: toastSpy }),
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))

import DraftRewrite from './DraftRewrite'

// Radix Select 依赖 pointer capture 与 scrollIntoView，jsdom 未实现。
// 只在本文件补齐，避免影响其它用例。
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

const CONTENT = '她从他臂弯里退开半步的动作很轻，却让林栩言胸口一空。雪原的夜风从帐帘缝隙里钻进来。'

/** 在只读正文里设一个真实的 UTF-16 选区并触发 onSelect，模拟用户拖选。 */
function selectRange(start: number, end: number) {
  const body = screen.getByLabelText('正文（选中要改写的段落）') as HTMLTextAreaElement
  body.setSelectionRange(start, end)
  fireEvent.select(body)
  return body
}

function renderPanel(overrides: Partial<Parameters<typeof DraftRewrite>[0]> = {}) {
  const onApplied = vi.fn()
  const onStale = vi.fn()
  render(
    <DraftRewrite
      draftId="draft_1"
      content={CONTENT}
      contentRevision="rev_1"
      onApplied={onApplied}
      onStale={onStale}
      {...overrides}
    />,
  )
  return { onApplied, onStale }
}

describe('DraftRewrite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.rewriteDraft.mockResolvedValue({ ok: true, taskId: 't1', total: 1 })
    api.task.mockResolvedValue({
      task: {
        id: 't1',
        status: 'completed',
        result: JSON.stringify({
          version: 1,
          baseRevision: 'rev_1',
          startUTF16: 0,
          endUTF16: 5,
          selectedText: '她从他臂弯',
          mode: 'polish',
          suggestion: '她自他臂弯中退开半步。',
        }),
      },
    })
  })

  it('没有选中段落时不允许生成', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /生成改写建议/ })).toBeDisabled()
  })

  it('选中段落后带 UTF-16 区间与选中文本提交，并在完成后展示对比', async () => {
    renderPanel()
    selectRange(0, 5)

    // 选区反馈必须来自真实 textarea 偏移，而不是 DOM Range
    expect(screen.getByText(/已选 5 字 · 第 0–5 字符/)).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /生成改写建议/ })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await waitFor(() => expect(api.rewriteDraft).toHaveBeenCalledTimes(1))
    expect(api.rewriteDraft).toHaveBeenCalledWith('draft_1', expect.objectContaining({
      baseRevision: 'rev_1',
      startUTF16: 0,
      endUTF16: 5,
      selectedText: CONTENT.slice(0, 5),
      mode: 'polish',
    }))

    // 建议与原文并列展示，并给出字数对照（「她自他臂弯中退开半步。」= 11 字）
    await screen.findByText('她自他臂弯中退开半步。')
    expect(screen.getByText(/原选段 5 字 → 建议 11 字/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /应用改写/ })).toBeInTheDocument()
  })

  it('应用成功后回传新正文与版本号', async () => {
    api.applyDraftRewrite.mockResolvedValue({
      ok: true,
      id: 'draft_1',
      result: '改写后的正文',
      contentRevision: 'rev_2',
    })
    const { onApplied } = renderPanel()
    selectRange(0, 5)
    fireEvent.click(screen.getByRole('button', { name: /生成改写建议/ }))
    await screen.findByText('她自他臂弯中退开半步。')

    fireEvent.click(screen.getByRole('button', { name: /应用改写/ }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ result: '改写后的正文', contentRevision: 'rev_2' }))
    // 应用前不得改动正文：只有父级回传后才更新
    expect(api.applyDraftRewrite).toHaveBeenCalledWith('draft_1', 't1', expect.objectContaining({ baseRevision: 'rev_1' }))
  })

  it('遇到 409 正文已变化时清空建议并通知父级重读', async () => {
    const conflict = Object.assign(new Error('草稿正文已变化，请重新选择选段'), { status: 409 })
    api.applyDraftRewrite.mockRejectedValue(conflict)
    const { onApplied, onStale } = renderPanel()
    selectRange(0, 5)
    fireEvent.click(screen.getByRole('button', { name: /生成改写建议/ }))
    await screen.findByText('她自他臂弯中退开半步。')

    fireEvent.click(screen.getByRole('button', { name: /应用改写/ }))

    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1))
    expect(onApplied).not.toHaveBeenCalled()
    // 陈旧建议不可再用：对比视图收起，必须重新选段
    await waitFor(() => expect(screen.queryByText('她自他臂弯中退开半步。')).not.toBeInTheDocument())
  })

  it('自定义模式必须填写改写说明', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderPanel()
    selectRange(0, 5)

    // Radix Select 由 pointer 事件驱动，click 不展开
    const trigger = screen.getByRole('combobox')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: '自定义要求' }))

    // 未填说明时禁用
    expect(screen.getByRole('button', { name: /生成改写建议/ })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('改写要求（必填）'), { target: { value: '更克制一些' } })
    expect(screen.getByRole('button', { name: /生成改写建议/ })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /生成改写建议/ }))
    await waitFor(() => expect(api.rewriteDraft).toHaveBeenCalledWith('draft_1', expect.objectContaining({
      mode: 'custom',
      instruction: '更克制一些',
    })))
  })

  it('正文版本变化时作废旧建议', async () => {
    const { rerender } = render(
      <DraftRewrite draftId="draft_1" content={CONTENT} contentRevision="rev_1" onApplied={vi.fn()} onStale={vi.fn()} />,
    )
    selectRange(0, 5)
    fireEvent.click(screen.getByRole('button', { name: /生成改写建议/ }))
    await screen.findByText('她自他臂弯中退开半步。')

    // 父级保存了正文 → 版本号变化 → 旧建议的偏移可能已失效
    rerender(<DraftRewrite draftId="draft_1" content={`${CONTENT}续`} contentRevision="rev_2" onApplied={vi.fn()} onStale={vi.fn()} />)
    await waitFor(() => expect(screen.queryByText('她自他臂弯中退开半步。')).not.toBeInTheDocument())
    expect(screen.getByText('尚未选中段落')).toBeInTheDocument()
  })
})
