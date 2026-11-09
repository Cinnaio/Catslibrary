import { useId, type CSSProperties } from 'react'
import { Check, Flame, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/filter-chip'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Switch } from '@/components/ui/switch'
import FormField from '@/components/shared/FormField'
import type { EdgeController } from '@/hooks/useEdgeController'
import {
  EDGE_ACT_LABELS, EDGE_CATEGORY_LABELS, EDGE_DIFFICULTIES, EDGE_FINALES, EDGE_SPEND_LABELS, EDGE_TONES,
  type EdgeCategory, type EdgeDifficulty, type EdgeFinale, type EdgeTone,
} from '@/lib/edge'
import styles from './EdgeControls.module.css'

const DIFFICULTY_LIST = Object.keys(EDGE_DIFFICULTIES) as EdgeDifficulty[]
const FINALE_LIST = Object.keys(EDGE_FINALES) as EdgeFinale[]
const TONE_LIST = Object.keys(EDGE_TONES) as EdgeTone[]
const CATEGORY_LIST = Object.keys(EDGE_CATEGORY_LABELS) as EdgeCategory[]

function Stage({ controller, compact }: { controller: EdgeController; compact: boolean }) {
  const id = useId()
  const Surface = compact ? 'div' : Panel
  const { session, status, phaseLabel, hint, elapsed, remaining, progress, phaseRemaining, chance, data, timing, spends, sprinting, bank, act } = controller
  const phase = session?.phase ?? 'stop'
  const running = status === 'running'
  const beatSeconds = session && session.bpm > 0 ? 60 / session.bpm : 0
  const showTimer = !data.settings.hiddenRemaining || !session
  const canDeclare = running && phase !== 'stop'
  return (
    <Surface className={styles.stage}>
      <section aria-labelledby={`${id}-phase`}>
        <div className={styles.phaseHead}>
          <span className={styles.phaseDot} data-phase={phase} aria-hidden="true" />
          <h2 id={`${id}-phase`}>{phaseLabel}</h2>
          {session?.settings.acts && <span className={styles.act} data-act={act}>{EDGE_ACT_LABELS[act]}</span>}
          <span className={styles.chance}>许可率 {chance}%</span>
        </div>
        <p className={styles.command} aria-live="polite">{session?.command ?? '准备好了就开始。手先松着。'}</p>
        {session && session.edges > 0 && <p className={styles.edges}>已申报 {session.edges} 次{session.grinds > 0 ? `，其中磨着 ${session.grinds} 次` : ''}</p>}
        <div className={styles.meter}>
          <span className={styles.meterFill} style={{ '--progress': progress } as CSSProperties} aria-hidden="true" />
        </div>
        <div className={styles.meta}>
          {showTimer
            ? <span className={styles.clock} role="timer" aria-live="off" aria-label={`剩余 ${controller.formatTime(remaining)}`}>{sprinting ? '冲刺' : controller.formatTime(remaining)}</span>
            : <span className={styles.clockMuted}>剩余时间已隐藏</span>}
          <span className={styles.phaseClock}>{session && phaseRemaining > 0 ? `本条 ${Math.ceil(phaseRemaining / 1000)} 秒` : `已进行 ${controller.formatTime(elapsed)}`}</span>
          {beatSeconds > 0 && <i className={styles.beat} data-running={running || undefined} style={{ '--beat-duration': `${beatSeconds}s` } as CSSProperties} aria-hidden="true" />}
          {session?.settings.bank && <span className={styles.bank}>银行 {bank} 点</span>}
        </div>
        <p className={styles.hint}>{hint}</p>
        {canDeclare && (
          <p className={styles.timing} data-timing={timing ?? undefined}>
            {timing === 'late' ? '就是现在，按下去最值。' : timing === 'steady' ? '还可以再撑一会儿。' : '现在按太早了，得分很低。'}
          </p>
        )}
        <div className={styles.actions}>
          {running || status === 'cooldown' ? (
            <>
              <Button type="button" onClick={() => controller.declareEdge('hold')} disabled={!canDeclare}>
                <Check aria-hidden="true" />忍住了
              </Button>
              {session?.settings.timing !== false && (
                <Button type="button" variant="outline" onClick={() => controller.declareEdge('grind')} disabled={!canDeclare}>
                  <Flame aria-hidden="true" />磨着不停
                </Button>
              )}
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
        {session?.settings.bank && session.status !== 'finished' && (
          <div className={styles.spends} role="group" aria-label="时间银行">
            {spends.map(({ kind, cost, note }) => (
              <Button key={kind} type="button" variant="outline" size="sm" disabled={!!note} title={note ?? EDGE_SPEND_LABELS[kind].summary} onClick={() => controller.spend(kind)}>
                {EDGE_SPEND_LABELS[kind].label} · {cost}
              </Button>
            ))}
          </div>
        )}
        {running && session?.phase !== 'stop' && (
          <Button type="button" variant="ghost" size="sm" className={styles.lost} onClick={controller.reportCame}>中途没忍住？点这里</Button>
        )}
      </section>
    </Surface>
  )
}

function Settings({ controller, compact }: { controller: EdgeController; compact: boolean }) {
  const id = useId()
  const Surface = compact ? 'div' : Panel
  const { data, session, changeSetting, changeCategory, saveNumbers, setMinutes, setPermitSeconds, setHoldMin, setHoldMax, customChance, setCustomChance } = controller
  const settings = data.settings
  const locked = !!session && session.status !== 'finished'
  return (
    <Surface className={styles.settings}>
      <section aria-labelledby={`${id}-settings-title`}>
        <h2 id={`${id}-settings-title`}>这一局的规则</h2>
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
            <p className={styles.choiceHint}>
              {EDGE_DIFFICULTIES[settings.difficulty].summary}
              {settings.customChance !== null && ` 当前按自定义许可率 ${settings.customChance}% 计算，难度的概率已被覆盖。`}
            </p>
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
                  <label htmlFor={`${id}-cat-${key}`}>{EDGE_CATEGORY_LABELS[key]}</label>
                  <Switch id={`${id}-cat-${key}`} checked={settings.categories[key]} onCheckedChange={(checked) => changeCategory(key, checked)} />
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

          {settings.finale === 'overtime' && (
            <FormField label="单次加时（秒）" hint="没抽中时额外加的时长，15–300 秒">
              <Input
                type="number"
                inputMode="numeric"
                min={15}
                max={300}
                step={15}
                value={settings.overtimeSeconds}
                onChange={(event) => changeSetting('overtimeSeconds', Math.min(300, Math.max(15, Math.round(Number(event.target.value) || 15))))}
              />
            </FormField>
          )}
        </fieldset>

        <div className={styles.switchList}>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-sound`}><strong>节拍声</strong><span>{controller.audio.soundSupported ? '绿色清脆、黄色更闷，红色静音' : '当前浏览器不支持，仍可使用视觉节拍'}</span></label>
            <Switch id={`${id}-sound`} checked={settings.sound} disabled={!controller.audio.soundSupported} onCheckedChange={(checked) => changeSetting('sound', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-heartbeat`}><strong>红色时的心跳</strong><span>仅在不许碰的相位响，音量比节拍低</span></label>
            <Switch id={`${id}-heartbeat`} checked={settings.heartbeat} disabled={!controller.audio.soundSupported} onCheckedChange={(checked) => changeSetting('heartbeat', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-speech`}><strong>语音播报</strong><span>{controller.audio.speechSupported ? '只播相位变化、申报与结局，不逐条念指令' : '当前浏览器不支持语音提示'}</span></label>
            <Switch id={`${id}-speech`} checked={settings.speech} disabled={!controller.audio.speechSupported} onCheckedChange={(checked) => changeSetting('speech', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-hidden`}><strong>隐藏剩余时间</strong><span>不显示倒计时，只留进度条</span></label>
            <Switch id={`${id}-hidden`} checked={settings.hiddenRemaining} onCheckedChange={(checked) => changeSetting('hiddenRemaining', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-long`}><strong>较长的指令</strong><span>每条指令持续更久，红色同样会拉长</span></label>
            <Switch id={`${id}-long`} checked={settings.segmentLength === 'long'} onCheckedChange={(checked) => changeSetting('segmentLength', checked ? 'long' : 'standard')} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-acts`}><strong>三幕结构</strong><span>铺垫、折磨、极限依次压过来，最后一段全红冲刺</span></label>
            <Switch id={`${id}-acts`} checked={settings.acts} onCheckedChange={(checked) => changeSetting('acts', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-bank`}><strong>时间银行</strong><span>每守住一分钟存 1 点，可兑现豁免、缩短或直接换许可</span></label>
            <Switch id={`${id}-bank`} checked={settings.bank} onCheckedChange={(checked) => changeSetting('bank', checked)} />
          </div>
          <div className={styles.settingRow}>
            <label htmlFor={`${id}-timing`}><strong>申报时机判定</strong><span>越接近本条指令末尾按下去，给的许可率越多；同时开放「磨着不停」</span></label>
            <Switch id={`${id}-timing`} checked={settings.timing} onCheckedChange={(checked) => changeSetting('timing', checked)} />
          </div>
        </div>
        {locked && <p className={styles.choiceHint}>这一局开始后规则与时长已固定，结束后可以重新调整。</p>}
        {controller.audio.error && <p className={styles.notice} role="status">{controller.audio.error}</p>}
      </section>
    </Surface>
  )
}

/** The tool page and reader use the same controls and session rules. */
export function EdgeControls({ controller, compact = false }: { controller: EdgeController; compact?: boolean }) {
  return <div className={styles.workspace} data-compact={compact || undefined}>
    <Stage controller={controller} compact={compact} />
    <Settings controller={controller} compact={compact} />
  </div>
}
