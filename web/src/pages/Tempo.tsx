import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Clock3, History, Pause, Play, RotateCcw, Square, Timer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/filter-chip'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import EmptyState from '@/components/shared/EmptyState'
import FormField from '@/components/shared/FormField'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'
import { useSession } from '@/context/SessionContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useTempoAudio } from '@/hooks/useTempoAudio'
import { useTempoData } from '@/hooks/useTempoData'
import { useTempoSession } from '@/hooks/useTempoSession'
import { formatTempoTime, type TempoSettings } from '@/lib/tempo'
import styles from './tempo.module.css'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const circumference = 2 * Math.PI * 120

function validNumber(value: string, min: number, max: number): boolean {
  return value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max
}

function TempoWorkspace({ scope }: { scope: string }) {
  const { data, error: storageError, updateSettings, addRecord, clearHistory, retry } = useTempoData(scope)
  const { session, dispatch } = useTempoSession()
  const audio = useTempoAudio(session, data.settings)
  const [minutes, setMinutes] = useState(String(data.settings.minutes))
  const [bpm, setBpm] = useState(String(data.settings.bpm))
  const [clearOpen, setClearOpen] = useState(false)
  const [visibleRecords, setVisibleRecords] = useState(5)
  const recorded = useRef<string | null>(null)
  const clearButton = useRef<HTMLButtonElement>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const running = session?.status === 'running'
  const active = running || session?.status === 'paused'
  const minutesValid = validNumber(minutes, 1, 180)
  const bpmValid = validNumber(bpm, 30, 180)
  const duration = (session?.minutes ?? (minutesValid ? Number(minutes) : data.settings.minutes)) * 60_000
  const elapsed = session?.elapsedMs ?? 0
  const remaining = duration - elapsed
  const progress = Math.min(1, elapsed / duration)
  const statusText = !session ? '准备开始' : running ? '跟着自己的节奏' : session.status === 'completed'
    ? '这一段时间，完成了' : session.status === 'ended' ? '本次已结束' : '计时已暂停'
  const hint = session?.pauseReason === 'background' ? '切到后台后已自动暂停，准备好再继续。'
    : session?.pauseReason === 'interrupted' ? '检测到设备休眠或运行中断，已暂停计时。'
      : session?.status === 'completed' ? '慢下来，给自己一点休息的时间。'
        : session?.status === 'ended' ? `本次进行了 ${formatTempoTime(elapsed)}，可以重新安排时间。`
          : '轻敲手指、练习节奏，或专注完成一件小事。'

  useEffect(() => {
    if (!session || (session.status !== 'completed' && session.status !== 'ended') || recorded.current === session.id) return
    recorded.current = session.id
    addRecord({ id: session.id, finishedAt: Date.now(), minutes: session.minutes, bpm: session.bpm, elapsedMs: Math.round(session.elapsedMs), completed: session.status === 'completed' })
  }, [session, addRecord])

  function saveNumbers(nextMinutes = minutes, nextBpm = bpm) {
    if (!validNumber(nextMinutes, 1, 180) || !validNumber(nextBpm, 30, 180)) return
    updateSettings({ ...data.settings, minutes: Number(nextMinutes), bpm: Number(nextBpm) })
  }

  function changeMinutes(value: string) {
    setMinutes(value)
    dispatch({ type: 'reset' })
  }

  function changeBpm(value: string) {
    setBpm(value)
    dispatch({ type: 'reset' })
  }

  function start() {
    if (active || !minutesValid || !bpmValid) return
    saveNumbers()
    audio.activate(Number(bpm), data.settings.sound)
    dispatch({ type: 'start', id: crypto.randomUUID(), settings: { ...data.settings, minutes: Number(minutes), bpm: Number(bpm) }, now: performance.now() })
  }

  function toggleSetting(name: 'sound' | 'speech', checked: boolean) {
    const settings: TempoSettings = { ...data.settings, [name]: checked }
    updateSettings(settings)
    if (name === 'sound') audio.activate(session?.bpm ?? settings.bpm, checked && running)
  }

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

      <div className={styles.workspace}>
        <Panel asChild className={styles.timerPanel}>
          <section aria-labelledby="tempo-status">
            <div className={styles.status} aria-live="polite">
              <h2 id="tempo-status">{statusText}</h2>
              <p>{hint}</p>
            </div>
            <div className={styles.dial} role="timer" aria-live="off" aria-label={`剩余 ${formatTempoTime(remaining)}`}>
              <svg viewBox="0 0 264 264" aria-hidden="true">
                <circle className={styles.track} cx="132" cy="132" r="120" />
                <circle className={styles.arc} cx="132" cy="132" r="120" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
              </svg>
              <div className={styles.dialText}>
                <span className={styles.countdown}>{formatTempoTime(remaining)}</span>
                <span className={styles.remaining}>{session?.status === 'completed' ? '计时完成' : '剩余时间'}</span>
                <span className={styles.beatLabel}>
                  <i className={styles.beat} data-running={running || undefined} style={{ '--beat-duration': `${60 / (session?.bpm ?? (bpmValid ? Number(bpm) : data.settings.bpm))}s` } as CSSProperties} aria-hidden="true" />
                  {session?.bpm ?? (bpmValid ? Number(bpm) : data.settings.bpm)} 拍 / 分钟
                </span>
              </div>
            </div>
            <div className={styles.actions}>
              {running ? (
                <Button type="button" onClick={() => dispatch({ type: 'pause', now: performance.now(), reason: 'manual' })}><Pause aria-hidden="true" />暂停</Button>
              ) : session?.status === 'paused' ? (
                <Button type="button" onClick={() => { audio.activate(session.bpm, data.settings.sound); dispatch({ type: 'resume', now: performance.now() }) }}><Play aria-hidden="true" />继续计时</Button>
              ) : (
                <Button type="button" disabled={!minutesValid || !bpmValid} onClick={start}>{session ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}{session ? '再来一次' : '开始计时'}</Button>
              )}
              {active && <Button type="button" variant="outline" onClick={() => dispatch({ type: 'end', now: performance.now() })}><Square aria-hidden="true" />结束</Button>}
            </div>
            <p className={styles.sessionNote}>切到后台自动暂停 · 离开此页结束本次计时</p>
          </section>
        </Panel>

        <Panel asChild className={styles.settingsPanel}>
          <section aria-labelledby="tempo-settings-title">
            <h2 id="tempo-settings-title">安排这一段时间</h2>
            <fieldset className={styles.settingsFields} disabled={active}>
              <legend className="sr-only">时长与节拍</legend>
              <div className={styles.presets} role="group" aria-label="常用时长">
                {[3, 5, 10, 25].map(value => <FilterChip key={value} selected={Number(minutes) === value} aria-pressed={Number(minutes) === value} onClick={() => { changeMinutes(String(value)); saveNumbers(String(value)) }}>{value} 分钟</FilterChip>)}
              </div>
              <div className={styles.numberFields}>
                <FormField label="时长（分钟）" hint="1–180 分钟" error={!minutesValid ? '请输入 1–180 的整数' : undefined}>
                  <Input type="number" inputMode="numeric" min={1} max={180} step={1} value={minutes} onChange={event => changeMinutes(event.target.value)} onBlur={() => saveNumbers()} />
                </FormField>
                <FormField label="节拍（BPM）" hint="每分钟 30–180 拍" error={!bpmValid ? '请输入 30–180 的整数' : undefined}>
                  <Input type="number" inputMode="numeric" min={30} max={180} step={1} value={bpm} onChange={event => changeBpm(event.target.value)} onBlur={() => saveNumbers()} />
                </FormField>
              </div>
            </fieldset>
            {active && <p className={styles.hint}>本次时长与节拍已固定，结束后可重新调整。</p>}
            <div className={styles.soundSettings}>
              <div className={styles.settingRow}>
                <label htmlFor="tempo-sound"><strong id="tempo-sound-label">节拍声</strong><span id="tempo-sound-hint">{audio.soundSupported ? '轻柔的提示音，随节拍响起' : '当前浏览器不支持，仍可使用视觉节拍'}</span></label>
                <Switch id="tempo-sound" aria-labelledby="tempo-sound-label" aria-describedby="tempo-sound-hint" checked={data.settings.sound} disabled={!audio.soundSupported} onCheckedChange={checked => toggleSetting('sound', checked)} />
              </div>
              <div className={styles.settingRow}>
                <label htmlFor="tempo-speech"><strong id="tempo-speech-label">语音提示</strong><span id="tempo-speech-hint">{audio.speechSupported ? '播报状态与每分钟进度，语音由浏览器提供' : '当前浏览器不支持语音提示'}</span></label>
                <Switch id="tempo-speech" aria-labelledby="tempo-speech-label" aria-describedby="tempo-speech-hint" checked={data.settings.speech} disabled={!audio.speechSupported} onCheckedChange={checked => toggleSetting('speech', checked)} />
              </div>
            </div>
            {audio.error && <p className={styles.notice} role="status">{audio.error}</p>}
            <p className={styles.hint}>声音默认关闭。开启后可在计时中随时关闭。</p>
          </section>
        </Panel>
      </div>

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
