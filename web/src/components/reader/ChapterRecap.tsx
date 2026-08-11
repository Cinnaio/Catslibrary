/**
 * 章节前情提要 —— 进章时静默读缓存，没有缓存才由读者点一下现生成。
 * 只概括「上一章」，天然不剧透；未配置 AI / 未登录 / 首章时整块不渲染。
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, getToken, type AiStatus } from '../../lib/api'

interface ChapterRecapProps {
  /** 上一章 id —— 提要讲的是它，不是当前章 */
  prevChapterId: string
  prevChapterTitle: string
}

/** 能力探测按 token 缓存：同一身份下切章复用，登录/登出后自动重探。 */
let cached: { token: string; promise: Promise<AiStatus> } | null = null
function loadStatus(): Promise<AiStatus> {
  const token = getToken()
  if (!cached || cached.token !== token) {
    cached = {
      token,
      promise: aiApi.status().catch(() => ({ configured: false, features: { recap: false, catchup: false }, model: '', quota: null })),
    }
  }
  return cached.promise
}

export default function ChapterRecap({ prevChapterId, prevChapterTitle }: ChapterRecapProps) {
  const [available, setAvailable] = useState(false)
  const [recap, setRecap] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRecap('')
    setError('')
    setCollapsed(false)
    if (!prevChapterId) {
      setAvailable(false)
      return
    }
    void (async () => {
      const status = await loadStatus()
      if (cancelled) return
      setAvailable(status.features.recap)
      if (!status.features.recap) return
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
  }, [prevChapterId])

  const generate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await aiApi.recap(prevChapterId)
      setRecap(res.recap)
    } catch (err) {
      setError((err as Error).message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [prevChapterId])

  if (!available || !prevChapterId) return null

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
        <button type="button" className="reader-recap__action" onClick={() => void generate()} disabled={loading}>
          {loading ? '正在回顾上一章…' : 'AI 回顾上一章'}
        </button>
      )}

      {recap && !collapsed && <p className="reader-recap__text">{recap}</p>}

      {error && (
        <p className="reader-recap__error" role="status">
          {error}
          <button type="button" className="reader-recap__action" onClick={() => void generate()} disabled={loading}>
            重试
          </button>
        </p>
      )}
    </aside>
  )
}
