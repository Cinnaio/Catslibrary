import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { AdminContentRatingAiSuggestion } from '@/lib/api'
import AiSuggestionBulkReview from './AiSuggestionBulkReview'
const { review } = vi.hoisted(() => ({ review: vi.fn() }))
vi.mock('@/lib/api', () => ({ adminApi: { contentRatingAi: { review } } }))

it('批量拒绝部分失败时报告具体作品，仅清除成功项并保留失败供核查', async () => {
  const user = userEvent.setup()
  review.mockImplementation((id: string) => id === 'b' ? Promise.reject(new Error('作品修订已变化')) : Promise.resolve({ ok: true }))
  const onCompleted = vi.fn().mockResolvedValue(undefined)
  const onBusy = vi.fn()
  const items = ['a', 'b'].map((id, i) => ({ id, title: `作品${id}`, revision: i + 4, confidence: 0.9, reason: 'AI依据', suggestedRating: 'unknown' })) as AdminContentRatingAiSuggestion[]
  render(<AiSuggestionBulkReview items={items} disabled={false} onCompleted={onCompleted} onBusy={onBusy} />)
  await user.click(screen.getByRole('button', { name: '批量拒绝' }))
  await user.type(screen.getByLabelText('批量审核理由'), '证据不足')
  await user.click(screen.getByRole('button', { name: '确认拒绝所选建议' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('作品b：作品修订已变化')
  expect(screen.getByRole('status')).toHaveTextContent('已完成 1 条，失败 1 条')
  expect(review).toHaveBeenCalledWith('b', { decision: 'reject', expectedRevision: 5, reason: '证据不足' })
  expect(onCompleted).toHaveBeenCalledWith(['a'])
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false))
})
