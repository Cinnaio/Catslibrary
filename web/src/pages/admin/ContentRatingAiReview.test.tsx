import { createRef, type ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AdminContentRatingAiSuggestion } from '@/lib/api'
import ContentRatingAiReview from './ContentRatingAiReview'

const suggestion: AdminContentRatingAiSuggestion = {
  id: 'suggestion-1', novelId: 'novel-1', title: '待核对的作品', author: '作者',
  taskId: 'task-1', novelRevision: 4, currentRating: 'unknown', currentSource: 'system', currentRevision: 4,
  inputSnapshot: {
    title: '待核对的作品', categories: [],
    body: {
      hasBody: true, chapterCount: 38, scannedCharacters: 78974,
      matchedChapterCount: 14, matchedChapterRatio: 14 / 38,
      keywordHits: [{ keyword: '白浊', chapters: 2 }, { keyword: '胸口', chapters: 6 }],
      excerpts: [{ chapter: '第 4 章', origin: 'match', keywords: ['胸口'], text: '这是需要结合上下文人工核对的原文片段。' }],
    },
  },
  suggestedRating: 'restricted', confidence: 0.91, reason: '需要人工核对的模型判断',
  evidence: [{ type: 'llm', field: 'body', value: '模型记录的正文依据' }],
  model: 'test-model', promptVersion: 'v1', status: 'pending', revision: 2,
  reviewedBy: '', reviewedByName: '', reviewedAt: 0, reviewReason: '', error: '', createdAt: 0, updatedAt: 0,
}

function props(overrides: Partial<ComponentProps<typeof ContentRatingAiReview>> = {}): ComponentProps<typeof ContentRatingAiReview> {
  return {
    suggestion, decision: null, reason: '', error: '', saving: false,
    reasonInputRef: createRef<HTMLTextAreaElement>(), triggerRef: createRef<HTMLElement>(),
    onDecision: vi.fn(), onReason: vi.fn(), onClose: vi.fn(), onSubmit: vi.fn(),
    ...overrides,
  }
}

describe('ContentRatingAiReview', () => {
  it('打开后聚焦作品标题，原文与命中词分组可供人工核对', async () => {
    const user = userEvent.setup()
    render(<ContentRatingAiReview {...props()} />)
    const dialog = screen.getByRole('dialog', { name: '待核对的作品' })
    expect(within(dialog).getByRole('heading', { name: '待核对的作品' })).toHaveFocus()
    expect(within(dialog).getByRole('region', { name: '分级建议与原文审阅' })).toBeInTheDocument()
    expect(within(dialog).getByText('这是需要结合上下文人工核对的原文片段。')).toBeVisible()
    expect(within(dialog).getByText(/扫描 38 章/)).toHaveTextContent('信号命中 14 章（37%）')
    expect(within(dialog).getByText('白浊 · 2 章')).not.toBeVisible()
    await user.click(within(dialog).getByText('命中词明细'))
    expect(within(dialog).getByText('直白词')).toBeVisible()
    expect(within(dialog).getByText('语境词')).toBeVisible()
    expect(within(dialog).getByText('白浊 · 2 章')).toBeVisible()
  })

  it('提交期间禁用审核操作并阻止 Escape 关闭', async () => {
    const user = userEvent.setup()
    const reviewProps = props({ decision: 'approve', reason: '已经人工核对', saving: true })
    render(<ContentRatingAiReview {...reviewProps} />)
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '返回查看' })).toBeDisabled()
    expect(screen.getByLabelText('批准理由')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(reviewProps.onClose).not.toHaveBeenCalled()
    expect(reviewProps.onSubmit).not.toHaveBeenCalled()
  })

  it('未标注建议保持真实影响说明，失败保留理由并关联错误', () => {
    const reviewProps = props({
      suggestion: { ...suggestion, suggestedRating: 'unknown', inputSnapshot: { title: '待核对的作品', categories: [] } },
    })
    const { rerender } = render(<ContentRatingAiReview {...reviewProps} />)
    rerender(<ContentRatingAiReview {...reviewProps} decision="approve" reason="需要后续复核" error="服务器暂时不可用，请重试。" />)
    const reason = screen.getByLabelText('批准理由')
    expect(reason).toHaveFocus()
    expect(reason).toHaveValue('需要后续复核')
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(reason).toHaveAccessibleDescription(/服务器暂时不可用，请重试/)
    expect(screen.getAllByText('批准后继续保持未标注，不会标为一般。').length).toBeGreaterThan(0)
    expect(screen.getByText('本次建议未附正文采样记录，请结合元数据与原文核对。')).toBeInTheDocument()
  })
})
