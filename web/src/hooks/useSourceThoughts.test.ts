import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSourceThoughts } from './useSourceThoughts'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ request }))
const counts = (id: string) => ({ available: true, source: { id, label: id }, paragraphs: [], unmatchedCount: 0 })
beforeEach(() => { request.mockReset() })
it('章节或账号变化时立即隔离旧统计，迟到响应不覆盖当前结果', async () => {
  let resolveOld!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  const view = renderHook(({ chapter, scope }) => useSourceThoughts(chapter, true, scope), { initialProps: { chapter: 'old', scope: 'first' } })
  request.mockResolvedValueOnce(counts('new'))
  view.rerender({ chapter: 'new', scope: 'first' })
  await waitFor(() => expect(view.result.current.data?.source?.id).toBe('new'))
  await act(async () => { resolveOld(counts('old')) })
  expect(view.result.current.data?.source?.id).toBe('new')
  let resolveAccount!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(resolve => { resolveAccount = resolve }))
  view.rerender({ chapter: 'new', scope: 'second' })
  expect(view.result.current.data).toBeUndefined()
  expect(view.result.current.loading).toBe(true)
  await act(async () => { resolveAccount(counts('second')) })
  expect(view.result.current.data?.source?.id).toBe('second')
})
it('来源失败可重试，禁用后清除统计且不继续请求', async () => {
  request.mockRejectedValueOnce(new Error('unavailable'))
  const view = renderHook(({ enabled }) => useSourceThoughts('chapter', enabled, 'account'), { initialProps: { enabled: true } })
  await waitFor(() => expect(view.result.current.error).not.toBe(''))
  request.mockResolvedValueOnce(counts('recovered'))
  act(() => view.result.current.retry())
  await waitFor(() => expect(view.result.current.data?.source?.id).toBe('recovered'))
  view.rerender({ enabled: false })
  expect(view.result.current.data).toBeUndefined()
  expect(view.result.current.loading).toBe(false)
  expect(request).toHaveBeenCalledTimes(2)
})
