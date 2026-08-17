import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ContentPolicyProvider, isRestrictedContent, useContentPolicy } from './ContentPolicyContext'

afterEach(() => {
  localStorage.removeItem('zhizhou-content-mode')
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ adultContentEnabled: true }), { status: 200 })))
})

describe('ContentPolicyContext', () => {
  it('只识别明确的限制级标记', () => {
    expect(isRestrictedContent({ categories: ['玄幻', '悬疑'] })).toBe(false)
    expect(isRestrictedContent({ title: '成人向未删减作品' })).toBe(true)
    expect(isRestrictedContent('R18')).toBe(true)
    expect(isRestrictedContent('18禁，高H，黄暴慎入')).toBe(true)
    expect(isRestrictedContent('前期剧情后期肉，含进身体')).toBe(true)
    expect(isRestrictedContent('因为女主和两位男主均会发生亲密行为')).toBe(true)
  })

  it('默认安全模式，读取站点开关后可切换成人内容模式', async () => {
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    expect(result.current.safeMode).toBe(true)
    expect(result.current.isAllowed({ title: 'R18 作品' })).toBe(false)

    await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))

    act(() => result.current.setMode('adult'))
    expect(result.current.mode).toBe('adult')
    expect(result.current.isAllowed({ title: 'R18 作品' })).toBe(true)
    expect(localStorage.getItem('zhizhou-content-mode')).toBe('adult')
  })

  it('站点关闭成人内容模式时始终保持安全模式', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ adultContentEnabled: false }), { status: 200 })))
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })

    await waitFor(() => expect(result.current.adultContentEnabled).toBe(false))
    act(() => result.current.setMode('adult'))

    expect(result.current.mode).toBe('safe')
    expect(result.current.isAllowed({ title: 'R18 作品' })).toBe(false)
  })
})
