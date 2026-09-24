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
