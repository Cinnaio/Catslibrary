/**
 * useAiConfigured — 探测文本 AI 供应商是否已配置。
 *
 * 用于让 AI 各面板区分「未配置」与「无数据」两种空态。只取 /ai/status 的
 * configured 布尔值，不拉完整设置；失败时返回 undefined（既非 true 也非 false），
 * 调用方据此退回普通空态，避免把网络错误误报成「未配置」。
 */
import { useEffect, useState } from 'react'
import { aiApi } from '@/lib/api'

export function useAiConfigured(): boolean | undefined {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    aiApi
      .status()
      .then((res) => {
        if (!cancelled) setConfigured(res.configured)
      })
      .catch(() => {
        // 探测失败保持 undefined：空态沿用「无数据」话术，不误报未配置
      })
    return () => {
      cancelled = true
    }
  }, [])

  return configured
}
