import { cleanLegacyEntry, LEGACY_READING_LIMIT, normalizeLegacyReadingData, type LegacyReadingData } from '@shared/reading-data'

const keys = ['novel_bookmarks', 'novel_reading_history', 'novel_bookshelf'] as const
export function readLegacyReadingData() {
  const data: LegacyReadingData = { bookmarks: [], progress: [], bookshelf: [] }
  const raw: string[] = []
  let invalid = 0
  const errors: string[] = []
  for (const key of keys) {
    let text: string | null
    try {
      text = localStorage.getItem(key)
    } catch {
      errors.push('浏览器不允许读取本地数据')
      break
    }
    raw.push(text || '')
    if (!text) continue
    try {
      const parsed: unknown = JSON.parse(text)
      const isHistory = key === 'novel_reading_history'
      if (isHistory ? !parsed || typeof parsed !== 'object' || Array.isArray(parsed) : !Array.isArray(parsed)) {
        errors.push(`${isHistory ? '阅读历史' : key === 'novel_bookmarks' ? '书签' : '书架'}格式无法识别`)
        continue
      }
      const values: unknown[] = isHistory
        ? Object.entries(parsed as Record<string, unknown>).map(([novelId, value]) =>
            value && typeof value === 'object' && !Array.isArray(value) ? { novelId, ...value } : value,
          )
        : (parsed as unknown[])
      const target = isHistory ? 'progress' : key === 'novel_bookmarks' ? 'bookmarks' : 'bookshelf'
      const kind = target === 'bookmarks' ? 'bookmark' : target
      if (values.length > LEGACY_READING_LIMIT) {
        errors.push(`单类超过 ${LEGACY_READING_LIMIT} 条，当前无法一次恢复；原始数据仍保留在浏览器中`)
        continue
      }
      for (const value of values) {
        const entry = cleanLegacyEntry(value, kind)
        if (entry) data[target].push(entry)
        else invalid++
      }
    } catch {
      errors.push('部分旧数据无法解析，原始内容仍保留在浏览器中')
    }
  }
  return { data: normalizeLegacyReadingData(data)!, fingerprint: JSON.stringify(raw), invalid, errors }
}
