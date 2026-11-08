import { useId, type CSSProperties } from 'react'
import { Pause, Play, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/filter-chip'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Switch } from '@/components/ui/switch'
import FormField from '@/components/shared/FormField'
import type { TempoController } from '@/hooks/useTempoController'
import { formatTempoTime } from '@/lib/tempo'
import styles from './TempoControls.module.css'

export function TempoControls({ controller, compact = false, sessionNote = '切到后台自动暂停 · 离开此页结束本次计时' }: {
  controller: TempoController
  compact?: boolean
  sessionNote?: string
}) {
  const id = useId()
  const Surface = compact ? 'div' : Panel
  const {
    data, session, dispatch, audio, minutes, bpm, running, active, minutesValid, bpmValid,
    remaining, progress, currentBpm, statusText, hint, saveNumbers, changeMinutes, changeBpm,
    start, resume, toggleSetting,
  } = controller
  const circumference = 2 * Math.PI * 120
  return (
      <div className={styles.workspace} data-compact={compact || undefined}>
        <Surface className={styles.timerPanel}>
          <section aria-labelledby={`${id}-status`}>
            <div className={styles.status} aria-live="polite">
              <h2 id={`${id}-status`}>{statusText}</h2>
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
                  <i className={styles.beat} data-running={running || undefined} style={{ '--beat-duration': `${60 / currentBpm}s` } as CSSProperties} aria-hidden="true" />
                  {currentBpm} 拍 / 分钟
                </span>
              </div>
            </div>
            <div className={styles.actions}>
              {running ? (
                <Button type="button" onClick={() => dispatch({ type: 'pause', now: performance.now(), reason: 'manual' })}><Pause aria-hidden="true" />暂停</Button>
              ) : session?.status === 'paused' ? (
                <Button type="button" onClick={resume}><Play aria-hidden="true" />继续计时</Button>
              ) : (
                <Button type="button" disabled={!minutesValid || !bpmValid} onClick={start}>{session ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}{session ? '再来一次' : '开始计时'}</Button>
              )}
              {active && <Button type="button" variant="outline" onClick={() => dispatch({ type: 'end', now: performance.now() })}><Square aria-hidden="true" />结束</Button>}
            </div>
            <p className={styles.sessionNote}>{sessionNote}</p>
          </section>
        </Surface>

        <Surface className={styles.settingsPanel}>
          <section aria-labelledby={`${id}-settings`}>
            <h2 id={`${id}-settings`}>安排这一段时间</h2>
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
                <label htmlFor={`${id}-sound`}><strong id={`${id}-sound-label`}>节拍声</strong><span id={`${id}-sound-hint`}>{audio.soundSupported ? '轻柔的提示音，随节拍响起' : '当前浏览器不支持，仍可使用视觉节拍'}</span></label>
                <Switch id={`${id}-sound`} aria-labelledby={`${id}-sound-label`} aria-describedby={`${id}-sound-hint`} checked={data.settings.sound} disabled={!audio.soundSupported} onCheckedChange={checked => toggleSetting('sound', checked)} />
              </div>
              <div className={styles.settingRow}>
                <label htmlFor={`${id}-speech`}><strong id={`${id}-speech-label`}>语音提示</strong><span id={`${id}-speech-hint`}>{audio.speechSupported ? '播报状态与每分钟进度，语音由浏览器提供' : '当前浏览器不支持语音提示'}</span></label>
                <Switch id={`${id}-speech`} aria-labelledby={`${id}-speech-label`} aria-describedby={`${id}-speech-hint`} checked={data.settings.speech} disabled={!audio.speechSupported} onCheckedChange={checked => toggleSetting('speech', checked)} />
              </div>
            </div>
            {audio.error && <p className={styles.notice} role="status">{audio.error}</p>}
            <p className={styles.hint}>声音默认关闭。开启后可在计时中随时关闭。</p>
          </section>
        </Surface>
      </div>

  )
}
