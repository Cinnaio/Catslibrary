import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectReaderDevice, readLocalSettings, useReaderSettings } from './useReaderSettings'
import { act, renderHook, waitFor } from '@testing-library/react'
import { authApi, clearToken, setToken } from '../lib/api'
import { setStorageUser } from '../lib/storage'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); clearToken() })

describe('useReaderSettings device-scoped storage', () => {
  it('最小字号 0 初始化与切换后均生效', async () => {
    localStorage.setItem('readerSettings:desktop:fontSize', '0')
    const { result } = renderHook(() => useReaderSettings())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fontSize).toBe(0)
  })
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    clearToken()
    window.innerWidth = 1024
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })

  it('读取 desktop 与 mobile 各自的阅读设置', () => {
    localStorage.setItem('readerSettings:desktop:fontSize', '1')
    localStorage.setItem('readerSettings:mobile:fontSize', '5')
    localStorage.setItem('readerSettings:desktop:readerTheme', 'paper')
    localStorage.setItem('readerSettings:mobile:readerTheme', 'eye')

    expect(readLocalSettings('desktop')).toMatchObject({ fontSize: '1', readerTheme: 'paper' })
    expect(readLocalSettings('mobile')).toMatchObject({ fontSize: '5', readerTheme: 'eye' })
  })

  it('按移动端 UA 或阅读器断点选择 mobile 分区', () => {
    expect(detectReaderDevice()).toBe('desktop')

    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' })
    expect(detectReaderDevice()).toBe('mobile')

    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    window.innerWidth = 390
    expect(detectReaderDevice()).toBe('mobile')
  })

  it('没有分端 key 时兼容旧版 localStorage 设置', () => {
    localStorage.setItem('fontSize', '4')
    localStorage.setItem('readerTheme', 'paper')

    expect(readLocalSettings('desktop')).toMatchObject({ fontSize: '4', readerTheme: 'paper' })
    expect(readLocalSettings('mobile')).toMatchObject({ fontSize: '4', readerTheme: 'paper' })
  })

  it('无归属旧设置不会上传并覆盖新账号', async () => {
    localStorage.setItem('readerSettings:desktop:fontSize', '5')
    localStorage.setItem('readerSettingsUpdatedAt:desktop', JSON.stringify({ fontSize: Date.now() }))
    setToken('b'); setStorageUser('b')
    vi.spyOn(authApi, 'readerSettings').mockResolvedValue({ settings: { fontSize: '1' }, updatedAt: { fontSize: 1 } })
    const save = vi.spyOn(authApi, 'updateReaderSettings')
    const { result } = renderHook(() => useReaderSettings())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.fontSize).toBe(1)
    expect(save).not.toHaveBeenCalled()
    expect(localStorage.getItem('readerSettings:desktop:fontSize:user:b')).toBe('1')
    expect(localStorage.getItem('readerSettings:desktop:fontSize')).toBe('5')
  })

  it('同一阅读器换账号重新加载，旧账号响应不能写回', async () => {
    setToken('a'); setStorageUser('a')
    let resolveA!: (value: { settings: Record<string, string>; updatedAt: Record<string, number> }) => void
    const read = vi.spyOn(authApi, 'readerSettings')
      .mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve }))
      .mockResolvedValueOnce({ settings: { fontSize: '1' }, updatedAt: { fontSize: 1 } })
    const save = vi.spyOn(authApi, 'updateReaderSettings')
    const { result, rerender } = renderHook(() => useReaderSettings())
    setToken('b'); setStorageUser('b'); rerender()
    await waitFor(() => expect(result.current.fontSize).toBe(1))
    await act(async () => resolveA({ settings: { fontSize: '5' }, updatedAt: { fontSize: 99 } }))
    expect(read).toHaveBeenCalledTimes(2)
    expect(result.current.fontSize).toBe(1)
    expect(save).not.toHaveBeenCalled()
    expect(localStorage.getItem('readerSettings:desktop:fontSize:user:a')).toBeNull()
  })

  it('换账号会取消旧设置的防抖上传，并保留该账号自己的本地设置', async () => {
    setToken('a'); setStorageUser('a')
    vi.spyOn(authApi, 'readerSettings').mockResolvedValue({ settings: { fontSize: '1' }, updatedAt: { fontSize: 1 } })
    const save = vi.spyOn(authApi, 'updateReaderSettings')
    const { result, rerender } = renderHook(() => useReaderSettings())
    await waitFor(() => expect(result.current.ready).toBe(true))
    vi.useFakeTimers()
    act(() => result.current.set('fontSize', '5'))
    setToken('b'); setStorageUser('b'); rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(save).not.toHaveBeenCalled()
    expect(result.current.fontSize).toBe(1)
    expect(localStorage.getItem('readerSettings:desktop:fontSize:user:a')).toBe('5')
  })
})
