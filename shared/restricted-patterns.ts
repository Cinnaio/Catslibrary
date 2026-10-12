/**
 * 安全模式的判定基线 —— 限制级特征正则。
 *
 * 写入侧判级（新建、更新、存量预填）的文本信号。读取侧只认数据库字段。
 *
 * 注意：这是枚举法，对开放集合天然不完备（P0-3 实测 43 个样本标签漏网 37 个）。
 * 它的定位是初判信号，不是人工复核的替代品；补文本规则一律加在这里。
 */
export const RESTRICTED_PATTERNS: RegExp[] = [
  /成人/i,
  /色情/i,
  /情色/i,
  /肉文/i,
  /肉梗/i,
  /多肉/i,
  /吃肉/i,
  /福利文/i,
  /限制级/i,
  /涉黄/i,
  /未删减/i,
  /18\s*禁/i,
  /未满\s*18/i,
  /未成年/i,
  /露骨/i,
  /性描写/i,
  /性爱/i,
  /艳情/i,
  /工口/i,
  /黄暴/i,
  /重口(?:味)?/i,
  /纯肉|肉肉|后期肉|前期.*后期.*肉/i,
  /调教|监禁|强制爱|床上|含进身体|发出禁忌|养成妹妹/i,
  /性幻想|性行为|性侵|性器|性欲|无套|双处/i,
  /乳晕|亲密行为|滚到一起|做了吗|剧情.*肉/i,
  /觊觎|阴暗.*变态|强取豪夺/i,
  /强奸|强X|轮奸|乱伦/i,
  /被操|操得|操她|操我|操死|肏她|肏我/i,
  /高\s*h|h\s*高/i,
  /b\s*d\s*s\s*m|\bsm\b/i,
  /r\s*[-_]?\s*18/i,
  /18\s*\+/i,
  /h\s*文/i,
]

/** 参与写入侧文本初判的字段；分类标签由独立的精确枚举处理。 */
export interface RestrictedTextSource {
  title?: string
  description?: string
}

/**
 * 正文采样信号词 —— 只负责「把可能含限制级内容的章节挑出来」，**不直接产出分级**。
 *
 * 与 `RESTRICTED_PATTERNS` 的分工必须区分清楚：
 *   - `RESTRICTED_PATTERNS` 跑在标题/简介上，命中即 `restricted`（写入侧初判）。
 *   - 本表跑在正文上，只用于给 LLM 定位采样章节；误伤的代价是多花几百 token，
 *     而不是把一本正常作品错标成 R18。所以这里允许收宽一些的弱信号词。
 *
 * 权重语义：3 = 直白性器官/性行为/体液描写，几乎只出现在成人向正文；
 * 1 = 语境依赖（「湿透」「高潮」「穴」在武侠、医学、剧情语境里同样常见）。
 * 采样排序用权重之和，因此强信号章节永远优先进入样本。
 */
export interface RestrictedBodyKeyword {
  keyword: string
  weight: 1 | 3
}

const STRONG_BODY_KEYWORDS = [
  '阴茎',
  '阳具',
  '肉棒',
  '龟头',
  '阴唇',
  '肉唇',
  '阴蒂',
  '阴道',
  '乳尖',
  '奶头',
  '性器',
  '性器官',
  '花穴',
  '肉穴',
  '淫穴',
  '蜜穴',
  '骚穴',
  '菊穴',
  '后穴',
  '下体',
  '私处',
  '淫水',
  '淫液',
  '爱液',
  '蜜液',
  '白浊',
  '精液',
  '阴精',
  '抽插',
  '交合',
  '云雨',
  '做爱',
  '性爱',
  '射精',
  '内射',
  '开苞',
  '破处',
  '口交',
  '舔弄',
  '吸吮',
  '吞吐',
  '淫荡',
  '骚货',
  '呻吟',
  '娇喘',
  '浪叫',
  '肏',
  '屄',
  '骚逼',
  '淫叫',
  '淫乱',
  '裸体',
  '全裸',
  '乳房',
  '酥胸',
  '乳肉',
  '顶弄',
  '抽送',
  '肉缝',
  '肉壁',
  '穴口',
  '双腿间',
  '情液',
  '春潮',
  '媚肉',
  '花心深处',
] as const

const WEAK_BODY_KEYWORDS = [
  '高潮',
  '情欲',
  '欲火',
  '缠绵',
  '亲吻',
  '抚摸',
  '爱抚',
  '喘息',
  '颤栗',
  '酥麻',
  '湿透',
  '香汗',
  '娇吟',
  '春色',
  '媚眼',
  '赤裸',
  '腰肢',
  '承欢',
  '侍寝',
  '双修',
  '采补',
  '合欢',
  '情动',
  '腿间',
  '胸口',
  '湿了',
  '硬了',
  '穴',
  '乳',
  '骚',
  // 药物与生理词：办案、医疗、宫斗剧情里同样常见（「体内检出催情药物」不是色情描写），
  // 因此只能做采样信号，不能当直白证据。
  '发情',
  '催情',
  '春药',
  '媚药',
] as const

/** 正文采样信号词全表。强信号在前，便于按权重排序与测试断言稳定。 */
export const RESTRICTED_BODY_KEYWORDS: readonly RestrictedBodyKeyword[] = [
  ...STRONG_BODY_KEYWORDS.map((keyword) => ({ keyword, weight: 3 as const })),
  ...WEAK_BODY_KEYWORDS.map((keyword) => ({ keyword, weight: 1 as const })),
]

/**
 * 单段正文里出现的信号词，按强度分组。
 *
 * 强弱必须分开呈现给审核员：弱词（「胸口」「湿了」「腰肢」）在正常剧情里同样常见，
 * 命中只代表「这段值得让模型看一眼」。如果界面把强弱词混在一起展示，审核员会把
 * 弱词的误报读成判级依据——那正是这套机制要避免的事。
 */
export function matchRestrictedBodyKeywordGroups(text: string): { strong: string[]; weak: string[] } {
  const strong: string[] = []
  const weak: string[] = []
  if (!text) return { strong, weak }
  for (const { keyword, weight } of RESTRICTED_BODY_KEYWORDS) {
    if (!text.includes(keyword)) continue
    if (weight === 3) strong.push(keyword)
    else weak.push(keyword)
  }
  return { strong, weak }
}

/** 单段正文里出现的信号词（去重、保序）。 */
export function matchRestrictedBodyKeywords(text: string): string[] {
  const { strong, weak } = matchRestrictedBodyKeywordGroups(text)
  return [...strong, ...weak]
}

/** 单段正文的信号强度合计，用于挑选最可能含成人内容的章节。 */
export function scoreRestrictedBodyText(text: string): number {
  if (!text) return 0
  let score = 0
  for (const { keyword, weight } of RESTRICTED_BODY_KEYWORDS) {
    if (text.includes(keyword)) score += weight
  }
  return score
}

/** 单条标题或简介文本是否命中限制级特征。 */
export function matchesRestrictedPattern(text: string): boolean {
  if (!text) return false
  return RESTRICTED_PATTERNS.some((pattern) => pattern.test(text))
}

/** 标题与简介拼成一段文本后判定。 */
export function hasRestrictedText(metadata: RestrictedTextSource | null | undefined): boolean {
  if (!metadata) return false
  const text = [metadata.title, metadata.description].filter(Boolean).join(' ')
  return matchesRestrictedPattern(text)
}
