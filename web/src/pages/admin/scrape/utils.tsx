// ============================================================
// Scrape Tab — shared helpers, constants, and small components
// ============================================================
import React from 'react'
import { authHeaders, operationHeaders, url } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { DEFAULT_COVER_PATH } from '@shared/covers'

// ---------- helpers ----------

/** scrapeApi 未覆盖的发现、榜单和辅助动作走此 POST。 */
export async function scrapePost(body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const operationId = typeof body.operationId === 'string' ? body.operationId : ''
  const res = await fetch(url('/scrape'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...operationHeaders(operationId), ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  return data
}

/** 逗号/顿号分隔分类字符串 → 去重数组（大小写不敏感）。 */
export function parseCategories(input: string): string[] {
  if (!input) return []
  const seen = new Set<string>()
  return input
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s || seen.has(s.toLowerCase())) return false
      seen.add(s.toLowerCase())
      return true
    })
}

/** 日志时间戳可能是数值或 ISO 字符串。 */
export function fmtLogTime(ts: number | string | undefined): string {
  if (ts == null) return ''
  const t = Number(ts)
  if (Number.isFinite(t) && t > 0) return formatDateTime(t)
  return String(ts)
}

export { DEFAULT_COVER_PATH as FALLBACK_COVER } from '@shared/covers'

// ---------- small components ----------

export function coverOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  if (img.src !== new URL(DEFAULT_COVER_PATH, img.ownerDocument.baseURI).href) {
    img.src = DEFAULT_COVER_PATH
    return
  }
  img.style.display = 'none'
  const p = img.parentElement
  if (p) p.classList.add('discover-card__cover--broken', 'is-broken')
}
