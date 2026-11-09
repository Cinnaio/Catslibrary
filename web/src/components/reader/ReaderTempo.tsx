import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Pause, Play, Timer, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from '@/components/shared/DialogFrame'
import { useExclusiveMenu } from '@/hooks/useExclusiveMenu'
import { ReaderTempoPanelContext, ReaderTempoStateContext, useReaderTempo, useReaderTempoState } from '@/hooks/useReaderTempo'
import { useEdgeController } from '@/hooks/useEdgeController'
import { EdgeControls } from './EdgeControls'
import styles from './ReaderTempo.module.css'

/** Lives above chapter loading; the reader remounts it when the account or book changes. */
export function ReaderTempoProvider({ scope, edgeAllowed = false, children }: { scope: string; edgeAllowed?: boolean; children: ReactNode }) {
  const controller = useEdgeController(scope, edgeAllowed)
  const { dispatch } = controller
  const [panelOpen, setOpen] = useState(false)
  const open = edgeAllowed && panelOpen
  // Hide the panel immediately when access changes; do not reopen on reauthorization.
  useEffect(() => {
    if (!edgeAllowed) setOpen(false)
  }, [edgeAllowed])
  const changeOpen = useExclusiveMenu('reader-tempo', setOpen)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const openPanel = useCallback((button: HTMLButtonElement) => {
    if (!edgeAllowed) return
    trigger.current = button
    changeOpen(true)
  }, [changeOpen, edgeAllowed])
  const suspend = useCallback(() => {
    setOpen(false)
    dispatch({ type: 'pause', now: performance.now(), reason: 'manual' })
  }, [dispatch])
  const panel = useMemo(() => ({ open, openPanel, suspend, available: edgeAllowed }), [open, openPanel, suspend, edgeAllowed])

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
              <DialogTitle ref={heading} tabIndex={-1}>节拍指令</DialogTitle>
              <DialogDescription>收起面板后继续阅读，切换本书章节不会中断计时。</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {edgeAllowed && <>
                <EdgeControls controller={controller} compact />
                <p className={styles.historyNote}>切到后台自动暂停 · 离开阅读器、换书或退出成人内容模式后停止，未结束的会话不记录。</p>
                {controller.storageError && <div className={styles.notice} role="status"><p>{controller.storageError}</p><Button type="button" variant="outline" onClick={controller.retry}>重试保存</Button></div>}
                <p className={styles.historyNote}>记录与「工具 → 节拍指令」共用，仅保存在本机当前账号。</p>
              </>}
            </DialogBody>
            <DialogFooter>
              {edgeAllowed && !controller.active && <Button asChild variant="ghost"><Link to="/tools/edge">查看本机记录</Link></Button>}
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>收起，继续阅读</Button>
            </DialogFooter>
          </DialogFrame>
        </Dialog>
      </ReaderTempoStateContext.Provider>
    </ReaderTempoPanelContext.Provider>
  )
}

export function ReaderTempoTrigger({ mobile = false, onOpen }: { mobile?: boolean; onOpen: () => void }) {
  const { open, openPanel, available } = useReaderTempo()
  const { active } = useReaderTempoState()
  if (!available) return null
  return <Button
    type="button" variant="ghost" size="icon" className={styles.trigger}
    data-reader-tempo-trigger={mobile ? 'mobile' : 'desktop'} data-active={active || undefined}
    aria-label="节拍指令" title="节拍指令" aria-haspopup="dialog" aria-expanded={open}
    onClick={event => { event.stopPropagation(); onOpen(); openPanel(event.currentTarget) }}
  ><Timer size={16} aria-hidden="true" />{!mobile && <span className="reader-tool-label">计时</span>}</Button>
}

export function ReaderTempoStatus({ locating = false, onOpen }: { locating?: boolean; onOpen: () => void }) {
  const { open, openPanel } = useReaderTempo()
  const controller = useReaderTempoState()
  const { session, status, active, phaseLabel, remaining, data, storageError, formatTime } = controller
  if (!session) return null
  const running = status === 'running' || status === 'cooldown' || status === 'permit'
  const visibleTime = active && !data.settings.hiddenRemaining
  const beatRunning = status === 'running' && session.phase !== 'stop' && session.bpm > 0
  return <div className={styles.statusBar} data-locating={locating || undefined} role="group" aria-label="阅读节拍指令控制">
    <div className={styles.toolbar}>
      <div className={styles.summary}>
        <span className={styles.state} aria-live="polite">
          <span className={styles.beat} data-phase={session.phase} data-running={beatRunning || undefined} style={{ '--beat-duration': `${60 / Math.max(1, session.bpm)}s` } as CSSProperties} aria-hidden="true" />
          {phaseLabel}
        </span>
        <Button type="button" variant="ghost" size="sm" className={styles.time} aria-label={`打开节拍指令，${visibleTime ? `剩余 ${formatTime(remaining)}` : phaseLabel}`} aria-haspopup="dialog" aria-expanded={open} onClick={event => { onOpen(); openPanel(event.currentTarget) }}>
          {visibleTime ? formatTime(remaining) : active ? '查看面板' : storageError ? '记录未保存' : '查看本次'}
        </Button>
        {beatRunning && <span className={styles.speed}>{session.bpm}<small>BPM</small></span>}
      </div>
      <div className={styles.actions}>
        {(status === 'running' || status === 'cooldown') && <Button type="button" variant="ghost" size="sm" disabled={session.phase === 'stop' || status === 'cooldown'} onClick={() => controller.declareEdge()}><Check size={14} aria-hidden="true" />忍住了</Button>}
        {status === 'permit' && <Button type="button" size="sm" onClick={controller.reportCame}><Check size={14} aria-hidden="true" />按下了</Button>}
        {active ? <Button type="button" variant="ghost" size="icon" aria-label={running ? '暂停节拍指令' : '继续节拍指令'} title={running ? '暂停' : '继续'} onClick={running ? controller.pause : controller.resume}>
          {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </Button> : <Button type="button" variant="ghost" size="icon" aria-label="收起节拍指令结果" title="收起结果" onClick={controller.reset}><X size={16} aria-hidden="true" /></Button>}
      </div>
    </div>
    <p className={styles.command} aria-live="polite">{session.command}</p>
    {session.pauseReason === 'background' && <span className={styles.reason}>切到后台后已暂停</span>}
    {session.pauseReason === 'interrupted' && <span className={styles.reason}>运行中断后已暂停</span>}
  </div>
}
