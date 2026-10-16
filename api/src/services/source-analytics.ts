import type { Db } from '../db/pool'
import { all } from '../db/query'
import { hasFollowupSource } from './novel-followup-defaults'
import { getPendingChapterCounts } from './novel-update-summary'
import {
  FOLLOWUP_LABELS,
  SOURCE_LABELS,
  type FollowupCategory,
  type SourceAnalyticsBook,
  type SourceAnalyticsGroup,
  type SourceAnalyticsResponse,
} from '../../../shared/source-analytics'
const emptyCounts = () => ({ enabled: 0, paused: 0, completed: 0, unconfigured: 0, available: 0 })
function source(value: unknown): { url: string; host: string } | null {
  try {
    const url = new URL(String(value || ''))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return { url: url.href, host: url.hostname.toLowerCase().replace(/^www\./, '') }
  } catch {
    return null
  }
}

/** 统计只读取来源和配置；完整配置不是实时可访问性的证明。 */
export async function getSourceAnalytics(db: Db, query: Record<string, string>, now = Date.now()): Promise<SourceAnalyticsResponse> {
  const rows = await all<Record<string, unknown>>(
    db,
    `
    SELECT n.id,n.title,n.author,n.status,n.chapter_count,n.cover_url,n.updated_at,n.source_url AS novel_source,
      c.source_url AS config_source,c.selectors,
      f.enabled,f.user_configured,f.interval_hours,f.checked_at,f.next_check_at,f.result,f.message,f.failures,
      EXISTS (SELECT 1 FROM scrape_jobs j WHERE j.novel_id=n.id AND j.status NOT IN ('completed','partial','failed','cancelled')) AS active,
      COALESCE((SELECT json_agg(json_build_object('url',b.source_url,'kind',b.source_type) ORDER BY b.is_primary DESC,b.id)
        FROM novel_source_bindings b WHERE b.novel_id=n.id), '[]'::json) AS bindings
    FROM novels n LEFT JOIN scrape_configs c ON c.novel_id=n.id LEFT JOIN novel_followups f ON f.novel_id=n.id
  `,
  )
  const pending = await getPendingChapterCounts(
    db,
    rows.map((r) => String(r.id)),
  )
  const books: SourceAnalyticsBook[] = rows.map((r) => {
    const config = source(r.config_source),
      novel = source(r.novel_source)
    const bindings = (r.bindings as Array<{ url: string; kind: string }>).flatMap((b) => {
      const s = source(b.url)
      return s ? [{ ...s, kind: b.kind === 'canonical' ? '原作者来源' : '绑定来源' }] : []
    })
    const sources = [...(config ? [{ ...config, kind: '抓取来源' }] : []), ...(novel ? [{ ...novel, kind: '作品来源' }] : []), ...bindings].filter(
      (s, index, list) => list.findIndex((x) => x.url === s.url) === index,
    )
    const primary = config || novel || bindings[0]
    const configured = hasFollowupSource(r.config_source as string | null, r.selectors as string | null)
    const enabled = Boolean(r.enabled && (r.status === 'ongoing' || r.user_configured))
    const category: FollowupCategory = enabled
      ? 'enabled'
      : r.user_configured && !r.enabled
        ? 'paused'
        : r.status !== 'ongoing'
          ? 'completed'
          : !configured
            ? 'unconfigured'
            : 'available'
    const active = Boolean(r.active),
      result = active ? 'running' : String(r.result || 'idle')
    const counts = pending.get(String(r.id))
    return {
      id: String(r.id),
      title: String(r.title),
      author: String(r.author || ''),
      status: String(r.status),
      chapterCount: Number(r.chapter_count),
      coverUrl: (r.cover_url as string) || null,
      sourceUrl: primary?.url || '',
      site: primary?.host || '__none__',
      sources,
      sourceCategory: configured ? 'configured' : sources.length ? 'link' : 'none',
      followupCategory: category,
      attention: enabled && !active && (!configured || ['failed', 'partial', 'pending', 'protected'].includes(result)),
      active,
      intervalHours: Number(r.interval_hours || 6),
      checkedAt: Number(r.checked_at || 0),
      nextCheckAt: enabled ? Number(r.next_check_at || 0) : 0,
      result,
      message: !configured && enabled ? '追更已开启，但抓取配置不完整' : String(r.message || ''),
      failures: r.failures == null ? null : Number(r.failures),
      pending: counts?.pendingChapterCount ?? null,
      protected: counts?.pendingProtectedChapterCount ?? null,
      updatedAt: Number(r.updated_at),
    }
  })
  const view = query.view === 'all' ? 'all' : 'primary'
  const sitesFor = (b: SourceAnalyticsBook) => (view === 'primary' ? [b.site] : b.sources.length ? [...new Set(b.sources.map((s) => s.host))] : ['__none__'])
  const groups = new Map<string, SourceAnalyticsGroup>(),
    followups = emptyCounts()
  for (const book of books) {
    followups[book.followupCategory]++
    for (const site of sitesFor(book)) {
      const group = groups.get(site) || { site, total: 0, configured: 0, link: 0, none: 0, followups: emptyCounts(), attention: 0 }
      group.total++
      group[book.sourceCategory]++
      group.followups[book.followupCategory]++
      group.attention += Number(book.attention)
      groups.set(site, group)
    }
  }
  const search = (query.search || '').trim().toLowerCase()
  const filtered = books.filter(
    (b) =>
      (!search || `${b.title}\n${b.author}`.toLowerCase().includes(search)) &&
      (!query.site || sitesFor(b).includes(query.site)) &&
      (!Object.hasOwn(SOURCE_LABELS, query.source || '') || b.sourceCategory === query.source) &&
      (query.followup === 'attention' ? b.attention : !Object.hasOwn(FOLLOWUP_LABELS, query.followup || '') || b.followupCategory === query.followup) &&
      (!['ongoing', 'completed'].includes(query.status || '') || b.status === query.status) &&
      (!query.result || b.result === query.result),
  )
  filtered.sort((a, b) => {
    if (query.sort === 'title') return a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)
    if (query.sort === 'next') return (a.nextCheckAt || Number.MAX_SAFE_INTEGER) - (b.nextCheckAt || Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
    if (query.sort === 'pending') return (b.pending ?? -1) - (a.pending ?? -1) || a.id.localeCompare(b.id)
    if (query.sort === 'updated') return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
    return b.checkedAt - a.checkedAt || a.id.localeCompare(b.id)
  })
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 15)))
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit)),
    page = Math.min(totalPages, Math.max(1, Math.floor(Number(query.page) || 1)))
  return {
    snapshotAt: now,
    view,
    total: books.length,
    withSource: books.filter((b) => b.sources.length).length,
    configured: books.filter((b) => b.sourceCategory === 'configured').length,
    attention: books.filter((b) => b.attention).length,
    followups,
    groups: [...groups.values()].sort((a, b) => b.total - a.total || a.site.localeCompare(b.site)),
    books: filtered.slice((page - 1) * limit, page * limit),
    filteredTotal: filtered.length,
    totalPages,
    page,
    limit,
  }
}
