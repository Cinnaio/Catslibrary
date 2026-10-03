import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ jobs: vi.fn(), status: vi.fn(), cancel: vi.fn(), retryFailed: vi.fn(), post: vi.fn(), confirm: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ scrapeApi: { jobs: mocks.jobs, status: mocks.status, cancel: mocks.cancel, retryFailed: mocks.retryFailed } }))
vi.mock('@/components/feedback', () => ({ useConfirm: () => ({ confirm: mocks.confirm }), useToast: () => ({ toast: mocks.toast }) }))
vi.mock('../utils', () => ({ scrapePost: mocks.post }))
import { useScrapeJobs } from './useScrapeJobs'
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.jobs.mockResolvedValue({ jobs: [] }) })
afterEach(() => { vi.useRealTimers() })
it('终态到达后，迟到的旧轮询不能把任务改回运行中或回退成功数', async () => {
  const resolvers: Array<(value: unknown) => void> = []
  mocks.status.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
  const { result } = renderHook(useScrapeJobs)
  act(() => result.current.track('job', '测试书'))
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(resolvers).toHaveLength(2)
  await act(async () => resolvers[1]!({ status: 'cancelled', summary: { successCount: 10 } }))
  expect(result.current.jobs[0]?.status).toBe('cancelled')
  await act(async () => resolvers[0]!({ status: 'scraping_chapters', summary: { successCount: 0 } }))
  expect(result.current.jobs[0]?.status).toBe('cancelled')
  expect(result.current.jobs[0]?.successCount).toBe(10)
})
it('重复点击整本重试只发送一次，成功后只添加一张新任务卡', async () => {
  const { result } = renderHook(useScrapeJobs)
  act(() => result.current.track('old', '测试书'))
  let resolve!: (value: unknown) => void
  mocks.post.mockReturnValue(new Promise(r => { resolve = r }))
  let pending!: Promise<void>
  act(() => { pending = result.current.retry('old') })
  act(() => { void result.current.retry('old') })
  expect(mocks.post).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ jobId: 'new' }); await pending })
  expect(result.current.jobs.map(job => job.jobId)).toEqual(['new', 'old'])
})

it('请求超过轮询周期时，仍接纳已返回的进度，再接纳后续结果', async () => {
  const resolvers: Array<(value: unknown) => void> = []
  mocks.status.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
  const { result } = renderHook(useScrapeJobs)
  act(() => result.current.track('slow', '慢任务'))
  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
  expect(resolvers).toHaveLength(2)
  await act(async () => resolvers[0]!({ status: 'scraping_chapters', summary: { successCount: 10 } }))
  expect(result.current.jobs[0]?.successCount).toBe(10)
  await act(async () => resolvers[1]!({ status: 'completed', summary: { successCount: 20 } }))
  expect(result.current.jobs[0]?.status).toBe('completed')
  expect(result.current.jobs[0]?.successCount).toBe(20)
})

it('移除任务后，迟到的轮询不会更新重新跟踪的同 ID 任务', async () => {
  let resolve!: (value: unknown) => void
  mocks.status.mockReturnValue(new Promise(r => { resolve = r }))
  const { result } = renderHook(useScrapeJobs)
  act(() => result.current.track('dismissed', '旧任务'))
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  act(() => { result.current.dismiss('dismissed'); result.current.track('dismissed', '重新跟踪') })
  await act(async () => resolve({ status: 'completed', summary: { successCount: 99 } }))
  expect(result.current.jobs[0]?.status).toBe('starting')
  expect(result.current.jobs[0]?.successCount).toBe(0)
})

it('失败章节与整本重试共用防重锁，请求失败后允许再次重试', async () => {
  let reject!: (reason: Error) => void
  mocks.retryFailed.mockReturnValueOnce(new Promise((_, r) => { reject = r }))
  const { result } = renderHook(useScrapeJobs)
  let pending!: Promise<void>
  act(() => { pending = result.current.retryFailed('old') })
  act(() => { void result.current.retryFailed('old'); void result.current.retry('old') })
  expect(mocks.retryFailed).toHaveBeenCalledTimes(1)
  expect(mocks.post).not.toHaveBeenCalled()
  await act(async () => { reject(new Error('网络失败')); await pending })
  mocks.retryFailed.mockResolvedValueOnce({ jobId: 'new' })
  await act(async () => { await result.current.retryFailed('old') })
  expect(mocks.retryFailed).toHaveBeenCalledTimes(2)
  expect(result.current.jobs.map(job => job.jobId)).toEqual(['new'])
})
