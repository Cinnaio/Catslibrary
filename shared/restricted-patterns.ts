/**
 * 安全模式的判定基线 —— 限制级特征正则。
 *
 * 这份列表同时服务两处，因此必须留在 shared 而不是 web：
 *   1. 前台 `isRestrictedContent` 的兜底判定（`contentRating === 'unknown'` 时回落）
 *   2. 存量分级的正则预填（`POST /api/novels {action:'prefill-content-rating'}`）
 * 一旦各留一份，「预填结果」与「前台判定」就会出现两套口径，而这正是方案 B 要消除的
 * 那类不可验证状态。
 *
 * 注意：这是枚举法，对开放集合天然不完备（P0-3 实测 43 个样本标签漏网 37 个）。
 * 它的定位是「未标注期间的等价兜底」，不是判定终点；补规则一律加在这里。
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

/** 参与判定的小说文本字段。与 `ContentMetadata` 结构兼容。 */
export interface RestrictedTextSource {
  title?: string
  description?: string
  categories?: string[]
}

/** 单条文本是否命中限制级特征（用于分类名等纯字符串场景）。 */
export function matchesRestrictedPattern(text: string): boolean {
  if (!text) return false
  return RESTRICTED_PATTERNS.some((pattern) => pattern.test(text))
}

/** 标题 / 简介 / 分类拼成一段文本后判定。 */
export function hasRestrictedText(metadata: RestrictedTextSource | string | null | undefined): boolean {
  if (!metadata) return false
  if (typeof metadata === 'string') return matchesRestrictedPattern(metadata)
  const text = [metadata.title, metadata.description, ...(metadata.categories || [])].filter(Boolean).join(' ')
  return matchesRestrictedPattern(text)
}
