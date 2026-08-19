/**
 * 阅读设置控件 —— 桌面弹层与移动端 sheet 共用（data-* 语义平移）。
 * 由 read.html 的 reader-settings-panel / mobile-settings-sheet 结构平移。
 */
import type { ReaderSettingKey } from '../../hooks/useReaderSettings'

interface SettingsRowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: SettingsRowProps) {
  return (
    <div className="mobile-settings-row">
      <span className="mobile-settings-row__label">{label}</span>
      <div className="mobile-settings-segmented" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

interface SegBtnProps {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}

function Seg({ active, disabled, title, onClick, children }: SegBtnProps) {
  return (
    <button type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  )
}

interface SettingsControlsProps {
  settings: Record<string, string>
  set: (key: ReaderSettingKey, value: string) => void
  wakeLockSupported: boolean
}

type Opt = [string, string]

export function SettingsControls({ settings, set, wakeLockSupported }: SettingsControlsProps) {
  return (
    <>
      <Row label="字号">
        {['0', '1', '2', '3', '4', '5'].map((v) => (
          <Seg key={v} active={settings.fontSize === v} onClick={() => set('fontSize', v)}>
            {['15', '18', '20', '23', '27', '32'][Number(v)]}
          </Seg>
        ))}
      </Row>
      <Row label="行高">
        {([['1.75', '紧凑'], ['1.95', '标准'], ['2.15', '舒展']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerLineHeight === v} onClick={() => set('readerLineHeight', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="段距">
        {([['1.0', '紧凑'], ['1.4', '标准'], ['1.8', '宽松']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerParagraphSpacing === v} onClick={() => set('readerParagraphSpacing', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="宽度">
        {([['narrow', '窄'], ['standard', '标准'], ['wide', '宽']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerPageWidth === v} onClick={() => set('readerPageWidth', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="字体">
        {([['serif', '衬线'], ['sans', '无衬线']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.fontFamily === v} onClick={() => set('fontFamily', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="模式">
        {([['scroll', '滚动'], ['page', '分页']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerPageMode === v} onClick={() => set('readerPageMode', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="主题">
        {([['default', '默认'], ['eye', '护眼'], ['paper', '纸张']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerTheme === v} onClick={() => set('readerTheme', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="滚动">
        {([['off', '关闭'], ['slow', '慢'], ['medium', '中'], ['fast', '快']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerAutoScrollSpeed === v} onClick={() => set('readerAutoScrollSpeed', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="点击">
        {([['off', '关闭'], ['on', '翻页']] as Opt[]).map(([v, label]) => (
          <Seg key={v} active={settings.readerClickPaging === v} onClick={() => set('readerClickPaging', v)}>
            {label}
          </Seg>
        ))}
      </Row>
      <Row label="常亮">
        {([['off', '关闭'], ['on', '开启']] as Opt[]).map(([v, label]) => (
          <Seg
            key={v}
            active={settings.readerWakeLock === v}
            disabled={!wakeLockSupported}
            title={wakeLockSupported ? undefined : '当前浏览器不支持屏幕常亮'}
            onClick={() => set('readerWakeLock', v)}
          >
            {label}
          </Seg>
        ))}
      </Row>
    </>
  )
}
