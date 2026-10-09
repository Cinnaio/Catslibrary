import './cover-style-gallery.css'

const REFERENCE_STYLES = [
  { value: 'doodle_journal', label: '萌系涂鸦手账', hint: '格纹 · 贴纸 · 描边字', sample: '心动手册' },
  { value: 'dreamy_cloud', label: '梦幻云染', hint: '蓝粉云团 · 手写字', sample: '云间来信' },
  { value: 'warm_apricot', label: '暖橘花染', hint: '桃橙晕染 · 书法字', sample: '花开时分' },
  { value: 'minimal_typographic', label: '极简水彩题字', hint: '白底淡彩 · 留白题字', sample: '春意' },
]

/** 用配色与排版示意风格，实际封面由作品内容和生成模型决定。 */
export default function CoverStyleGallery({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">参考风格 · 下方为配色与排版示意</p>
      <div className="cover-style-gallery" role="group" aria-label="参考封面风格">
        {REFERENCE_STYLES.map((style) => (
          <button
            key={style.value}
            type="button"
            className="cover-style-choice"
            aria-pressed={value === style.value}
            disabled={disabled}
            onClick={() => onChange(style.value)}
          >
            <span className={`cover-style-sample cover-style-sample--${style.value}`} aria-hidden="true">
              <span className="cover-style-sample-title">{style.sample}</span>
              <span className="cover-style-sample-author">作者</span>
            </span>
            <span className="cover-style-name">{style.label}</span>
            <span className="cover-style-hint">{style.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
