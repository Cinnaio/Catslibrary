import { useRef, useState, type CSSProperties } from 'react'
import { Check, Flame, History, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import ContentPolicyStatus from '@/components/ContentPolicyStatus'
import ContentRestrictionNotice from '@/components/ContentRestrictionNotice'
import EmptyState from '@/components/shared/EmptyState'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useSession } from '@/context/SessionContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useEdgeController } from '@/hooks/useEdgeController'
import { EDGE_DIFFICULTIES, EDGE_ENDING_LABELS, EDGE_FINALES, summarizeEdgeHistory } from '@/lib/edge'
import { EdgeControls } from '@/components/reader/EdgeControls'
import styles from './edge.module.css'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function EdgeWorkspace({ scope }: { scope: string }) {
  const controller = useEdgeController(scope)
  const { data, storageError, clearHistory, retry, session } = controller
  const [clearOpen, setClearOpen] = useState(false)
  const [visibleRecords, setVisibleRecords] = useState(5)
  const clearButton = useRef<HTMLButtonElement>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const totals = summarizeEdgeHistory(data.history)

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
        <p className={styles.eyebrow}><Flame size={15} aria-hidden="true" /> 阅读之外 · 小工具 · 限 18 岁以上</p>
        <h1>节拍指令</h1>
        <p>屏幕每隔一阵换一次颜色和指令，你照做，撑到时间结束。能不能去，最后由它决定。</p>
      </header>

      <EdgeControls controller={controller} />

      <section className={styles.history} aria-labelledby="edge-history-title">
        <div className={styles.historyHeading}>
          <div>
            <h2 id="edge-history-title" ref={historyHeading} tabIndex={-1}>最近这一些局</h2>
            <p>最多保留 30 局，仅保存在本机当前{scope === 'guest' ? '游客空间' : '账号'}，不跨设备同步，也不上传。</p>
          </div>
          <Button ref={clearButton} type="button" variant="ghost" disabled={data.history.length === 0} onClick={() => changeClearOpen(true)}><Trash2 aria-hidden="true" />清空记录</Button>
        </div>
        {storageError && <div className={styles.storageNotice} role="status"><p>{storageError}</p><Button type="button" variant="outline" onClick={retry}>重试保存</Button></div>}
        {data.history.length > 0 && (
          <dl className={styles.totals} aria-label="战绩汇总">
            {[
              ['总局数', String(totals.sessions)],
              ['总申报', String(totals.edges)],
              ['磨着不停', String(totals.grinds)],
              ['银行兑现', `${totals.spent} 点`],
              ['拿到许可', `${totals.permitted} 局`],
              ['最长坚持', controller.formatTime(totals.longestMs)],
            ].map(([label, value]) => (
              <div key={label} className={styles.total}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {data.history.length === 0 ? (
          <EmptyState icon={<History />} message={storageError ? '本机记录暂不可用' : '还没有记下来的局'} hint={storageError ? '请重试读取和保存；游戏仍可正常进行。' : '结束一局后，这里会留下结局、申报次数和耗时。'} />
        ) : (
          <ol className={styles.records}>
            {data.history.slice(0, visibleRecords).map((record, index) => (
              <li key={record.id} className={styles.record} style={{ '--row-delay': `${Math.round(index * 220 / Math.max(1, Math.min(visibleRecords, data.history.length) - 1))}ms` } as CSSProperties}>
                <span className={styles.recordIcon} aria-hidden="true">{record.ending === 'permitted' || record.ending === 'ruined' ? <Check size={18} /> : <Square size={16} />}</span>
                <div className={styles.recordInfo}>
                  <strong>{EDGE_ENDING_LABELS[record.ending]}</strong>
                  <time dateTime={new Date(record.finishedAt).toISOString()}>{dateFormat.format(record.finishedAt)}</time>
                </div>
                <span className={styles.recordMeta}>{EDGE_DIFFICULTIES[record.difficulty].label} · {EDGE_FINALES[record.finale].label}</span>
                <span className={styles.recordDuration}>{controller.formatTime(record.elapsedMs)}<small> / {record.minutes} 分钟</small></span>
                <span className={styles.recordEdges}>{record.edges} 次申报{record.grinds > 0 ? ` · 磨着 ${record.grinds}` : ''}{record.spent > 0 ? ` · 花掉 ${record.spent} 点` : ''}{record.overtime > 0 ? ` · 加时 ${record.overtime}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
        {data.history.length > 5 && (
          <div className={styles.historyMore}>
            <span>已显示 {Math.min(visibleRecords, data.history.length)} / {data.history.length} 局</span>
            {visibleRecords < data.history.length && <Button type="button" variant="ghost" onClick={() => setVisibleRecords((value) => value + 5)}>继续显示</Button>}
          </div>
        )}
        {session?.status === 'finished' && <p className={styles.hint}>这一局已经写进记录，点「再来一次」会开新的一局。</p>}
      </section>

      <ConfirmationDialog
        open={clearOpen}
        onOpenChange={changeClearOpen}
        title="清空节拍指令记录？"
        description="删除当前账号或游客空间在此浏览器里的对局记录，保留规则设置与声音偏好。此操作无法撤销。"
        confirmText="清空记录"
        danger
        onConfirm={() => { clearHistory(); changeClearOpen(false) }}
      />
    </main>
  )
}

export default function Edge() {
  useDocumentTitle('节拍指令')
  const { user, loading } = useSession()
  const { mode, setMode, adultContentEnabled, checking, policyError } = useContentPolicy()
  if (loading) return <div className={styles.loading}><Spinner aria-label="正在准备节拍指令" /></div>
  // 与作品详情、阅读器同一条门禁：先把权限确认清楚，再谈是否放行。
  if (checking || policyError) return <ContentPolicyStatus />
  if (mode !== 'adult') return <ContentRestrictionNotice mode={mode} onModeChange={setMode} canUnlock={adultContentEnabled} title="节拍指令需要成人内容模式" description="这是限制级工具，仅对已登录且已开启成人内容模式的读者开放。开关在侧栏底部。" />
  const scope = user ? `user:${user.id}` : 'guest'
  return <EdgeWorkspace key={scope} scope={scope} />
}
