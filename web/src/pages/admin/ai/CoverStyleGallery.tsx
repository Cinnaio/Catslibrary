import './cover-style-gallery.css'

const REFERENCE_STYLES = [
  { value: 'doodle_journal', label: '萌系涂鸦手账', hint: '格纹 · 贴纸 · 描边字', sample: '心动手册' },
  { value: 'dreamy_cloud', label: '梦幻云染', hint: '蓝粉云团 · 手写字', sample: '云间来信' },
  { value: 'warm_apricot', label: '暖橘花染', hint: '桃橙晕染 · 书法字', sample: '花开时分' },
  { value: 'minimal_typographic', label: '极简水彩题字', hint: '白底淡彩 · 留白题字', sample: '春意' },
  { value: 'ancient_blossom', label: '古言花间插画', hint: '花枝人物 · 墨色题字', sample: '花间' },
  { value: 'pink_collage', label: '粉色情绪拼贴', hint: '透明叠层 · 错落字章', sample: '心动失序' },
  { value: 'floral_handwriting', label: '花笺甜系手写', hint: '花瓣纸纹 · 俏皮手写', sample: '悄悄喜欢' },
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
              {style.value === 'ancient_blossom' && (
                <svg className="cover-style-character" viewBox="0 0 100 150" aria-hidden="true">
                  <path d="M30 55 Q20 16 54 14 Q84 18 76 62 L80 104 L30 110Z" fill="#443b39" />
                  <ellipse cx="56" cy="45" rx="18" ry="25" fill="#f5dcd0" />
                  <path d="M35 40 Q38 10 58 18 Q78 20 75 44 Q55 28 35 40" fill="#443b39" />
                  <path d="M41 67 L56 79 L72 64 Q90 83 97 148 L17 148 Q20 96 41 67Z" fill="#c0d7cc" />
                  <path d="M41 67 L58 89 L50 130 L31 146 L19 147 Q21 94 41 67Z" fill="#f9eee8" />
                  <path d="M73 65 L58 89 L75 147 L97 148 Q91 84 73 65Z" fill="#efe2dc" />
                  <path d="M77 29 L93 4 M78 28 L97 32 M22 133 L5 94" stroke="#9c8078" strokeWidth="1.5" />
                  <g fill="#dfa7b5">
                    <circle cx="88" cy="14" r="5" />
                    <circle cx="93" cy="31" r="5" />
                    <circle cx="11" cy="109" r="5" />
                    <circle cx="77" cy="28" r="4" />
                  </g>
                </svg>
              )}
              <span className="cover-style-sample-title">
                {Array.from(style.sample).map((character, index) => (
                  <span key={index}>{character}</span>
                ))}
              </span>
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
