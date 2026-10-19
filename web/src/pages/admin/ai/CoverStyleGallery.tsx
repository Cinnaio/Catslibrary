import './cover-style-gallery.css'

export const COVER_STYLE_REFERENCES = [
  {
    id: 'blue-watercolor-title',
    stylePreset: 'dreamy_cloud',
    composition: 'title_center',
    label: '蓝紫云染',
    hint: '雾蓝水彩 · 白色题字',
    image: '/images/cover-style-references/blue-watercolor-title.jpg',
  },
  {
    id: 'pink-blossom-calligraphy',
    stylePreset: 'soft_watercolor',
    composition: 'title_vertical',
    label: '粉白花笺',
    hint: '樱花水彩 · 朱红题字',
    image: '/images/cover-style-references/pink-blossom-calligraphy.jpg',
  },
  {
    id: 'pastel-floral-romance',
    stylePreset: 'pastel_romance',
    composition: 'title_center',
    label: '粉彩花影',
    hint: '粉紫花影 · 轻柔题字',
    image: '/images/cover-style-references/pastel-floral-romance.jpg',
  },
  {
    id: 'red-ink-editorial',
    stylePreset: 'minimal_typographic',
    composition: 'title_vertical',
    label: '红墨竖题',
    hint: '留白纸面 · 红黑书法',
    image: '/images/cover-style-references/red-ink-editorial.jpg',
  },
  {
    id: 'anime-pink-romance',
    stylePreset: 'romance_illustration',
    composition: 'duo',
    label: '粉色人物言情',
    hint: '双人物 · 商业插画',
    image: '/images/cover-style-references/anime-pink-romance.jpg',
  },
  {
    id: 'pink-bubble-typography',
    stylePreset: 'doodle_journal',
    composition: 'title_center',
    label: '粉色泡泡字',
    hint: '柔粉底 · 手账字卡',
    image: '/images/cover-style-references/pink-bubble-typography.jpg',
  },
  {
    id: 'floral-handwriting',
    stylePreset: 'floral_handwriting',
    composition: 'title_center',
    label: '花笺手写',
    hint: '白底花瓣 · 轻盈手写',
    image: '/images/cover-style-references/floral-handwriting.jpg',
  },
  {
    id: 'pink-doodle-comic',
    stylePreset: 'doodle_journal',
    composition: 'title_collage',
    label: '粉色涂鸦字卡',
    hint: '漫画贴纸 · 错落大字',
    image: '/images/cover-style-references/pink-doodle-comic.jpg',
  },
  {
    id: 'soft-pink-watercolor',
    stylePreset: 'soft_watercolor',
    composition: 'title_center',
    label: '清透粉水彩',
    hint: '低对比晕染 · 中央题字',
    image: '/images/cover-style-references/soft-pink-watercolor.jpg',
  },
  {
    id: 'crimson-ink',
    stylePreset: 'ink',
    composition: 'title_center',
    label: '赤色水墨',
    hint: '深红墨纹 · 白色书法',
    image: '/images/cover-style-references/crimson-ink.jpg',
  },
  {
    id: 'ancient-romance-pastel',
    stylePreset: 'ancient_blossom',
    composition: 'duo',
    label: '古言花间人物',
    hint: '古风双人 · 花枝氛围',
    image: '/images/cover-style-references/ancient-romance-pastel.jpg',
  },
  {
    id: 'blue-lavender-abstract',
    stylePreset: 'moonlit_dream',
    composition: 'title_center',
    label: '蓝紫抽象梦境',
    hint: '靛蓝肌理 · 月色留白',
    image: '/images/cover-style-references/blue-lavender-abstract.jpg',
  },
] as const

/** 展示用户选定的实际封面缩略图作为风格参考，选择时同步写入匹配的构图方向。 */
export default function CoverStyleGallery({
  value,
  composition,
  onChange,
  disabled,
}: {
  value: string
  composition: string
  onChange: (stylePreset: string, composition: string) => void
  disabled: boolean
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">参考风格 · 选择样本会同时设定匹配的构图方向</p>
      <div className="cover-style-gallery" role="group" aria-label="参考封面风格">
        {COVER_STYLE_REFERENCES.map((style) => (
          <button
            key={style.id}
            type="button"
            className="cover-style-choice"
            aria-pressed={value === style.stylePreset && composition === style.composition}
            disabled={disabled}
            onClick={() => onChange(style.stylePreset, style.composition)}
          >
            <span className="cover-style-sample cover-style-sample--reference" aria-hidden="true">
              <img src={style.image} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="cover-style-name">{style.label}</span>
            <span className="cover-style-hint">{style.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
