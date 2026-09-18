// ============================================================
// Scrape Tab — shared helpers, constants, and small components
// ============================================================
import React from 'react'
import { authHeaders, operationHeaders, url } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { Badge } from '@/components/ui/badge'
import type { SelectOption } from '@/components/admin/CustomSelect'
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

// ---------- 榜单来源 ----------

/** 与 po18.tw 榜单表单的 kind 字段一一对应：人气 / 珍珠 / 订购 / 收藏 / 留言人气。 */
export type Po18RankingKind = 'sex' | 'pearl' | 'bestsale' | 'stocked' | 'mostcomments'
/** 与 po18.tw 榜单表单的 type 字段一一对应：周 / 月 / 总。 */
export type Po18RankingType = 'weekly' | 'monthly' | 'total'

/**
 * POPO 榜单入口。切换周/月/总是在页内提交 #rank-form1 到 /rank/more，
 * 并携带一次性 CSRF 字段与站点会话 Cookie；带 query 的 GET 会被拒，
 * 所以 kind/type 只能作为 POST 字段下发，不能拼进地址。
 */
export const POPO_RANKING_LIST_URL = 'https://www.po18.tw/rank/index'

export interface RankingOption extends SelectOption {
  /** 榜单实际请求地址：POPO 为表单页，po18x.vip 为静态榜单 URL。 */
  listUrl?: string
  ranking?: { kind: Po18RankingKind; type: Po18RankingType }
}

export const PO18_SITES: RankingOption[] = [
  { label: '日点击榜', value: 'https://wap.po18x.vip/top/dayvisit_1/', sub: 'po18x.vip' },
  { label: '周点击榜', value: 'https://wap.po18x.vip/top/weekvisit_1/', sub: 'po18x.vip' },
  { label: '月点击榜', value: 'https://wap.po18x.vip/top/monthvisit_1/', sub: 'po18x.vip' },
  { label: '总点击榜', value: 'https://wap.po18x.vip/top/allvisit_1/', sub: 'po18x.vip' },
  { label: '日推荐榜', value: 'https://wap.po18x.vip/top/dayvote_1/', sub: 'po18x.vip' },
  { label: '周推荐榜', value: 'https://wap.po18x.vip/top/weekvote_1/', sub: 'po18x.vip' },
  { label: '月推荐榜', value: 'https://wap.po18x.vip/top/monthvote_1/', sub: 'po18x.vip' },
  { label: '总推荐榜', value: 'https://wap.po18x.vip/top/allvote_1/', sub: 'po18x.vip' },
  { label: '总收藏榜', value: 'https://wap.po18x.vip/top/goodnum_1/', sub: 'po18x.vip' },
  { label: '字数排行', value: 'https://wap.po18x.vip/top/size_1/', sub: 'po18x.vip' },
  { label: '最新入库', value: 'https://wap.po18x.vip/top/postdate_1/', sub: 'po18x.vip' },
  { label: '最近更新', value: 'https://wap.po18x.vip/top/lastupdate_1/', sub: 'po18x.vip' },
]

const POPO_RANKINGS: Array<{ kind: Po18RankingKind; label: string }> = [
  { kind: 'sex', label: '人气榜' },
  { kind: 'pearl', label: '珍珠榜' },
  { kind: 'bestsale', label: '订购榜' },
  { kind: 'stocked', label: '收藏榜' },
  { kind: 'mostcomments', label: '留言人气榜' },
]

const POPO_PERIODS: Array<{ type: Po18RankingType; label: string }> = [
  { type: 'weekly', label: '周' },
  { type: 'monthly', label: '月' },
  { type: 'total', label: '总' },
]

/** 5 个榜单 × 周/月/总 = 15 项，值用 #popo/<kind>/<type> 保持唯一。 */
export const POPO_RANKING_SITES: RankingOption[] = POPO_RANKINGS.flatMap(({ kind, label }) =>
  POPO_PERIODS.map(({ type, label: period }) => ({
    value: `#popo/${kind}/${type}`,
    label: `POPO ${label} · ${period}`,
    sub: 'po18.tw',
    listUrl: POPO_RANKING_LIST_URL,
    ranking: { kind, type },
  })),
)

/** POPO 在前：它是本项目的原生来源，po18x.vip 榜单作为补充。 */
export const RANKING_SITES: RankingOption[] = [...POPO_RANKING_SITES, ...PO18_SITES]

/** 榜单下拉选中项 → 发现请求参数；自定义 URL 不在此处理。 */
export function resolveRankingSource(siteValue: string): { listUrl: string; rankingKind?: Po18RankingKind; rankingType?: Po18RankingType } | null {
  const option = RANKING_SITES.find((item) => item.value === siteValue)
  if (!option) return null
  return {
    listUrl: option.listUrl || option.value,
    ...(option.ranking ? { rankingKind: option.ranking.kind, rankingType: option.ranking.type } : {}),
  }
}

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
