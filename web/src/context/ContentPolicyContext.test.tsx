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

  // 以下为方案 B 的判定契约。核心承诺是「上线行为等价」：unknown 必须与今天完全一致
  // （回落正则），因此 B 的引入不改变任何一本书的可见性。
  describe('内容分级字段（方案 B）', () => {
    it('restricted 直接判定受限，不需要文本线索', () => {
      expect(isRestrictedContent({ title: '雾城来信', contentRating: 'restricted' })).toBe(true)
    })

    it('general 直接放行，即使文本命中正则', () => {
      // 人工判定优先于正则：正则误伤（如「肉肉大冒险」）由人工改回 general 即可修正，
      // 这正是 B 相对正则枚举法的价值所在。
      expect(isRestrictedContent({ title: '成人向未删减作品', contentRating: 'general' })).toBe(false)
    })

    it('unknown 回落正则，与未引入字段时的结果逐条一致', () => {
      const samples = [
        { title: '成人向未删减作品' },
        { title: '雾城来信', description: '一段简介', categories: ['玄幻', '悬疑'] },
        { title: '18禁，高H，黄暴慎入' },
        { description: '前期剧情后期肉' },
        { categories: ['高Ｈ'] },
      ]
      for (const sample of samples) {
        expect(isRestrictedContent({ ...sample, contentRating: 'unknown' })).toBe(isRestrictedContent(sample))
      }
    })

    it('未提供字段（旧数据 / 分类名等纯文本）等价于 unknown', () => {
      expect(isRestrictedContent({ title: '成人向' })).toBe(true)
      expect(isRestrictedContent({ title: '成人向', contentRating: undefined })).toBe(true)
      expect(isRestrictedContent('R18')).toBe(true)
    })

    it('安全模式下的实际放行结果符合三态语义', async () => {
      const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
      await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))

      expect(result.current.isAllowed({ title: '普通作品', contentRating: 'restricted' })).toBe(false)
      expect(result.current.isAllowed({ title: '成人向作品', contentRating: 'general' })).toBe(true)
      expect(result.current.isAllowed({ title: '成人向作品', contentRating: 'unknown' })).toBe(false)
      // 字段缺失 = unknown
      expect(result.current.isAllowed({ title: '成人向作品' })).toBe(false)

      // 成人模式：三种分级一律放行，开关语义未被 B 改变。
      act(() => result.current.setMode('adult'))
      expect(result.current.isAllowed({ title: '普通作品', contentRating: 'restricted' })).toBe(true)
      expect(result.current.isAllowed({ title: '成人向作品', contentRating: 'general' })).toBe(true)
      expect(result.current.isAllowed({ title: '成人向作品', contentRating: 'unknown' })).toBe(true)
    })
  })
})
