import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisReport, AnalysisReview } from '@shared/novel-analysis'
import { setStorageUser } from '@/lib/storage'
import NovelAnalysisReport from './NovelAnalysisReport'

const api = vi.hoisted(() => ({ read: vi.fn(), source: vi.fn(), edit: vi.fn(), stop: vi.fn(), resume: vi.fn(), reviewPreview: vi.fn(), review: vi.fn(), stopReview: vi.fn(), applyReview: vi.fn() }))
vi.mock('@/lib/novel-analysis-api', () => ({ novelAnalysisApi: api }))
vi.mock('@/lib/api', () => ({ newOperationId: () => `review_${Math.random().toString(36).slice(2)}` }))
const original = '父母已经在场。'
const match = { sourceIds: ['S1'], chapterId: 'c1', chapterTitle: '第一章', start: 0, end: 11, quote: '他担心父母会看见。' }
const segment = { id: 'p1', start: 0, end: original.length, text: original, sourceIds: ['S1'] }
function review(overrides: Partial<AnalysisReview> = {}): AnalysisReview {
  return { id: 'review', reportId: 'report', reportRevision: 2, contentHash: 'content', sourceFingerprint: 'source', checkerVersion: 'v1', taskId: 'task-review',
    status: 'completed', error: '', stale: false, createdAt: 1, coverage: { segments: [segment], skipped: 2, sourceChars: 100 },
    result: { items: [{ id: 'f1', segmentId: 'p1', start: 0, end: original.length, original, kind: 'inference', explanation: '原文表达担心，不能说明父母已经在场。', suggestion: '他担心被父母看见，在场情况未明确。', evidence: [match] }],
      partial: false, rejected: 0, checkedSegmentIds: ['p1'] }, ...overrides }
}
function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return { id: 'report', novelId: 'book', taskId: 'task', status: 'completed', request: { kind: 'plot', startChapterId: 'c1', endChapterId: 'c1', question: '' },
    step: '', error: '', processed: 1, total: 1, chapterCount: 1, revision: 2, edited: false, createdAt: 1, updatedAt: 1,
    content: original, originalContent: original, sourceChanged: false, notes: [], checkedSourceIds: [],
    sources: [{ id: 'S1', chapterId: 'c1', chapterTitle: '第一章', chapterOrdinal: 1, part: 1, offset: 0, endOffset: 11, revision: 'hash' }],
    evidence: { checkerVersion: 'v1', contentHash: 'content', sourceFingerprint: 'source', coverage: 'complete', scannedQuotes: 1, totalQuotes: 1,
      items: [{ id: 'q1', start: 0, end: original.length, quote: original, citedSourceIds: ['S1'], status: 'not_found', matches: [] }] },
    reviews: [], ...overrides }
}
const onChange = vi.fn()
function View({ active = true, reportId = 'report', novelId = 'book' }: { active?: boolean; reportId?: string; novelId?: string }) {
  return <MemoryRouter><NovelAnalysisReport key={`${novelId}:${reportId}`} novelId={novelId} reportId={reportId} active={active} onChange={onChange} onReanalyze={() => {}} /></MemoryRouter>
}
function expand(text: string | RegExp) { fireEvent.click(screen.getByText(text, { selector: 'summary' })) }

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  onChange.mockClear(); sessionStorage.clear(); localStorage.clear(); localStorage.setItem('user_session_marker', 'evidence-tests'); setStorageUser('admin')
  api.read.mockResolvedValue(report())
  api.source.mockResolvedValue({ ...report().sources[0], text: match.quote })
  api.reviewPreview.mockResolvedValue({ revision: 2, segments: [segment], skipped: 2, sourceChars: 100, availableSegments: [segment] })
  api.review.mockResolvedValue({ reviewId: 'review', taskId: 'task-review', created: true })
  api.stopReview.mockResolvedValue({ ok: true }); api.applyReview.mockResolvedValue({ ok: true })
})
afterEach(() => { vi.useRealTimers() })

it('打开报告只读核验，显式预览后才允许发起一次核对；失去回执沿用请求和版本', async () => {
  api.reviewPreview.mockResolvedValue({ revision: 2, segments: [segment], skipped: 2, sourceChars: 100, sourceIds: ['S1', 'S2'], availableSegments: [segment] })
  api.review.mockRejectedValueOnce(new Error('回执丢失')).mockResolvedValue({ reviewId: 'review', taskId: 'task-review', created: false })
  const first = render(<View />)
  await screen.findByRole('button', { name: '核对主要结论' })
  expect(api.reviewPreview).not.toHaveBeenCalled(); expect(api.review).not.toHaveBeenCalled()
  expand(/引用字面核验/)
  expect(screen.getByText(/找到连续原句不代表分析判断正确/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '核对主要结论' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeEnabled())
  expect(screen.getByText(/本次实际覆盖 1 段.*另有 2 段未覆盖/)).toBeInTheDocument()
  expand('实际提供的原文来源 · 2 段')
  expect(screen.getByRole('button', { name: 'S2 · 原文来源' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '确认范围并开始核对' }))
  await screen.findByText(/回执丢失/)
  const request = api.review.mock.calls[0]!
  expect(request[2]).toMatchObject({ revision: 2 })
  first.unmount(); render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: '核对主要结论' }))
  fireEvent.click(screen.getByRole('button', { name: '重试并找回这次核对' }))
  await waitFor(() => expect(api.review).toHaveBeenCalledTimes(2))
  expect(api.review.mock.calls[1]).toEqual(request)
})

it('手选段落以服务端偏移提交，实际覆盖未返回前不能开始，最多8段', async () => {
  const segments = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, start: i * 20, end: i * 20 + 4, text: `结论${i}`, sourceIds: ['S1'] }))
  api.reviewPreview.mockImplementation(async (_novel: string, _report: string, starts?: number[]) => ({ revision: 2, segments: starts ? segments.filter(s => starts.includes(s.start)) : segments.slice(0, 8), skipped: starts ? 9 - starts.length : 1, sourceChars: 100, availableSegments: segments }))
  render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: '核对主要结论' }))
  await screen.findByText('手动选择段落 · 已选 8 / 8')
  expand(/手动选择段落/)
  expect(screen.getAllByRole('checkbox')[8]).toBeDisabled()
  fireEvent.click(screen.getAllByRole('checkbox')[0]!)
  await waitFor(() => expect(api.reviewPreview).toHaveBeenLastCalledWith('book', 'report', [20, 40, 60, 80, 100, 120, 140]))
  await waitFor(() => expect(screen.getAllByRole('checkbox')[8]).toBeEnabled())
  fireEvent.click(screen.getAllByRole('checkbox')[8]!)
  await waitFor(() => expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '确认范围并开始核对' }))
  await waitFor(() => expect(api.review).toHaveBeenCalledWith('book', 'report', expect.objectContaining({ revision: 2, paragraphStarts: [20, 40, 60, 80, 100, 120, 140, 160] })))
})

it('核对原文、修订前后对照及应用绑定当前修订，失败不丢建议', async () => {
  api.read.mockResolvedValue(report({ reviews: [review()] }))
  api.applyReview.mockRejectedValue(new Error('报告版本已变化'))
  render(<View />)
  await screen.findByRole('button', { name: '核对主要结论' })
  expand(/事实核对记录/); expand(/可能将认知/)
  expect(screen.getByText('修订前')).toBeInTheDocument(); expect(screen.getByText('建议修订后')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '核对原文 S1 · 第一章' }))
  await screen.findByText('待核对的连续原句')
  expect(api.source).toHaveBeenCalledWith('book', 'report', 'S1')
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '应用这条修订' }))
  await screen.findByText(/报告版本已变化/)
  expect(api.applyReview).toHaveBeenCalledWith('book', 'report', 'review', 'f1', 2)
  expect(screen.getByText('他担心被父母看见，在场情况未明确。')).toBeInTheDocument()
})

it.each(['old-revision', 'source-changed', 'stale-record'] as const)('%s 保留历史依据并禁止应用', async reason => {
  api.read.mockResolvedValue(report({ revision: reason === 'old-revision' ? 3 : 2, sourceChanged: reason === 'source-changed', reviews: [review({ stale: reason === 'stale-record' })] }))
  render(<View />)
  await screen.findByRole('button', { name: '核对主要结论' })
  expand(/事实核对记录/); expand(/可能将认知/)
  expect(screen.getByRole('button', { name: '应用这条修订' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '核对原文 S1 · 第一章' })).toBeEnabled()
  if (reason === 'source-changed') {
    fireEvent.click(screen.getByRole('button', { name: '核对主要结论' }))
    expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeDisabled()
  }
  expect(api.applyReview).not.toHaveBeenCalled(); expect(api.review).not.toHaveBeenCalled()
})

it('报告已完成仍轮询核对任务，隐藏停止轮询，迟到核对不会改写人工输入', async () => {
  vi.useFakeTimers()
  api.read.mockResolvedValueOnce(report({ reviews: [review({ status: 'running', result: undefined })] }))
    .mockResolvedValueOnce(report({ reviews: [review({ status: 'running', result: undefined })] }))
    .mockResolvedValue(report({ revision: 3, updatedAt: 3, content: '其他窗口的新报告', reviews: [review({ stale: true })] }))
  const view = render(<View />)
  await act(async () => { await Promise.resolve() })
  fireEvent.click(screen.getByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '我的未保存修订' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(api.read).toHaveBeenCalledTimes(2)
  view.rerender(<View active={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(api.read).toHaveBeenCalledTimes(2)
  view.rerender(<View active />)
  await act(async () => { await Promise.resolve() })
  expect(api.read).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('textbox', { name: '修订报告（Markdown）' })).toHaveValue('我的未保存修订')
  expand(/事实核对记录/); expand(/可能将认知/)
  expect(screen.getByRole('button', { name: '应用这条修订' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存修订' }))
  await act(async () => { await Promise.resolve() })
  expect(api.edit).toHaveBeenCalledWith('book', 'report', '我的未保存修订', 2)
})

it('不完整且零可用建议不能显示未发现问题；停止核对使用独立入口', async () => {
  api.read.mockResolvedValue(report({ reviews: [review({ id: 'running', status: 'running', result: undefined }), review({ result: { items: [], partial: true, rejected: 2, checkedSegmentIds: [] } })] }))
  render(<View />)
  await screen.findByRole('button', { name: '核对主要结论' })
  expand(/事实核对记录/)
  expect(screen.getByText(/检查不完整.*丢弃 2 条/)).toBeInTheDocument()
  expect(screen.getByText('本次没有可用修订建议，不能据此判断未发现问题。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '停止这次核对' }))
  await waitFor(() => expect(api.stopReview).toHaveBeenCalledWith('book', 'report', 'running'))
  expect(api.stop).not.toHaveBeenCalled(); expect(api.resume).not.toHaveBeenCalled()
})

it('切书后迟到预览不能覆盖新报告', async () => {
  let finishPreview!: (value: unknown) => void
  api.reviewPreview.mockImplementationOnce(() => new Promise(resolve => { finishPreview = resolve }))
  api.read.mockImplementation(async (novelId: string, id: string) => report({ novelId, id, content: id }))
  const view = render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: '核对主要结论' }))
  await waitFor(() => expect(api.reviewPreview).toHaveBeenCalled())
  view.rerender(<View reportId="other-report" novelId="other" />)
  await screen.findByText('other-report')
  await act(async () => finishPreview({ revision: 2, segments: [{ ...segment, text: '旧书迟到范围' }], skipped: 0, sourceChars: 100 }))
  expect(screen.queryByText('旧书迟到范围')).not.toBeInTheDocument()
  expect(api.review).not.toHaveBeenCalled()
})

it('取消全部手选不把空查询误当第一段，禁止开始且可恢复自动范围', async () => {
  render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: '核对主要结论' }))
  await screen.findByText('手动选择段落 · 已选 1 / 8')
  expand(/手动选择段落/)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeDisabled()
  await screen.findByText(/本次实际覆盖 0 段/)
  expect(api.reviewPreview).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '恢复自动选择' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeEnabled())
  expect(api.reviewPreview).toHaveBeenCalledTimes(2)
})

it('迟到的旧版本范围不能用于当前报告，手选范围保留并要求更新', async () => {
  let finishPreview!: (value: unknown) => void
  api.reviewPreview.mockImplementationOnce(() => new Promise(resolve => { finishPreview = resolve }))
  const view = render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: '核对主要结论' }))
  await waitFor(() => expect(api.reviewPreview).toHaveBeenCalled())
  api.read.mockResolvedValue(report({ revision: 3, updatedAt: 3, content: '最新报告' }))
  view.rerender(<View active={false} />); view.rerender(<View active />)
  await screen.findByText('最新报告')
  await act(async () => finishPreview({ revision: 2, segments: [{ ...segment, text: '过期的核对范围' }], skipped: 0, sourceChars: 100 }))
  expect(screen.queryByText('过期的核对范围')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '更新核对范围' })).toBeEnabled()
})

it('切报告后迟到核对回执不刷新或改变当前报告', async () => {
  let finish!: (value: unknown) => void
  api.review.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  api.read.mockImplementation(async (novelId: string, id: string) => report({ novelId, id, content: id }))
  const view = render(<View />)
  fireEvent.click(await screen.findByRole('button', { name: '核对主要结论' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '确认范围并开始核对' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '确认范围并开始核对' }))
  await waitFor(() => expect(api.review).toHaveBeenCalledTimes(1))
  view.rerender(<View reportId="next-report" />)
  await screen.findByText('next-report')
  const reads = api.read.mock.calls.length
  await act(async () => finish({ reviewId: 'old-review', taskId: 'old-task', created: true }))
  expect(api.read).toHaveBeenCalledTimes(reads)
  expect(screen.getByText('next-report')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重试并找回这次核对' })).not.toBeInTheDocument()
})
