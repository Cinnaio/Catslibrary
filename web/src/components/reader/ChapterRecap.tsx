/**
 * 章节前情提要 —— 进章时静默读缓存，没有缓存才由读者点一下现生成。
 * 只概括「上一章」，天然不剧透；未配置 AI / 未登录 / 首章时整块不渲染。
 * 有每日配额的读者会看到剩余次数，用尽后按钮禁用（命中缓存不计数）。
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, type ApiError } from '../../lib/api'
import { useAiStatus } from '../../hooks/useAiStatus'

interface ChapterRecapProps {
  /** 上一章 id —— 提要讲的是它，不是当前章 */
  prevChapterId: string
  prevChapterTitle: string
}

function isQuotaError(err: unknown): boolean {
  const apiErr = err as ApiError
  return apiErr?.status === 429 || (apiErr?.data as { code?: string } | undefined)?.code === 'quota_exceeded'
}

export default function ChapterRecap({ prevChapterId, prevChapterTitle }: ChapterRecapProps) {
  const status = useAiStatus(!!prevChapterId)
  const [recap, setRecap] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  /** 今日剩余生成次数；null 表示不限额（管理员）或未知 */
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!status?.quota || status.quota.limit < 0) {
      setRemaining(null)
      return
    }
    setRemaining(Math.max(0, status.quota.limit - status.quota.used))
  }, [status])

  useEffect(() => {
    let cancelled = false
    setRecap('')
    setError('')
    setCollapsed(false)
    if (!prevChapterId || !status?.features.recap) return
    void (async () => {
      try {
        const res = await aiApi.cachedRecap(prevChapterId)
        if (!cancelled && res.recap) setRecap(res.recap)
      } catch {
        /* 静默失败：拿不到缓存就退回按钮态 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [prevChapterId, status])

  const generate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await aiApi.recap(prevChapterId)
      setRecap(res.recap)
      // 命中缓存不计配额，只有真实生成才扣减
      if (!res.cached) setRemaining((r) => (r === null ? r : Math.max(0, r - 1)))
    } catch (err) {
      if (isQuotaError(err)) setRemaining(0)
      setError((err as Error).message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [prevChapterId])

  if (!status?.features.recap || !prevChapterId) return null

  const quotaExhausted = remaining === 0

  return (
    <aside className="reader-recap" aria-label="前情提要">
      <div className="reader-recap__head">
        <span className="reader-recap__label">前情提要</span>
        <span className="reader-recap__source">{prevChapterTitle}</span>
        {recap && (
          <button type="button" className="reader-recap__toggle" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? '展开' : '收起'}
          </button>
        )}
      </div>

      {!recap && !error && (
        <button type="button" className="reader-recap__action" onClick={() => void generate()} disabled={loading || quotaExhausted}>
          {loading
            ? '正在回顾上一章…'
            : quotaExhausted
              ? '今日 AI 次数已用完，明天再来'
              : `AI 回顾上一章${remaining !== null ? `（今日剩 ${remaining} 次）` : ''}`}
        </button>
      )}

      {recap && !collapsed && <p className="reader-recap__text">{recap}</p>}

      {error && (
        <p className="reader-recap__error" role="status">
          {error}
          {!quotaExhausted && (
            <button type="button" className="reader-recap__action" onClick={() => void generate()} disabled={loading}>
              重试
            </button>
          )}
        </p>
      )}
    </aside>
  )
}
