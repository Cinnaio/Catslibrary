import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { ContentPolicyProvider, isRestrictedContent, useContentPolicy } from './ContentPolicyContext'

const mocks = vi.hoisted(() => ({ session: { user: null as { id: string } | null, loading: false }, dialog: null as null | { onUnlock: (token: string) => Promise<void>; onCancel: () => void } }))
vi.mock('./SessionContext', () => ({ useOptionalSession: () => mocks.session }))
vi.mock('../components/AdultUnlockDialog', () => ({ default: (props: { onUnlock: (token: string) => Promise<void>; onCancel: () => void }) => {
  mocks.dialog = props
  return <button onClick={() => void props.onUnlock('test-token')}>完成验证</button>
} }))

afterEach(() => {
  localStorage.removeItem('zhizhou-content-mode')
  sessionStorage.removeItem('user_session_token')
  vi.unstubAllGlobals()
})

beforeEach(() => {
  mocks.session = { user: null, loading: false }
  mocks.dialog = null
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ adultContentEnabled: true }), { status: 200 })))
})

describe('ContentPolicyContext', () => {
  it('游客默认安全模式，即使站点开放也不能切换成人模式', async () => {
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    expect(result.current.safeMode).toBe(true)
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)

    await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))

    await act(async () => { await result.current.setMode('adult') })
    expect(result.current.mode).toBe('safe')
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)
    expect(localStorage.getItem('zhizhou-content-mode')).toBe('safe')
  })

  it('游客本地 adult 状态不会触发解锁或恢复授权', async () => {
    localStorage.setItem('zhizhou-content-mode', 'adult')
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))
    expect(result.current.mode).toBe('safe')
    expect(vi.mocked(fetch).mock.calls.every(call => !String(call[0]).includes('/unlock') && !String(call[0]).includes('/refresh'))).toBe(true)
  })

  it('登录用户通过验证才能开启，注销后立即恢复安全模式', async () => {
    mocks.session = { user: { id: 'reader' }, loading: false }
    sessionStorage.setItem('user_session_token', 'reader-token')
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes('/refresh')
      ? new Response(JSON.stringify({ code: 'restricted_content', reason: 'not_unlocked' }), { status: 403 })
      : new Response(JSON.stringify({ adultContentEnabled: true, turnstileConfigured: true, turnstileSiteKey: 'test-site' }))))
    const { result, rerender } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))
    await act(async () => {})
    let opening: Promise<void>
    act(() => { opening = result.current.setMode('adult') })
    expect(result.current.mode).toBe('safe')
    await act(async () => { fireEvent.click(screen.getByText('完成验证')); await opening! })
    expect(result.current.mode).toBe('adult')
    const request = vi.mocked(fetch).mock.calls.find(call => String(call[0]).endsWith('/unlock'))
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ confirmed: true, turnstileToken: 'test-token' })
    mocks.session = { user: null, loading: false }
    sessionStorage.removeItem('user_session_token')
    rerender()
    expect(result.current.mode).toBe('safe')
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)
  })

  it('账号切换后，迟到的解锁结果不能给新账号放行', async () => {
    mocks.session = { user: { id: 'reader' }, loading: false }
    sessionStorage.setItem('user_session_token', 'reader-token')
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/unlock')) return new Promise<Response>(resolve => { finish = resolve })
      if (input.endsWith('/refresh')) return new Response('{}', { status: 403 })
      return new Response(JSON.stringify({ adultContentEnabled: true, turnstileConfigured: true, turnstileSiteKey: 'test-site' }))
    }))
    const { result, rerender } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })
    await waitFor(() => expect(result.current.adultContentEnabled).toBe(true))
    await act(async () => {})
    act(() => { void result.current.setMode('adult') })
    let unlocking!: Promise<void>
    act(() => { unlocking = mocks.dialog!.onUnlock('test-token') })
    mocks.session = { user: { id: 'other' }, loading: false }
    sessionStorage.setItem('user_session_token', 'other-token')
    rerender()
    await act(async () => { finish(new Response('{}')); await unlocking })
    expect(result.current.mode).toBe('safe')
    expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)
  })

  it('站点关闭成人内容模式时始终保持安全模式', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ adultContentEnabled: false }), { status: 200 })))
    const { result } = renderHook(() => useContentPolicy(), { wrapper: ContentPolicyProvider })

    await waitFor(() => expect(result.current.adultContentEnabled).toBe(false))
    await act(async () => { await result.current.setMode('adult') })

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

      // 游客即使尝试开启也不能放行 restricted。
      await act(async () => { await result.current.setMode('adult') })
      expect(result.current.isAllowed({ contentRating: 'restricted' })).toBe(false)
      expect(result.current.isAllowed({ contentRating: 'general' })).toBe(true)
      expect(result.current.isAllowed({ contentRating: 'unknown' })).toBe(true)
    })
  })
})
