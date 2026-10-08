import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Thought } from '@shared/types'
import { useThoughtImages } from './useThoughtImages'

const api = vi.hoisted(() => ({ capabilities: vi.fn(), task: vi.fn(), generate: vi.fn(), sequence: 0 }))
vi.mock('../lib/api', () => ({ newOperationId: () => `image-${++api.sequence}`, thoughtsApi: {
  imageCapabilities: api.capabilities, imageTask: api.task, generateImage: api.generate,
} }))
const thought = { id: 'thought-1', chapterId: 'chapter-1', thoughtText: '雨夜插画', imageUrl: '/api/thoughts/image/thought-1' } as Thought
const completed = { id: 'task-1', status: 'completed', error: '', paragraphIndex: 0, selectedText: '雨夜', thought }
beforeEach(() => {
  api.sequence = 0
  api.capabilities.mockReset().mockResolvedValue({ allowed: true, dailyQuota: 10 })
  api.task.mockReset().mockResolvedValue({ task: null })
  api.generate.mockReset().mockResolvedValue({ taskId: 'task-1' })
})

it('恢复章节最新完成任务并通知阅读器插入图片想法', async () => {
  api.task.mockResolvedValue({ task: completed })
  const published = vi.fn()
  const { result } = renderHook(() => useThoughtImages('chapter-1', 'user-1', published))
  await waitFor(() => expect(result.current.allowed).toBe(true))
  expect(result.current.task?.id).toBe('task-1')
  expect(published).toHaveBeenCalledWith(thought)
  expect(result.current.generating).toBe(false)
})

it('刷新后恢复进行中任务，轮询完成后停止并发布结果', async () => {
  api.task.mockResolvedValueOnce({ task: { ...completed, status: 'running', thought: undefined } }).mockResolvedValue({ task: completed })
  const published = vi.fn()
  const { result } = renderHook(() => useThoughtImages('chapter-1', 'user-1', published))
  await waitFor(() => expect(result.current.generating).toBe(true))
  await waitFor(() => expect(result.current.task?.status).toBe('completed'), { timeout: 4000 })
  expect(published).toHaveBeenCalledWith(thought)
  expect(result.current.generating).toBe(false)
  expect(api.task).toHaveBeenCalledTimes(2)
})

it('创建任务响应丢失时使用同一个操作 ID 重试，成功后发布结果', async () => {
  const published = vi.fn()
  const { result } = renderHook(() => useThoughtImages('chapter-1', 'user-1', published))
  await waitFor(() => expect(result.current.allowed).toBe(true))
  api.generate.mockRejectedValueOnce(new Error('请求超时'))
  const input = { chapterId: 'chapter-1', selectedText: '雨夜' }
  await act(async () => { await expect(result.current.generate(input)).rejects.toThrow('请求超时') })
  api.task.mockResolvedValue({ task: completed })
  await act(async () => { await result.current.generate(input) })
  expect(api.generate.mock.calls[0]?.[1]).toBe(api.generate.mock.calls[1]?.[1])
  expect(published).toHaveBeenCalledWith(thought)
})

it('切换章节后忽略旧请求的完成结果', async () => {
  const published = vi.fn()
  const { result, rerender } = renderHook(({ chapter }) => useThoughtImages(chapter, 'user-1', published), { initialProps: { chapter: 'chapter-1' } })
  await waitFor(() => expect(result.current.allowed).toBe(true))
  let resolve!: (value: { taskId: string }) => void
  api.generate.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  let pending!: Promise<void>
  act(() => { pending = result.current.generate({ chapterId: 'chapter-1', selectedText: '雨夜' }) })
  rerender({ chapter: 'chapter-2' })
  await act(async () => { resolve({ taskId: 'task-1' }); await pending })
  expect(published).not.toHaveBeenCalled()
  expect(result.current.task).toBeNull()
})

it('无登录用户不读取出图能力或任务', () => {
  const { result } = renderHook(() => useThoughtImages('chapter-1', '', vi.fn()))
  expect(result.current.allowed).toBe(false)
  expect(api.capabilities).not.toHaveBeenCalled()
  expect(api.task).not.toHaveBeenCalled()
})
