import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeTempoHistory, readTempoData, tempoStorageKey, writeTempoData, type TempoData, type TempoRecord, type TempoSettings } from '../lib/tempo'

/** The caller remounts this hook when the confirmed account changes. */
export function useTempoData(scope: string) {
  const [initial] = useState(() => readTempoData(scope))
  const [data, setData] = useState(initial.data)
  const [error, setError] = useState(initial.error)
  const current = useRef(data)
  const pending = useRef<TempoRecord[]>([])
  const dirtySettings = useRef(false)
  const clearing = useRef(false)

  const publish = useCallback((next: TempoData) => {
    current.current = next
    setData(next)
  }, [])

  const save = useCallback(() => {
    const latest = readTempoData(scope)
    if (latest.error) {
      setError('本机数据暂时无法读取，本次改动留在当前页面，尚未保存。')
      return
    }
    const next: TempoData = {
      settings: dirtySettings.current ? current.current.settings : latest.data.settings,
      history: clearing.current ? [] : mergeTempoHistory(latest.data.history, pending.current),
    }
    publish(next)
    if (!writeTempoData(scope, next)) {
      setError('浏览器未能保存本机数据，本次改动仅留在当前页面。请重试保存。')
      return
    }
    pending.current = []
    dirtySettings.current = false
    clearing.current = false
    setError(null)
  }, [publish, scope])

  const updateSettings = useCallback((settings: TempoSettings) => {
    dirtySettings.current = true
    publish({ ...current.current, settings })
    save()
  }, [publish, save])

  const addRecord = useCallback((record: TempoRecord) => {
    clearing.current = false
    pending.current = mergeTempoHistory(pending.current, [record])
    publish({ ...current.current, history: mergeTempoHistory(current.current.history, [record]) })
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
      if (event.key !== null && event.key !== tempoStorageKey(scope)) return
      const latest = readTempoData(scope)
      if (latest.error) { setError(latest.error); return }
      publish({
        settings: current.current.settings,
        history: clearing.current ? [] : mergeTempoHistory(latest.data.history, pending.current),
      })
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [scope, publish])

  return { data, error, updateSettings, addRecord, clearHistory, retry: save }
}
