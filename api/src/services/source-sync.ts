/**
 * 原作者源站同步：只同步小说元数据和章节目录，不抓取正文。
 * 章节匹配允许 1 个源站章节对应多个本地拆分章节。
 */
import { all, first, withTx } from '../db/query'
import type { Db } from '../db/pool'
import { newId } from './auth'
import { detectMeta } from './scraper/meta'
import { extractJjwxcTitles, extractPo18twTitles } from './scraper/enrich'
import type { FetchHtmlOptions, FetchResult } from './scraper/fetch'
import type { ScrapeStore } from './scraper/store'
import { getPo18Session } from './source-account'

export type SourceSyncConfidence = 'high' | 'medium' | 'low'

export interface SourceChapter {
  key: string
  order: number
  title: string
  url: string
}

export interface LocalChapterForSync {
  id: string
  order: number
  title: string
}

export interface SourceSyncChange {
  localChapterId: string
  localOrder: number
  oldTitle: string
  newTitle: string
  sourceOrder: number
  sourceTitle: string
  relation: 'one_to_one' | 'split' | 'merged'
  partIndex: number
  partCount: number
  confidence: SourceSyncConfidence
  eligible: boolean
}

export interface SourceSyncMapping {
  sourceChapterKey: string
  sourceOrder: number
  sourceTitle: string
  sourceUrl: string
  localChapterIds: string[]
  relation: 'one_to_one' | 'split' | 'merged'
  confidence: SourceSyncConfidence
}

export interface SourceSyncMetadata {
  title: string
  author: string
  description: string
  coverUrl: string
  category: string
  categories: string[]
  status: string
  sourceUrl: string
}

export interface SourceSyncPreview {
  runId: string
  bindingId: string
  novelId: string
  site: string
  sourceUrl: string
  metadata: SourceSyncMetadata
  sourceChapterCount: number
  localChapterCount: number
  splitLocalChapterCount: number
  matchedSourceCount: number
  unmatchedSource: SourceChapter[]
  unmatchedLocal: LocalChapterForSync[]
  mappings: SourceSyncMapping[]
  changes: SourceSyncChange[]
  onlyWeakTitles: boolean
  warnings: string[]
}

interface SourceBindingRow {
  id: string
  novel_id: string
  site: string
  source_url: string
  source_book_id: string
  source_type: string
  is_primary: number
  metadata_json: string
  last_synced_at: number
  last_error: string
  created_at: number
  updated_at: number
}

interface SourceSyncRunRow {
  id: string
  binding_id: string
  novel_id: string
  status: string
  only_weak_titles: number
  metadata_json: string
  source_chapters_json: string
  changes_json: string
  mapping_json: string
  local_snapshot_json: string
  created_at: number
  applied_at: number
}

const GENERIC_WEAK_TITLES = /^(?:正文|无标题|未命名|空标题)$/i
const INTRO_TITLES = /^(?:内容简介|作品简介|小说简介|文案|简介|楔子|序章|序言)$/i
const SPLIT_MARKER = /(?:[（(]\s*(\d+)\s*[/／]\s*(\d+)\s*[)）]|(?:[-_ ]+)?(?:part|pt)\s*(\d+)(?:\s*[/／]\s*(\d+))?)$/i
const ARABIC_NUMBER = /(?:第\s*)?(\d+)\s*(?:章|节|回|卷|集|部|篇)?/i
const CHINESE_NUMBER = /第\s*([零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+)\s*(?:章|节|回|卷|集|部|篇)?/i

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeUrl(sourceUrl: string): URL {
  const url = new URL(String(sourceUrl || '').trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('源站 URL 必须使用 HTTP 或 HTTPS')
  return url
}

function sourceSite(sourceUrl: string): 'jjwxc' | 'po18tw' | 'unsupported' {
  const host = normalizeUrl(sourceUrl).hostname.toLowerCase()
  if (/(^|\.)jjwxc\.net$/.test(host)) return 'jjwxc'
  if (/(^|\.)po18\.tw$/.test(host)) return 'po18tw'
  return 'unsupported'
}

function sourceBookId(url: URL): string {
  return url.searchParams.get('novelid') || url.pathname.match(/(?:book|books|novel|novels)[/_-]?(\d+)/i)?.[1] || ''
}

function cleanTitle(title: string): string {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitPart(title: string): { index: number; count: number } | null {
  const match = cleanTitle(title).match(SPLIT_MARKER)
  if (!match) return null
  const index = Number(match[1] || match[3])
  const count = Number(match[2] || match[4] || 0)
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || count < index) return null
  return { index, count }
}

function chineseNumberToArabic(value: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    壹: 1,
    贰: 2,
    叁: 3,
    肆: 4,
    伍: 5,
    陆: 6,
    柒: 7,
    捌: 8,
    玖: 9,
  }
  const units: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let number = 0
  for (const char of value) {
    if (digits[char] !== undefined) number = digits[char]!
    else if (units[char]) {
      const unit = units[char]!
      if (unit === 10000) {
        section = (section + number) * unit
        total += section
        section = 0
      } else {
        section += (number || 1) * unit
      }
      number = 0
    } else return null
  }
  return total + section + number || null
}

function chapterNumber(title: string): number | null {
  const text = cleanTitle(title)
  const arabic = text.match(ARABIC_NUMBER)
  if (arabic) return Number(arabic[1]) || null
  const chinese = text.match(CHINESE_NUMBER)
  return chinese ? chineseNumberToArabic(chinese[1]!) : null
}

function normalizedTitle(title: string): string {
  return cleanTitle(title)
    .replace(/^第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?\s*/i, '')
    .replace(/^chapter\s*\d+\s*/i, '')
    .replace(SPLIT_MARKER, '')
    .replace(/[【】「」『』《》]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
}

function isWeakTitle(title: string, order: number): boolean {
  const text = cleanTitle(title)
  if (!text || GENERIC_WEAK_TITLES.test(text)) return true
  if (/^chapter\s*\d+(?:\s*[/／]\s*\d+)?$/i.test(text)) return true
  const number = chapterNumber(text)
  return number === order && normalizedTitle(text) === ''
}

function appendSourceTitle(title: string, part: { index: number; count: number } | null): string {
  const base = cleanTitle(title).replace(SPLIT_MARKER, '').trim()
  return part && part.count > 1 ? `${base} (${part.index}/${part.count})` : base
}

interface LocalGroup {
  chapters: LocalChapterForSync[]
  explicitSplit: boolean
  declaredPartCount?: number
}

function groupLocalChapters(rows: LocalChapterForSync[]): LocalGroup[] {
  const groups: LocalGroup[] = []
  for (const row of rows) {
    const part = splitPart(row.title)
    const previous = groups[groups.length - 1]
    const previousChapter = previous?.chapters[previous.chapters.length - 1]
    const sameChapterNumber = Boolean(
      part && previousChapter && chapterNumber(row.title) !== null && chapterNumber(row.title) === chapterNumber(previousChapter.title),
    )
    const canContinueSplit = Boolean(
      part &&
      part.index > 1 &&
      previous &&
      previous.chapters.length < part.count &&
      part.index === previous.chapters.length + 1 &&
      (previous.declaredPartCount === undefined || previous.declaredPartCount === part.count) &&
      (previous.explicitSplit || sameChapterNumber),
    )
    if (canContinueSplit && previous) {
      previous.chapters.push(row)
      previous.explicitSplit = true
    } else if (part && part.count > 1) {
      groups.push({ chapters: [row], explicitSplit: true, declaredPartCount: part.count })
    } else {
      groups.push({ chapters: [row], explicitSplit: false })
    }
  }
  return groups
}

function groupScore(source: SourceChapter, group: LocalGroup): number {
  const first = group.chapters[0]!
  if (INTRO_TITLES.test(source.title) && INTRO_TITLES.test(first.title)) return 10
  let score = group.chapters.length > 1 ? 2 : 0
  const sourceNumber = chapterNumber(source.title)
  const localNumber = chapterNumber(first.title)
  if (sourceNumber !== null && localNumber !== null) score += sourceNumber === localNumber ? 8 : -5
  const s = normalizedTitle(source.title)
  const l = normalizedTitle(first.title)
  if (s && l && (s === l || s.includes(l) || l.includes(s))) score += 8
  if (isWeakTitle(first.title, first.order)) score += 3
  if (group.explicitSplit) score += 2
  return score
}

interface Alignment {
  sourceIndex: number
  groupIndex: number
  score: number
}

/** 以顺序为主、标题/编号为辅的序列对齐；拆分组已经先折叠为一个本地组。 */
function alignSourceAndLocal(source: SourceChapter[], groups: LocalGroup[]): Alignment[] {
  const n = source.length
  const m = groups.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  const step: Array<Array<'diag' | 'source' | 'local'>> = Array.from({ length: n + 1 }, () => Array<'diag' | 'source' | 'local'>(m + 1).fill('diag'))
  for (let i = 1; i <= n; i++) dp[i]![0] = dp[i - 1]![0]! - 3
  for (let j = 1; j <= m; j++) dp[0]![j] = dp[0]![j - 1]! - 2
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1]![j - 1]! + groupScore(source[i - 1]!, groups[j - 1]!)
      const skipSource = dp[i - 1]![j]! - 3
      const skipLocal = dp[i]![j - 1]! - 2
      if (diag >= skipSource && diag >= skipLocal) {
        dp[i]![j] = diag
        step[i]![j] = 'diag'
      } else if (skipLocal >= skipSource) {
        dp[i]![j] = skipLocal
        step[i]![j] = 'local'
      } else {
        dp[i]![j] = skipSource
        step[i]![j] = 'source'
      }
    }
  }
  const result: Alignment[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const current = step[i]![j]!
    if (current === 'diag') {
      result.push({ sourceIndex: i - 1, groupIndex: j - 1, score: groupScore(source[i - 1]!, groups[j - 1]!) })
      i--
      j--
    } else if (current === 'local') j--
    else i--
  }
  return result.reverse()
}

async function fetchSourceChapters(
  sourceUrl: string,
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>,
): Promise<{ site: string; chapters: SourceChapter[] }> {
  const site = sourceSite(sourceUrl)
  if (site === 'jjwxc') {
    const result = await extractJjwxcTitles(sourceUrl, fetchHtml)
    return { site: 'jjwxc', chapters: result.titles.map((item) => ({ key: item.url, order: item.order, title: cleanTitle(item.title), url: item.url })) }
  }
  if (site === 'po18tw') {
    const result = await extractPo18twTitles(sourceUrl, fetchHtml)
    return { site: 'po18tw', chapters: result.titles.map((item) => ({ key: item.url, order: item.order, title: cleanTitle(item.title), url: item.url })) }
  }
  throw new Error('目前支持的原作者源站为晋江和 PO18.tw；其他站点请继续使用手动粘贴标题')
}

async function fetchSourceMetadata(
  sourceUrl: string,
  store: ScrapeStore,
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>,
): Promise<{ metadata: SourceSyncMetadata; warning?: string }> {
  try {
    const result = await detectMeta(sourceUrl, { store, fetchHtml })
    const novel = result.novel
    return {
      metadata: {
        title: novel.title === '(未识别)' ? '' : novel.title,
        author: novel.author === '未知作者' ? '' : novel.author,
        description: novel.description || '',
        coverUrl: novel.coverUrl || '',
        category: novel.category || '',
        categories: novel.categories || [],
        status: novel.status || '',
        sourceUrl: novel.sourceUrl || sourceUrl,
      },
    }
  } catch (err) {
    return {
      metadata: { title: '', author: '', description: '', coverUrl: '', category: '', categories: [], status: '', sourceUrl },
      warning: `小说信息读取失败：${(err as Error).message}`,
    }
  }
}

async function ensureBinding(db: Db, novelId: string, sourceUrl: string, site: string): Promise<SourceBindingRow> {
  const url = normalizeUrl(sourceUrl)
  const now = Date.now()
  const existing = await first<SourceBindingRow>(db, 'SELECT * FROM novel_source_bindings WHERE novel_id = $1 AND source_url = $2', [novelId, url.href])
  if (existing) {
    await db.query('UPDATE novel_source_bindings SET is_primary = CASE WHEN id = $1 THEN 1 ELSE 0 END WHERE novel_id = $2', [existing.id, novelId])
    await db.query('UPDATE novel_source_bindings SET site = $1, source_book_id = $2, is_primary = 1, updated_at = $3 WHERE id = $4', [
      site,
      sourceBookId(url),
      now,
      existing.id,
    ])
    return { ...existing, site, source_book_id: sourceBookId(url), is_primary: 1, updated_at: now }
  }
  const id = newId('source')
  await db.query('UPDATE novel_source_bindings SET is_primary = 0 WHERE novel_id = $1', [novelId])
  await db.query(
    `INSERT INTO novel_source_bindings
      (id, novel_id, site, source_url, source_book_id, source_type, is_primary, metadata_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'canonical', 1, '{}', $6, $6)`,
    [id, novelId, site, url.href, sourceBookId(url), now],
  )
  return {
    id,
    novel_id: novelId,
    site,
    source_url: url.href,
    source_book_id: sourceBookId(url),
    source_type: 'canonical',
    is_primary: 1,
    metadata_json: '{}',
    last_synced_at: 0,
    last_error: '',
    created_at: now,
    updated_at: now,
  }
}

function sourceConfidence(score: number, group: LocalGroup): SourceSyncConfidence {
  if (group.chapters.length > 1 && group.explicitSplit && score >= 4) return 'high'
  if (score >= 8) return 'high'
  if (score >= 3) return 'medium'
  return 'low'
}

function buildPreview(
  sourceChapters: SourceChapter[],
  localChapters: LocalChapterForSync[],
  metadata: SourceSyncMetadata,
  onlyWeakTitles: boolean,
  base: { runId: string; bindingId: string; novelId: string; site: string; sourceUrl: string },
  warnings: string[],
): SourceSyncPreview {
  const groups = groupLocalChapters(localChapters)
  for (const group of groups) {
    if (group.declaredPartCount && group.chapters.length < group.declaredPartCount) {
      warnings.push(
        `本地拆分章节「${group.chapters[0]?.title || '未命名'}」只发现 ${group.chapters.length}/${group.declaredPartCount} 节，将只处理已发现的部分`,
      )
    }
  }
  const alignments = alignSourceAndLocal(sourceChapters, groups)
  const matchedSourceIndexes = new Set(alignments.map((item) => item.sourceIndex))
  const matchedGroupIndexes = new Set(alignments.map((item) => item.groupIndex))
  const changes: SourceSyncChange[] = []
  const mappings: SourceSyncMapping[] = []
  let splitLocalChapterCount = 0

  for (const alignment of alignments) {
    const source = sourceChapters[alignment.sourceIndex]!
    const group = groups[alignment.groupIndex]!
    const relation = group.chapters.length > 1 ? 'split' : 'one_to_one'
    const confidence = sourceConfidence(alignment.score, group)
    const partCount = group.chapters.length > 1 ? group.declaredPartCount || group.chapters.length : 1
    if (partCount > 1) splitLocalChapterCount += partCount
    mappings.push({
      sourceChapterKey: source.key,
      sourceOrder: source.order,
      sourceTitle: source.title,
      sourceUrl: source.url,
      localChapterIds: group.chapters.map((chapter) => chapter.id),
      relation,
      confidence,
    })
    group.chapters.forEach((local, index) => {
      const part = partCount > 1 ? { index: index + 1, count: partCount } : splitPart(local.title)
      const newTitle = appendSourceTitle(source.title, part)
      const eligible = confidence !== 'low' && (!onlyWeakTitles || isWeakTitle(local.title, local.order) || relation === 'split')
      if (newTitle !== local.title) {
        changes.push({
          localChapterId: local.id,
          localOrder: local.order,
          oldTitle: local.title,
          newTitle,
          sourceOrder: source.order,
          sourceTitle: source.title,
          relation,
          partIndex: part?.index || 1,
          partCount: part?.count || 1,
          confidence,
          eligible,
        })
      }
    })
  }

  return {
    ...base,
    metadata,
    sourceChapterCount: sourceChapters.length,
    localChapterCount: localChapters.length,
    splitLocalChapterCount,
    matchedSourceCount: matchedSourceIndexes.size,
    unmatchedSource: sourceChapters.filter((_, index) => !matchedSourceIndexes.has(index)),
    unmatchedLocal: groups.filter((_, index) => !matchedGroupIndexes.has(index)).flatMap((group) => group.chapters),
    mappings,
    changes,
    onlyWeakTitles,
    warnings,
  }
}

export async function createSourceSyncPreview(
  db: Db,
  opts: {
    novelId: string
    sourceUrl: string
    onlyWeakTitles?: boolean
    store: ScrapeStore
    fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>
    manualTitles?: string[]
  },
): Promise<SourceSyncPreview> {
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [opts.novelId])
  if (!novel) throw new Error('Novel not found')
  const url = normalizeUrl(opts.sourceUrl)
  const site = sourceSite(url.href)
  if (site === 'unsupported' && !opts.manualTitles?.length) {
    throw new Error('目前支持的原作者源站为晋江和 PO18.tw；其他站点请继续使用手动粘贴标题')
  }
  const binding = await ensureBinding(db, opts.novelId, url.href, site)
  const warnings: string[] = []
  let sourceFetchHtml = opts.fetchHtml
  if (site === 'po18tw') {
    const session = await getPo18Session(db)
    sourceFetchHtml = (targetUrl, fetchOpts = {}) => {
      const headers = new Headers(fetchOpts.headers)
      headers.set('Cookie', session.cookie)
      return opts.fetchHtml(targetUrl, { ...fetchOpts, headers, allowedRedirectHosts: ['po18.tw'] })
    }
  }
  const source = opts.manualTitles?.length
    ? {
        site: site === 'unsupported' ? 'manual' : site,
        chapters: opts.manualTitles.map((title, index) => ({ key: `manual:${index + 1}`, order: index + 1, title: cleanTitle(title), url: '' })),
      }
    : await fetchSourceChapters(url.href, sourceFetchHtml)
  const metadataResult = await fetchSourceMetadata(url.href, opts.store, sourceFetchHtml)
  if (metadataResult.warning) warnings.push(metadataResult.warning)
  const locals = await all<LocalChapterForSync>(db, 'SELECT id, sort_order AS order, title FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC', [
    opts.novelId,
  ])
  const runId = newId('sync')
  const preview = buildPreview(
    source.chapters,
    locals,
    metadataResult.metadata,
    opts.onlyWeakTitles !== false,
    {
      runId,
      bindingId: binding.id,
      novelId: opts.novelId,
      site: source.site,
      sourceUrl: url.href,
    },
    warnings,
  )
  const now = Date.now()
  await db.query(
    `INSERT INTO source_sync_runs
      (id, binding_id, novel_id, status, only_weak_titles, metadata_json, source_chapters_json, changes_json, mapping_json, local_snapshot_json, created_at)
     VALUES ($1, $2, $3, 'preview', $4, $5, $6, $7, $8, $9, $10)`,
    [
      runId,
      binding.id,
      opts.novelId,
      preview.onlyWeakTitles ? 1 : 0,
      JSON.stringify(preview.metadata),
      JSON.stringify(source.chapters),
      JSON.stringify(preview.changes),
      JSON.stringify(preview.mappings),
      JSON.stringify(locals),
      now,
    ],
  )
  await db.query('UPDATE novel_source_bindings SET metadata_json = $1, last_error = $2, updated_at = $3 WHERE id = $4', [
    JSON.stringify(preview.metadata),
    warnings.join('; '),
    now,
    binding.id,
  ])
  return preview
}

export async function listSourceBindings(db: Db, novelId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await all<SourceBindingRow>(db, 'SELECT * FROM novel_source_bindings WHERE novel_id = $1 ORDER BY is_primary DESC, updated_at DESC', [novelId])
  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    site: row.site,
    sourceUrl: row.source_url,
    sourceBookId: row.source_book_id,
    sourceType: row.source_type,
    isPrimary: row.is_primary === 1,
    metadata: safeJsonParse(row.metadata_json, {}),
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function applySourceSync(
  db: Db,
  opts: { runId: string; applyMetadata?: boolean; metadataFields?: string[]; metadataMode?: 'missing' | 'replace' },
): Promise<{ updated: number; metadataUpdated: string[]; mappings: number }> {
  const run = await first<SourceSyncRunRow>(db, 'SELECT * FROM source_sync_runs WHERE id = $1', [opts.runId])
  if (!run) throw new Error('同步预览不存在或已过期')
  if (run.status === 'applied') throw new Error('该同步预览已经应用过')
  const changes = safeJsonParse<SourceSyncChange[]>(run.changes_json, [])
  const mappings = safeJsonParse<SourceSyncMapping[]>(run.mapping_json, [])
  const metadata = safeJsonParse<SourceSyncMetadata>(run.metadata_json, {
    title: '',
    author: '',
    description: '',
    coverUrl: '',
    category: '',
    categories: [],
    status: '',
    sourceUrl: '',
  })
  const selectedFields = new Set(opts.metadataFields || [])
  const metadataUpdated: string[] = []
  const eligibleChanges = changes.filter((change) => change.eligible)
  const now = Date.now()

  await withTx(db, async (q) => {
    const novel = await q('SELECT title, author, description, cover_url, categories, status FROM novels WHERE id = $1', [run.novel_id])
    const novelRow = novel.rows[0] as Record<string, unknown> | undefined
    if (!novelRow) throw new Error('Novel not found')
    for (const change of eligibleChanges) {
      const current = await q('SELECT title FROM chapters WHERE id = $1 AND novel_id = $2', [change.localChapterId, run.novel_id])
      const currentRow = current.rows[0] as Record<string, unknown> | undefined
      if (!currentRow) throw new Error(`章节不存在：${change.localChapterId}`)
      if (String(currentRow.title || '') !== change.oldTitle) throw new Error(`章节「${change.oldTitle}」在预览后已发生变化，请重新预览`)
      await q('UPDATE chapters SET title = $1 WHERE id = $2 AND novel_id = $3', [change.newTitle, change.localChapterId, run.novel_id])
    }

    const currentNovel = novelRow
    const replaceMetadata = opts.metadataMode === 'replace'
    const canApply = (field: string, value: unknown, current: unknown): boolean => {
      if (!opts.applyMetadata || !selectedFields.has(field) || !value) return false
      if (replaceMetadata) return true
      if (field === 'categories') return !current || current === '[]'
      return !String(current || '').trim()
    }
    const nextTitle = canApply('title', metadata.title, currentNovel.title) ? metadata.title : currentNovel.title
    const nextAuthor = canApply('author', metadata.author, currentNovel.author) ? metadata.author : currentNovel.author
    const nextDescription = canApply('description', metadata.description, currentNovel.description) ? metadata.description : currentNovel.description
    const nextCover = canApply('coverUrl', metadata.coverUrl, currentNovel.cover_url) ? metadata.coverUrl : currentNovel.cover_url
    const nextCategories = canApply('categories', metadata.categories.length ? JSON.stringify(metadata.categories) : '', currentNovel.categories)
      ? JSON.stringify(metadata.categories)
      : currentNovel.categories
    const nextStatus = canApply('status', metadata.status, currentNovel.status) ? metadata.status : currentNovel.status
    if (nextTitle !== currentNovel.title) metadataUpdated.push('title')
    if (nextAuthor !== currentNovel.author) metadataUpdated.push('author')
    if (nextDescription !== currentNovel.description) metadataUpdated.push('description')
    if (nextCover !== currentNovel.cover_url) metadataUpdated.push('coverUrl')
    if (nextCategories !== currentNovel.categories) metadataUpdated.push('categories')
    if (nextStatus !== currentNovel.status) metadataUpdated.push('status')
    await q('UPDATE novels SET title = $1, author = $2, description = $3, cover_url = $4, categories = $5, status = $6, updated_at = $7 WHERE id = $8', [
      nextTitle,
      nextAuthor,
      nextDescription,
      nextCover,
      nextCategories,
      nextStatus,
      now,
      run.novel_id,
    ])
    for (const mapping of mappings) {
      const localIds = mapping.localChapterIds
      const partCount = localIds.length
      for (let index = 0; index < localIds.length; index++) {
        const localId = localIds[index]!
        const change = changes.find((item) => item.localChapterId === localId)
        await q(
          `INSERT INTO source_chapter_mappings
            (id, binding_id, sync_run_id, source_chapter_key, source_order, source_title, source_url, local_chapter_id, relation, part_index, part_count, confidence, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (sync_run_id, source_chapter_key, local_chapter_id) DO UPDATE SET
             source_title = EXCLUDED.source_title, source_url = EXCLUDED.source_url,
             relation = EXCLUDED.relation, part_index = EXCLUDED.part_index,
             part_count = EXCLUDED.part_count, confidence = EXCLUDED.confidence`,
          [
            newId('map'),
            run.binding_id,
            run.id,
            mapping.sourceChapterKey,
            mapping.sourceOrder,
            mapping.sourceTitle,
            mapping.sourceUrl,
            localId,
            mapping.relation,
            change?.partIndex || index + 1,
            change?.partCount || partCount,
            mapping.confidence,
            now,
          ],
        )
      }
    }
    await q('UPDATE source_sync_runs SET status = $1, applied_at = $2 WHERE id = $3', ['applied', now, run.id])
    await q("UPDATE novel_source_bindings SET last_synced_at = $1, last_error = '', updated_at = $1 WHERE id = $2", [now, run.binding_id])
  })
  return { updated: eligibleChanges.length, metadataUpdated, mappings: mappings.reduce((sum, mapping) => sum + mapping.localChapterIds.length, 0) }
}

export function sourceSyncTestHelpers() {
  return { splitPart, chapterNumber, normalizedTitle, groupLocalChapters, alignSourceAndLocal, buildPreview }
}
