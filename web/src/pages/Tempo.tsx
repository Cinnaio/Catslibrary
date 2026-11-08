import { useRef, useState, type CSSProperties } from 'react'
import { Check, Clock3, History, Timer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import EmptyState from '@/components/shared/EmptyState'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'
import { useSession } from '@/context/SessionContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { TempoControls } from '@/components/reader/TempoControls'
import { useTempoController } from '@/hooks/useTempoController'
import { formatTempoTime } from '@/lib/tempo'
import styles from './tempo.module.css'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function TempoWorkspace({ scope }: { scope: string }) {
  const controller = useTempoController(scope)
  const { data, storageError, clearHistory, retry } = controller
  const [clearOpen, setClearOpen] = useState(false)
  const [visibleRecords, setVisibleRecords] = useState(5)
  const clearButton = useRef<HTMLButtonElement>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)

  function changeClearOpen(open: boolean) {
    setClearOpen(open)
    if (!open) requestAnimationFrame(() => {
      if (clearButton.current?.disabled) historyHeading.current?.focus()
      else clearButton.current?.focus()
    })
  }

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}><Timer size={15} aria-hidden="true" /> 阅读之外 · 小工具</p>
        <h1>节奏计时</h1>
        <p>留一小段时间，找到舒服的节奏。</p>
      </header>

      <TempoControls controller={controller} />

      <section className={styles.history} aria-labelledby="tempo-history-title">
        <div className={styles.historyHeading}>
          <div><h2 id="tempo-history-title" ref={historyHeading} tabIndex={-1}>最近记录</h2><p>最多保留 30 次，仅保存在本机当前{scope === 'guest' ? '游客空间' : '账号'}，不跨设备同步。</p></div>
          <Button ref={clearButton} type="button" variant="ghost" disabled={data.history.length === 0} onClick={() => changeClearOpen(true)}><Trash2 aria-hidden="true" />清空记录</Button>
        </div>
        {storageError && <div className={styles.storageNotice} role="status"><p>{storageError}</p><Button type="button" variant="outline" onClick={retry}>重试保存</Button></div>}
        {data.history.length === 0 ? (
          <EmptyState icon={<History />} message={storageError ? '本机记录暂不可用' : '从一小段时间开始'} hint={storageError ? '请重试读取和保存；计时仍可正常使用。' : '完成计时或手动结束后，这里会留下记录。'} />
        ) : (
          <ol className={styles.records}>
            {data.history.slice(0, visibleRecords).map((record, index) => (
              <li key={record.id} className={styles.record} style={{ '--row-delay': `${Math.round(index * 220 / Math.max(1, Math.min(visibleRecords, data.history.length) - 1))}ms` } as CSSProperties}>
                <span className={styles.recordIcon} aria-hidden="true">{record.completed ? <Check size={18} /> : <Clock3 size={18} />}</span>
                <div className={styles.recordInfo}><strong>{record.completed ? '完成计时' : '提前结束'}</strong><time dateTime={new Date(record.finishedAt).toISOString()}>{dateFormat.format(record.finishedAt)}</time></div>
                <span className={styles.recordDuration}>{formatTempoTime(record.elapsedMs)}<small> / {record.minutes} 分钟</small></span>
                <span className={styles.recordTempo}>{record.bpm} BPM</span>
              </li>
            ))}
          </ol>
        )}
        {data.history.length > 5 && <div className={styles.historyMore}><span>已显示 {Math.min(visibleRecords, data.history.length)} / {data.history.length} 条</span>{visibleRecords < data.history.length && <Button type="button" variant="ghost" onClick={() => setVisibleRecords(value => value + 5)}>继续显示</Button>}</div>}
      </section>
      <ConfirmationDialog open={clearOpen} onOpenChange={changeClearOpen} title="清空本机计时记录？" description="删除当前账号或游客空间在此浏览器中的计时记录，保留时长与声音设置。此操作无法撤销。" confirmText="清空记录" danger onConfirm={() => { clearHistory(); changeClearOpen(false) }} />
    </main>
  )
}

export default function Tempo() {
  useDocumentTitle('节奏计时')
  const { user, loading } = useSession()
  if (loading) return <div className={styles.loading}><Spinner aria-label="正在准备计时工具" /></div>
  const scope = user ? `user:${user.id}` : 'guest'
  return <TempoWorkspace key={scope} scope={scope} />
}
