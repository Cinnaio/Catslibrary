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
  aiProgress: vi.fn(),
  aiLatest: vi.fn(),
  aiResume: vi.fn(),
  cancelTask: vi.fn(),
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
      progress: mocks.aiProgress,
      latest: mocks.aiLatest,
      resume: mocks.aiResume,
    },
  },
  aiApi: {
    task: mocks.aiTask,
    cancelTask: mocks.cancelTask,
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
  // 这个面板的交互链较长（打开 Dialog/Popover、等异步列表、轮询进度），
  // 默认 5s 在满负载并行跑的机器上会随机吃紧；文件内统一给足预算，
  // 避免用例变成「单独跑能过、全量跑偶发超时」的不稳定测试。
  vi.setConfig({ testTimeout: 20_000 })

  beforeEach(() => {
    // resetAllMocks 而非 clearAllMocks：后者只清调用记录，会留下上一用例的
    // mockResolvedValue 实现，导致轮询类用例被前一个用例的返回值污染。
    vi.resetAllMocks()
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
    mocks.aiLatest.mockResolvedValue({ task: null, total: 0, done: 0, remaining: 0, canResume: false, resumable: false, promptVersion: '' })
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

  it('分析任务显示批次进度，并可随时中止', async () => {
    const user = userEvent.setup()
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    mocks.aiScan.mockResolvedValue({
      ok: true,
      taskId: 'aitask-run',
      selected: 40,
      total: 40,
      task: { id: 'aitask-run', status: 'running', current: 0, total: 40, step: '准备作品元数据' },
    })
    mocks.aiProgress.mockResolvedValue({
      task: { id: 'aitask-run', status: 'running', current: 12, total: 40, step: '已分析 12 / 40 本 · 成功 12' },
      total: 40,
      done: 12,
      remaining: 28,
      canResume: false,
      resumable: true,
      promptVersion: 'content-rating-ai-v1',
    })
    mocks.cancelTask.mockResolvedValue({ ok: true })
    render(<ContentRatingsTab />)

    await user.click(screen.getByRole('button', { name: '分析 unknown' }))

    // 进度用批次口径（已处理/剩余缺口），不是执行器游标
    expect(await screen.findByText(/已处理 12 \/ 40 本/)).toBeInTheDocument()
    expect(screen.getByText(/剩余 28 本/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')

    await user.click(screen.getByRole('button', { name: /中止任务/ }))
    await waitFor(() => expect(mocks.cancelTask).toHaveBeenCalledWith('aitask-run'))
    expect(mocks.toast).toHaveBeenCalledWith('已中止分析任务，已生成的建议保留在下方列表', 'success')
  })

  it('中断后只在仍有缺口时提供断点恢复，并按跳过/补跑数量提示', async () => {
    const user = userEvent.setup()
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    mocks.aiScan.mockResolvedValue({
      ok: true,
      taskId: 'aitask-failed',
      selected: 40,
      total: 40,
      task: { id: 'aitask-failed', status: 'running', current: 3, total: 40, step: '准备作品元数据' },
    })
    // 首次进度读取时任务已中断且有 28 本缺口 → 允许恢复
    mocks.aiProgress.mockResolvedValueOnce({
      task: { id: 'aitask-failed', status: 'failed', current: 12, total: 40, step: '已分析 12 / 40 本', error: '上游超时' },
      total: 40,
      done: 12,
      remaining: 28,
      canResume: true,
      resumable: true,
      promptVersion: 'content-rating-ai-v1',
    })
    mocks.aiProgress.mockResolvedValue({
      task: { id: 'aitask-failed', status: 'failed', current: 12, total: 40, step: '已分析 12 / 40 本', error: '上游超时' },
      total: 40,
      done: 12,
      remaining: 28,
      canResume: true,
      resumable: true,
      promptVersion: 'content-rating-ai-v1',
    })
    mocks.aiResume.mockResolvedValue({
      ok: true,
      taskId: 'aitask-resumed',
      selected: 28,
      total: 40,
      skipped: 12,
      task: { id: 'aitask-resumed', status: 'queued', current: 0, total: 28, step: '' },
    })
    render(<ContentRatingsTab />)

    await user.click(screen.getByRole('button', { name: '分析 unknown' }))

    const resumeButton = await screen.findByRole('button', { name: /断点恢复（28 本）/ })
    await user.click(resumeButton)

    await waitFor(() => expect(mocks.aiResume).toHaveBeenCalledWith('aitask-failed'))
    expect(mocks.toast).toHaveBeenCalledWith('已断点恢复：跳过 12 本，补跑 28 本', 'success')
  })

  it('批次已无缺口时不再渲染断点恢复入口', async () => {
    const user = userEvent.setup()
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    mocks.aiScan.mockResolvedValue({
      ok: true,
      taskId: 'aitask-done',
      selected: 5,
      total: 5,
      task: { id: 'aitask-done', status: 'running', current: 0, total: 5, step: '准备作品元数据' },
    })
    mocks.aiProgress.mockResolvedValue({
      task: { id: 'aitask-done', status: 'cancelled', current: 5, total: 5, step: '已取消' },
      total: 5,
      done: 5,
      remaining: 0,
      canResume: false,
      resumable: false,
      promptVersion: 'content-rating-ai-v1',
    })
    render(<ContentRatingsTab />)

    await user.click(screen.getByRole('button', { name: '分析 unknown' }))

    expect(await screen.findByText(/剩余 0 本|无缺口/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /断点恢复/ })).not.toBeInTheDocument()
  })

  it('刷新页面后从服务端对齐当前批次，进度条与控制入口不丢失', async () => {
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    // 模拟刷新：本地没有任何任务内存态，只有服务端记着上次的批次
    mocks.aiLatest.mockResolvedValue({
      task: { id: 'aitask-running', status: 'running', current: 30, total: 100, step: '已分析 30 / 100 本 · 成功 29 · 失败 1' },
      total: 100,
      done: 30,
      remaining: 70,
      canResume: false,
      resumable: true,
      promptVersion: 'content-rating-ai-v1',
    })
    render(<ContentRatingsTab />)

    expect(await screen.findByText(/已处理 30 \/ 100 本/)).toBeInTheDocument()
    // 剩余缺口：与「已处理」同属一行，用整个进度区的文本断言（跨节点匹配）
    const region = screen.getByLabelText('LLM 分级任务进度')
    expect(region.textContent?.replace(/\s+/g, ' ')).toContain('剩余 70 本')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
    // 运行中的任务刷新后仍可中止
    expect(screen.getByRole('button', { name: /中止任务/ })).toBeInTheDocument()
  })

  it('刷新后接管已中止的批次，缺口仍可断点恢复', async () => {
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    mocks.aiLatest.mockResolvedValue({
      task: { id: 'aitask-stopped', status: 'cancelled', current: 20, total: 100, step: '已取消' },
      total: 100,
      done: 20,
      remaining: 80,
      canResume: true,
      resumable: true,
      promptVersion: 'content-rating-ai-v1',
    })
    render(<ContentRatingsTab />)

    expect(await screen.findByRole('button', { name: /断点恢复（80 本）/ })).toBeInTheDocument()
    expect(screen.getByText(/已处理 20 \/ 100 本/)).toBeInTheDocument()
  })

  it('单批分析数量可调，默认 20，改为 100 后按 100 提交', async () => {
    const user = userEvent.setup()
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    render(<ContentRatingsTab />)

    // 默认不改变既有行为：没选过就是 20
    expect(screen.getByLabelText('单批分析数量')).toHaveTextContent('20 本')

    // 改成 100 后提交，服务端按 100 选目标，避免用户被迫点 20 次
    await user.click(screen.getByLabelText('单批分析数量'))
    await user.click(await screen.findByRole('option', { name: '100 本（单批上限）' }))
    expect(screen.getByLabelText('单批分析数量')).toHaveTextContent('100 本（单批上限）')

    mocks.aiScan.mockResolvedValue({
      ok: true,
      taskId: 'aitask-batch',
      selected: 100,
      total: 100,
      task: { id: 'aitask-batch', status: 'running', current: 0, total: 100, step: '准备作品元数据' },
    })
    mocks.aiProgress.mockResolvedValue({
      task: { id: 'aitask-batch', status: 'running', current: 0, total: 100, step: '准备作品元数据' },
      total: 100,
      done: 0,
      remaining: 100,
      canResume: false,
      resumable: true,
      promptVersion: 'content-rating-ai-v1',
    })
    await user.click(screen.getByRole('button', { name: '分析 unknown' }))

    await waitFor(() => expect(mocks.aiScan).toHaveBeenCalledWith({ limit: 100 }))
  })

  it('服务端上限之外的数量会被收敛到 20，不会把非法值发出去', async () => {
    const user = userEvent.setup()
    mocks.aiList.mockResolvedValue({ items: [], total: 0, counts: { pending: 0, approved: 0, rejected: 0, stale: 0, failed: 0 } })
    render(<ContentRatingsTab />)

    await user.click(screen.getByRole('button', { name: '分析 unknown' }))
    await waitFor(() => expect(mocks.aiScan).toHaveBeenCalledWith({ limit: 20 }))
  })

  it('筛选下拉带宽度上限，不会在工具条里撑满整行', async () => {
    render(<ContentRatingsTab />)
    await screen.findByText('潮汐之后')

    // 回归：compact 曾解除宽度约束，两个筛选器各占一整行（实测 1440px），
    // 工具条被撑成三行。宽度上限必须由控件自身提供。
    for (const name of ['按分级筛选', '按来源筛选']) {
      const trigger = screen.getByLabelText(name)
      expect(trigger.className).toContain('max-w-[var(--admin-filter-width)]')
      expect(trigger.className).not.toContain('max-w-none')
    }
  })

  it('工具条带自己的内间距类名，避免贴边与压住表头', async () => {
    render(<ContentRatingsTab />)
    await screen.findByText('潮汐之后')

    // 回归：.admin-toolbar--inline 自身没有内间距，各页面须由自己的 class 补齐
    // （padding + border-bottom + margin-bottom）。裸用会让控件贴住面板左右边缘，
    // 且 padding-bottom 落在盒内、表格紧贴表头。
    const toolbar = document.querySelector('.content-ratings-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.className).toContain('admin-toolbar')
  })
})
