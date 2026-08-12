import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedCallback, useDebouncedValue } from './useDebounce'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('值稳定 delay 毫秒后才传播', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    })
    expect(result.current).toBe('a')

    rerender({ value: 'ab' })
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(399))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('ab')
  })

  it('连续变化会重置计时（只取最后一次）', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'ab' })
    act(() => vi.advanceTimersByTime(300))
    rerender({ value: 'abc' })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('abc')
  })
})

describe('useDebouncedCallback', () => {
  it('聚合多次调用，仅以最后一次参数执行一次', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 400))

    act(() => {
      result.current(1)
      result.current(2)
      result.current(3)
    })
    expect(fn).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(400))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })

  it('卸载时取消未执行的调用', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 400))
    act(() => result.current('x'))
    unmount()
    act(() => vi.advanceTimersByTime(400))
    expect(fn).not.toHaveBeenCalled()
  })
})
