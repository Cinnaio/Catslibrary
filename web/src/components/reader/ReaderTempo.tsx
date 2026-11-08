import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Pause, Play, Timer, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from '@/components/shared/DialogFrame'
import { useExclusiveMenu } from '@/hooks/useExclusiveMenu'
import { ReaderTempoPanelContext, ReaderTempoStateContext, useReaderTempo, useReaderTempoState } from '@/hooks/useReaderTempo'
import { useTempoController } from '@/hooks/useTempoController'
import { formatTempoTime } from '@/lib/tempo'
import { TempoControls } from './TempoControls'
import styles from './ReaderTempo.module.css'

/** Lives above chapter loading; the reader remounts it when the account or book changes. */
export function ReaderTempoProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const controller = useTempoController(scope)
  const { dispatch } = controller
  const [open, setOpen] = useState(false)
  const changeOpen = useExclusiveMenu('reader-tempo', setOpen)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const openPanel = useCallback((button: HTMLButtonElement) => {
    trigger.current = button
    changeOpen(true)
  }, [changeOpen])
  const suspend = useCallback(() => {
    setOpen(false)
    dispatch({ type: 'pause', now: performance.now(), reason: 'manual' })
  }, [dispatch])
  const panel = useMemo(() => ({ open, openPanel, suspend }), [open, openPanel, suspend])

  return (
    <ReaderTempoPanelContext.Provider value={panel}>
      <ReaderTempoStateContext.Provider value={controller}>
        {children}
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogFrame
            showCloseButton={false}
            onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus() }}
            onCloseAutoFocus={event => {
              event.preventDefault()
              const previous = trigger.current
              const surface = window.innerWidth <= 700 ? 'mobile' : 'desktop'
              if (previous?.isConnected && (!previous.dataset.readerTempoTrigger || previous.dataset.readerTempoTrigger === surface)) previous.focus({ preventScroll: true })
              else document.querySelector<HTMLButtonElement>(`[data-reader-tempo-trigger="${surface}"]`)?.focus({ preventScroll: true })
            }}
          >
            <DialogHeader>
              <DialogTitle ref={heading} tabIndex={-1}>节奏计时</DialogTitle>
              <DialogDescription>收起面板后继续阅读，切换本书章节不会中断计时。</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <TempoControls controller={controller} compact sessionNote="切到后台自动暂停 · 离开阅读器或换书后停止，未结束的计时不记录" />
              {controller.storageError && <div className={styles.notice} role="status"><p>{controller.storageError}</p><Button type="button" variant="outline" onClick={controller.retry}>重试保存</Button></div>}
              <p className={styles.historyNote}>记录与「工具 → 节奏计时」共用，仅保存在本机当前{scope === 'guest' ? '游客空间' : '账号'}。</p>
            </DialogBody>
            <DialogFooter>
              {!controller.active && <Button asChild variant="ghost"><Link to="/tools/tempo">查看计时记录</Link></Button>}
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>收起，继续阅读</Button>
            </DialogFooter>
          </DialogFrame>
        </Dialog>
      </ReaderTempoStateContext.Provider>
    </ReaderTempoPanelContext.Provider>
  )
}

export function ReaderTempoTrigger({ mobile = false, onOpen }: { mobile?: boolean; onOpen: () => void }) {
  const { open, openPanel } = useReaderTempo()
  const { active } = useReaderTempoState()
  return <Button
    type="button" variant="ghost" size="icon" className={styles.trigger}
    data-reader-tempo-trigger={mobile ? 'mobile' : 'desktop'} data-active={active || undefined}
    aria-label="节奏计时" title="节奏计时" aria-haspopup="dialog" aria-expanded={open}
    onClick={event => { event.stopPropagation(); onOpen(); openPanel(event.currentTarget) }}
  ><Timer size={16} aria-hidden="true" />{!mobile && <span className="reader-tool-label">计时</span>}</Button>
}

export function ReaderTempoStatus({ locating = false, onOpen }: { locating?: boolean; onOpen: () => void }) {
  const { open, openPanel } = useReaderTempo()
  const { session, running, active, remaining, currentBpm, dispatch, resume, storageError } = useReaderTempoState()
  if (!session) return null
  const label = running ? '计时中' : session.status === 'paused' ? '已暂停' : session.status === 'completed' ? '计时完成' : '计时已结束'
  return <div className={styles.statusBar} data-locating={locating || undefined} role="group" aria-label="阅读计时控制">
    <span className={styles.state} aria-live="polite"><span className={styles.beat} data-running={running || undefined} style={{ '--beat-duration': `${60 / currentBpm}s` } as CSSProperties} aria-hidden="true" />{label}</span>
    <Button type="button" variant="ghost" className={styles.time} aria-label={`打开节奏计时，${active ? `剩余 ${formatTempoTime(remaining)}` : label}`} aria-haspopup="dialog" aria-expanded={open} onClick={event => { onOpen(); openPanel(event.currentTarget) }}>
      {active ? formatTempoTime(remaining) : storageError ? '记录未保存' : '查看本次'}
    </Button>
    <span className={styles.speed}>{currentBpm} BPM</span>
    {active ? <Button type="button" variant="ghost" size="icon" aria-label={running ? '暂停计时' : '继续计时'} onClick={() => running ? dispatch({ type: 'pause', now: performance.now(), reason: 'manual' }) : resume()}>
      {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
    </Button> : <Button type="button" variant="ghost" size="icon" aria-label="收起计时结果" onClick={() => dispatch({ type: 'reset' })}><X size={16} aria-hidden="true" /></Button>}
    {session.pauseReason === 'background' && <span className={styles.reason}>切到后台后已暂停</span>}
    {session.pauseReason === 'interrupted' && <span className={styles.reason}>运行中断后已暂停</span>}
  </div>
}
