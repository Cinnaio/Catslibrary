/** FNV-1a 段落锚点：阅读器与划选图片接口使用同一个规范化与哈希实现。 */
export function hashParagraphText(text: string): string {
  let h = 2166136261
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
