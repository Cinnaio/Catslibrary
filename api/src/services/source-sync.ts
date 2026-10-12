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
import { applyContentRatingChange, CONTENT_RATING_RULE_VERSION } from './content-rating-governance'
import { evaluateContentRatingRules, loadContentRatingRuleSet } from './content-rating-rules'
import { toContentRating } from '../db/mappers'

export type SourceSyncConfidence = 'high' | 'medium' | 'low'
export type SourceSyncMatchReason = 'exact-title' | 'chapter-number' | 'title-overlap' | 'sequence' | 'manual'
export interface SourceSyncManualMapping { localChapterId: string; sourceChapterKey: string | null }

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
  matchReason?: SourceSyncMatchReason
  matchEvidence?: string
}

export interface SourceSyncMapping {
  sourceChapterKey: string
  sourceOrder: number
  sourceTitle: string
  sourceUrl: string
  localChapterIds: string[]
  relation: 'one_to_one' | 'split' | 'merged'
  confidence: SourceSyncConfidence
  matchReason?: SourceSyncMatchReason
  matchEvidence?: string
}

export interface SourceSyncOrderChange {
  localChapterId: string
  title: string
  oldOrder: number
  newOrder: number
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
  orderChanges: SourceSyncOrderChange[]
  orderRepairBlockedReason?: string
  orderRepairSkipped?: Array<{ localChapterId: string; reason: string; blockingChapterIds?: string[] }>
  revision?: number
  sourceChapters?: SourceChapter[]
  localChapters?: LocalChapterForSync[]
  manualMappings?: SourceSyncManualMapping[]
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
  revision?: number
  manual_mappings_json?: string
  applied_changes_json?: string
  history_summary?: string
  rollback_result_json?: string
}

interface AppliedChapterChange {
  kind: 'chapter'
  id: string
  before: { title: string; order: number }
  after: { title: string; order: number }
}
const NOVEL_SNAPSHOT_FIELDS = ['title', 'author', 'description', 'cover_url', 'categories', 'status', 'content_rating', 'content_rating_revision'] as const
interface AppliedMetadataChange { kind: 'metadata'; before: Record<string, unknown>; after: Record<string, unknown> }
type AppliedSyncChange = AppliedChapterChange | AppliedMetadataChange
export interface SourceSyncRollbackResult { runId: string; restored: number; conflicts: Array<{ id: string; title: string; reason: string }> }

const GENERIC_WEAK_TITLES = /^(?:正文|无标题|未命名|空标题)$/i
const INTRO_TITLES = /^(?:内容简介|作品简介|小说简介|文案|简介|楔子|序章|序言)$/i
const SPLIT_MARKER = /(?:[（(]\s*(\d+)\s*[/／]\s*(\d+)\s*[)）]|(?:[-_ ]+)?(?:part|pt)\s*(\d+)(?:\s*[/／]\s*(\d+))?)$/i
const EXTRA_NUMBER = /(?:番外|外传)\s*(?:第\s*)?([0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+)/i
const ARABIC_NUMBER = /^第\s*(\d+)(?=\s|[章节回卷集部篇]|$)/i
const EXTRA_TITLE = /番外|外传/i
const CHINESE_NUMBER = /^第\s*([零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+)\s*(?:章|节|回|卷|集|部|篇)?/i

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

function parseNumberToken(value: string): number | null {
  const normalized = value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
  if (/^\d+$/.test(normalized)) return Number(normalized) || null
  return chineseNumberToArabic(normalized)
}

function chapterNumber(title: string): number | null {
  const text = cleanTitle(title).normalize('NFKC')
  // 导入器可能添加「第0011章」，作者原题却以「10.」开头；优先使用内层作者编号。
  const withoutImportPrefix = text.replace(/^第\s*\d+\s*[章节回卷集部篇]\s*/, '')
  const innerNumber = withoutImportPrefix.match(/^(\d+(?:\.\d+)?)(?:[.、:：]|\s)/)
  if (innerNumber) return Number(innerNumber[1])
  const english = text.match(/^chapter\s*(\d+)\b/i)
  if (english) return Number(english[1]) || null
  const extra = text.match(EXTRA_NUMBER)
  if (extra) return parseNumberToken(extra[1]!)
  const arabic = text.match(ARABIC_NUMBER)
  if (arabic) return Number(arabic[1]) || null
  const chinese = text.match(CHINESE_NUMBER)
  return chinese ? chineseNumberToArabic(chinese[1]!) : null
}

function isExtraTitle(title: string): boolean {
  return EXTRA_TITLE.test(cleanTitle(title))
}

function normalizedTitle(title: string): string {
  return cleanTitle(title).normalize('NFKC')
    .replace(/^第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?\s*/i, '')
    .replace(/^chapter\s*\d+\s*/i, '')
    // 清除目录序号及作者编号，支持「38 36.5 论坛番外」这样的多层前缀。
    .replace(/^(?:\d+(?:\.\d+)?(?:[.、:：]\s*|\s+))+/, '')
    .replace(SPLIT_MARKER, '')
    .replace(/[【】「」『』《》]/g, '')
    .toLocaleLowerCase()
    .replace(/[\s.,，。:：!！?？、]/g, '')
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
    const currentTitle = normalizedTitle(row.title)
    const previousTitle = previousChapter ? normalizedTitle(previousChapter.title) : ''
    const compatibleTitle = previousChapter && (
      currentTitle && previousTitle ? currentTitle === previousTitle : sameChapterNumber
    )
    const canContinueSplit = Boolean(
      part &&
      part.index > 1 &&
      previous &&
      previous.chapters.length < part.count &&
      part.index === previous.chapters.length + 1 &&
      (previous.declaredPartCount === undefined || previous.declaredPartCount === part.count) &&
      compatibleTitle &&
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
  const s = normalizedTitle(source.title)
  const l = normalizedTitle(first.title)
  // 完整标题一致比导入编号更可靠，缺章或插入公告也不能使它让位给相邻编号。
  if (s && l && s === l) return 24 + (group.explicitSplit ? 2 : 0)
  if (isExtraTitle(source.title) !== isExtraTitle(first.title)) return -8
  let score = group.chapters.length > 1 ? 2 : 0
  const sourceNumber = chapterNumber(source.title)
  const localNumber = chapterNumber(first.title)
  const titleContains = Boolean(s && l && (s.includes(l) || l.includes(s)))
  // 编号冲突且标题无对应关系时，跳过两侧章节的代价为 -5，不能以同分强行配对。
  if (sourceNumber !== null && localNumber !== null) {
    if (sourceNumber !== localNumber && !titleContains) return -6
    score += sourceNumber === localNumber ? 8 : -5
  }
  if (titleContains) score += 8
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
function alignInOrder(source: SourceChapter[], groups: LocalGroup[], allowed: (sourceIndex: number, groupIndex: number) => boolean): Alignment[] {
  const n = source.length
  const m = groups.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  const step: Array<Array<'diag' | 'source' | 'local'>> = Array.from({ length: n + 1 }, () => Array<'diag' | 'source' | 'local'>(m + 1).fill('diag'))
  for (let i = 1; i <= n; i++) dp[i]![0] = dp[i - 1]![0]! - 3
  for (let j = 1; j <= m; j++) dp[0]![j] = dp[0]![j - 1]! - 2
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = allowed(i - 1, j - 1) ? dp[i - 1]![j - 1]! + groupScore(source[i - 1]!, groups[j - 1]!) : -Infinity
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

/** 唯一完整标题先独立定位，允许纠正已有乱序；其余章节仍受已知标题边界约束。 */
function alignSourceAndLocal(source: SourceChapter[], groups: LocalGroup[]): Alignment[] {
  const titleIndexes = (titles: string[]) => {
    const indexes = new Map<string, number[]>()
    titles.forEach((title, index) => {
      const key = normalizedTitle(title)
      if (!key || isWeakTitle(title, chapterNumber(title) || 0)) return
      indexes.set(key, [...(indexes.get(key) || []), index])
    })
    return indexes
  }
  const sourceTitles = titleIndexes(source.map(row => row.title))
  const localTitles = titleIndexes(groups.map(group => group.chapters[0]!.title))
  const anchors: Alignment[] = []
  for (const [key, sourceIndexes] of sourceTitles) {
    const localIndexes = localTitles.get(key)
    if (sourceIndexes.length !== 1 || localIndexes?.length !== 1) continue
    const sourceIndex = sourceIndexes[0]!
    const groupIndex = localIndexes[0]!
    anchors.push({ sourceIndex, groupIndex, score: groupScore(source[sourceIndex]!, groups[groupIndex]!) })
  }
  const anchoredSource = new Set(anchors.map(row => row.sourceIndex))
  const anchoredLocal = new Set(anchors.map(row => row.groupIndex))
  const sourceIndexes = source.map((_, index) => index).filter(index => !anchoredSource.has(index))
  const localIndexes = groups.map((_, index) => index).filter(index => !anchoredLocal.has(index))
  const bounds = localIndexes.map(groupIndex => {
    let lower = -1
    let upper = source.length
    for (const anchor of anchors) {
      if (anchor.groupIndex < groupIndex) lower = Math.max(lower, anchor.sourceIndex)
      else upper = Math.min(upper, anchor.sourceIndex)
    }
    return { lower, upper }
  })
  const rest = alignInOrder(sourceIndexes.map(index => source[index]!), localIndexes.map(index => groups[index]!), (s, l) =>
    sourceIndexes[s]! > bounds[l]!.lower && sourceIndexes[s]! < bounds[l]!.upper,
  ).map(row => ({ ...row, sourceIndex: sourceIndexes[row.sourceIndex]!, groupIndex: localIndexes[row.groupIndex]! }))
  return [...anchors, ...rest].sort((a, b) => a.sourceIndex - b.sourceIndex)
}

function buildOrderRepair(mappings: SourceSyncMapping[], locals: LocalChapterForSync[], source: SourceChapter[]): {
  orderChanges: SourceSyncOrderChange[]; orderRepairBlockedReason?: string
  orderRepairSkipped: Array<{ localChapterId: string; reason: string; blockingChapterIds?: string[] }>
} {
  const orderRepairSkipped: Array<{ localChapterId: string; reason: string; blockingChapterIds?: string[] }> = []
  const count = (values: string[]) => {
    const counts = new Map<string, number>()
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1))
    return counts
  }
  const localTitles = count(locals.map(row => normalizedTitle(row.title)))
  const sourceTitles = count(source.map(row => normalizedTitle(row.title)))
  const sourceOrders = count(source.map(row => String(row.order)))
  const mappedSources = count(mappings.map(row => row.sourceChapterKey))
  const byLocal = new Map<string, SourceSyncMapping[]>()
  mappings.forEach(mapping => mapping.localChapterIds.forEach(id => byLocal.set(id, [...(byLocal.get(id) || []), mapping])))
  const candidates = new Map<string, SourceSyncOrderChange>()
  for (const local of locals) {
    const matches = byLocal.get(local.id) || []
    const mapping = matches[0]
    let reason = ''
    if (!mapping) reason = (localTitles.get(normalizedTitle(local.title)) || 0) > 1
      ? '本地存在重复完整标题，请先核查重复章节'
      : '尚未匹配，不能确定源站序号'
    else if (mapping.relation !== 'one_to_one' || mapping.localChapterIds.length !== 1) reason = '拆分章节不能直接使用源站序号'
    else if (matches.length !== 1 || mappedSources.get(mapping.sourceChapterKey) !== 1) reason = '章节对应关系不唯一'
    else if (mapping.confidence !== 'high') reason = '匹配证据不足，请先核对映射'
    else {
      const title = normalizedTitle(local.title)
      if ((localTitles.get(title) || 0) > 1) {
        reason = '本地存在重复完整标题，请先核查重复章节'
      } else if ((sourceTitles.get(normalizedTitle(mapping.sourceTitle)) || 0) > 1) {
        reason = '源站存在重复完整标题，不能唯一确定序号'
      } else if (!title || title !== normalizedTitle(mapping.sourceTitle) || isWeakTitle(local.title, local.order)) {
        reason = '序号修复需要唯一且完整一致的标题'
      } else if (!Number.isSafeInteger(mapping.sourceOrder) || mapping.sourceOrder < 1 || sourceOrders.get(String(mapping.sourceOrder)) !== 1) {
        reason = '源站序号重复或无效'
      }
    }
    if (reason) orderRepairSkipped.push({ localChapterId: local.id, reason })
    else if (mapping && mapping.sourceOrder !== local.order) candidates.set(local.id, { localChapterId: local.id, title: local.title, oldOrder: local.order, newOrder: mapping.sourceOrder })
  }
  const skippedById = new Map(orderRepairSkipped.map(row => [row.localChapterId, row]))
  const localById = new Map(locals.map(row => [row.id, row]))
  // 只允许目标位置为空或其占用章节也能在本次修复中移走；保留交换和连续偏移。
  let removed = true
  while (removed) {
    removed = false
    for (const [id, change] of candidates) {
      const blockers = locals.filter(local => local.id !== id && local.order === change.newOrder && !candidates.has(local.id))
      if (blockers.length) {
        candidates.delete(id)
        // 沿连续偏移追到真正无法移走的章节，而不是只提示下一章。
        const blockingChapterIds = [...new Set(blockers.flatMap(local => skippedById.get(local.id)?.blockingChapterIds || [local.id]))]
        const details = blockingChapterIds.map(blockerId => {
          const local = localById.get(blockerId)!
          return `本地 ${local.order}「${local.title}」（${skippedById.get(blockerId)?.reason || '序号保持不变'}）`
        }).join('；')
        const skipped = { localChapterId: id, blockingChapterIds, reason: `目标序号 ${change.newOrder} 的移动依赖受阻：${details}` }
        skippedById.set(id, skipped)
        orderRepairSkipped.push(skipped)
        removed = true
      }
    }
  }
  const orderChanges = [...candidates.values()].sort((a, b) => a.newOrder - b.newOrder)
  return {
    orderChanges, orderRepairSkipped,
    ...(!orderChanges.length && orderRepairSkipped.length ? { orderRepairBlockedReason: '当前没有可独立修复的序号，请查看映射列表中的未修复原因。' } : {}),
  }
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
  throw new Error('目前支持的原作者源站为晋江和 PO18.tw')
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

function matchExplanation(source: SourceChapter, group: LocalGroup, manual: boolean): { matchReason: SourceSyncMatchReason; matchEvidence: string } {
  if (manual) return { matchReason: 'manual', matchEvidence: '管理员指定的对应关系，应用标题前仍需勾选确认。' }
  const local = group.chapters[0]!
  const s = normalizedTitle(source.title)
  const l = normalizedTitle(local.title)
  if (s && l && s === l) return { matchReason: 'exact-title', matchEvidence: '清理导入编号、空白和常见标点后，完整标题一致。' }
  const number = chapterNumber(source.title)
  if (number !== null && number === chapterNumber(local.title)) return { matchReason: 'chapter-number', matchEvidence: `两侧章节编号均为 ${number}；请核对标题差异。` }
  if (s && l && (s.includes(l) || l.includes(s))) return { matchReason: 'title-overlap', matchEvidence: '标题仅部分重合，结合相邻章节核对。' }
  return { matchReason: 'sequence', matchEvidence: '依据相邻已匹配章节和目录顺序推断，缺少完整标题或编号证据。' }
}

function buildPreview(
  sourceChapters: SourceChapter[],
  localChapters: LocalChapterForSync[],
  metadata: SourceSyncMetadata,
  onlyWeakTitles: boolean,
  base: { runId: string; bindingId: string; novelId: string; site: string; sourceUrl: string },
  warnings: string[],
  manualMappings: SourceSyncManualMapping[] = [],
): SourceSyncPreview {
  const groups = groupLocalChapters(localChapters)
  const seenOrders = new Set<number>()
  const duplicateOrders = new Set<number>()
  localChapters.forEach(chapter => {
    if (seenOrders.has(chapter.order)) duplicateOrders.add(chapter.order)
    seenOrders.add(chapter.order)
  })
  if (duplicateOrders.size) warnings.push(`本地存在重复序号：${[...duplicateOrders].sort((a, b) => a - b).join('、')}。已优先按完整标题匹配，请核对序号修复预览。`)
  for (const group of groups) {
    if (group.declaredPartCount && group.chapters.length < group.declaredPartCount) {
      warnings.push(
        `本地拆分章节「${group.chapters[0]?.title || '未命名'}」只发现 ${group.chapters.length}/${group.declaredPartCount} 节，将只处理已发现的部分`,
      )
    }
  }
  const overridden = new Set(manualMappings.map(row => row.localChapterId))
  const manualSourceKeys = new Set(manualMappings.map(row => row.sourceChapterKey).filter((key): key is string => key !== null))
  const alignments = alignSourceAndLocal(sourceChapters, groups).filter(row =>
    !groups[row.groupIndex]!.chapters.some(chapter => overridden.has(chapter.id)) && !manualSourceKeys.has(sourceChapters[row.sourceIndex]!.key),
  )
  for (const manual of manualMappings) {
    if (manual.sourceChapterKey === null) continue
    const sourceIndex = sourceChapters.findIndex(row => row.key === manual.sourceChapterKey)
    const groupIndex = groups.findIndex(group => group.chapters.some(row => row.id === manual.localChapterId))
    if (sourceIndex < 0 || groupIndex < 0 || groups[groupIndex]!.chapters.length !== 1 || groups[groupIndex]!.explicitSplit) throw new Error('人工映射目标无效或属于拆分章节')
    alignments.push({ sourceIndex, groupIndex, score: 24 })
  }
  alignments.sort((a, b) => a.sourceIndex - b.sourceIndex)
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
    const manual = overridden.has(group.chapters[0]!.id)
    const explanation = matchExplanation(source, group, manual)
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
      ...explanation,
    })
    group.chapters.forEach((local, index) => {
      const part = partCount > 1 ? { index: index + 1, count: partCount } : splitPart(local.title)
      const newTitle = appendSourceTitle(source.title, part)
      const eligible = !manual && confidence !== 'low' && (!onlyWeakTitles || isWeakTitle(local.title, local.order) || relation === 'split')
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
          ...explanation,
        })
      }
    })
  }

  return {
    ...base,
    revision: 0,
    sourceChapters,
    localChapters,
    manualMappings,
    ...buildOrderRepair(mappings, localChapters, sourceChapters),
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
  },
): Promise<SourceSyncPreview> {
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [opts.novelId])
  if (!novel) throw new Error('Novel not found')
  const url = normalizeUrl(opts.sourceUrl)
  const site = sourceSite(url.href)
  if (site === 'unsupported') throw new Error('目前支持的原作者源站为晋江和 PO18.tw')
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
  const source = await fetchSourceChapters(url.href, sourceFetchHtml)
  const metadataResult = await fetchSourceMetadata(url.href, opts.store, sourceFetchHtml)
  if (metadataResult.warning) warnings.push(metadataResult.warning)
  const locals = await all<LocalChapterForSync>(db, 'SELECT id, sort_order AS order, title FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC, id ASC', [
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

function assertSyncRevision(run: SourceSyncRunRow, revision: unknown) {
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('预览版本无效，请重新读取源站')
  if (Number(run.revision || 0) !== revision) throw new Error('预览版本已发生变化，请重新读取源站')
}

function sameCatalog(snapshot: LocalChapterForSync[], current: LocalChapterForSync[]): boolean {
  const byId = new Map(current.map(row => [row.id, row]))
  return snapshot.length === current.length && snapshot.every(row => {
    const latest = byId.get(row.id)
    return latest && latest.title === row.title && latest.order === row.order
  })
}

export async function remapSourceSync(db: Db, opts: { runId: string; revision: number; manualMappings: SourceSyncManualMapping[] }): Promise<SourceSyncPreview> {
  return withTx(db, async q => {
    const result = await q<SourceSyncRunRow>('SELECT * FROM source_sync_runs WHERE id=$1 FOR UPDATE', [opts.runId])
    const run = result.rows[0]
    if (!run || run.status !== 'preview') throw new Error('同步预览不存在或已应用，请重新读取源站')
    assertSyncRevision(run, opts.revision)
    const locals = safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, [])
    const sources = safeJsonParse<SourceChapter[]>(run.source_chapters_json, [])
    await q('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [run.novel_id])
    const current = (await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.novel_id])).rows
    if (!sameCatalog(locals, current)) throw new Error('章节目录在预览后已发生变化，请重新读取源站')
    if (!Array.isArray(opts.manualMappings) || opts.manualMappings.length > locals.length) throw new Error('人工映射参数无效')
    const seen = new Set<string>()
    const sourceKeys = new Set(sources.map(row => row.key))
    const groups = groupLocalChapters(locals)
    for (const row of opts.manualMappings) {
      if (!row || typeof row.localChapterId !== 'string' || seen.has(row.localChapterId) || (row.sourceChapterKey !== null && (typeof row.sourceChapterKey !== 'string' || !sourceKeys.has(row.sourceChapterKey)))) throw new Error('人工映射目标无效或重复')
      const group = groups.find(item => item.chapters.some(chapter => chapter.id === row.localChapterId))
      if (!group || group.explicitSplit) throw new Error('人工映射目标无效或属于拆分章节')
      seen.add(row.localChapterId)
    }
    const metadata = safeJsonParse<SourceSyncMetadata>(run.metadata_json, {} as SourceSyncMetadata)
    const base = { runId: run.id, bindingId: run.binding_id, novelId: run.novel_id, site: sourceSite(metadata.sourceUrl), sourceUrl: metadata.sourceUrl }
    const automatic = buildPreview(sources, locals, metadata, Boolean(run.only_weak_titles), base, [])
    const occupied = new Map<string, string>()
    for (const mapping of automatic.mappings) {
      for (const id of mapping.localChapterIds) {
        if (!seen.has(id)) occupied.set(mapping.sourceChapterKey, id)
      }
    }
    for (const manual of opts.manualMappings) {
      if (manual.sourceChapterKey === null) continue
      const previous = occupied.get(manual.sourceChapterKey)
      if (previous && previous !== manual.localChapterId) throw new Error('源站章节已被其他本地章节占用，请先解除对应关系')
      occupied.set(manual.sourceChapterKey, manual.localChapterId)
    }
    const preview = buildPreview(sources, locals, metadata, Boolean(run.only_weak_titles), base, [], opts.manualMappings)
    preview.revision = Number(run.revision || 0) + 1
    await q('UPDATE source_sync_runs SET manual_mappings_json=$1,changes_json=$2,mapping_json=$3,revision=$4 WHERE id=$5',
      [JSON.stringify(opts.manualMappings), JSON.stringify(preview.changes), JSON.stringify(preview.mappings), preview.revision, run.id])
    return preview
  })
}

export async function applySourceSync(
  db: Db,
  opts: {
    runId: string
    applyMetadata?: boolean
    metadataFields?: string[]
    metadataMode?: 'missing' | 'replace'
    confirmedChangeIds?: string[]
    repairOrder?: boolean
    confirmedOrderIds?: string[]
    actorUserId?: string
    revision?: number
  },
): Promise<{ updated: number; orderUpdated: number; metadataUpdated: string[]; mappings: number }> {
  const run = await first<SourceSyncRunRow>(db, 'SELECT * FROM source_sync_runs WHERE id = $1', [opts.runId])
  if (!run) throw new Error('同步预览不存在或已过期')
  if (run.status === 'applied') throw new Error('该同步预览已经应用过')
  assertSyncRevision(run, opts.revision ?? 0)
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
  const confirmedChangeIds = new Set(opts.confirmedChangeIds || [])
  const metadataUpdated: string[] = []
  const changesToApply = changes.filter((change) => change.eligible || confirmedChangeIds.has(change.localChapterId))
  const now = Date.now()
  let orderUpdated = 0

  await withTx(db, async (q) => {
    const lockedRun = await q<SourceSyncRunRow>('SELECT * FROM source_sync_runs WHERE id = $1 FOR UPDATE', [run.id])
    if (!lockedRun.rows[0] || lockedRun.rows[0].status !== 'preview') throw new Error('该同步预览已应用或已过期，请重新预览')
    assertSyncRevision(lockedRun.rows[0], opts.revision ?? 0)
    const novel = await q('SELECT title, author, description, cover_url, categories, status, content_rating, content_rating_revision FROM novels WHERE id = $1 FOR UPDATE', [
      run.novel_id,
    ])
    const novelRow = novel.rows[0] as Record<string, unknown> | undefined
    if (!novelRow) throw new Error('Novel not found')
    const audit: AppliedSyncChange[] = []
    const chapterBefore = new Map<string, { title: string; order: number }>()
    if (safeJsonParse<SourceSyncManualMapping[]>(run.manual_mappings_json || '[]', []).length) {
      const current = (await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.novel_id])).rows
      if (!sameCatalog(safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, []), current)) throw new Error('章节目录在预览后已发生变化，请重新读取源站')
    }
    if (opts.repairOrder) {
      const snapshot = safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, [])
      const sources = safeJsonParse<SourceChapter[]>(run.source_chapters_json, [])
      const repair = buildOrderRepair(mappings, snapshot, sources)
      if (repair.orderRepairBlockedReason) throw new Error(`无法修复序号：${repair.orderRepairBlockedReason}`)
      const current = await q<LocalChapterForSync>('SELECT id, title, sort_order AS order FROM chapters WHERE novel_id = $1 FOR UPDATE', [run.novel_id])
      const currentById = new Map(current.rows.map(row => [row.id, row]))
      if (current.rows.length !== snapshot.length || snapshot.some(row => {
        const latest = currentById.get(row.id)
        return !latest || latest.title !== row.title || latest.order !== row.order
      })) throw new Error('章节目录在预览后已发生变化，请重新预览')
      const confirmedOrderIds = opts.confirmedOrderIds === undefined ? null : new Set(opts.confirmedOrderIds)
      if (confirmedOrderIds && [...confirmedOrderIds].some(id => !repair.orderChanges.some(change => change.localChapterId === id))) {
        throw new Error('无法修复序号：所选章节不在序号修复预览中，请重新预览')
      }
      const orderChanges = repair.orderChanges.filter(change => !confirmedOrderIds || confirmedOrderIds.has(change.localChapterId))
      const newOrders = new Map(orderChanges.map(change => [change.localChapterId, change.newOrder]))
      const occupiedOrders = new Map<number, string>()
      for (const local of snapshot) {
        const order = newOrders.get(local.id) ?? local.order
        const occupied = occupiedOrders.get(order)
        if (occupied && (newOrders.has(local.id) || newOrders.has(occupied))) {
          throw new Error('无法修复序号：所选章节的目标序号被未选章节占用，请一并勾选相关映射')
        }
        occupiedOrders.set(order, local.id)
      }
      for (const change of orderChanges) {
        chapterBefore.set(change.localChapterId, { title: change.title, order: change.oldOrder })
        await q('UPDATE chapters SET sort_order = $1 WHERE id = $2 AND novel_id = $3', [change.newOrder, change.localChapterId, run.novel_id])
      }
      orderUpdated = orderChanges.length
    }
    const ruleSet = await loadContentRatingRuleSet(q)
    for (const change of changesToApply) {
      const current = await q('SELECT title, sort_order FROM chapters WHERE id = $1 AND novel_id = $2 FOR UPDATE', [change.localChapterId, run.novel_id])
      const currentRow = current.rows[0] as Record<string, unknown> | undefined
      if (!currentRow) throw new Error(`章节不存在：${change.localChapterId}`)
      if (String(currentRow.title || '') !== change.oldTitle) throw new Error(`章节「${change.oldTitle}」在预览后已发生变化，请重新预览`)
      if (!opts.repairOrder && Number(currentRow.sort_order) !== change.localOrder) throw new Error(`章节「${change.oldTitle}」的序号在预览后已发生变化，请重新预览`)
      if (!chapterBefore.has(change.localChapterId)) chapterBefore.set(change.localChapterId, { title: String(currentRow.title), order: Number(currentRow.sort_order) })
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
    const ruleDecision = evaluateContentRatingRules(
      {
        title: String(nextTitle || ''),
        description: String(nextDescription || ''),
        categories: safeJsonParse<string[]>(String(nextCategories || '[]'), []),
      },
      ruleSet,
    )
    const nextRating = currentNovel.content_rating === 'unknown' ? ruleDecision.rating : toContentRating(currentNovel.content_rating)
    await q(
      `UPDATE novels SET title = $1, author = $2, description = $3, cover_url = $4, categories = $5,
      status = $6, updated_at = $7 WHERE id = $8`,
      [nextTitle, nextAuthor, nextDescription, nextCover, nextCategories, nextStatus, now, run.novel_id],
    )
    if (currentNovel.content_rating === 'unknown' && nextRating !== 'unknown') {
      await applyContentRatingChange(q, {
        novelId: run.novel_id,
        rating: nextRating,
        source: 'source_import',
        actorUserId: opts.actorUserId || 'system',
        reason: '源站元数据同步后重新执行分级规则',
        evidence: ruleDecision.evidence,
        ruleVersion: ruleDecision.ruleVersion || CONTENT_RATING_RULE_VERSION,
        operationId: run.id,
      })
    }
    for (const [id, before] of chapterBefore) {
      const row = (await q<{ title: string; order: number }>('SELECT title,sort_order AS order FROM chapters WHERE id=$1 AND novel_id=$2', [id, run.novel_id])).rows[0]!
      audit.push({ kind: 'chapter', id, before, after: row })
    }
    if (metadataUpdated.length || nextRating !== currentNovel.content_rating) {
      const after = (await q<Record<string, unknown>>('SELECT title,author,description,cover_url,categories,status,content_rating,content_rating_revision FROM novels WHERE id=$1', [run.novel_id])).rows[0]!
      audit.push({ kind: 'metadata', before: Object.fromEntries(NOVEL_SNAPSHOT_FIELDS.map(field => [field, currentNovel[field]])), after })
    }
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
    await q('UPDATE source_sync_runs SET status=$1,applied_at=$2,applied_changes_json=$4,history_summary=$5 WHERE id=$3',
      ['applied', now, run.id, JSON.stringify(audit), JSON.stringify({ novelTitle: String(nextTitle), titleUpdated: changesToApply.length, orderUpdated, metadataUpdated: metadataUpdated.length, sourceUrl: metadata.sourceUrl })])
    await q("UPDATE novel_source_bindings SET last_synced_at = $1, last_error = '', updated_at = $1 WHERE id = $2", [now, run.binding_id])
  })
  return { updated: changesToApply.length, orderUpdated, metadataUpdated, mappings: mappings.reduce((sum, mapping) => sum + mapping.localChapterIds.length, 0) }
}

export function sourceSyncTestHelpers() {
  return { splitPart, chapterNumber, normalizedTitle, groupLocalChapters, alignSourceAndLocal, buildPreview }
}

export async function listSourceSyncHistory(db: Db, novelId: string, limit = 20, offset = 0) {
  const pageSize = Math.min(100, Math.max(1, Number.isSafeInteger(limit) ? limit : 20))
  const start = Math.max(0, Number.isSafeInteger(offset) ? offset : 0)
  const total = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM source_sync_runs WHERE novel_id=$1 AND applied_at>0', [novelId])
  const rows = await all<{ id: string; status: string; applied_at: number; history_summary: string; can_rollback: boolean; rollback_result_json: string }>(db,
    `SELECT id,status,applied_at,history_summary,rollback_result_json,(status='applied' AND applied_changes_json<>'[]') AS can_rollback
     FROM source_sync_runs WHERE novel_id=$1 AND applied_at>0 ORDER BY applied_at DESC,id DESC LIMIT $2 OFFSET $3`, [novelId, pageSize, start])
  return { total: total?.total || 0, items: rows.map(row => ({
    runId: row.id, status: row.status, appliedAt: Number(row.applied_at), canRollback: row.can_rollback,
    summary: safeJsonParse<Record<string, unknown>>(row.history_summary, {}),
    rollback: row.rollback_result_json ? safeJsonParse<SourceSyncRollbackResult | null>(row.rollback_result_json, null) : null,
  })) }
}

export async function getSourceSyncHistoryDetail(db: Db, runId: string) {
  const row = await first<{ applied_changes_json: string; applied_at: number }>(db, 'SELECT applied_changes_json,applied_at FROM source_sync_runs WHERE id=$1', [runId])
  if (!row || !Number(row.applied_at)) throw new Error('融合历史不存在')
  return { runId, changes: safeJsonParse<AppliedSyncChange[]>(row.applied_changes_json, []) }
}

export async function rollbackSourceSync(db: Db, runId: string, actorUserId: string): Promise<SourceSyncRollbackResult> {
  return withTx(db, async q => {
    const run = (await q<SourceSyncRunRow>('SELECT * FROM source_sync_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0]
    if (!run) throw new Error('融合历史不存在')
    if (run.rollback_result_json) return safeJsonParse<SourceSyncRollbackResult>(run.rollback_result_json, { runId, restored: 0, conflicts: [] })
    if (run.status !== 'applied') throw new Error('这次融合当前不可撤回')
    const changes = safeJsonParse<AppliedSyncChange[]>(run.applied_changes_json || '[]', [])
    if (!changes.length) throw new Error('旧记录没有应用快照，无法安全撤回')
    const novel = (await q<Record<string, unknown>>('SELECT * FROM novels WHERE id=$1 FOR UPDATE', [run.novel_id])).rows[0]
    if (!novel) throw new Error('Novel not found')
    const current = (await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.novel_id])).rows
    const byId = new Map(current.map(row => [row.id, row]))
    const original = safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, [])
    const result: SourceSyncRollbackResult = { runId, restored: 0, conflicts: [] }
    const candidates = new Map<string, AppliedChapterChange>()
    for (const change of changes) {
      if (change.kind !== 'chapter') continue
      const latest = byId.get(change.id)
      if (!latest || latest.title !== change.after.title || latest.order !== change.after.order) {
        result.conflicts.push({ id: change.id, title: change.after.title, reason: '章节已删除或标题、序号已再次修改，保留当前值。' })
      } else candidates.set(change.id, change)
    }
    // 撤回序号时保留预览后新增/编辑的章节，不能制造新的序号占用冲突。
    let removed = true
    while (removed) {
      removed = false
      for (const [id, change] of candidates) {
        if (change.before.order === change.after.order) continue
        const originalIds = new Set(original.filter(row => row.order === change.before.order).map(row => row.id))
        const collision = current.some(row => row.id !== id && (candidates.get(row.id)?.before.order ?? row.order) === change.before.order && !originalIds.has(row.id))
        if (!collision) continue
        candidates.delete(id); removed = true
        result.conflicts.push({ id, title: change.after.title, reason: '原序号已被其他章节占用，保留当前标题与序号。' })
      }
    }
    for (const [id, change] of candidates) {
      await q('UPDATE chapters SET title=$1,sort_order=$2 WHERE id=$3 AND novel_id=$4', [change.before.title, change.before.order, id, run.novel_id])
      await q('DELETE FROM source_chapter_mappings WHERE sync_run_id=$1 AND local_chapter_id=$2', [runId, id])
      result.restored++
    }
    for (const change of changes) {
      if (change.kind !== 'metadata') continue
      if (!NOVEL_SNAPSHOT_FIELDS.every(field => JSON.stringify(novel[field]) === JSON.stringify(change.after[field]))) {
        result.conflicts.push({ id: run.novel_id, title: '小说信息', reason: '小说信息或分级已再次编辑、审核，保留当前值。' })
        continue
      }
      const before = change.before
      await q('UPDATE novels SET title=$1,author=$2,description=$3,cover_url=$4,categories=$5,status=$6 WHERE id=$7',
        [before.title, before.author, before.description, before.cover_url, before.categories, before.status, run.novel_id])
      if (before.content_rating !== novel.content_rating) await applyContentRatingChange(q, {
        novelId: run.novel_id, rating: toContentRating(before.content_rating), source: 'source_import', actorUserId,
        reason: '撤回源站融合，恢复原分级', operationId: runId, expectedRevision: Number(novel.content_rating_revision),
      })
      result.restored++
    }
    if (!result.conflicts.length) await q('DELETE FROM source_chapter_mappings WHERE sync_run_id=$1', [runId])
    await q('UPDATE novels SET updated_at=$1 WHERE id=$2', [Date.now(), run.novel_id])
    await q('UPDATE source_sync_runs SET status=$1,rolled_back_at=$2,rollback_result_json=$3 WHERE id=$4',
      [result.conflicts.length ? 'rollback_partial' : 'rolled_back', Date.now(), JSON.stringify(result), runId])
    return result
  })
}
