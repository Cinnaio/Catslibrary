import { beforeEach, describe, expect, it } from 'vitest'
import { detectReaderDevice, readLocalSettings } from './useReaderSettings'

describe('useReaderSettings device-scoped storage', () => {
  beforeEach(() => {
    localStorage.clear()
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
})
