import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import WritingPreparation from './WritingPreparation'
import { emptyWritingBrief } from './writing-brief'
import DraftReview from './DraftReview'

const api = vi.hoisted(() => ({ materials: vi.fn(), getDraftReview: vi.fn(), reviewDraft: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { writing: api } }))
const materials = {
  revision: 'revision-1',
  anchor: { chapterId: 'c5', title: '重逢', sortOrder: 5 },
  characterCount: 100,
  recentContextPolicy: '历史原文按匹配片段补充',
  excludedProfiles: [],
  historicalPassages: [{ chapterId: 'c1', title: '旧承诺', text: '林舟将钥匙交给沈月。', start: 0, end: 12, matchedTerms: ['林舟'] }],
  plan: {
    facts: [],
    currentState: [{ id: 'plot-state', text: '完整档案保留的旧伏笔' }],
    style: [{ id: 'novel-style-analysis', text: '按说话人另起一段。' }],
    chapterTask: [],
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  api.materials.mockResolvedValue(materials)
  api.getDraftReview.mockResolvedValue({ report: null })
  api.reviewDraft.mockResolvedValue({ report: { draftRevision: 'draft-1', inputHash: 'hash', updatedAt: 1, findings: [], sources: [] } })
})
function Preparation() {
  const [brief, setBrief] = useState(emptyWritingBrief())
  const request = { novelId: 'book', writingBrief: brief }
  return (
    <WritingPreparation
      brief={brief}
      onChange={setBrief}
      request={request}
      requestKey={JSON.stringify(request)}
      chapterCount={2}
      disabled={false}
      continuation
      onPreview={() => {}}
    />
  )
}
it('edits chapter goals and character delimiters, previews evidence and marks changed requirements', async () => {
  render(<Preparation />)
  const cast = screen.getByLabelText('出场人物')
  fireEvent.change(cast, { target: { value: '林舟、' } })
  expect(cast).toHaveValue('林舟、')
  fireEvent.change(cast, { target: { value: '林舟、沈月' } })
  fireEvent.change(screen.getByLabelText('本章目标'), { target: { value: '核对旧承诺' } })
  fireEvent.click(screen.getByRole('button', { name: '预览本次上下文' }))
  expect(await screen.findByText(/历史原文 · 旧承诺/)).toBeInTheDocument()
  expect(api.materials).toHaveBeenCalledWith(
    expect.objectContaining({ writingBrief: expect.objectContaining({ characters: ['林舟', '沈月'], objective: '核对旧承诺' }) }),
  )
  expect(screen.getByText('完整档案保留的旧伏笔')).toBeInTheDocument()
  expect(screen.getByText(/本次文风分析参考/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('本章目标'), { target: { value: '新的目标' } })
  expect(screen.getByText('要求或起点已变化，请重新预览。')).toBeInTheDocument()
  expect(screen.queryByLabelText('本次上下文材料')).not.toBeInTheDocument()
})
it('checks drafts only on request and invalidates reports after the content revision changes', async () => {
  const { rerender } = render(<DraftReview draftId="d1" contentRevision="draft-1" />)
  await waitFor(() => expect(api.getDraftReview).toHaveBeenCalledWith('d1'))
  expect(api.reviewDraft).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '检查草稿' }))
  expect(await screen.findByText(/在本次提供的材料范围内未发现/)).toBeInTheDocument()
  expect(api.reviewDraft).toHaveBeenCalledWith('d1', 'draft-1', expect.any(Function))
  api.getDraftReview.mockResolvedValue({ report: { draftRevision: 'draft-1', inputHash: 'hash', updatedAt: 1, findings: [], sources: [] } })
  rerender(<DraftReview draftId="d1" contentRevision="draft-2" />)
  expect(await screen.findByText(/草稿或来源已变化/)).toBeInTheDocument()
})

it('labels zero verified findings as incomplete and allows a paid retry', async () => {
  api.getDraftReview.mockResolvedValue({ report: { draftRevision: 'draft-1', inputHash: 'hash', updatedAt: 1, findings: [], sources: [], completeness: 'partial', rejectedFindings: 2 } })
  render(<DraftReview draftId="d1" contentRevision="draft-1" />)
  expect(await screen.findByText(/检查不完整/)).toHaveTextContent('2 项未通过')
  expect(screen.queryByText(/在本次提供的材料范围内未发现/)).not.toBeInTheDocument()
  expect(api.reviewDraft).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重试检查' }))
  expect(await screen.findByText(/在本次提供的材料范围内未发现/)).toBeInTheDocument()
  expect(screen.queryByText(/检查不完整/)).not.toBeInTheDocument()
})

it('restores a failed review attempt and clears it after switching drafts', async () => {
  api.getDraftReview.mockResolvedValueOnce({ report: null, attempt: { draftRevision: 'draft-1', status: 'failed', message: '质量检查超时，可以重试。' } })
  const { rerender } = render(<DraftReview draftId="d1" contentRevision="draft-1" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('质量检查超时')
  expect(screen.getByRole('button', { name: '重试检查' })).toBeEnabled()
  rerender(<DraftReview draftId="d2" contentRevision="draft-2" />)
  await waitFor(() => expect(api.getDraftReview).toHaveBeenCalledWith('d2'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not restore retired archive counters while retaining source previews', async () => {
  api.materials.mockResolvedValue({ ...materials, memorySelection: { revision: 'ledger-1', retrievedFacts: 7, totalFacts: 120 } })
  render(<Preparation />)
  fireEvent.click(screen.getByRole('button', { name: '预览本次上下文' }))
  expect(await screen.findByText('完整档案保留的旧伏笔')).toBeInTheDocument()
  expect(screen.queryByText(/本次关联 7 条 \/ 已存 120 条/)).not.toBeInTheDocument()
})
