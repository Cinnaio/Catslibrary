import { useCallback, useEffect, useRef, useState } from 'react'
import { edgeStorageKey, mergeEdgeHistory, readEdgeData, writeEdgeData, type EdgeData, type EdgeRecord, type EdgeSettings } from '../lib/edge'

/** 换账号由调用方用 key 重挂载；这里只负责当前空间的本机读写。 */
export function useEdgeData(scope: string) {
  const [initial] = useState(() => readEdgeData(scope))
  const [data, setData] = useState(initial.data)
  const [error, setError] = useState(initial.error)
  const current = useRef(data)
  const pending = useRef<EdgeRecord[]>([])
  const dirtySettings = useRef(false)
  const clearing = useRef(false)

  const publish = useCallback((next: EdgeData) => {
    current.current = next
    setData(next)
  }, [])

  const save = useCallback(() => {
    // 先读回本机最新值，避免另一标签页写入的记录被这次改动抹掉。
    const latest = readEdgeData(scope)
    if (latest.error) {
      setError('本机数据暂时无法读取，本次改动留在当前页面，尚未保存。')
      return
    }
    const next: EdgeData = {
      settings: dirtySettings.current ? current.current.settings : latest.data.settings,
      history: clearing.current ? [] : mergeEdgeHistory(latest.data.history, pending.current),
    }
    publish(next)
    if (!writeEdgeData(scope, next)) {
      setError('浏览器未能保存本机数据，本次改动仅留在当前页面。请重试保存。')
      return
    }
    pending.current = []
    dirtySettings.current = false
    clearing.current = false
    setError(null)
  }, [publish, scope])

  const updateSettings = useCallback((settings: EdgeSettings) => {
    dirtySettings.current = true
    publish({ ...current.current, settings })
    save()
  }, [publish, save])

  const addRecord = useCallback((record: EdgeRecord) => {
    clearing.current = false
    pending.current = mergeEdgeHistory(pending.current, [record])
    publish({ ...current.current, history: mergeEdgeHistory(current.current.history, [record]) })
    save()
  }, [publish, save])

  const clearHistory = useCallback(() => {
    clearing.current = true
    pending.current = []
    publish({ ...current.current, history: [] })
    save()
  }, [publish, save])

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== null && event.key !== edgeStorageKey(scope)) return
      const latest = readEdgeData(scope)
      if (latest.error) { setError(latest.error); return }
      publish({
        settings: current.current.settings,
        history: clearing.current ? [] : mergeEdgeHistory(latest.data.history, pending.current),
      })
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [scope, publish])

  return { data, error, updateSettings, addRecord, clearHistory, retry: save }
}
