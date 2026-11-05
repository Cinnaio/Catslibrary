import '@/styles/admin/pages/ai-service-claude.css'
import '@/styles/admin/pages/ai.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { aiApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import AiConfigPanel from './AiConfigPanel'
import AiParamsPanel from './AiParamsPanel'
import styles from '../site-settings.module.css'

type AiView = 'config' | 'params'
type Settings = Awaited<ReturnType<typeof aiApi.settings>>

/** 每页独立保存读取快照，刷新或保存一页不会重置另一页的未保存草稿。 */
function SettingsSection({ view, group, onBusyChange }: { view: AiView; group?: string | null; onBusyChange: (busy: boolean) => void }) {
  const [data, setData] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const revision = useRef(0)
  const load = useCallback(async () => {
    const request = ++revision.current
    setLoading(true)
    setError('')
    try {
      const value = await aiApi.settings()
      if (request === revision.current) setData(value)
    } catch (error) {
      if (request === revision.current) setError(error instanceof Error ? error.message : '读取 AI 设置失败')
    } finally {
      if (request === revision.current) setLoading(false)
    }
  }, [])
  useEffect(() => { void load(); return () => { revision.current++ } }, [load])
  useEffect(() => onBusyChange(busy), [busy, onBusyChange])

  if (!data) return error
    ? <ErrorState message={error} onRetry={() => void load()} />
    : <LoadingState label="正在读取 AI 设置…" />

  return <div className={view === 'config' ? styles.aiWorkspace : 'ai-service ai-admin-page'}>
    {view === 'params' && <div className={styles.aiToolbar}>
      {dirty && <span className={styles.hint}>当前页有未保存的修改，切换设置页会保留草稿。</span>}
      <Button variant="secondary" size="sm" disabled={loading || busy || dirty} onClick={() => void load()} aria-label="刷新生成参数">{loading ? '刷新中…' : '刷新'}</Button>
    </div>}
    {error && <InlineError message={`刷新失败：${error}。当前保留上次读取的配置。`} />}
    {view === 'config'
      ? <AiConfigPanel {...data} loading={loading} onReload={load} onBusyChange={setBusy} onDirtyChange={setDirty} />
      : <AiParamsPanel settings={data.settings} loading={loading} onReload={load} group={group} onBusyChange={setBusy} onDirtyChange={setDirty} />}
  </div>
}

export default function AiSettingsWorkspace({ view, group, onBusyChange }: { view: AiView | null; group?: string | null; onBusyChange: (busy: boolean) => void }) {
  const [visited, setVisited] = useState<Set<AiView>>(() => new Set(view ? [view] : []))
  const [busy, setBusy] = useState({ config: false, params: false })
  useEffect(() => {
    if (view) setVisited(previous => previous.has(view) ? previous : new Set([...previous, view]))
  }, [view])
  const configBusy = useCallback((value: boolean) => setBusy(previous => ({ ...previous, config: value })), [])
  const paramsBusy = useCallback((value: boolean) => setBusy(previous => ({ ...previous, params: value })), [])
  useEffect(() => onBusyChange(busy.config || busy.params), [busy.config, busy.params, onBusyChange])
  return <>
    <div hidden={view !== 'config'}>{visited.has('config') && <SettingsSection view="config" onBusyChange={configBusy} />}</div>
    <div hidden={view !== 'params'}>{visited.has('params') && <SettingsSection view="params" group={group} onBusyChange={paramsBusy} />}</div>
  </>
}
