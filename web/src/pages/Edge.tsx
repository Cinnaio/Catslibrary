import { useRef, useState, type CSSProperties } from 'react'
import { Check, Flame, History, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/filter-chip'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import ContentPolicyStatus from '@/components/ContentPolicyStatus'
import ContentRestrictionNotice from '@/components/ContentRestrictionNotice'
import EmptyState from '@/components/shared/EmptyState'
import FormField from '@/components/shared/FormField'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useSession } from '@/context/SessionContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useEdgeController, type EdgeController } from '@/hooks/useEdgeController'
import {
  EDGE_CATEGORY_LABELS, EDGE_DIFFICULTIES, EDGE_ENDING_LABELS, EDGE_FINALES, EDGE_TONES,
  type EdgeCategory, type EdgeDifficulty, type EdgeFinale, type EdgeTone,
} from '@/lib/edge'
import styles from './edge.module.css'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const DIFFICULTY_LIST = Object.keys(EDGE_DIFFICULTIES) as EdgeDifficulty[]
const FINALE_LIST = Object.keys(EDGE_FINALES) as EdgeFinale[]
const TONE_LIST = Object.keys(EDGE_TONES) as EdgeTone[]
const CATEGORY_LIST = Object.keys(EDGE_CATEGORY_LABELS) as EdgeCategory[]

function Stage({ controller }: { controller: EdgeController }) {
  const { session, status, phaseLabel, hint, elapsed, remaining, progress, phaseRemaining, chance, data } = controller
  const phase = session?.phase ?? 'stop'
  const running = status === 'running'
  const beatSeconds = session && session.bpm > 0 ? 60 / session.bpm : 0
  const showTimer = !data.settings.hiddenRemaining || !session
  return (
    <Panel asChild className={styles.stage}>
      <section aria-labelledby="edge-phase">
        <div className={styles.phaseHead}>
          <span className={styles.phaseDot} data-phase={phase} aria-hidden="true" />
          <h2 id="edge-phase">{phaseLabel}</h2>
          <span className={styles.chance}>许可率 {chance}%</span>
        </div>
        <p className={styles.command} aria-live="polite">{session?.command ?? '准备好了就开始。手先松着。'}</p>
        {session && session.edges > 0 && <p className={styles.edges}>已申报 {session.edges} 次</p>}
        <div className={styles.meter}>
          <span className={styles.meterFill} style={{ '--progress': progress } as CSSProperties} aria-hidden="true" />
        </div>
        <div className={styles.meta}>
          {showTimer
            ? <span className={styles.clock} role="timer" aria-live="off" aria-label={`剩余 ${controller.formatTime(remaining)}`}>{controller.formatTime(remaining)}</span>
            : <span className={styles.clockMuted}>剩余时间已隐藏</span>}
          <span className={styles.phaseClock}>{session && phaseRemaining > 0 ? `本条 ${Math.ceil(phaseRemaining / 1000)} 秒` : `已进行 ${controller.formatTime(elapsed)}`}</span>
          {beatSeconds > 0 && <i className={styles.beat} data-running={running || undefined} style={{ '--beat-duration': `${beatSeconds}s` } as CSSProperties} aria-hidden="true" />}
        </div>
        <p className={styles.hint}>{hint}</p>
        <div className={styles.actions}>
          {running || status === 'cooldown' ? (
            <>
              <Button type="button" onClick={controller.declareEdge} disabled={session?.phase === 'stop' || status === 'cooldown'}>
                <Check aria-hidden="true" />忍住了
              </Button>
              <Button type="button" variant="outline" onClick={controller.pause}><Pause aria-hidden="true" />暂停</Button>
            </>
          ) : status === 'paused' ? (
            <>
              <Button type="button" onClick={controller.resume}><Play aria-hidden="true" />继续</Button>
              <Button type="button" variant="outline" onClick={controller.quit}><Square aria-hidden="true" />结束这一局</Button>
            </>
          ) : status === 'permit' ? (
            <Button type="button" onClick={controller.reportCame}><Check aria-hidden="true" />按下了</Button>
          ) : (
            <Button type="button" disabled={!controller.minutesValid || !controller.permitValid || !controller.holdMinValid || !controller.holdMaxValid || !controller.chanceValid} onClick={controller.start}>
              {session ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}{session ? '再来一次' : '开始这一局'}
            </Button>
          )}
          {session && session.status !== 'finished' && <Button type="button" variant="ghost" onClick={controller.quit}>不玩了</Button>}
          {status === 'finished' && <Button type="button" variant="ghost" onClick={controller.reset}><RotateCcw aria-hidden="true" />清掉结果</Button>}
        </div>
        {running && session?.phase !== 'stop' && (
          <Button type="button" variant="ghost" size="sm" className={styles.lost} onClick={controller.reportCame}>中途没忍住？点这里</Button>
        )}
      </section>
    </Panel>
  )
}

function Settings({ controller }: { controller: EdgeController }) {
  const { data, session, changeSetting, changeCategory, saveNumbers, setMinutes, setPermitSeconds, setHoldMin, setHoldMax, customChance, setCustomChance } = controller
  const settings = data.settings
  const locked = !!session && session.status !== 'finished'
  return (
    <Panel asChild className={styles.settings}>
      <section aria-labelledby="edge-settings-title">
        <h2 id="edge-settings-title">这一局的规则</h2>
        <fieldset className={styles.fieldset} disabled={locked}>
          <legend className="sr-only">时长与结局</legend>
          <div className={styles.presets} role="group" aria-label="常用时长">
            {[3, 5, 10, 20].map((value) => (
              <FilterChip key={value} selected={Number(controller.minutes) === value} aria-pressed={Number(controller.minutes) === value} onClick={() => { setMinutes(String(value)); saveNumbers({ minutes: String(value) }) }}>{value} 分钟</FilterChip>
            ))}
          </div>
          <FormField label="时长（分钟）" hint="1–180 分钟；结束前不会告诉你能不能去" error={!controller.minutesValid ? '请输入 1–180 的整数' : undefined}>
            <Input type="number" inputMode="numeric" min={1} max={180} step={1} value={controller.minutes} onChange={(event) => setMinutes(event.target.value)} onBlur={() => saveNumbers()} />
          </FormField>

          <div className={styles.choiceGroup}>
            <p className={styles.choiceLabel}>难度</p>
            <div className={styles.chips}>
              {DIFFICULTY_LIST.map((key) => (
                <FilterChip key={key} selected={settings.difficulty === key} aria-pressed={settings.difficulty === key} onClick={() => changeSetting('difficulty', key)}>{EDGE_DIFFICULTIES[key].label} · {EDGE_DIFFICULTIES[key].chance}%</FilterChip>
              ))}
            </div>
            <p className={styles.choiceHint}>{EDGE_DIFFICULTIES[settings.difficulty].summary}</p>
          </div>

          <div className={styles.choiceGroup}>
            <p className={styles.choiceLabel}>结局</p>
            <div className={styles.chips}>
              {FINALE_LIST.map((key) => (
                <FilterChip key={key} selected={settings.finale === key} aria-pressed={settings.finale === key} onClick={() => changeSetting('finale', key)}>{EDGE_FINALES[key].label}</FilterChip>
              ))}
            </div>
            <p className={styles.choiceHint}>{EDGE_FINALES[settings.finale].summary}</p>
          </div>

          <div className={styles.choiceGroup}>
            <p className={styles.choiceLabel}>口吻</p>
            <div className={styles.chips}>
              {TONE_LIST.map((key) => (
                <FilterChip key={key} selected={settings.tone === key} aria-pressed={settings.tone === key} onClick={() => changeSetting('tone', key)}>{EDGE_TONES[key].label}</FilterChip>
              ))}
            </div>
            <p className={styles.choiceHint}>会加在指令前后的短句，例如「{EDGE_TONES[settings.tone].sample}」</p>
          </div>

          <div className={styles.choiceGroup}>
            <p className={styles.choiceLabel}>指令类型</p>
            <div className={styles.switchList}>
              {CATEGORY_LIST.map((key) => (
                <div key={key} className={styles.settingRow}>
                  <label htmlFor={`edge-cat-${key}`}>{EDGE_CATEGORY_LABELS[key]}</label>
                  <Switch id={`edge-cat-${key}`} checked={settings.categories[key]} onCheckedChange={(checked) => changeCategory(key, checked)} />
                </div>
              ))}
            </div>
            <p className={styles.choiceHint}>基础指令（动／慢／松手）始终保留，这里只控制附加的几类。</p>
          </div>

          <div className={styles.numberFields}>
            <FormField label="许可时长（秒）" hint="拿到许可后的窗口，5–60 秒" error={!controller.permitValid ? '请输入 5–60 的整数' : undefined}>
              <Input type="number" inputMode="numeric" min={5} max={60} step={1} value={controller.permitSeconds} onChange={(event) => setPermitSeconds(event.target.value)} onBlur={() => saveNumbers()} />
            </FormField>
            <FormField label="自定义许可率（%）" hint="留空则跟随难度" error={!controller.chanceValid ? '请输入 0–100 的整数' : undefined}>
              <Input type="number" inputMode="numeric" min={0} max={100} step={1} placeholder={String(EDGE_DIFFICULTIES[settings.difficulty].chance)} value={customChance} onChange={(event) => setCustomChance(event.target.value)} onBlur={() => saveNumbers()} />
            </FormField>
          </div>

          <div className={styles.numberFields}>
            <FormField label="忍住后等待最短（秒）" hint="3–120 秒" error={!controller.holdMinValid ? '请输入 3–120 的整数' : undefined}>
              <Input type="number" inputMode="numeric" min={3} max={120} step={1} value={controller.holdMin} onChange={(event) => setHoldMin(event.target.value)} onBlur={() => saveNumbers()} />
            </FormField>
            <FormField label="最长（秒）" hint="不小于最短" error={!controller.holdMaxValid ? '请输入不小于最短值的整数' : undefined}>
              <Input type="number" inputMode="numeric" min={3} max={120} step={1} value={controller.holdMax} onChange={(event) => setHoldMax(event.target.value)} onBlur={() => saveNumbers()} />
            </FormField>
          </div>
        </fieldset>

        <div className={styles.switchList}>
          <div className={styles.settingRow}>
            <label htmlFor="edge-sound"><strong>节拍声</strong><span>{controller.audio.soundSupported ? '绿色清脆、黄色更闷，红色静音' : '当前浏览器不支持，仍可使用视觉节拍'}</span></label>
            <Switch id="edge-sound" checked={settings.sound} disabled={!controller.audio.soundSupported} onCheckedChange={(checked) => changeSetting('sound', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor="edge-heartbeat"><strong>红色时的心跳</strong><span>仅在不许碰的相位响，音量比节拍低</span></label>
            <Switch id="edge-heartbeat" checked={settings.heartbeat} disabled={!controller.audio.soundSupported} onCheckedChange={(checked) => changeSetting('heartbeat', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor="edge-speech"><strong>语音播报</strong><span>{controller.audio.speechSupported ? '只播相位变化、申报与结局，不逐条念指令' : '当前浏览器不支持语音提示'}</span></label>
            <Switch id="edge-speech" checked={settings.speech} disabled={!controller.audio.speechSupported} onCheckedChange={(checked) => changeSetting('speech', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor="edge-hidden"><strong>隐藏剩余时间</strong><span>不显示倒计时，只留进度条</span></label>
            <Switch id="edge-hidden" checked={settings.hiddenRemaining} onCheckedChange={(checked) => changeSetting('hiddenRemaining', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor="edge-long"><strong>较长的指令</strong><span>每条指令持续更久，红色和写明秒数的不变</span></label>
            <Switch id="edge-long" checked={settings.segmentLength === 'long'} onCheckedChange={(checked) => changeSetting('segmentLength', checked ? 'long' : 'standard')} />
          </div>
        </div>
        {locked && <p className={styles.choiceHint}>这一局开始后规则与时长已固定，结束后可以重新调整。</p>}
        {controller.audio.error && <p className={styles.notice} role="status">{controller.audio.error}</p>}
      </section>
    </Panel>
  )
}

function EdgeWorkspace({ scope }: { scope: string }) {
  const controller = useEdgeController(scope)
  const { data, storageError, clearHistory, retry, session } = controller
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
        <p className={styles.eyebrow}><Flame size={15} aria-hidden="true" /> 阅读之外 · 小工具 · 限 18 岁以上</p>
        <h1>节拍指令</h1>
        <p>屏幕每隔一阵换一次颜色和指令，你照做，撑到时间结束。能不能去，最后由它决定。</p>
      </header>

      <div className={styles.workspace}>
        <Stage controller={controller} />
        <Settings controller={controller} />
      </div>

      <section className={styles.history} aria-labelledby="edge-history-title">
        <div className={styles.historyHeading}>
          <div>
            <h2 id="edge-history-title" ref={historyHeading} tabIndex={-1}>最近这一些局</h2>
            <p>最多保留 30 局，仅保存在本机当前{scope === 'guest' ? '游客空间' : '账号'}，不跨设备同步，也不上传。</p>
          </div>
          <Button ref={clearButton} type="button" variant="ghost" disabled={data.history.length === 0} onClick={() => changeClearOpen(true)}><Trash2 aria-hidden="true" />清空记录</Button>
        </div>
        {storageError && <div className={styles.storageNotice} role="status"><p>{storageError}</p><Button type="button" variant="outline" onClick={retry}>重试保存</Button></div>}
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
                <span className={styles.recordEdges}>{record.edges} 次申报{record.overtime > 0 ? ` · 加时 ${record.overtime}` : ''}</span>
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
