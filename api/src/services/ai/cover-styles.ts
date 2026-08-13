/**
 * 小说封面视觉风格知识库 —— 由 story-cover skill 的 cover-styles.md 萃取为 TS 常量。
 * 供 buildImagePrompt 组装题材风格标签、平台调性、书名/作者名字体层。
 * 纯数据 + 纯函数（inferGenre 可单测），不触碰 DB / 网络。
 */

/** 支持的题材。多题材命中时按 GENRE_PRIORITY 取一，零命中回落 'urban'。 */
export type Genre = 'xianxia' | 'urban' | 'ancient' | 'romance' | 'mystery' | 'scifi' | 'fantasy' | 'historical' | 'horror' | 'light'

/** 支持的平台风格。'default' 表示通用竖版，不叠加平台调性。 */
export type CoverPlatform = 'default' | 'fanqie' | 'qidian' | 'jinjiang' | 'zhihu' | 'qimao' | 'ciweimao'

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
 * 题材推断规则：关键词命中即计入该题材。
 * 多题材命中按 GENRE_PRIORITY 优先级取一；零命中回落 'urban'。
 */
const GENRE_KEYWORDS: Record<Genre, string[]> = {
  xianxia: ['仙', '道', '剑', '灵', '修', '宗', '天', '帝', '尊', '神', '玄幻', '仙侠', '修真', '洪荒'],
  urban: ['都市', '总裁', '校园', '重生', '系统', '学霸', '医生', '兵王', '战神', '赘婿'],
  ancient: ['妃', '皇', '侯', '宫', '嫡', '庶', '后', '朝', '凤', '鸾', '宫斗', '古言'],
  romance: ['契约', '替嫁', '甜宠', '娇妻', '萌宝', '闪婚', '现言', '暗恋', '婚'],
  mystery: ['诡', '案', '侦探', '悬疑', '推理', '密室', '连环', '罪', '谜'],
  scifi: ['星际', '末世', '机甲', '赛博', '废土', '进化', '科幻', '星', '宇宙'],
  fantasy: ['龙', '骑', '魔法', '异世界', '精灵', '领主', '西幻', '魔', '骑士'],
  historical: ['三国', '大明', '大唐', '战场', '将军', '谋士', '历史', '军事', '权谋'],
  horror: ['鬼', '僵尸', '阴阳', '风水', '盗墓', '咒', '灵异', '恐怖', '诡秘'],
  light: ['萌', '喵', '团宠', '娇', '转生', '轻小说', '二次元'],
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
    tag: 'modern romance cover art, soft dreamy warm atmosphere',
    figure: 'a couple in a tender intimate interaction, embracing, gazing at each other or holding hands',
    background: 'café, garden, cozy interior, sunset beach',
    color: 'color palette of pink, warm white and light gold, warm and gentle',
    light: 'soft warm backlighting, dreamy bokeh, gentle sunset glow',
    titleFont: 'soft rounded handwritten style in white with pink glow',
    authorFont: 'small soft pink-white handwritten text with a tiny heart motif on the left side, light sparkle effect',
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

/** 平台风格调性关键词。'default' 为空串，表示不叠加平台专属风格。 */
export const PLATFORM_STYLES: Record<CoverPlatform, string> = {
  default: '',
  fanqie: 'vibrant saturated colors, eye-catching bold design, character portrait dominating frame, mass-market novel cover style, high contrast',
  qidian: 'polished refined illustration, detailed cinematic composition, epic atmospheric, mature sophisticated style, premium quality',
  jinjiang: 'dreamy ethereal aesthetic, soft pastel tones, elegant romantic, delicate beauty, flower petals and bokeh',
  zhihu: 'minimalist literary style, clean composition with negative space, subtle moody atmosphere, independent film poster aesthetic',
  qimao: 'striking high-impact design, vivid dramatic colors, spectacular visual effects, attention-grabbing poster style',
  ciweimao: 'anime illustration style, vibrant colorful, detailed character art, Japanese light novel aesthetic',
}

export function isCoverPlatform(value: unknown): value is CoverPlatform {
  return typeof value === 'string' && value in PLATFORM_STYLES
}

/**
 * 根据书名 + 分类推断题材。
 * - 命中计数：书名与分类里每出现一个题材关键词就给对应题材 +1
 * - 有命中 → 在命中题材中按 GENRE_PRIORITY 取优先级最高者
 * - 零命中 → 'urban'（与 skill「零命中默认都市」一致）
 */
export function inferGenre(title: string, categories: string[] = []): Genre {
  const haystack = `${title || ''} ${(categories || []).join(' ')}`
  const hits = new Set<Genre>()
  for (const genre of Object.keys(GENRE_KEYWORDS) as Genre[]) {
    if (GENRE_KEYWORDS[genre].some((kw) => haystack.includes(kw))) hits.add(genre)
  }
  if (!hits.size) return 'urban'
  for (const genre of GENRE_PRIORITY) {
    if (hits.has(genre)) return genre
  }
  return 'urban'
}
