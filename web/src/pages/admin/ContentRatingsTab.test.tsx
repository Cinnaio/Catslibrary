import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminContentRatingAiSuggestion, AdminContentRatingItem } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  history: vi.fn(),
  update: vi.fn(),
  candidateList: vi.fn(),
  candidateCreate: vi.fn(),
  candidatePreview: vi.fn(),
  candidateReview: vi.fn(),
  aiList: vi.fn(),
  aiScan: vi.fn(),
  aiReview: vi.fn(),
  aiTask: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  adminApi: {
    contentRatings: {
      list: mocks.list,
      history: mocks.history,
      update: mocks.update,
    },
    contentRatingRuleCandidates: {
      list: mocks.candidateList,
      create: mocks.candidateCreate,
      preview: mocks.candidatePreview,
      review: mocks.candidateReview,
    },
    contentRatingAi: {
      list: mocks.aiList,
      scan: mocks.aiScan,
      review: mocks.aiReview,
    },
    aiApi: {
      task: mocks.aiTask,
    },
  },
}))

vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

import ContentRatingsTab from './ContentRatingsTab'

const item: AdminContentRatingItem = {
  id: 'novel-1',
  title: '潮汐之后',
  author: '宁月',
  contentRating: 'restricted',
  revision: 3,
  source: 'prefill',
  reason: '规则预填，等待人工复核',
  evidence: [
    { type: 'category', value: '成人' },
    { type: 'text', field: 'description' },
  ],
  ruleVersion: 'restricted-rules-v1',
  updatedBy: 'system',
  updatedByName: '系统',
  contentRatingUpdatedAt: Date.now() - 3_600_000,
  operationId: 'prefill-1',
  chapterCount: 18,
  updatedAt: Date.now() - 3_600_000,
}

const response = {
  items: [item],
  total: 1,
  limit: 20,
  offset: 0,
  counts: { general: 4, restricted: 1, unknown: 2 },
  sources: ['manual', 'ai_task', 'prefill', 'source_import', 'migration', 'system', 'legacy'],
}

describe('ContentRatingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue(response)
    mocks.history.mockResolvedValue({
      history: [
        {
          id: 'audit-1',
          novelId: item.id,
          fromRating: 'unknown',
          toRating: 'restricted',
          source: 'prefill',
          reason: '复核完成',
          evidence: item.evidence,
          ruleVersion: 'restricted-rules-v1',
          operationId: 'prefill-1',
          actorUserId: 'system',
          actorName: '系统',
          createdAt: item.contentRatingUpdatedAt,
        },
      ],
    })
    mocks.update.mockResolvedValue({ item })
    mocks.candidateList.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      counts: { pending: 0, approved: 0, rejected: 0 },
      kinds: ['category', 'phrase'],
      activeRuleVersion: 'restricted-rules-v1',
    })
    mocks.candidateCreate.mockResolvedValue({ created: true, exampleAdded: true, candidate: {} })
    mocks.candidatePreview.mockResolvedValue({
      candidate: {
        id: 'candidate-1',
        kind: 'category',
        value: '新成人标签',
        normalizedValue: '新成人标签',
        targetRating: 'restricted',
        status: 'pending',
        createdBy: 'admin-1',
        createdByName: '站长',
        createdAt: Date.now(),
        reviewedBy: '',
        reviewedByName: '',
        reviewedAt: 0,
        reviewReason: '',
        updatedAt: Date.now(),
        revision: 1,
        ruleVersion: '',
        exampleCount: 1,
        latestExample: null,
      },
      currentRuleVersion: 'restricted-rules-v1',
      prospectiveRuleVersion: 'restricted-rules-v2-preview',
      affectedCount: 1,
      items: [
        {
          novelId: 'unknown-1',
          title: '待标注作品',
          author: '作者',
          revision: 2,
          source: 'legacy',
          matchedFields: ['categories'],
          evidence: [{ type: 'rule-candidate', field: 'categories', value: '新成人标签', rule: 'candidate-1' }],
        },
      ],
    })
    mocks.candidateReview.mockResolvedValue({
      ok: true,
      decision: 'approve',
      candidate: { status: 'approved' },
      ruleVersion: 'restricted-rules-v2-preview',
      matchedCount: 1,
      appliedCount: 1,
      operationId: 'rating-rule-apply-1',
    })
    mocks.aiList.mockResolvedValue({
      items: [],
      total: 0,
      counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 },
    })
    mocks.aiScan.mockResolvedValue({ ok: true, taskId: '', selected: 0, total: 0, message: '没有可分析的 unknown 作品' })
  })

  it('展示分级概览、来源和可解释证据', async () => {
    render(<ContentRatingsTab />)

    expect(await screen.findByText('潮汐之后')).toBeInTheDocument()
    expect(screen.getByText('规则预填')).toBeInTheDocument()
    expect(screen.getByText('分类：成人')).toBeInTheDocument()
    expect(screen.getByText('修订 3')).toBeInTheDocument()
    expect(screen.getByText('待标注')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('人工修改必须带理由，并携带当前 revision 提交', async () => {
    const user = userEvent.setup()
    render(<ContentRatingsTab />)

    await user.click(await screen.findByRole('button', { name: '修改 潮汐之后 的分级' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('修改理由'), '人工复核标题、分类和简介后确认')
    await user.click(screen.getByRole('button', { name: '保存分级' }))

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith('novel-1', {
        contentRating: 'restricted',
        reason: '人工复核标题、分类和简介后确认',
        expectedRevision: 3,
      })
    })
    expect(dialog).not.toBeInTheDocument()
    expect(mocks.toast).toHaveBeenCalledWith('作品分级已更新，修改理由已写入审计记录', 'success')
  })

  it('人工 restricted 作品可以沉淀待审核候选，但不会直接扩散规则', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue({
      ...response,
      items: [{ ...item, source: 'manual', reason: '人工复核确认限制级' }],
    })
    render(<ContentRatingsTab />)

    await user.click(await screen.findByRole('button', { name: '从 潮汐之后 沉淀规则候选' }))
    await user.type(screen.getByLabelText('分类标签'), '新成人标签')
    await user.type(screen.getByLabelText('候选理由'), '人工复核确认该分类在本库语境下稳定指向限制级')
    await user.click(screen.getByRole('button', { name: '保存待审核候选' }))

    await waitFor(() => {
      expect(mocks.candidateCreate).toHaveBeenCalledWith({
        novelId: 'novel-1',
        kind: 'category',
        value: '新成人标签',
        reason: '人工复核确认该分类在本库语境下稳定指向限制级',
      })
    })
    expect(mocks.toast).toHaveBeenCalledWith('已生成待审核规则候选，不会立即影响其他作品', 'success')
  })

  it('审核规则候选前必须先预览影响范围，并按候选 revision 提交批准', async () => {
    const user = userEvent.setup()
    mocks.candidateList.mockResolvedValue({
      items: [
        {
          id: 'candidate-1',
          kind: 'category',
          value: '新成人标签',
          normalizedValue: '新成人标签',
          targetRating: 'restricted',
          status: 'pending',
          createdBy: 'admin-1',
          createdByName: '站长',
          createdAt: Date.now(),
          reviewedBy: '',
          reviewedByName: '',
          reviewedAt: 0,
          reviewReason: '',
          updatedAt: Date.now(),
          revision: 1,
          ruleVersion: '',
          exampleCount: 1,
          latestExample: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      counts: { pending: 1, approved: 0, rejected: 0 },
      kinds: ['category', 'phrase'],
      activeRuleVersion: 'restricted-rules-v1',
    })
    render(<ContentRatingsTab />)

    await user.click(await screen.findByRole('button', { name: '预览影响' }))
    expect(await screen.findByText('待标注作品')).toBeInTheDocument()
    expect(mocks.candidatePreview).toHaveBeenCalledWith('candidate-1', { limit: 100, offset: 0 })

    await user.click(screen.getByRole('button', { name: '批准并应用' }))
    await user.type(screen.getByLabelText('批准理由'), '影响范围确认，批准作为分类自动规则')
    await user.click(screen.getByRole('button', { name: '确认批准并应用' }))

    await waitFor(() => {
      expect(mocks.candidateReview).toHaveBeenCalledWith('candidate-1', {
        decision: 'approve',
        expectedRevision: 1,
        reason: '影响范围确认，批准作为分类自动规则',
      })
    })
    expect(mocks.toast).toHaveBeenCalledWith('规则已批准并应用，影响 1 本作品', 'success')
  })

  it('可以查看变更历史，并在并发冲突时刷新而不覆盖他人的修改', async () => {
    const user = userEvent.setup()
    render(<ContentRatingsTab />)

    await user.click(await screen.findByRole('button', { name: '查看 潮汐之后 的分级历史' }))
    expect(await screen.findByText('复核完成')).toBeInTheDocument()
    expect(mocks.history).toHaveBeenCalledWith('novel-1')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: '修改 潮汐之后 的分级' }))
    await user.type(screen.getByLabelText('修改理由'), '再次复核')
    const conflict = Object.assign(new Error('作品分级已被其他管理员修改'), {
      status: 409,
      data: { code: 'content_rating_conflict' },
    })
    mocks.update.mockRejectedValueOnce(conflict)
    await user.click(screen.getByRole('button', { name: '保存分级' }))

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('已被其他管理员修改'), 'error'))
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('LLM 建议必须经过人工审核，批准 restricted 时按建议 revision 提交', async () => {
    const user = userEvent.setup()
    const suggestion: AdminContentRatingAiSuggestion = {
      id: 'ratingai-1',
      novelId: 'unknown-1',
      title: '待审核 AI 作品',
      author: '作者',
      taskId: 'aitask-1',
      novelRevision: 4,
      currentRating: 'unknown',
      currentSource: 'system',
      currentRevision: 4,
      inputSnapshot: { title: '待审核 AI 作品', categories: ['测试成人标签'] },
      suggestedRating: 'restricted',
      confidence: 0.91,
      reason: '元数据出现明确限制级分类',
      evidence: [{ type: 'llm', field: 'categories', value: '测试成人标签' }],
      model: 'rating-test-model',
      promptVersion: 'content-rating-ai-v1',
      status: 'pending',
      revision: 0,
      reviewedBy: '',
      reviewedByName: '',
      reviewedAt: 0,
      reviewReason: '',
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mocks.aiList.mockResolvedValueOnce({ items: [suggestion], total: 1, counts: { pending: 1, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    mocks.aiReview.mockResolvedValue({
      ok: true,
      decision: 'approve',
      suggestion: { ...suggestion, status: 'approved' },
      applied: true,
      operationId: 'rating-ai-1',
    })
    render(<ContentRatingsTab />)

    expect(await screen.findByText('待审核 AI 作品')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '审核建议' }))
    await user.click(screen.getByRole('button', { name: '进入批准确认' }))
    await user.type(screen.getByLabelText('批准理由'), '人工复核 AI 提取证据后确认')
    await user.click(screen.getByRole('button', { name: '确认批准建议' }))

    await waitFor(() => {
      expect(mocks.aiReview).toHaveBeenCalledWith('ratingai-1', {
        decision: 'approve',
        expectedRevision: 0,
        reason: '人工复核 AI 提取证据后确认',
      })
    })
    expect(mocks.toast).toHaveBeenCalledWith('AI 建议已批准，作品已标为限制级；操作已写入审计记录', 'success')
  })
})
