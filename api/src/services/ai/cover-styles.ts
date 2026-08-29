/**
 * 小说封面视觉风格知识库 —— 由 story-cover skill 的 cover-styles.md 萃取为 TS 常量。
 * 供 buildImagePrompt 组装题材风格标签、平台版式约束、书名/作者名字体层。
 * 纯数据 + 纯函数（inferGenre 可单测），不触碰 DB / 网络。
 */

/** 支持的题材。多题材按命中分数与 GENRE_PRIORITY 取一，零命中回落 'urban'。 */
export type Genre = 'xianxia' | 'urban' | 'ancient' | 'romance' | 'mystery' | 'scifi' | 'fantasy' | 'historical' | 'horror' | 'light'

/** 支持的平台版式。'default' 表示通用竖版，不叠加平台专属约束。 */
export type CoverPlatform = 'default' | 'fanqie' | 'qidian' | 'jinjiang' | 'zhihu' | 'qimao' | 'ciweimao'

/**
 * 封面主视觉预设。auto 不是固定画风，而是根据题材、小说 ID 和 variationId 稳定选一套合适方向。
 * 平台风格与主视觉分离，避免「平台」参数把所有书压成同一套画风。
 */
export type CoverStylePreset =
  | 'auto'
  | 'cinematic'
  | 'illustration'
  | 'ink'
  | 'minimal'
  | 'noir'
  | 'graphic'
  | 'soft_watercolor'
  | 'moonlit_dream'
  | 'ancient_guochao'
  | 'romance_illustration'
  | 'dark_cinematic'
  | 'pastel_romance'
  | 'botanical_literary'
  | 'minimal_typographic'

/** 封面构图预设。auto 会按小说和变体稳定轮换。 */
export type CoverComposition = 'auto' | 'portrait' | 'duo' | 'environment' | 'symbolic' | 'silhouette' | 'off_center'

export type ResolvedCoverStylePreset = Exclude<CoverStylePreset, 'auto'>
export type ResolvedCoverComposition = Exclude<CoverComposition, 'auto'>

export interface CoverDirection {
  stylePreset: ResolvedCoverStylePreset
  composition: ResolvedCoverComposition
  stylePrompt: string
  compositionPrompt: string
}

export const COVER_STYLE_OPTIONS: Array<{ value: CoverStylePreset; label: string }> = [
  { value: 'auto', label: '自动推荐' },
  { value: 'soft_watercolor', label: '清透水彩' },
  { value: 'moonlit_dream', label: '月色梦境' },
  { value: 'ancient_guochao', label: '古风国色' },
  { value: 'romance_illustration', label: '人物言情插画' },
  { value: 'dark_cinematic', label: '暗夜电影感' },
  { value: 'pastel_romance', label: '粉彩轻甜' },
  { value: 'botanical_literary', label: '草木文学' },
  { value: 'minimal_typographic', label: '留白字章' },
  { value: 'cinematic', label: '电影概念设计' },
  { value: 'illustration', label: '编辑插画' },
  { value: 'ink', label: '东方水墨' },
  { value: 'minimal', label: '极简海报' },
  { value: 'noir', label: '黑色电影' },
  { value: 'graphic', label: '现代平面设计' },
]

export const COVER_COMPOSITION_OPTIONS: Array<{ value: CoverComposition; label: string }> = [
  { value: 'auto', label: '自动变化' },
  { value: 'portrait', label: '人物特写' },
  { value: 'duo', label: '双人物关系' },
  { value: 'environment', label: '环境叙事' },
  { value: 'symbolic', label: '关键物件' },
  { value: 'silhouette', label: '剪影留白' },
  { value: 'off_center', label: '非对称构图' },
]

export interface GenreStyle {
  /** 题材风格标签（英文，塞进 prompt 主体） */
  tag: string
  /** 人物描述模板（英文；画面层骨架，文本模型按简介增强的锚点） */
  figure: string
  /** 背景描述模板（英文；画面层骨架，与人物同层） */
  background: string
  /** 色彩指令 */
  color: string
  /** 光效指令 */
  light: string
  /** 书名字体风格关键词 */
  titleFont: string
  /** 作者名字体风格关键词 */
  authorFont: string
}

/**
 * 题材推断规则：关键词命中即计入该题材，多字词的语义权重更高。
 * 多题材按得分取一，同分再按 GENRE_PRIORITY；零命中回落 'urban'。
 */
const GENRE_KEYWORDS: Record<Genre, string[]> = {
  // 尽量使用有语义的词，避免「神 / 天 / 后 / 婚」等单字把其他题材误判成仙侠或言情。
  xianxia: ['仙侠', '玄幻', '修真', '洪荒', '修仙', '剑道', '灵气', '宗门', '仙', '剑'],
  urban: ['都市', '总裁', '校园', '重生', '系统', '学霸', '医生', '兵王', '战神', '赘婿'],
  ancient: ['妃', '皇', '侯', '宫', '嫡', '庶', '凤', '鸾', '宫斗', '古言'],
  romance: [
    '现代言情',
    '都市言情',
    '悬疑言情',
    '校园言情',
    '职场言情',
    '契约',
    '替嫁',
    '甜宠',
    '娇妻',
    '萌宝',
    '闪婚',
    '现言',
    '言情',
    '爱情',
    '恋爱',
    '暗恋',
    '婚姻',
    '结婚',
  ],
  mystery: ['诡案', '侦探', '悬疑', '推理', '密室', '连环', '犯罪', '谜案'],
  scifi: ['星际', '末世', '机甲', '赛博', '废土', '进化', '科幻', '宇宙', '太空'],
  fantasy: ['龙', '骑', '魔法', '异世界', '精灵', '领主', '西幻', '魔', '骑士'],
  historical: ['三国', '大明', '大唐', '战场', '将军', '谋士', '历史', '军事', '权谋'],
  horror: ['鬼', '僵尸', '阴阳', '风水', '盗墓', '诅咒', '灵异', '恐怖', '诡秘'],
  light: ['萌', '喵', '团宠', '转生', '轻小说', '二次元'],
}

/** 多题材命中时的取舍优先级（越靠前越优先）。 */
export const GENRE_PRIORITY: Genre[] = ['xianxia', 'fantasy', 'ancient', 'romance', 'urban', 'mystery', 'scifi', 'historical', 'horror', 'light']

export const GENRE_STYLES: Record<Genre, GenreStyle> = {
  xianxia: {
    tag: 'xianxia Chinese fantasy art style, ethereal atmosphere, immortal cultivation theme',
    figure:
      'a male cultivator with long black hair in flowing white silk robes, holding a glowing spiritual sword, robe sleeves fluttering in the wind; or a female immortal in drifting celestial robes accompanied by a spirit beast with lotus ornaments',
    background: 'a sea of clouds, immortal mountains, ancient pavilions and towers, spiritual energy particles',
    color: 'color palette of deep blue, gold and black, cool tones with warm golden light accents',
    light: 'divine golden light rays, mystical mist, spiritual energy glow',
    titleFont: 'bold golden brush calligraphy with metallic glow and sharp strokes',
    authorFont:
      'small refined white serif text with faint golden glow, flanked by delicate cloud-scroll ornaments on both sides, resting on a thin horizontal gold line',
  },
  urban: {
    tag: 'modern urban contemporary style, clean cinematic composition',
    figure: 'a handsome man in a well-tailored suit with sharp confident features; or a fashionable woman in modern chic outfit with a confident expression',
    background: 'city skyline, upscale office, campus, neon-lit streets',
    color: 'color palette of deep blue, grey and gold, with neon or warm sunset accents',
    light: 'sharp city lights, sunset glow reflecting on glass buildings, neon rim light',
    titleFont: 'modern bold sans-serif with metallic silver finish',
    authorFont: 'small clean white modern text with subtle drop shadow, positioned above a thin silver horizontal divider line',
  },
  ancient: {
    tag: 'ancient Chinese romance palace drama, elegant classical beauty',
    figure: 'a noble woman in ornate embroidered hanfu with phoenix crown and swaying hair ornaments, exquisite makeup; or a dignified emperor or general',
    background: 'imperial palace, courtyard, red walls, beaded curtains, folding screens, lanterns',
    color: 'color palette of crimson red, gold and ink black, opulent and rich',
    light: 'warm lantern light, golden candle glow, silk fabric shimmering',
    titleFont: 'elegant golden traditional Kai script with ornate decoration',
    authorFont: 'small elegant dark red traditional text inside a thin golden rectangular border frame with corner decorations',
  },
  romance: {
    tag: 'character-driven romance cover art with editorial emotional realism',
    figure: 'two distinct protagonists shown through a story-specific gesture, distance, or consequence; never a generic posed couple',
    background: 'a concrete setting and visual motif drawn from the novel premise, never a stock romance backdrop',
    color: 'palette must follow the story emotion and setting; do not default to pink, warm white, or gold',
    light: 'lighting must follow the emotional temperature and location; avoid automatic dreamy bokeh and sunset glow',
    titleFont: 'mood-matched editorial title lettering with a distinctive but restrained treatment, never automatic pink glow',
    authorFont: 'small clean author lettering with color and weight matched to the chosen visual concept, no decorative heart motif',
  },
  mystery: {
    tag: 'dark mystery thriller, noir atmosphere, high contrast shadows',
    figure: 'a figure in silhouette or seen from behind with a half-hidden face, calm or tense expression',
    background: 'rainy night street, old buildings, secret room, dark alley',
    color: 'color palette of black, deep grey and dark blue, with blood red or cold white accents',
    light: 'dramatic chiaroscuro, single spotlight, rain-slicked reflections',
    titleFont: 'distorted bold cracked letters in blood red',
    authorFont: 'small pale grey text with slight blur effect, almost hidden in the shadows, a thin cracked line underneath',
  },
  scifi: {
    tag: 'sci-fi cyberpunk, futuristic technology, post-apocalyptic',
    figure: 'a figure in mech armor or tactical combat suit holding sci-fi weaponry, holographic interface floating beside',
    background: 'outer space, ruined city, laboratory, space station',
    color: 'color palette of deep blue, black and silver, with neon blue, electric purple or energy green accents',
    light: 'holographic blue glow, neon rim lighting, energy arcs',
    titleFont: 'neon glowing futuristic font in electric blue',
    authorFont: 'small crisp white monospace text with subtle cyan scanline overlay, flanked by small geometric brackets',
  },
  fantasy: {
    tag: 'western high fantasy, epic medieval atmosphere',
    figure: 'a knight in shining armor, a mage in flowing robes, or a ranger in leather, accompanied by a dragon or griffin',
    background: 'castle, dragon lair, magic circle, vast plains',
    color: 'color palette of deep blue, dark gold and silver white, with fire red or magic purple accents',
    light: 'magic spell glow, dramatic stormy sky, firelight from torches',
    titleFont: 'metallic embossed fantasy lettering with glow effect',
    authorFont: 'small bronze medieval script text with aged parchment texture, enclosed in a small decorative shield or banner shape',
  },
  historical: {
    tag: 'historical Chinese war epic, grand battlefield panorama',
    figure: 'a general in heavy armor holding a weapon, or a strategist in long robes with a determined gaze',
    background: 'battlefield, city walls, military camp, beacon fires',
    color: 'color palette of iron grey, dark red and earthy yellow, with golden armor sheen and beacon-fire orange accents',
    light: 'dramatic battlefield firelight, smoke-filled sky, sunset over war',
    titleFont: 'heavy stone-carved seal script in deep red',
    authorFont: 'small dignified white Song typeface text above a double horizontal line in dark red',
  },
  horror: {
    tag: 'Chinese supernatural horror, eerie ghostly atmosphere',
    figure: 'a taoist priest in ritual robes, or an ordinary person caught in a haunting, ghostly apparitions, paper figures, zombies',
    background: 'graveyard, ancient temple, dark alley, coffin',
    color: 'color palette of ink black, ghostly green and dark red, with paper white and candle yellow accents',
    light: 'eerie green glow, flickering candlelight, cold ghostly luminescence',
    titleFont: 'eerie dripping handwritten font in sickly green',
    authorFont: 'small faded grey-green text slightly tilted, with a thin dripping ink line above',
  },
  light: {
    tag: 'anime light novel cover, vibrant colorful moe style',
    figure: 'a cute chibi-style character with cat ears or wings, adorable moe features',
    background: 'fantasy world, school, other world, starry sky',
    color: 'bright multi-color palette with starlight and flower-petal accents',
    light: 'sparkly star effects, magical particle effects, soft luminous glow',
    titleFont: 'colorful cartoon outlined bubbly font',
    authorFont: 'small playful rounded white text with pastel color outline, tiny star decorations on both sides',
  },
}

const STYLE_PROMPTS: Record<ResolvedCoverStylePreset, string> = {
  cinematic:
    'cinematic concept art with a strong focal point, atmospheric depth, controlled lens perspective, layered foreground and background, premium film-poster finish',
  illustration:
    'editorial digital illustration with expressive shapes, intentional brushwork, elegant visual storytelling, refined silhouette design, contemporary book-jacket finish',
  ink: 'East Asian ink and color-wash illustration with expressive brush texture, restrained detail, organic negative space, paper grain, and poetic visual rhythm',
  minimal:
    'minimalist graphic poster with one memorable visual metaphor, disciplined geometry, generous negative space, restrained palette, and strong thumbnail readability',
  noir: 'noir photographic artwork with hard directional light, deep shadow, atmospheric grain, partial concealment, and a tense independent-film-poster mood',
  graphic:
    'modern graphic design with bold color blocking, layered typography-safe shapes, crisp editorial composition, tactile print texture, and a distinctive visual identity',
  soft_watercolor:
    'airy Chinese book-jacket watercolor with translucent peach, ivory, powder-blue, mint, or apricot washes, soft bleeding edges, paper grain, botanical or cloud-like textures, gentle atmosphere, and generous breathing room',
  moonlit_dream:
    'poetic moonlit watercolor with layered cobalt, powder blue, icy white, and muted lavender, misty clouds or distant silhouettes, soft luminous bloom, quiet night atmosphere, and an open area reserved for elegant title lettering',
  ancient_guochao:
    'refined Chinese guochao ancient-romance illustration with expressive hanfu costume and period architecture, controlled vermilion, jade, ink, and muted gold accents, decorative brush-calligraphy energy, layered ornamental detail, and a clear readable silhouette',
  romance_illustration:
    'polished commercial Chinese web-novel romance illustration with expressive character close-ups, story-specific relationship gestures, clean linework blended with painterly rendering, carefully designed hair and costume details, and a balanced contemporary palette',
  dark_cinematic:
    'dark cinematic romance or fantasy artwork with deep plum, navy, charcoal, and black, one controlled crimson or violet accent, dramatic rim light, partial silhouette, intimate tension, atmospheric grain, and premium film-poster restraint',
  pastel_romance:
    'soft pastel romance cover with blush, warm ivory, peach, pale lilac, and champagne tones, delicate fabric and floral or architectural details, gentle diffused light, elegant emotional intimacy, and a polished light web-novel finish',
  botanical_literary:
    'quiet botanical literary cover with sage, olive, moss, faded blue, and warm paper tones, layered leaves or translucent plant textures, organic brushwork, low visual noise, natural light, and a calm understated mood',
  minimal_typographic:
    'quiet minimalist literary cover with an ivory, white, or single pale-tint field, one subtle watercolor wash or symbolic texture, extremely generous negative space, a large elegant Chinese title as the primary graphic, and a small restrained author line',
}

const COMPOSITION_PROMPTS: Record<ResolvedCoverComposition, string> = {
  portrait: 'close portrait or half-body framing, expressive face and costume details as the primary focal point',
  duo: 'two characters arranged to show their relationship and tension, with clear separation and a readable emotional gesture',
  environment: 'wide environmental storytelling, a small but readable character placed inside a memorable world or location',
  symbolic: 'one story-defining object or motif in the foreground, with the character or setting implied through layered context',
  silhouette: 'recognizable silhouette or back view, strong negative space, atmospheric light outlining the subject, mysterious and restrained',
  off_center: 'asymmetrical off-center composition, intentional empty space for title placement, visual movement leading across the frame',
}

const GENRE_STYLE_POOLS: Record<Genre, ResolvedCoverStylePreset[]> = {
  xianxia: ['moonlit_dream', 'ink', 'ancient_guochao', 'cinematic', 'soft_watercolor', 'minimal_typographic'],
  urban: ['romance_illustration', 'dark_cinematic', 'minimal_typographic', 'graphic', 'soft_watercolor', 'pastel_romance'],
  ancient: ['ancient_guochao', 'soft_watercolor', 'pastel_romance', 'ink', 'cinematic', 'minimal_typographic'],
  romance: ['romance_illustration', 'soft_watercolor', 'pastel_romance', 'dark_cinematic', 'moonlit_dream', 'minimal_typographic'],
  mystery: ['dark_cinematic', 'noir', 'minimal_typographic', 'moonlit_dream', 'graphic', 'ink'],
  scifi: ['cinematic', 'graphic', 'dark_cinematic', 'moonlit_dream', 'minimal_typographic', 'illustration'],
  fantasy: ['cinematic', 'ancient_guochao', 'moonlit_dream', 'soft_watercolor', 'illustration', 'graphic'],
  historical: ['ancient_guochao', 'ink', 'cinematic', 'dark_cinematic', 'minimal_typographic', 'soft_watercolor'],
  horror: ['dark_cinematic', 'noir', 'ink', 'moonlit_dream', 'minimal_typographic', 'ancient_guochao'],
  light: ['pastel_romance', 'soft_watercolor', 'romance_illustration', 'graphic', 'moonlit_dream', 'minimal_typographic'],
}

const COMPOSITION_POOL: ResolvedCoverComposition[] = ['portrait', 'duo', 'environment', 'symbolic', 'silhouette', 'off_center']

export function isCoverStylePreset(value: unknown): value is CoverStylePreset {
  return typeof value === 'string' && COVER_STYLE_OPTIONS.some((option) => option.value === value)
}

export function isCoverComposition(value: unknown): value is CoverComposition {
  return typeof value === 'string' && COVER_COMPOSITION_OPTIONS.some((option) => option.value === value)
}

/**
 * 根据小说和 variationId 稳定选择一套视觉方向。
 * 同一 variation 可复现，variation 改变时至少会改变风格或构图，避免每次随机到不可追溯。
 */
export function resolveCoverDirection(args: {
  novelId: string
  genre: Genre
  stylePreset?: unknown
  composition?: unknown
  variationId?: string
}): CoverDirection {
  const seed = `${args.novelId || 'novel'}|${args.variationId || 'default'}|${args.genre}`
  const styleValue = isCoverStylePreset(args.stylePreset) ? args.stylePreset : 'auto'
  const compositionValue = isCoverComposition(args.composition) ? args.composition : 'auto'
  const stylePool = GENRE_STYLE_POOLS[args.genre] || GENRE_STYLE_POOLS.urban
  const stylePreset = styleValue === 'auto' ? pick(stylePool, stableHash(`${seed}|style`)) : styleValue
  const composition = compositionValue === 'auto' ? pick(COMPOSITION_POOL, stableHash(`${seed}|composition`)) : compositionValue
  return {
    stylePreset,
    composition,
    stylePrompt: STYLE_PROMPTS[stylePreset],
    compositionPrompt: COMPOSITION_PROMPTS[composition],
  }
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function pick<T>(items: T[], hash: number): T {
  return items[hash % items.length]!
}

/**
 * 平台版式约束。这里不再指定主视觉画风，避免平台选项覆盖题材风格和构图预设。
 * 'default' 为空串，表示只使用通用竖版 2:3。
 */
export const PLATFORM_STYLES: Record<CoverPlatform, string> = {
  default: '',
  fanqie: 'platform-safe portrait layout, strong thumbnail contrast, clear focal area, readable title-safe margins',
  qidian: 'platform-safe portrait layout, balanced visual hierarchy, refined title-safe margins, readable at small size',
  jinjiang: 'platform-safe portrait layout, generous title-safe negative space, delicate spacing, uncluttered hierarchy',
  zhihu: 'platform-safe portrait layout, restrained visual density, generous title-safe negative space, clear editorial hierarchy',
  qimao: 'platform-safe portrait layout, immediate focal point, bold readable silhouette, clear title-safe margins',
  ciweimao: 'platform-safe portrait layout, character-safe framing, readable silhouette, clear title-safe margins',
}

export function isCoverPlatform(value: unknown): value is CoverPlatform {
  return typeof value === 'string' && value in PLATFORM_STYLES
}

/**
 * 根据书名 + 分类推断题材。
 * - 命中计数：书名与分类里每出现一个题材关键词就累计分数；有语义的多字词权重更高
 * - 有命中 → 先取分数最高的题材，同分再按 GENRE_PRIORITY 取优先级
 * - 零命中 → 'urban'（与 skill「零命中默认都市」一致）
 */
export function inferGenres(title: string, categories: string[] = [], description = ''): Genre[] {
  const haystack = `${title || ''} ${(categories || []).join(' ')} ${description || ''}`
  const scores = new Map<Genre, number>()
  for (const genre of Object.keys(GENRE_KEYWORDS) as Genre[]) {
    const score = GENRE_KEYWORDS[genre].reduce((total, kw) => {
      if (!haystack.includes(kw)) return total
      // 「仙」和「剑」本身就是高辨识度题材锚点；其余单字权重较低，避免泛词压过多字题材词。
      return total + (kw.length >= 2 || kw === '仙' || kw === '剑' ? 2 : 1)
    }, 0)
    if (score > 0) scores.set(genre, score)
  }
  if (!scores.size) return ['urban']
  return [...scores.entries()]
    .sort(([genreA, scoreA], [genreB, scoreB]) => {
      if (scoreA !== scoreB) return scoreB - scoreA
      return GENRE_PRIORITY.indexOf(genreA) - GENRE_PRIORITY.indexOf(genreB)
    })
    .map(([genre]) => genre)
}

/** 兼容旧调用方：返回得分最高的主题材；需要复合题材时使用 inferGenres。 */
export function inferGenre(title: string, categories: string[] = [], description = ''): Genre {
  return inferGenres(title, categories, description)[0] || 'urban'
}
