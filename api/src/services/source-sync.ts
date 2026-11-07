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
import { withPo18Session } from './po18-fetch'
import { applyContentRatingChange, CONTENT_RATING_RULE_VERSION } from './content-rating-governance'
import { evaluateContentRatingRules, loadContentRatingRuleSet } from './content-rating-rules'
import { toContentRating } from '../db/mappers'
import { invalidateCoverForSourceChange, type StoredCover } from './covers'
import { isDefaultCoverSource } from '@shared/covers'
import type { TitleUpdateReason } from '@shared/source-sync'

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
  titleUpdateReasons?: TitleUpdateReason[]
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
  requiredChapterIds?: string[]
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
  /** 按阻塞源章聚合后的序号修复受阻摘要，供前端展示；orderRepairSkipped 保留逐章明细。 */
  orderRepairBlockers?: Array<{ blockingChapterIds: string[]; reason: string; affectedChapterIds: string[] }>
  /** 序号偏移区段仅解释差异，修复资格由映射证据与目标占位独立判断。 */
  orderShiftSegments?: SourceSyncShiftSegment[]
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
interface AppliedMetadataChange { kind: 'metadata'; before: Record<string, unknown>; after: Record<string, unknown>; coverHistoryId?: string | null }
type AppliedSyncChange = AppliedChapterChange | AppliedMetadataChange
export interface SourceSyncRollbackResult { runId: string; restored: number; conflicts: Array<{ id: string; title: string; reason: string }> }

// 「正文」在测试里是占位章节，但真实目录中「正文」也可能是正式章名；
// 仅当标题不含任何自定义正文（纯公告/占位）时才判弱，故此处对「正文」单独放宽。
const GENERIC_WEAK_TITLES = /^(?:正文|无标题|未命名|空标题|首-?发|首发|防盗|防盗章|防盗章节|本章为防盗章|公告|请假|停更|通知)$/i
// PO18 等站点在正文首行插入的防盜水印，会被目录抓取误当作章节名。
const WATERMARK_TITLE = /^(?:首-?发|首发|防盗|本章为防盗章|防盜|獨發|独家首发)[:：、.。\s]*$/
const INTRO_TITLES = /^(?:内容简介|作品简介|小说简介|文案|简介|楔子|序章|序言)$/i
const SPLIT_MARKER = /(?:[（(]\s*(\d+)\s*[/／]\s*(\d+)\s*[)）]|(?:[-_ ]+)?(?:part|pt)\s*(\d+)(?:\s*[/／]\s*(\d+))?)$/i
const EXTRA_NUMBER = /(?:番外|外传)\s*(?:第\s*)?([0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+)/i
const ARABIC_NUMBER = /^第\s*(\d+)(?=\s|[章节回卷集部篇]|$)/i
const EXTRA_TITLE = /番外|外传/i
const CHINESE_NUMBER = /^第\s*([零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+)\s*(?:章|节|回|卷|集|部|篇)?/i
// 章节名尾部/中段的情色分级标记（H/微H/高h/小H 等），源站常带、本地常被抹掉。
// 全半角括号（（）/()）与大小写均需兼容；修饰词也允许「无」这类否定形式。
const H_MARKER = /[（(]\s*(?:微|高|小|重|轻|肉|无|超)?\s*[hH]\s*[)）]/g
// 完全由 H 标记构成的标题（如「（H）」），剥离后会变空串，须单独识别为弱标题。
const H_MARKER_ONLY = /^(?:[（(]\s*(?:微|高|小|重|轻|肉|无|超)?\s*[hH]\s*[)）][\s、,，]*)+$/
// 源站章节名尾部夹带的推广水印，形如「掉马「po1⒏homes」」；
// 全角数字、内部点号与站点词是其指纹，普通正文标题不会长成这样。
const PROMO_SUFFIX = /[「"'“”]?(?:po\s*1[0-9０-９]{0,2}\s*[.．。]?\s*(?:home|homes|com|net|tw|cc|xyz|top|vip|me|info|site|org)|[a-z]{2,10}\s*[.．。]\s*(?:com|net|tw|cc|xyz|top|vip|me|info|site|org))\s*(?:[」"'“”]|[0-9０-９]*)?\s*$/i

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * 归一化本地章节快照的数值字段。
 *
 * PostgreSQL 的 `sort_order` 是 bigint，而 `pg` 驱动为避免精度丢失**默认把 bigint
 * 返回为字符串**。于是直接来自 `SELECT` 的快照里 `order` 是 `"1"`，经 buildPreview
 * 加工后才变成 `1`——同一份快照在预览路径与应用路径下类型不一致。
 * 旧逻辑只有逐章判定、对类型不敏感，所以问题长期潜伏；段级分组需要数值比较，
 * 一旦拿到字符串就会静默退化（每章自成一段），把良性排版段也重编号。
 *
 * 因此所有读取点都过这里做自愈：既保护新写入的数据，也能修复历史上已落库的脏快照。
 */
function normalizeLocalSnapshot(rows: LocalChapterForSync[]): LocalChapterForSync[] {
  if (!Array.isArray(rows)) return []
  return rows.map(row => ({ ...row, order: Number(row.order) }))
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
    .replace(/^\d+\s+(?=\d+[.、:：](?!\d))/, '')
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

/** 剥离两侧都无害的尾部噪声：源站的水印/推广词、目标分级标记（H）。 */
function stripTitleDecorations(title: string): string {
  let text = cleanTitle(title).normalize('NFKC')
  // 循环处理「（微H）「po1⒏homes」」这类叠加尾巴。
  for (let round = 0; round < 4; round++) {
    const next = text.replace(PROMO_SUFFIX, '').replace(H_MARKER, '').trim()
    if (next === text) break
    text = next
  }
  return text
}

/** normalizedTitle 会清掉的前缀部分；用于判断两标题差异是否只来自「导入编号噪声」。 */
function stripComparablePrefix(title: string): string {
  return cleanTitle(title).normalize('NFKC')
    .replace(/^第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?\s*/i, '')
    .replace(/^chapter\s*\d+\s*/i, '')
    .replace(/^(?:\d+(?:\.\d+)?(?:[.、:：]\s*|\s+))+/, '')
}

function normalizedTitle(title: string): string {
  return stripComparablePrefix(stripTitleDecorations(title))
    .replace(SPLIT_MARKER, '')
    .replace(/[【】「」『』《》]/g, '')
    .toLocaleLowerCase()
    .replace(/[\s.,，。:：!！?？、—–－-]/g, '')
}

function isWeakTitle(title: string, order: number): boolean {
  const text = cleanTitle(title)
  if (!text || GENERIC_WEAK_TITLES.test(text)) return true
  // 「首-发：」这类被抓进目录的防盜水印没有任何标题信息，必须判弱，
  // 否则它会顶掉真实章节、把其后全部章节的序号整体推偏。
  if (WATERMARK_TITLE.test(text.normalize('NFKC'))) return true
  // 「（H）」这类纯分级标记没有标题信息，剥离后为空串，必须判弱以免成为空锚点。
  if (H_MARKER_ONLY.test(text.normalize('NFKC'))) return true
  if (/^chapter\s*\d+(?:\s*[/／]\s*\d+)?$/i.test(text)) return true
  const number = chapterNumber(text)
  return number === order && normalizedTitle(text) === ''
}

/**
 * 目标标题相对本地标题是否"只差噪声"。
 *
 * 判据一：归一化后逐字相等。normalizedTitle 已剥离导入前缀、章节分级标记（H）、
 * 广告后缀与标点，因此相等本身就证明两处差异全部来自这些噪声成分——
 * 比枚举噪声类型更稳健。反例「掉马（H）推广」→「掉马」归一化为
 * `掉马h推广` ≠ `掉马`，自然排除。
 *
 * 判据二（语义，非形态枚举）：**本地标题带序号前缀、目标标题不带**。
 * 只有"清理本地残留前缀"才是安全的自动修正。反向（本地干净、目标带前缀）
 * 会把用户的好标题改写成导入形态，属倒退；两侧都带则是作者编号约定，
 * 均须人工确认。用"前缀剥离量"比较，天然覆盖 `84.`/`第84章`/`(12)` 等
 * 一切形态，不依赖枚举，避免遗漏未预见的写法。
 *
 * 由调用方保证 matchReason==='exact-title' 且 confidence==='high'。
 */
function isNoiseOnlyDiff(localTitle: string, targetTitle: string): boolean {
  const local = cleanTitle(localTitle).normalize('NFKC')
  const target = cleanTitle(targetTitle).normalize('NFKC')
  if (!local || !target || local === target) return false
  // 护栏只针对【序号前缀】方向：目标标题带导入前缀（如「84.」「第84章」）时
  // 拒绝，否则会把用户干净的标题改写成导入形态，属倒退。
  // 尾部的分级标记（微H）与广告后缀是正常标注或本地噪声，改写成它们不是倒退，
  // 因此不在此拦截——由下面的归一化相等判据统一放行。
  if (stripComparablePrefix(target) !== target) return false
  if (PROMO_SUFFIX.test(target.replace(H_MARKER, '').trim())) return false
  // 归一化后逐字相等，即证明两处差异全部来自 normalizedTitle 已剥离的成分
  // （前缀 / 分级标记 / 广告后缀 / 标点），属确定性的噪声清理。
  const key = normalizedTitle(local)
  return Boolean(key) && key === normalizedTitle(target)
}

function titleUpdateReasons(localTitle: string, targetTitle: string): TitleUpdateReason[] {
  const local = cleanTitle(localTitle).normalize('NFKC')
  const target = cleanTitle(targetTitle).normalize('NFKC')
  const reasons: TitleUpdateReason[] = []
  if (stripComparablePrefix(local) !== local && stripComparablePrefix(target) === target) reasons.push('import-prefix')
  if (PROMO_SUFFIX.test(local.replace(H_MARKER, '').trim()) && !PROMO_SUFFIX.test(target.replace(H_MARKER, '').trim())) reasons.push('promo-cleanup')
  // match() 不依赖全局正则的 lastIndex；分级标记与广告水印分别解释。
  if (JSON.stringify(local.match(H_MARKER)) !== JSON.stringify(target.match(H_MARKER))) reasons.push('rating-marker')
  if (!reasons.length && normalizedTitle(local) === normalizedTitle(target)) reasons.push('typography')
  return reasons.length ? reasons : ['source-title']
}

function introducesTitleNoise(localTitle: string, targetTitle: string): boolean {
  const target = cleanTitle(targetTitle).normalize('NFKC')
  const local = cleanTitle(localTitle).normalize('NFKC')
  return PROMO_SUFFIX.test(target.replace(H_MARKER, '').trim()) ||
    (stripComparablePrefix(target) !== target && stripComparablePrefix(local) === local)
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

/**
 * 同名章节消歧：把同名候选按各自序号一一配对，取总偏差最小且保持顺序的分配。
 * 优先用两侧的显式章节编号；本库多数章节并无编号前缀，此时退化为
 * 用固定基准点对齐后的相对位置（本地与源站的绝对偏移互不影响）。
 * 保持顺序是关键：它保证「本地靠前的同名章」配到「源站靠前的同名章」。
 */
function pickOrderNearestPair(
  sourceIndexes: number[],
  localIndexes: number[],
  source: SourceChapter[],
  groups: LocalGroup[],
  baseSourceOrder: number,
  baseGroupOrder: number,
): Array<[number, number]> {
  const shift = (sourceIndex: number, groupIndex: number) => {
    const sourceNumber = chapterNumber(source[sourceIndex]!.title)
    const localNumber = chapterNumber(groups[groupIndex]!.chapters[0]!.title)
    // 两侧都有显式编号时，编号比位置更可靠。
    if (sourceNumber !== null && localNumber !== null) return localNumber - sourceNumber
    return (groups[groupIndex]!.chapters[0]!.order - baseGroupOrder) - (source[sourceIndex]!.order - baseSourceOrder)
  }
  const count = Math.min(sourceIndexes.length, localIndexes.length)
  if (count < 1) return []
  // 两类候选都已按序列顺序排列，只需选出 count 对且不交叉的配对。
  let best: { pairs: Array<[number, number]>; cost: number } | null = null
  const walk = (a: number, b: number, chosen: Array<[number, number]>, cost: number) => {
    if (chosen.length === count) {
      if (!best || cost < best.cost) best = { pairs: [...chosen], cost }
      return
    }
    if (a >= sourceIndexes.length || b >= localIndexes.length) return
    if (sourceIndexes.length - a < count - chosen.length || localIndexes.length - b < count - chosen.length) return
    walk(a + 1, b + 1, [...chosen, [sourceIndexes[a]!, localIndexes[b]!]], cost + Math.abs(shift(sourceIndexes[a]!, localIndexes[b]!)))
    walk(a + 1, b, chosen, cost)
    walk(a, b + 1, chosen, cost)
  }
  walk(0, 0, [], 0)
  return (best as { pairs: Array<[number, number]> } | null)?.pairs ?? []
}

/** 唯一完整标题先独立定位，允许纠正已有乱序；其余章节仍受已知标题边界约束。 */
function alignSourceAndLocal(source: SourceChapter[], groups: LocalGroup[]): Alignment[] {
  const titleIndexes = (titles: string[]) => {
    const indexes = new Map<string, number[]>()
    titles.forEach((title, index) => {
      const key = normalizedTitle(title)
      // 空 key（纯编号标题塌成空串、纯 H 标记）不含任何标题信息，视同弱标题直接排除，
      // 否则大量空 key 会被当作"唯一完整标题"参与锚定，制造虚假确定性。
      if (!key || isWeakTitle(title, chapterNumber(title) || 0)) return
      indexes.set(key, [...(indexes.get(key) || []), index])
    })
    return indexes
  }
  const sourceTitles = titleIndexes(source.map(row => row.title))
  const localTitles = titleIndexes(groups.map(group => group.chapters[0]!.title))
  // 同名消歧需要一条可信的“两侧序号基准线”。取所有唯一标题配对在各自序列中的
  // 相对位置差的中位数：目录整体前移/后移都不影响它，个别错位区域也不会带偏。
  const offsets: number[] = []
  for (const [key, sourceIndexes] of sourceTitles) {
    const localIndexes = localTitles.get(key)
    if (sourceIndexes.length !== 1 || localIndexes?.length !== 1) continue
    offsets.push(
      (groups[localIndexes[0]!]!.chapters[0]!.order - groups[0]!.chapters[0]!.order) -
      (source[sourceIndexes[0]!]!.order - source[0]!.order),
    )
  }
  offsets.sort((a, b) => a - b)
  const median = offsets.length ? offsets[Math.floor(offsets.length / 2)]! : 0
  const sourceBase = source[0]?.order ?? 0
  const groupBase = (groups[0]?.chapters[0]?.order ?? 0) + median
  // 与基准线偏离过大的标题锚点分两种：
  //   1. 作者主动重排的整块番外（本地把源站末尾的番外搬到中段）——标题自带「番外」，
  //      且彼此相邻成块，位置虽远但语义确定，必须保留锚定。
  //   2. 纯正文标题的巧合远距离同名（如本地112「游戏」↔源站54，偏移57）——符号上成立、
  //      语义上是伪造的确定性。它会声明"本地112之前全部在源站54之前"，使中段成片错配。
  // 因此只排除「不含番外标记的远距离锚点」。
  const isExtra = (title: string) => EXTRA_TITLE.test(cleanTitle(title))
  const isFarFromBaseline = (sourceIndex: number, groupIndex: number) => {
    const delta = (groups[groupIndex]!.chapters[0]!.order - groupBase) - (source[sourceIndex]!.order - sourceBase)
    return Math.abs(delta) > Math.max(ANCHOR_BASELINE_TOLERANCE, Math.abs(median) + ANCHOR_BASELINE_TOLERANCE)
  }
  const isImplausibleAnchor = (sourceIndex: number, groupIndex: number) =>
    isFarFromBaseline(sourceIndex, groupIndex) &&
    !isExtra(groups[groupIndex]!.chapters[0]!.title) &&
    !isExtra(source[sourceIndex]!.title)
  const candidates: Array<{ sourceIndex: number; groupIndex: number }> = []
  for (const [key, sourceIndexes] of sourceTitles) {
    const localIndexes = localTitles.get(key)
    if (!localIndexes) continue
    if (sourceIndexes.length === 1 && localIndexes.length === 1) {
      const sourceIndex = sourceIndexes[0]!
      const groupIndex = localIndexes[0]!
      if (isImplausibleAnchor(sourceIndex, groupIndex)) continue
      candidates.push({ sourceIndex, groupIndex })
      continue
    }
    // 「自由」这类同名章节：唯一性不成立时按两侧序号顺序消歧。
    // 基准取所有唯一配对的中位偏移，避免被错位区域（如番外前移）带偏。
    for (const [sourceIndex, groupIndex] of pickOrderNearestPair(sourceIndexes, localIndexes, source, groups, sourceBase, groupBase)) {
      if (isImplausibleAnchor(sourceIndex, groupIndex)) continue
      candidates.push({ sourceIndex, groupIndex })
    }
  }
  // 锚点必须互相单调：位置荒谬的锚点已在上方剔除，这里再把仍然互相冲突的锚点按代价剔除。
  const anchors = keepMonotonicAnchors(candidates, source, groups)
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

/**
 * 保留互相单调的锚点。两条锚点若「源站靠前而本地靠后」，落在它们之间的章节
 * 无论怎么排都会错位。但相邻/近邻交叉（重复序号造成的公告与正文颠倒、
 * 局部序号偏移）是常见且无害的，顺序对齐本身能处理，因此只把跨度超过
 * ANCHOR_CROSS_TOLERANCE 的远距离交叉视为有害。
 *
 * 番外锚点单独处理：作者常把源站末尾的番外整块搬到本地中段，这会让它们与
 * 正文锚点大面积交叉。这种搬迁是确定性的（标题唯一且成块），因此番外锚点
 * 不参与单调仲裁，直接保留；仲裁只在正文锚点之间进行。
 * 逐个丢弃边际代价最高的锚点，直到剩余锚点两两单调。
 */
const ANCHOR_CROSS_TOLERANCE = 3
// 与基准线的最大可接受偏离。全书正文偏移通常为个位数，超过即视为位置荒谬的巧合锚点。
const ANCHOR_BASELINE_TOLERANCE = 12
function keepMonotonicAnchors(candidates: Array<{ sourceIndex: number; groupIndex: number }>, source: SourceChapter[], groups: LocalGroup[]): Alignment[] {
  const isExtraPair = (row: { sourceIndex: number; groupIndex: number }) =>
    EXTRA_TITLE.test(cleanTitle(source[row.sourceIndex]!.title)) &&
    EXTRA_TITLE.test(cleanTitle(groups[row.groupIndex]!.chapters[0]!.title))
  const extra = candidates.filter(isExtraPair)
  const plain = candidates.filter(row => !isExtraPair(row))
  const cost = (a: { sourceIndex: number; groupIndex: number }, b: { sourceIndex: number; groupIndex: number }) =>
    a.sourceIndex < b.sourceIndex && a.groupIndex > b.groupIndex
      ? Math.max(b.groupIndex - a.groupIndex, b.sourceIndex - a.sourceIndex) - ANCHOR_CROSS_TOLERANCE
      : 0
  const totalCost = (rows: Array<{ sourceIndex: number; groupIndex: number }>) => {
    let sum = 0
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) sum += cost(rows[i]!, rows[j]!)
    return sum
  }
  const kept = [...plain].sort((a, b) => a.sourceIndex - b.sourceIndex || a.groupIndex - b.groupIndex)
  while (kept.length > 1) {
    const current = totalCost(kept)
    if (current <= 0) break
    let dropIndex = -1
    let dropCost = -1
    let dropDistance = -1
    for (let index = 0; index < kept.length; index++) {
      const without = kept.filter((_, i) => i !== index)
      const marginal = current - totalCost(without)
      const candidate = kept[index]!
      const distance = Math.abs(candidate.groupIndex - candidate.sourceIndex)
      if (marginal > dropCost || (marginal === dropCost && distance > dropDistance)) {
        dropCost = marginal
        dropDistance = distance
        dropIndex = index
      }
    }
    if (dropCost <= 0 || dropIndex < 0) break
    kept.splice(dropIndex, 1)
  }
  return [...kept, ...extra].map(row => ({ sourceIndex: row.sourceIndex, groupIndex: row.groupIndex, score: groupScore(source[row.sourceIndex]!, groups[row.groupIndex]!) }))
}

/** 序号偏移区段：连续且偏移一致的一段本地章节。 */
export interface SourceSyncShiftSegment {
  localRange: { from: number; to: number }
  sourceRange: { from: number; to: number }
  offset: number
  kind: 'layout' | 'gap'
  reason: string
  blockingChapterIds: string[]
  chapterIds: string[]
}

/**
 * 按相邻映射的偏移切分序号偏移区段，并区分病因：
 *  - `gap`：本地在该段多插入了内容（或缺失内容）导致序号与源站整体错开，
 *    段内章节在**物理顺序上仍与源站一致**，只是"整体挪了一格"——按源站序号
 *    归位即可修复，不会改变任何章节之间的相对次序。
 *  - `layout`：本地主动重排过（典型是把源站末尾的番外搬到中段）。此类段与
 *    前后段在源站序号轴上**互相穿插**（如前移段的源站序号远大于其后一段），
 *    强行按源站序号归位会把整块内容切开、与物理顺序撕裂，因此不生成修复。
 *  - `blocked`：段内存在无有效源站对应的章节，其正确序号无法判定。
 *
 * 判据落在「该段是否与其它段在源站序号轴上交叉」：交叉即说明作者动过版，
 * 不能按源站序号重排；不交叉的等距错开才是可安全归位的错位。
 */
function buildShiftSegments(
  mappings: SourceSyncMapping[],
  locals: LocalChapterForSync[],
): SourceSyncShiftSegment[] {
  const byLocal = new Map<string, SourceSyncMapping>()
  mappings.forEach(mapping => {
    if (mapping.localChapterIds.length === 1) byLocal.set(mapping.localChapterIds[0]!, mapping)
  })
  const rows = locals
    .map(row => {
      const mapping = byLocal.get(row.id)
      if (!mapping || !Number.isSafeInteger(mapping.sourceOrder)) return null
      return { local: row, offset: row.order - mapping.sourceOrder }
    })
    .filter((row): row is { local: LocalChapterForSync; offset: number } => row !== null)
  const segments: SourceSyncShiftSegment[] = []
  const orderById = new Map(rows.map(row => [row.local.id, row.local.order]))
  for (const row of rows) {
    const previous = segments[segments.length - 1]
    const lastOrder = previous ? orderById.get(previous.chapterIds[previous.chapterIds.length - 1]!) : undefined
    // 只在序号与偏移同时连续时并入上一段，避免把断层粘成一段。
    if (previous && lastOrder !== undefined && row.local.order === lastOrder + 1 && row.offset === previous.offset) {
      previous.chapterIds.push(row.local.id)
      previous.localRange.to = row.local.order
      previous.sourceRange.to = row.local.order - row.offset
      continue
    }
    segments.push({
      localRange: { from: row.local.order, to: row.local.order },
      sourceRange: { from: row.local.order - row.offset, to: row.local.order - row.offset },
      offset: row.offset,
      kind: 'layout',
      reason: '',
      blockingChapterIds: [],
      chapterIds: [row.local.id],
    })
  }
  // 无有效源站对应的章节：它们物理占着序号格，是 offset 的成因，也需在段上标出。
  const unmatchedOrders = locals
    .filter(row => !byLocal.has(row.id))
    .map(row => ({ id: row.id, order: row.order, title: row.title }))
  return segments.map(segment => {
    const blocking = unmatchedOrders.filter(row =>
      segment.chapterIds.some(id => {
        const order = orderById.get(id)
        return order !== undefined && (row.order === order || row.order === order - 1)
      }))
    if (segment.offset === 0) {
      return { ...segment, kind: 'layout' as const, reason: '本地序号与源站一致，无需调整。' }
    }
    // 判据：段偏移能被"本地多插/漏插了章"解释时，说明段内章节与源站的相对
    // 次序未变，只是整体挪了格子 => gap，可整段归位。
    //   precedingUnmatched = 段前本地无归属章数（它们把其后本地序号顶开）
    // 不吻合（番外被搬到中段造成的 -69/+6/+7/+8）=> 作者重排 => layout，不可动。
    const precedingUnmatched = unmatchedOrders.filter(row => row.order < segment.localRange.from).length
    // 段内序号连续且跨度与源站一致时，局部微调（含重复序号造成的颠倒、
    // 以及占位章把段内前后两截各自挤偏 1 格）不涉及远距离搬运，同样可安全归位。
    const localSpan = segment.localRange.to - segment.localRange.from
    const sourceSpan = segment.sourceRange.to - segment.sourceRange.from
    const reordered = localSpan === sourceSpan && Math.abs(segment.offset) <= 1
    // 段起点之前存在物理空位（本地序号缺口）时，段内章节可整体下滑填入空位，
    // 如同滑动拼图：空位是启动条件。偏移在「可达下滑距离」内即可安全归位。
    const localOrderSet = new Set(locals.map(row => row.order))
    let gapBefore = 0
    for (let order = segment.localRange.from - 1; order >= 1; order--) {
      if (!localOrderSet.has(order)) gapBefore++
      else break
    }
    const slidingSlack = gapBefore > 0 && segment.offset > 0 && segment.offset <= gapBefore
    const explicated = Math.abs(segment.offset) === precedingUnmatched || reordered || slidingSlack
    if (explicated) {
      return {
        ...segment,
        kind: 'gap' as const,
        reason: `本地该段相对源站偏移 ${segment.offset > 0 ? '+' : ''}${segment.offset}，等于其前 ${precedingUnmatched} 个无源站对应章节造成的位移，需按源站序号归位。`,
        blockingChapterIds: blocking.map(row => row.id),
      }
    }
    return {
      ...segment,
      kind: 'layout' as const,
      reason: `本地第 ${segment.localRange.from}-${segment.localRange.to} 章相对源站偏移 ${segment.offset > 0 ? '+' : ''}${segment.offset}，可核对后勾选按源站序号同步。`,
      blockingChapterIds: blocking.map(row => row.id),
    }
  })
}

function buildOrderRepair(mappings: SourceSyncMapping[], locals: LocalChapterForSync[], source: SourceChapter[]): {
  orderChanges: SourceSyncOrderChange[]; orderRepairBlockedReason?: string
  orderRepairSkipped: Array<{ localChapterId: string; reason: string; blockingChapterIds?: string[] }>
  orderRepairBlockers: Array<{ blockingChapterIds: string[]; reason: string; affectedChapterIds: string[] }>
  orderShiftSegments: SourceSyncShiftSegment[]
} {
  // 分段只解释目录差异，不决定能否同步。唯一且高置信度的对应关系可按源站排序，
  // 目标占位与移动依赖由下方完整方案计算，执行仍需管理员勾选。
  const shiftSegments = buildShiftSegments(mappings, locals)
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
    // 已对齐就没有移动需求；重复标题的消歧限制不能制造虚假的修复待办。
    if (mapping?.relation === 'one_to_one' && matches.length === 1 && mapping.sourceOrder === local.order) continue
    let reason = ''
    if (!mapping) reason = (localTitles.get(normalizedTitle(local.title)) || 0) > 1
      ? '本地存在重复完整标题，请先核查重复章节'
      : '尚未匹配，不能确定源站序号'
    else if (mapping.relation !== 'one_to_one' || mapping.localChapterIds.length !== 1) reason = '拆分章节不能直接使用源站序号'
    else if (matches.length !== 1 || mappedSources.get(mapping.sourceChapterKey) !== 1) reason = '章节对应关系不唯一'
    else if (mapping.confidence !== 'high') reason = '匹配证据不足，请先核对映射'
    else {
      const title = normalizedTitle(local.title)
      // 「本地存在重复完整标题」只在重复标题确实无法区分时才成立。
      // 关键：同名章节之间可以互相交换，仅"各自指向不同源站章"不足以证明配对
      // 正确（两个「同名章节」同样满足）。必须存在**独立于标题**的判别证据，
      // 否则一律保守拦下。本实现采用的证据是与同名组的整体偏移一致性：
      // 同名章节相对其匹配目标的偏移完全相同，说明消歧是按同一基准有序配对的
      // （两个「自由」皆为 +1），此时交换会破坏该一致性；而当两侧同名、序号
      // 也各自对等时，偏移虽然相同也能被上式判为"未证明"，由下方额外要求排除。
      const localDuplicate = (localTitles.get(title) || 0) > 1
      const sourceDuplicate = (sourceTitles.get(normalizedTitle(mapping.sourceTitle)) || 0) > 1
      let duplicatesResolved = false
      if (localDuplicate && sourceDuplicate && localDuplicate === sourceDuplicate) {
        const localRows = locals.filter(row => normalizedTitle(row.title) === title)
        const pairs = localRows.map(row => {
          const match = byLocal.get(row.id)?.[0]
          return match ? { row, order: match.sourceOrder } : null
        })
        if (pairs.every(pair => pair !== null)) {
          const shifts = pairs.map(pair => pair!.row.order - pair!.order)
          const targets = pairs.map(pair => pair!.order)
          // 偏移一致（有序配对）且目标两两不同（确实一一对应）。
          // 若偏移全为 0 且本地序号也两两不同，顺序本就无需修复，不进入此处判定。
          duplicatesResolved = shifts.every(shift => shift === shifts[0]) &&
            new Set(targets).size === pairs.length &&
            !(shifts.every(shift => shift === 0) && new Set(pairs.map(pair => pair!.row.order)).size === pairs.length)
        }
      }
      if (!duplicatesResolved && localDuplicate) {
        reason = '本地存在重复完整标题，请先核查重复章节'
      } else if (!duplicatesResolved && sourceDuplicate) {
        reason = '源站存在重复完整标题，不能唯一确定序号'
      } else if (!title || title !== normalizedTitle(mapping.sourceTitle) || isWeakTitle(local.title, local.order)) {
        reason = '序号修复需要唯一且完整一致的标题'
      } else if (!Number.isSafeInteger(mapping.sourceOrder) || mapping.sourceOrder < 1 || sourceOrders.get(String(mapping.sourceOrder)) !== 1) {
        reason = '源站序号重复或无效'
      }
    }
    if (reason) orderRepairSkipped.push({ localChapterId: local.id, reason })
    else if (mapping && mapping.sourceOrder !== local.order) {
      candidates.set(local.id, { localChapterId: local.id, title: local.title, oldOrder: local.order, newOrder: mapping.sourceOrder })
    }
  }
  const skippedById = new Map(orderRepairSkipped.map(row => [row.localChapterId, row]))
  const localById = new Map(locals.map(row => [row.id, row]))
  // 段级批量平移：gap 段内所有章节**同时**移到目标序号，段内彼此让位不构成冲突
  // （L39 要移走、L40 要移到 L39 原位，并发执行即可）。只有段**外**被占用的
  // 目标号才是真阻塞。逐章判定会把这个同时性误读成依赖链，
  // 从而制造出 L40→L41→…→L105 的假阻塞。
  //
  // 段的平移是否可行，取决于"段内全部目标格是否都能腾空"：段内互占的格子随
  // 平移一起让位，只有来自段外、且本次不移动的章节占着段的目标格才会挡住平移。
  // 个别章节因段外占用无法移动时，它的原位仍留在段内，会连带挡住以该原位为
  // 目标的下一章——但这类连带仅限"目标格确实仍被占用"的链，不应扩散到整段。
  // 段内章节的目标格是否真的能被腾空，取决于占着该格的章节是否也在"本次会移动"
  // 的集合里。段内互占的格子随平移一起让位；只有段外、且本次不动的章节实占目标格
  // 时才会挡住。据此做一次不动点计算：被挡住的章节退出移动集合，可能连带挡住
  // 以它原位为目标的章节，如此迭代至稳定。
  const blocked: Array<{ id: string; change: SourceSyncOrderChange; blocker: LocalChapterForSync }> = []
  const movable = new Set(candidates.keys())
  let settled = false
  while (!settled) {
    settled = true
    for (const id of [...movable]) {
      const change = candidates.get(id)!
      // 该目标格当前被谁占着？若占位者本次也会移走（在 movable 内），格子会腾空。
      const occupant = locals.find(local => local.id !== id && local.order === change.newOrder && !movable.has(local.id))
      if (!occupant) continue
      // 占位者不动（段外章节，或已被判定不动）=> 本章无法落位。
      movable.delete(id)
      candidates.delete(id)
      blocked.push({ id, change, blocker: occupant })
      settled = false
    }
  }
  for (const { id, change, blocker } of blocked) {
    // 直接受阻：目标格被某个具体章节物理占据（占位者自身不在移动集合中）。
    // 传导受阻：占位者本身也待修复，只是因更前置的章节卡死而连带动不了。
    const direct = !blocked.some(row => row.id === blocker.id) && !candidates.has(blocker.id)
    const blockingChapterIds = [...new Set(skippedById.get(blocker.id)?.blockingChapterIds || [blocker.id])]
    const details = blockingChapterIds.map(blockerId => {
      const local = localById.get(blockerId)!
      return `本地 ${local.order}「${local.title}」（${skippedById.get(blockerId)?.reason || '序号保持不变'}）`
    }).join('；')
    const skipped = {
      localChapterId: id,
      blockingChapterIds,
      reason: direct
        ? `目标序号 ${change.newOrder} 被占位章占用：${details}`
        : `目标序号 ${change.newOrder} 的移动依赖受阻：${details}`,
    }
    skippedById.set(id, skipped)
    orderRepairSkipped.push(skipped)
  }
  const orderChanges = [...candidates.values()].sort((a, b) => a.newOrder - b.newOrder)
  const occupants = new Map<number, string[]>()
  locals.forEach(local => occupants.set(local.order, [...(occupants.get(local.order) || []), local.id]))
  for (const change of orderChanges) {
    const required = new Set<string>()
    const collect = (id: string) => {
      for (const occupant of occupants.get(candidates.get(id)!.newOrder) || []) {
        if (occupant === change.localChapterId || occupant === id || required.has(occupant) || !candidates.has(occupant)) continue
        required.add(occupant)
        collect(occupant)
      }
    }
    collect(change.localChapterId)
    if (required.size) change.requiredChapterIds = [...required].sort()
  }
  // 连锁受阻会产生大量指向同一阻塞源的重复记录（一本书常见上百条），
  // 前端无法阅读。这里按阻塞源聚合出摘要，逐章明细仍保留在 orderRepairSkipped。
  const blockerGroups = new Map<string, { blockingChapterIds: string[]; reason: string; affectedChapterIds: string[] }>()
  for (const row of orderRepairSkipped) {
    // 缺乏修复资格仅是核对事项，只有实际占位导致的移动失败才是阻塞源。
    if (!row.blockingChapterIds?.length) continue
    const blockingChapterIds = [...row.blockingChapterIds]
    const key = blockingChapterIds.join('|')
    const group = blockerGroups.get(key)
    if (group) {
      group.affectedChapterIds.push(row.localChapterId)
      continue
    }
    const blocker = localById.get(blockingChapterIds[0]!)
    const blockerTitle = blocker ? `本地 ${blocker.order}「${blocker.title}」` : '未知章节'
    const cause = skippedById.get(blockingChapterIds[0]!)?.reason
    // 摘要只说明"谁挡住了什么"，逐章差异交给明细，避免把 100+ 条原文拼进一条。
    blockerGroups.set(key, {
      blockingChapterIds,
      reason: `${blockerTitle}阻挡：${cause && !cause.startsWith('目标序号') ? cause : '依赖其序号让位'}`,
      affectedChapterIds: [row.localChapterId],
    })
  }
  const orderRepairBlockers = [...blockerGroups.values()]
    .sort((a, b) => b.affectedChapterIds.length - a.affectedChapterIds.length)
  return {
    orderChanges, orderRepairSkipped, orderRepairBlockers, orderShiftSegments: shiftSegments,
    ...(!orderChanges.length && orderRepairBlockers.length ? { orderRepairBlockedReason: '序号修复受占位章节阻塞，请核对下方阻塞源。' } : {}),
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
      const noiseOnly = explanation.matchReason === 'exact-title' && confidence === 'high' &&
        isNoiseOnlyDiff(local.title, newTitle)
      const eligible = !manual && !introducesTitleNoise(local.title, newTitle) && confidence !== 'low' && (
        !onlyWeakTitles ||
        isWeakTitle(local.title, local.order) ||
        relation === 'split' ||
        // 差异只来自 normalizedTitle 已剥离的噪声（导入前缀/分级标记/广告后缀）时，
        // 属于 onlyWeakTitles 想要覆盖的清理场景，不该被"标题非空"挡下。
        noiseOnly
      ) && (
        // 但弱标题本身（纯编号、纯分级标记「（H）」、水印公告）不承载任何标题信息，
        // 不能仅凭顺序推断就自动改写；它们必须由人工确认，否则会把占位文本写进正文。
        // 例外：若命中噪声差异判定，说明两侧确实指向同一标题，只是本地多了噪声。
        !isWeakTitle(local.title, local.order) || relation === 'split' || noiseOnly
      )
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
          titleUpdateReasons: relation === 'split' ? ['split-title'] : titleUpdateReasons(local.title, newTitle),
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
  const sourceFetchHtml = site === 'po18tw' ? withPo18Session(db, opts.fetchHtml) : opts.fetchHtml
  const source = await fetchSourceChapters(url.href, sourceFetchHtml)
  const metadataResult = await fetchSourceMetadata(url.href, opts.store, sourceFetchHtml)
  if (metadataResult.warning) warnings.push(metadataResult.warning)
  const locals = normalizeLocalSnapshot(await all<LocalChapterForSync>(db, 'SELECT id, sort_order AS order, title FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC, id ASC', [
    opts.novelId,
  ]))
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
      JSON.stringify(normalizeLocalSnapshot(locals)),
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

/** 复用已经读取的源站目录，针对最新本地目录创建可继续处理的预览。 */
export async function refreshSourceSync(db: Db, opts: { runId: string; revision: number }): Promise<SourceSyncPreview> {
  return withTx(db, async q => {
    const previous = (await q<SourceSyncRunRow>('SELECT * FROM source_sync_runs WHERE id=$1 FOR UPDATE', [opts.runId])).rows[0]
    if (!previous || !['preview', 'applied'].includes(previous.status)) throw new Error('同步预览不存在或已撤回，请重新读取源站')
    assertSyncRevision(previous, opts.revision)
    if (!(await q('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [previous.novel_id])).rows.length) throw new Error('Novel not found')
    const locals = normalizeLocalSnapshot((await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 ORDER BY sort_order ASC,id ASC FOR UPDATE', [previous.novel_id])).rows)
    const sources = safeJsonParse<SourceChapter[]>(previous.source_chapters_json, [])
    const metadata = safeJsonParse<SourceSyncMetadata>(previous.metadata_json, {} as SourceSyncMetadata)
    const groups = groupLocalChapters(locals)
    const manual = safeJsonParse<SourceSyncManualMapping[]>(previous.manual_mappings_json || '[]', []).filter(mapping =>
      groups.some(group => group.chapters.length === 1 && !group.explicitSplit && group.chapters[0]!.id === mapping.localChapterId))
    const runId = newId('sync')
    const preview = buildPreview(sources, locals, metadata, Boolean(previous.only_weak_titles),
      { runId, bindingId: previous.binding_id, novelId: previous.novel_id, site: sourceSite(metadata.sourceUrl), sourceUrl: metadata.sourceUrl }, [], manual)
    await q(`INSERT INTO source_sync_runs
      (id,binding_id,novel_id,status,only_weak_titles,metadata_json,source_chapters_json,changes_json,mapping_json,local_snapshot_json,manual_mappings_json,created_at)
      VALUES ($1,$2,$3,'preview',$4,$5,$6,$7,$8,$9,$10,$11)`,
    [runId, previous.binding_id, previous.novel_id, previous.only_weak_titles, previous.metadata_json, previous.source_chapters_json,
      JSON.stringify(preview.changes), JSON.stringify(preview.mappings), JSON.stringify(normalizeLocalSnapshot(locals)), JSON.stringify(manual), Date.now()])
    return preview
  })
}

export async function remapSourceSync(db: Db, opts: { runId: string; revision: number; manualMappings: SourceSyncManualMapping[] }): Promise<SourceSyncPreview> {
  return withTx(db, async q => {
    const result = await q<SourceSyncRunRow>('SELECT * FROM source_sync_runs WHERE id=$1 FOR UPDATE', [opts.runId])
    const run = result.rows[0]
    if (!run || run.status !== 'preview') throw new Error('同步预览不存在或已应用，请重新读取源站')
    assertSyncRevision(run, opts.revision)
    const locals = normalizeLocalSnapshot(safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, []))
    const sources = safeJsonParse<SourceChapter[]>(run.source_chapters_json, [])
    await q('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [run.novel_id])
    const current = normalizeLocalSnapshot((await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.novel_id])).rows)
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
  if (changes.some(change => change.eligible && introducesTitleNoise(change.oldTitle, change.newTitle))) {
    throw new Error('旧预览包含新增编号或推广水印的自动更新，请重新生成预览后核对')
  }
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
  let now = Date.now()
  let orderUpdated = 0

  await withTx(db, async (q) => {
    const lockedRun = await q<SourceSyncRunRow>('SELECT * FROM source_sync_runs WHERE id = $1 FOR UPDATE', [run.id])
    if (!lockedRun.rows[0] || lockedRun.rows[0].status !== 'preview') throw new Error('该同步预览已应用或已过期，请重新预览')
    assertSyncRevision(lockedRun.rows[0], opts.revision ?? 0)
    const novel = await q('SELECT title, author, description, cover_url, categories, status, content_rating, content_rating_revision, updated_at FROM novels WHERE id = $1 FOR UPDATE', [
      run.novel_id,
    ])
    const novelRow = novel.rows[0] as Record<string, unknown> | undefined
    if (!novelRow) throw new Error('Novel not found')
    now = Math.max(now, (Number(novelRow.updated_at) || 0) + 1)
    const audit: AppliedSyncChange[] = []
    const chapterBefore = new Map<string, { title: string; order: number }>()
    if (safeJsonParse<SourceSyncManualMapping[]>(run.manual_mappings_json || '[]', []).length) {
      const current = normalizeLocalSnapshot((await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.novel_id])).rows)
      if (!sameCatalog(normalizeLocalSnapshot(safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, [])), current)) throw new Error('章节目录在预览后已发生变化，请重新读取源站')
    }
    if (opts.repairOrder) {
      const snapshot = normalizeLocalSnapshot(safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, []))
      const sources = safeJsonParse<SourceChapter[]>(run.source_chapters_json, [])
      const repair = buildOrderRepair(mappings, snapshot, sources)
      if (repair.orderRepairBlockedReason) throw new Error(`无法修复序号：${repair.orderRepairBlockedReason}`)
      if (!repair.orderChanges.length && repair.orderRepairSkipped?.length) throw new Error('无法修复序号：当前没有可执行的序号修复，请先核对映射')
      const current = normalizeLocalSnapshot((await q<LocalChapterForSync>('SELECT id, title, sort_order AS order FROM chapters WHERE novel_id = $1 FOR UPDATE', [run.novel_id])).rows)
      const currentById = new Map(current.map(row => [row.id, row]))
      if (current.length !== snapshot.length || snapshot.some(row => {
        const latest = currentById.get(row.id)
        return !latest || latest.title !== row.title || latest.order !== row.order
      })) throw new Error('章节目录在预览后已发生变化，请重新预览')
      const confirmedOrderIds = opts.confirmedOrderIds === undefined ? null : new Set(opts.confirmedOrderIds)
      // "不在预览中"仅指该 id 与本次预览完全无关（既不可修、也未登记跳过）。
      // 已登记为跳过的章节属于合法选择，只是本次无法修复，应被跳过而不是拒绝整个操作。
      const knownOrderIds = new Set([
        ...repair.orderChanges.map(change => change.localChapterId),
        ...(repair.orderRepairSkipped || []).map(row => row.localChapterId),
      ])
      if (confirmedOrderIds && [...confirmedOrderIds].some(id => !knownOrderIds.has(id))) {
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
    let coverHistoryId: string | null | undefined
    if (nextCover !== currentNovel.cover_url) {
      metadataUpdated.push('coverUrl')
      coverHistoryId = await invalidateCoverForSourceChange(q, run.novel_id, { actorId: opts.actorUserId, reason: 'source-sync' })
    }
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
      audit.push({ kind: 'metadata', before: Object.fromEntries(NOVEL_SNAPSHOT_FIELDS.map(field => [field, currentNovel[field]])), after, ...(coverHistoryId !== undefined ? { coverHistoryId } : {}) })
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
  return { splitPart, chapterNumber, normalizedTitle, isWeakTitle, groupLocalChapters, alignSourceAndLocal, buildPreview }
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
    const current = normalizeLocalSnapshot((await q<LocalChapterForSync>('SELECT id,title,sort_order AS order FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.novel_id])).rows)
    const byId = new Map(current.map(row => [row.id, row]))
    const original = normalizeLocalSnapshot(safeJsonParse<LocalChapterForSync[]>(run.local_snapshot_json, []))
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
      if (change.coverHistoryId !== undefined) {
        const cover = (await q<StoredCover>('SELECT data, content_type, source, prompt, metadata, updated_at FROM novel_covers WHERE novel_id = $1 FOR UPDATE', [run.novel_id])).rows[0]
        if (cover && !isDefaultCoverSource(cover.source) && cover.source !== String(change.after.cover_url || '').trim()) {
          result.conflicts.push({ id: run.novel_id, title: '小说封面', reason: '封面已被后续替换，保留当前封面与小说信息。' })
          continue
        }
        const previous = change.coverHistoryId
          ? (await q<StoredCover>('SELECT data, content_type, source, prompt, metadata FROM novel_cover_history WHERE id=$1 AND novel_id=$2', [change.coverHistoryId, run.novel_id])).rows[0]
          : undefined
        if (change.coverHistoryId && !previous) {
          result.conflicts.push({ id: run.novel_id, title: '小说封面', reason: '原封面历史已清理，保留当前封面与小说信息。' })
          continue
        }
        await invalidateCoverForSourceChange(q, run.novel_id, { actorId: actorUserId, reason: 'source-sync-rollback' })
        if (previous) await q(
          `INSERT INTO novel_covers (novel_id,data,content_type,source,prompt,metadata,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [run.novel_id, previous.data, previous.content_type, previous.source, previous.prompt, previous.metadata, Date.now()],
        )
      } else if (change.before.cover_url !== change.after.cover_url) {
        // 兼容修复前的融合历史：旧记录只保存了 URL，恢复时让源封面重新按旧 URL 缓存。
        const cover = (await q<{ source: string }>('SELECT source FROM novel_covers WHERE novel_id=$1', [run.novel_id])).rows[0]
        if (cover && /^https?:\/\//i.test(cover.source)) await invalidateCoverForSourceChange(q, run.novel_id, { actorId: actorUserId, reason: 'source-sync-rollback' })
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
    await q('UPDATE novels SET updated_at=GREATEST(updated_at+1,$1) WHERE id=$2', [Date.now(), run.novel_id])
    await q('UPDATE source_sync_runs SET status=$1,rolled_back_at=$2,rollback_result_json=$3 WHERE id=$4',
      [result.conflicts.length ? 'rollback_partial' : 'rolled_back', Date.now(), JSON.stringify(result), runId])
    return result
  })
}
