/**
 * 回来接着读 —— 小说详情页的「隔了很久回来」回顾入口。
 * 距上次阅读超过 7 天才出现；生成复用已缓存的单章提要，一次短调用，成本接近零。
 * 原料不足时后端返回 null，此处给软提示而不是报错。
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, getToken, type AiStatus } from '../lib/api'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** 能力探测按 token 缓存：同一身份下换书复用，登录/登出后自动重探。 */
let cached: { token: string; promise: Promise<AiStatus> } | null = null
function loadStatus(): Promise<AiStatus> {
  const token = getToken()
  if (!cached || cached.token !== token) {
    cached = {
      token,
      promise: aiApi
        .status()
        .catch(() => ({ configured: false, features: { recap: false, catchup: false }, model: '', quota: null })),
    }
  }
  return cached.promise
}

interface CatchupRecapProps {
  novelId: string
  novelTitle: string
  /** 最近一次阅读时间戳；没有记录或不够 7 天则不渲染 */
  lastReadAt?: number
}

export default function CatchupRecap({ novelId, novelTitle, lastReadAt = 0 }: CatchupRecapProps) {
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [recap, setRecap] = useState('')
  const [error, setError] = useState('')
  const [empty, setEmpty] = useState(false)
  const [emptyReason, setEmptyReason] = useState<'no_progress' | 'not_stale' | 'insufficient_summaries' | ''>('')

  const stale = lastReadAt > 0 && Date.now() - lastReadAt >= STALE_AFTER_MS

  useEffect(() => {
    if (!stale) {
      setAvailable(false)
      return
    }
    let cancelled = false
    void (async () => {
      const status = await loadStatus()
      if (!cancelled) setAvailable(status.features.catchup)
    })()
    return () => {
      cancelled = true
    }
  }, [stale])

  const generate = useCallback(async () => {
    setLoading(true)
    setError('')
    setEmpty(false)
    setEmptyReason('')
    try {
      const res = await aiApi.catchup(novelId)
      if (res.recap) setRecap(res.recap)
      else {
        setEmpty(true)
        setEmptyReason(res.reason || 'insufficient_summaries')
      }
    } catch (err) {
      setError((err as Error).message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [novelId])

  if (!stale || !available) return null

  return (
    <section className="catchup-card" aria-label="回来接着读">
      <div className="catchup-card__body">
        <div className="catchup-card__intro">
          <span className="detail-kicker">CATCH-UP</span>
          <p className="catchup-card__hint">
            {novelTitle}隔了很久没读了。让 AI 用最近几章帮你衔接一下记忆，再接着往下读。
          </p>
        </div>

        {recap ? (
          <p className="catchup-card__recap">{recap}</p>
        ) : error ? (
          <div className="catchup-card__status catchup-card__status--error">
            <span>{error}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void generate()}>
              重试
            </button>
          </div>
        ) : empty ? (
          <p className="catchup-card__status">
            {emptyReason === 'insufficient_summaries'
              ? '这本书还没有足够的剧情提要，先去读几章，回头就能生成回顾了。'
              : emptyReason === 'not_stale'
                ? '你刚刚还在阅读这本书，暂时不需要重新回顾。'
                : '还没有找到这本书的阅读进度。'}
          </p>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => void generate()} disabled={loading}>
            {loading ? '正在回顾…' : 'AI 回顾这段剧情'}
          </button>
        )}
      </div>
    </section>
  )
}
