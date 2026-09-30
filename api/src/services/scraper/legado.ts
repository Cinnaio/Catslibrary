/** 读取已保存的 Legado 规则，供抓取运行时匹配站点并构造选择器预设。 */

export function legadoHost(sourceUrl: string): string | null {
  if (!sourceUrl) return null
  let url = String(sourceUrl).trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url
  try {
    const parsed = new URL(url)
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  } catch {
    return null
  }
}

/** 行 → 与 SITE_PRESETS 对齐的 preset 对象。 */
export function sourceToPreset(
  row: Record<string, unknown> | null | undefined,
): { name: string; encoding: string; selectors: Record<string, string>; meta: Record<string, string> | null; source: unknown } | null {
  if (!row) return null
  let selectors: Record<string, string> = {}
  let meta: Record<string, string> = {}
  try {
    selectors = JSON.parse(String(row.selectors || '{}'))
  } catch {
    /* ignore */
  }
  try {
    meta = JSON.parse(String(row.meta_selectors || '{}'))
  } catch {
    /* ignore */
  }
  const isEmptyMeta = !meta || Object.keys(meta).every((key) => !meta[key])
  return {
    name: String(row.name || row.host || ''),
    encoding: String(row.encoding || 'utf-8'),
    selectors,
    meta: isEmptyMeta ? null : meta,
    source: row,
  }
}
