/**
 * 阅读进度同步 hook —— 由 read.js saveProgressToServer/flushProgress 平移。
 * 服务端写入节流（10s 间隔），pending 位置在换章/页面离开时冲刷。
 */
import { useCallback, useEffect, useRef } from 'react'
import { getToken, progressApi } from '../lib/api'
import { getStorageScope } from '../lib/storage'
import { applyProgressState } from '../lib/progress-state'

const PROGRESS_MIN_INTERVAL_MS = 10000

export function useProgressSync() {
  const pending = useRef<{ novelId: string; chapterId: string; scrollPercent: number; clientUpdatedAt: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentAt = useRef(0)
  const pendingToken = useRef('')

  const flush = useCallback((onExit = false) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!pending.current) return
    if (pendingToken.current !== getToken()) {
      pending.current = null
      return
    }
    const payload = { ...pending.current }
    pending.current = null
    lastSentAt.current = Date.now()
    if (onExit) progressApi.saveOnExit(payload)
    else {
      const token = getToken()
      const scope = getStorageScope()
      progressApi.save(payload).then(state => {
        if (getToken() === token && getStorageScope() === scope && (state.progress || state.tombstone)) applyProgressState(payload.novelId, state)
      }).catch(() => {})
    }
  }, [])

  const queue = useCallback(
    (novelId: string, chapterId: string, scrollPercent: number) => {
      if (!novelId || !chapterId) return
      pending.current = { novelId, chapterId, scrollPercent, clientUpdatedAt: Date.now() }
      pendingToken.current = getToken()
      const wait = PROGRESS_MIN_INTERVAL_MS - (Date.now() - lastSentAt.current)
      if (wait <= 0) {
        flush()
        return
      }
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null
          flush()
        }, wait)
      }
    },
    [flush],
  )

  // 卸载时冲刷（visibilitychange hidden / pagehide 由页面全局监听调用）
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return { queue, flush }
}
