/**
 * 防抖工具 hook：
 * - useDebouncedValue：值稳定 delay 毫秒后才向下游传播（搜索输入等）。
 * - useDebouncedCallback：调用聚合，静默 delay 毫秒后只执行最后一次（自动保存等）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

export function useDebouncedValue<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay = 400): (...args: A) => void {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return useMemo(
    () =>
      (...args: A) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          fnRef.current(...args)
        }, delay)
      },
    [delay],
  )
}
