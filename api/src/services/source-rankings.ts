import type { Db } from '../db/pool'
import { discoverList } from './scraper/enrich'
import { makeDeps } from './scraper/runtime'
import { getPresetForUrl } from './scraper/store'
import { adapterById, adapterForUrl, sourceFetcher } from './scraper/sources'

// Only these existing source presets are published in the reader's discovery area.
const featuredRankings = {
  po18: ['po18-dayvisit', 'po18-weekvisit', 'po18-monthvisit'],
  fanqie: ['fanqie-0-2-267', 'fanqie-1-2-261', 'fanqie-0-2-249', 'fanqie-1-2-1140'],
  po18tw: ['popo-sex-weekly', 'popo-sex-monthly', 'popo-pearl-weekly'],
}

interface SnapshotEntry {
  rank: number
  url: string
  title: string
  author: string
  description: string
}

interface SnapshotRow {
  source_id: string
  ranking_id: string
  refreshed_at: number
  entries: SnapshotEntry[]
}

function configuredRankings() {
  return Object.entries(featuredRankings).flatMap(([sourceId, ids]) => {
    const source = adapterById(sourceId)
    return ids.flatMap(rankingId => {
      const preset = source?.rankings?.find(ranking => ranking.id === rankingId)
      if (!source || !preset) return []
      return [{ id: `${sourceId}:${rankingId}`, sourceId, sourceName: source.name, label: preset.label, preset }]
    })
  })
}

async function readSnapshots(db: Db) {
  const { rows } = await db.query<SnapshotRow>('SELECT source_id, ranking_id, refreshed_at, entries FROM source_ranking_snapshots')
  return new Map(rows.map(row => [`${row.source_id}:${row.ranking_id}`, row]))
}

export async function refreshSourceRankings(db: Db) {
  const rankings = configuredRankings()
  if (!rankings.length) return
  const snapshots = await readSnapshots(db)
  const deps = makeDeps(db)
  for (const ranking of rankings) {
    const startedAt = Date.now()
    if (startedAt - (snapshots.get(ranking.id)?.refreshed_at ?? 0) < 60 * 60_000) continue
    try {
      const result = await discoverList(ranking.preset.listUrl, {
        db,
        fetchHtml: sourceFetcher(db, deps.fetchHtml),
        getPreset: url => getPresetForUrl(url, deps.store),
        includeRankingDetails: false,
      }, ranking.preset)
      const seen = new Set<string>()
      const entries = result.novels.slice(0, 100).flatMap((book, index): SnapshotEntry[] => {
        if (!book.title.trim() || !sourceUrlVariants(book.url).length || seen.has(book.url)) return []
        seen.add(book.url)
        return [{
          rank: index + 1, url: book.url, title: book.title, author: book.author,
          description: book.description.slice(0, 2000),
        }]
      })
      // An upstream login page or changed markup can look like an empty ranking.
      if (!entries.length) continue
      await db.query(`INSERT INTO source_ranking_snapshots(source_id, ranking_id, entries, refreshed_at)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (source_id, ranking_id) DO UPDATE SET entries=EXCLUDED.entries, refreshed_at=EXCLUDED.refreshed_at
        WHERE source_ranking_snapshots.refreshed_at < EXCLUDED.refreshed_at`,
      [ranking.sourceId, ranking.preset.id, JSON.stringify(entries), startedAt])
    } catch (error) {
      console.warn('[source-rankings] refresh failed', ranking.id, error instanceof Error ? error.name : 'unknown')
    }
  }
}

interface LinkedNovel {
  source_url: string
  id: string
  title: string
  author: string
  updated_at: number
  readable: boolean
}

interface RankingEntry {
  rank: number
  title: string
  author: string
  novelId?: string
  updatedAt?: number
  sourceUrl?: string
  description?: string
}

function sourceUrlVariants(value: string) {
  const url = URL.parse(value)
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return []
  const aliases = adapterForUrl(value)?.rankingBookAliases?.(url) ?? []
  return [url, ...aliases.map(alias => new URL(alias))].flatMap(candidate => {
    const path = candidate.pathname.replace(/\/$/, '')
    return ['https:', 'http:'].flatMap(protocol => [path, `${path}/`].map(pathname =>
      `${protocol}//${candidate.host}${pathname}${candidate.search}`))
  })
}

export async function readSourceRankings(db: Db, options: {
  rankingId: string | undefined
  visibilitySql: string
  canViewRestricted: boolean
  includeUncollected: boolean
}) {
  const rankings = configuredRankings()
  if (!rankings.length) return { rankings: [], selectedId: null, entries: [] }
  const snapshots = await readSnapshots(db)
  const variants = new Map<string, string[]>()
  for (const ranking of rankings) {
    for (const entry of snapshots.get(ranking.id)?.entries ?? []) {
      if (!variants.has(entry.url)) variants.set(entry.url, sourceUrlVariants(entry.url))
    }
  }

  const urls = [...new Set([...variants.values()].flat())]
  const linked = new Map<string, LinkedNovel[]>()
  if (urls.length) {
    // Keep inaccessible matches in SQL results so they cannot fall through as uncollected entries.
    const { rows } = await db.query<LinkedNovel>(`WITH matching_urls AS (
      SELECT source_url, id AS novel_id FROM novels WHERE source_url=ANY($1::text[])
      UNION SELECT source_url, novel_id FROM novel_source_bindings WHERE source_url=ANY($1::text[])
      UNION SELECT source_url, novel_id FROM scrape_configs WHERE source_url=ANY($1::text[])
    )
    SELECT m.source_url, n.id, n.title, n.author, n.updated_at,
      (${options.visibilitySql} AND ($2::boolean OR COALESCE(n.content_rating, 'unknown') <> 'restricted')) AS readable
    FROM matching_urls m JOIN novels n ON n.id=m.novel_id`, [urls, options.canViewRestricted])
    for (const row of rows) {
      const matches = linked.get(row.source_url) ?? []
      matches.push(row)
      linked.set(row.source_url, matches)
    }
  }

  const available = rankings.flatMap(ranking => {
    const snapshot = snapshots.get(ranking.id)
    const entries = (snapshot?.entries ?? []).flatMap((entry): RankingEntry[] => {
      const matches = new Map((variants.get(entry.url) ?? []).flatMap(url => linked.get(url) ?? [])
        .map(novel => [novel.id, novel]))
      if (matches.size === 1) {
        const novel = matches.values().next().value!
        if (!novel.readable) return []
        return [{ rank: entry.rank, title: novel.title, author: novel.author, novelId: novel.id, updatedAt: novel.updated_at }]
      }
      if (matches.size || !options.includeUncollected) return []
      return [{ rank: entry.rank, title: entry.title, author: entry.author, sourceUrl: entry.url, description: entry.description }]
    })
    return [{ id: ranking.id, sourceId: ranking.sourceId, sourceName: ranking.sourceName, label: ranking.label,
      refreshedAt: snapshot?.refreshed_at ?? null, entries }]
  })
  const selected = options.rankingId === undefined
    ? available.find(ranking => ranking.entries.length) ?? available[0]
    : available.find(ranking => ranking.id === options.rankingId)
  return {
    rankings: available.map(({ entries: _entries, ...ranking }) => ranking),
    selectedId: selected?.id ?? null,
    entries: options.rankingId === undefined ? selected?.entries.slice(0, 3) ?? [] : selected?.entries ?? [],
  }
}
