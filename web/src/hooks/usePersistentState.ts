/**
 * 持久化 state hook —— 值同步到 localStorage，刷新后恢复。
 * 用于管理后台各子 tab（Ai 服务 / 爬虫抓取 / 账户与注册）：刷新页面后
 * 仍停留在之前选择的子标签，而不是重置回默认项。
 */
import { useCallback, useState } from 'react'

/**
 * @param key        localStorage 键
 * @param defaultValue 缺省值（无历史记录或历史值不合法时）
 * @param isValid    可选校验：历史值不在合法选项内时回落默认值，避免渲染出不存在的子 tab
 */
export function usePersistentState<T extends string = string>(
  key: string,
  defaultValue: T,
  isValid?: (value: string) => boolean,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved !== null && (!isValid || isValid(saved))) return saved as T
    } catch {
      /* 隐私模式 / 存储不可用时忽略 */
    }
    return defaultValue
  })

  const set = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* 同上 */
      }
    },
    [key],
  )

  return [value, set]
}
