/**
 * 回来接着读 —— 小说详情页的「隔了很久回来」回顾入口。
 * 过期天数阈值由后端设置下发（/ai/status 的 catchupStaleDays），前端不再自带一份；
 * 生成复用已缓存的单章提要，一次短调用，成本接近零。
 * 原料不足时后端返回 null，此处给软提示而不是报错。
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, type ApiError } from '../lib/api'
import { useAiStatus } from '../hooks/useAiStatus'

interface CatchupRecapProps {
  novelId: string
  novelTitle: string
  /** 最近一次阅读时间戳；没有记录或未超过阈值则不渲染 */
  lastReadAt?: number
}

function isQuotaError(err: unknown): boolean {
  const apiErr = err as ApiError
  return apiErr?.status === 429 || (apiErr?.data as { code?: string } | undefined)?.code === 'quota_exceeded'
}

export default function CatchupRecap({ novelId, novelTitle, lastReadAt = 0 }: CatchupRecapProps) {
  const status = useAiStatus(lastReadAt > 0)
  const [loading, setLoading] = useState(false)
  const [recap, setRecap] = useState('')
  const [error, setError] = useState('')
  const [empty, setEmpty] = useState(false)
  const [emptyReason, setEmptyReason] = useState<'no_progress' | 'not_stale' | 'insufficient_summaries' | ''>('')
  /** 今日剩余生成次数；null 表示不限额（管理员）或未知 */
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!status?.quota || status.quota.limit < 0) {
      setRemaining(null)
      return
    }
    setRemaining(Math.max(0, status.quota.limit - status.quota.used))
  }, [status])

  // 阈值与后端判定同源：status 未就绪时不渲染，避免「入口显示但后端拒绝」
  const staleDays = status?.catchupStaleDays ?? 7
  const stale = lastReadAt > 0 && Date.now() - lastReadAt >= staleDays * 24 * 60 * 60 * 1000
  const available = !!status?.features.catchup && stale

  const generate = useCallback(async () => {
    setLoading(true)
    setError('')
    setEmpty(false)
    setEmptyReason('')
    try {
      const res = await aiApi.catchup(novelId)
      if (res.recap) {
        setRecap(res.recap)
        // 命中缓存不计配额，只有真实生成才扣减
        if (!res.cached) setRemaining((r) => (r === null ? r : Math.max(0, r - 1)))
      } else {
        setEmpty(true)
        setEmptyReason(res.reason || 'insufficient_summaries')
      }
    } catch (err) {
      if (isQuotaError(err)) setRemaining(0)
      setError((err as Error).message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [novelId])

  if (!available) return null

  const quotaExhausted = remaining === 0

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
            {!quotaExhausted && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void generate()}>
                重试
              </button>
            )}
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
          <button type="button" className="btn btn--primary" onClick={() => void generate()} disabled={loading || quotaExhausted}>
            {loading
              ? '正在回顾…'
              : quotaExhausted
                ? '今日 AI 次数已用完'
                : `AI 回顾这段剧情${remaining !== null ? `（今日剩 ${remaining} 次）` : ''}`}
          </button>
        )}
      </div>
    </section>
  )
}
