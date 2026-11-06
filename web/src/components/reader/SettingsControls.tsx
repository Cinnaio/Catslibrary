/** 桌面弹层与移动端共用的阅读设置；保留原有设置键与档位。 */
import { useId } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FONT_LABELS, type ReaderSettingKey } from '../../hooks/useReaderSettings'
import styles from './SettingsControls.module.css'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={styles.row}>
    <span className={styles.label}>{label}</span>
    <div className={styles.options} role="group" aria-label={label}>{children}</div>
  </div>
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Button variant="ghost" className={styles.option} aria-pressed={active} onClick={onClick} type="button">{children}</Button>
}

function Toggle({ label, checked, disabled, hint, onChange }: {
  label: string; checked: boolean; disabled?: boolean; hint?: string; onChange: (checked: boolean) => void
}) {
  const id = useId()
  return <label className={styles.toggleRow} htmlFor={id}>
    <span className={styles.toggleLabel}>{label}{hint && <small id={`${id}-hint`}>{hint}</small>}</span>
    <Switch id={id} checked={checked} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} onCheckedChange={onChange} />
  </label>
}

interface SettingsControlsProps {
  settings: Record<string, string>
  set: (key: ReaderSettingKey, value: string) => void
  wakeLockSupported: boolean
}

type Opt = [string, string]

export function SettingsControls({ settings, set, wakeLockSupported }: SettingsControlsProps) {
  const parsedFontSize = Number.parseInt(settings.fontSize ?? '2', 10)
  const fontSize = Math.min(FONT_LABELS.length - 1, Math.max(0, Number.isFinite(parsedFontSize) ? parsedFontSize : 2))
  const autoScroll = settings.readerAutoScrollSpeed || 'off'
  return <div className={styles.controls}>
    <fieldset className={styles.group}><legend>文字排版</legend>
      <div className={styles.row}>
        <span className={styles.label}>字号</span>
        <div className={styles.stepper} role="group" aria-label="字号">
          <Button type="button" variant="ghost" size="icon" aria-label="减小字号" disabled={fontSize === 0} onClick={() => set('fontSize', String(fontSize - 1))}><Minus size={16} aria-hidden="true" /></Button>
          <output aria-label="当前字号" aria-live="polite">{FONT_LABELS[fontSize]}</output>
          <Button type="button" variant="ghost" size="icon" aria-label="增大字号" disabled={fontSize === FONT_LABELS.length - 1} onClick={() => set('fontSize', String(fontSize + 1))}><Plus size={16} aria-hidden="true" /></Button>
        </div>
      </div>
      <Row label="行高">{([['1.75', '紧凑'], ['1.95', '标准'], ['2.15', '舒展']] as Opt[]).map(([v, label]) => <Seg key={v} active={(settings.readerLineHeight || '1.95') === v} onClick={() => set('readerLineHeight', v)}>{label}</Seg>)}</Row>
      <Row label="段距">{([['1.0', '紧凑'], ['1.4', '标准'], ['1.8', '宽松']] as Opt[]).map(([v, label]) => <Seg key={v} active={(settings.readerParagraphSpacing || '1.4') === v} onClick={() => set('readerParagraphSpacing', v)}>{label}</Seg>)}</Row>
      <Row label="宽度">{([['narrow', '窄'], ['standard', '标准'], ['wide', '宽']] as Opt[]).map(([v, label]) => <Seg key={v} active={(settings.readerPageWidth || 'standard') === v} onClick={() => set('readerPageWidth', v)}>{label}</Seg>)}</Row>
      <Row label="字体">{([['serif', '衬线'], ['sans', '无衬线']] as Opt[]).map(([v, label]) => <Seg key={v} active={(settings.fontFamily || 'serif') === v} onClick={() => set('fontFamily', v)}>{label}</Seg>)}</Row>
    </fieldset>
    <fieldset className={styles.group}><legend>阅读方式</legend>
      <Row label="模式">{([['scroll', '滚动'], ['page', '分页']] as Opt[]).map(([v, label]) => <Seg key={v} active={(settings.readerPageMode || 'scroll') === v} onClick={() => set('readerPageMode', v)}>{label}</Seg>)}</Row>
      <Row label="阅读底色">{([['default', '默认'], ['eye', '护眼'], ['paper', '纸张']] as Opt[]).map(([v, label]) => <Seg key={v} active={(settings.readerTheme || 'default') === v} onClick={() => set('readerTheme', v)}><span className={styles.swatch} data-color={v} aria-hidden="true" />{label}</Seg>)}</Row>
      <Toggle label="显示插图" checked={settings.readerIllustrations !== 'off'} onChange={on => set('readerIllustrations', on ? 'on' : 'off')} />
    </fieldset>
    <fieldset className={styles.group}><legend>辅助功能</legend>
      <Toggle label="自动滚动" checked={autoScroll !== 'off'} onChange={on => set('readerAutoScrollSpeed', on ? 'medium' : 'off')} />
      {autoScroll !== 'off' && <Row label="滚动速度">{([['slow', '慢'], ['medium', '中'], ['fast', '快']] as Opt[]).map(([v, label]) => <Seg key={v} active={autoScroll === v} onClick={() => set('readerAutoScrollSpeed', v)}>{label}</Seg>)}</Row>}
      <Toggle label="点击翻页" hint="分页模式下点击正文两侧翻页" checked={settings.readerClickPaging !== 'off'} onChange={on => set('readerClickPaging', on ? 'on' : 'off')} />
      <Toggle label="屏幕常亮" hint={wakeLockSupported ? undefined : '当前浏览器不支持屏幕常亮'} checked={settings.readerWakeLock === 'on'} disabled={!wakeLockSupported} onChange={on => set('readerWakeLock', on ? 'on' : 'off')} />
    </fieldset>
  </div>
}
