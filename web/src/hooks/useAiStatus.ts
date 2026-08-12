/**
 * AI 能力探测（/ai/status）的共享缓存：
 * 按 token 缓存 promise，同一身份下切章/换书复用，登录/登出后自动重探。
 * 原先 ChapterRecap 与 CatchupRecap 各自复制一份，这里收敛为单一实现。
 */
import { useEffect, useState } from 'react'
import { aiApi, getToken, type AiStatus } from '../lib/api'

const FALLBACK_STATUS: AiStatus = {
  configured: false,
  features: { recap: false, catchup: false },
  model: '',
  quota: null,
  catchupStaleDays: 7,
}

let cached: { token: string; promise: Promise<AiStatus> } | null = null

export function loadAiStatus(): Promise<AiStatus> {
  const token = getToken()
  if (!cached || cached.token !== token) {
    cached = { token, promise: aiApi.status().catch(() => FALLBACK_STATUS) }
  }
  return cached.promise
}

/** enabled 为 false 时不发请求（如入口前置条件不满足）。 */
export function useAiStatus(enabled = true): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void loadAiStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return status
}
