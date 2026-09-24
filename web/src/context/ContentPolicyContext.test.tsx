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
  it('默认安全模式，读取站点开关后可切换成人内容模式', async () => {
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    expect(result.current.safeMode).toBe(true)
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)

    await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))

    act(() => result.current.setMode('adult'))
    expect(result.current.mode).toBe('adult')
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(true)
    expect(localStorage.getItem('zhizhou-content-mode')).toBe('adult')
  })

  it('站点关闭成人内容模式时始终保持安全模式', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ adultContentEnabled: false }), { status: 200 })))
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })

    await waitFor(() => expect(result.current.adultContentEnabled).toBe(false))
    act(() => result.current.setMode('adult'))

    expect(result.current.mode).toBe('safe')
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)
  })

  // 判定依据统一：读取侧**只认 contentRating 字段**，不再回落到文本正则。
  // 「R18 ≡ restricted」——只有显式标为 restricted 的书才算限制级。
  describe('判级依据（统一到字段）', () => {
    it('restricted 即限制级（R18）', () => {
      expect(isRestrictedContent({ contentRating: 'restricted' })).toBe(true)
    })

    it('general 放行', () => {
      expect(isRestrictedContent({ contentRating: 'general' })).toBe(false)
    })

    it('unknown 按当前策略放行，但仍是待人工复核状态', () => {
      expect(isRestrictedContent({ contentRating: 'unknown' })).toBe(false)
    })

    it('字段缺失同样放行（调用方未提供分级信息时不做猜测）', () => {
      expect(isRestrictedContent({})).toBe(false)
      expect(isRestrictedContent({ title: '成人向未删减作品' })).toBe(false)
    })

    it('不再依据标题/简介文本判定——这是与旧行为的根本区别', () => {
      // 旧实现会对这些文本回落到正则并判为受限；统一后读取侧不猜文本。
      // 这些书应由写入侧（创建/更新/预填）在落库时判好并写入字段。
      expect(isRestrictedContent({ title: '18禁，高H，黄暴慎入' })).toBe(false)
      expect(isRestrictedContent({ description: '前期剧情后期肉' })).toBe(false)
      expect(isRestrictedContent({ categories: ['h', 'np'] })).toBe(false)
    })

    it('null / undefined 不抛错且视为放行', () => {
      expect(isRestrictedContent(null)).toBe(false)
      expect(isRestrictedContent(undefined)).toBe(false)
    })

    it('安全模式下的实际放行结果符合「R18 ≡ restricted」', async () => {
      const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
      await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))

      // 安全模式：只有 restricted 被拦
      expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)
      expect(result.current.isAllowed({ contentRating: 'general' })).toBe(true)
      expect(result.current.isAllowed({ contentRating: 'unknown' })).toBe(true)
      expect(result.current.isAllowed({})).toBe(true)

      // 成人模式：一律放行，开关语义未变
      act(() => result.current.setMode('adult'))
      expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(true)
      expect(result.current.isAllowed({ contentRating: 'general' })).toBe(true)
      expect(result.current.isAllowed({ contentRating: 'unknown' })).toBe(true)
    })
  })
})
