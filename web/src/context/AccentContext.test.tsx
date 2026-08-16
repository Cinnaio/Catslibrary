import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AccentProvider, applyAccent, resolveAccent, useAccent } from './AccentContext'

afterEach(() => {
  localStorage.removeItem('accent')
  applyAccent(null)
})

describe('AccentContext', () => {
  it('无自定义时 accent 为 null，html 无 data-accent', () => {
    const { result } = renderHook(() => useAccent(), { wrapper: AccentProvider })
    expect(result.current.accent).toBeNull()
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false)
  })

  it('resolveAccent 读取 localStorage 并小写化', () => {
    localStorage.setItem('accent', '#C05B4A')
    expect(resolveAccent()).toBe('#c05b4a')
  })

  it('非法存储值视为未自定义', () => {
    localStorage.setItem('accent', '#12345')
    expect(resolveAccent()).toBeNull()
  })

  it('setAccent 写入 localStorage、data-accent 与 --accent-base/ink', () => {
    const { result } = renderHook(() => useAccent(), { wrapper: AccentProvider })
    act(() => result.current.setAccent('#2F5D62'))
    expect(result.current.accent).toBe('#2f5d62')
    expect(localStorage.getItem('accent')).toBe('#2f5d62')
    expect(document.documentElement.hasAttribute('data-accent')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--accent-base')).toBe('#2f5d62')
    expect(document.documentElement.style.getPropertyValue('--accent-ink-light')).toBe('#FFFFFF')
    expect(document.documentElement.style.getPropertyValue('--accent-ink-dark')).toBe('#1D1510')
  })

  it('非法输入视为清除', () => {
    const { result } = renderHook(() => useAccent(), { wrapper: AccentProvider })
    act(() => result.current.setAccent('#12345'))
    expect(result.current.accent).toBeNull()
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false)
  })

  it('恢复默认清除存储与变量', () => {
    const { result } = renderHook(() => useAccent(), { wrapper: AccentProvider })
    act(() => result.current.setAccent('#A23B4E'))
    act(() => result.current.setAccent(null))
    expect(result.current.accent).toBeNull()
    expect(localStorage.getItem('accent')).toBeNull()
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--accent-base')).toBe('')
  })
})
