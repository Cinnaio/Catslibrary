// ============================================================
// Scrape Tab — shared helpers, constants, and small components
// ============================================================
import React from 'react'
import { authHeaders, operationHeaders, url } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { Badge } from '@/components/ui/badge'
import type { SourceRow } from './types'

// ---------- helpers ----------

/** scrapeApi 未覆盖的 /scrape 动作（test/discover/list-sources/import-legado 等）走此 POST。 */
export async function scrapePost(body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const operationId = typeof body.operationId === 'string' ? body.operationId : ''
  const res = await fetch(url('/scrape'), {
    method: 'POST',
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

/** PO18 封面兜底：从 /book/<id> 推导。 */
export function po18CoverFallback(sourceUrl: string): string {
  const m = (sourceUrl || '').match(/\/book\/(\d+)/)
  if (!m) return ''
  const id = parseInt(m[1] || '', 10)
  return `https://img.po18x.vip/image/${Math.floor(id / 1000)}/${m[1]}/${m[1]}s.jpg`
}

// ---------- constants ----------

export const PO18_SITES = [
  { label: '日点击榜', value: 'https://wap.po18x.vip/top/dayvisit_1/' },
  { label: '周点击榜', value: 'https://wap.po18x.vip/top/weekvisit_1/' },
  { label: '月点击榜', value: 'https://wap.po18x.vip/top/monthvisit_1/' },
  { label: '总点击榜', value: 'https://wap.po18x.vip/top/allvisit_1/' },
  { label: '日推荐榜', value: 'https://wap.po18x.vip/top/dayvote_1/' },
  { label: '周推荐榜', value: 'https://wap.po18x.vip/top/weekvote_1/' },
  { label: '月推荐榜', value: 'https://wap.po18x.vip/top/monthvote_1/' },
  { label: '总推荐榜', value: 'https://wap.po18x.vip/top/allvote_1/' },
  { label: '总收藏榜', value: 'https://wap.po18x.vip/top/goodnum_1/' },
  { label: '字数排行', value: 'https://wap.po18x.vip/top/size_1/' },
  { label: '最新入库', value: 'https://wap.po18x.vip/top/postdate_1/' },
  { label: '最近更新', value: 'https://wap.po18x.vip/top/lastupdate_1/' },
]

export const FALLBACK_COVER = 'https://wap.po18x.vip/17mb/style/noimg.jpg'

// ---------- small components ----------

export function supportBadge(support: string | undefined) {
  const label = support === 'full' ? '可用' : support === 'partial' ? '需核验' : '不支持'
  const cls =
    support === 'full'
      ? 'bg-success/10 text-success'
      : support === 'partial'
        ? 'bg-warning/10 text-warning'
        : 'bg-secondary text-muted-foreground'
  return <Badge className={cls}>{label}</Badge>
}

export function connectivityBadge(connectivity: SourceRow['connectivity']) {
  if (connectivity === 'reachable') return <Badge className="bg-success/10 text-success">可连接</Badge>
  if (connectivity === 'unreachable') return <Badge className="bg-destructive/10 text-destructive">不可访问</Badge>
  return <Badge variant="secondary">未检测</Badge>
}

export function coverOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  if (img.src !== FALLBACK_COVER) {
    img.src = FALLBACK_COVER
    return
  }
  img.style.display = 'none'
  const p = img.parentElement
  if (p) p.classList.add('discover-card__cover--broken')
}
