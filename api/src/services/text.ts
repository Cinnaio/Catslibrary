/**
 * 路由层共用的文本清洗 / 参数钳制 / 垃圾内容启发式。
 * 原先在 comments/thoughts/ratings/admin 各自复制一份，这里收敛为单一实现。
 */

/** 去控制字符、折叠空白、裁剪长度。 */
export function cleanText(value: unknown, max: number): string {
  return String(value || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** 解析整数查询参数并钳制到 [min, max]，非法输入返回 fallback。 */
export function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value || '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 垃圾内容启发式：链接数超限或同字符长串重复。
 * maxLinks 按场景配置：段评（短文本）默认 1，长评论可放宽到 3。
 */
export function looksLikeSpam(text: string, maxLinks = 1): boolean {
  const links = (text.match(/https?:\/\//gi) || []).length
  if (links > maxLinks) return true
  if (/(.)\1{12,}/.test(text)) return true
  return false
}

/**
 * 转义 LIKE/ILIKE 模式中的通配符（% _ \），使用户输入按字面匹配。
 * PostgreSQL 默认转义字符即反斜杠，无需额外 ESCAPE 子句。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
