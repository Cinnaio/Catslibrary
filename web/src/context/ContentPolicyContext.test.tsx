import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ContentPolicyProvider, isRestrictedContent, useContentPolicy } from './ContentPolicyContext'

afterEach(() => {
  localStorage.removeItem('zhizhou-content-mode')
})

describe('ContentPolicyContext', () => {
  it('只识别明确的限制级标记', () => {
    expect(isRestrictedContent({ categories: ['玄幻', '悬疑'] })).toBe(false)
    expect(isRestrictedContent({ title: '成人向未删减作品' })).toBe(true)
    expect(isRestrictedContent('R18')).toBe(true)
  })

  it('默认安全模式，切换后持久化且允许显示限制级内容', () => {
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    expect(result.current.safeMode).toBe(true)
    expect(result.current.isAllowed({ title: 'R18 作品' })).toBe(false)

    act(() => result.current.setMode('adult'))
    expect(result.current.mode).toBe('adult')
    expect(result.current.isAllowed({ title: 'R18 作品' })).toBe(true)
    expect(localStorage.getItem('zhizhou-content-mode')).toBe('adult')
  })
})
