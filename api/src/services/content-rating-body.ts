/**
 * 正文证据采样 —— 给 LLM 分级提供「作品正文里到底写了什么」的最小充分证据。
 *
 * 为什么必须有这一层：分级链路原先只送标题/简介/分类，于是《入红尘》这类
 * 元数据干净（仙凡婚姻、代嫁）而正文是硬核色情的作品，模型只能给出
 * `unknown` + 20% 置信度。模型没判错，是证据面被砍掉了。
 *
 * 设计约束：
 *   1. **成本可控**：绝不把全书正文送进上下文，也不对每个信号词各扫一遍全书。
 *      先用合并正则粗筛出命中章节（全书只扫一遍），再只对这些章节算权重与命中词，
 *      正文只在被选中做样本时才回传片段，总量上限 `BODY_MAX_TOTAL_CHARS`。
 *   2. **不漏网**：信号词只能定位它收录的写法。因此样本由两层组成 ——
 *      `match`（信号强度最高的章节，命中点上下文）与 `spread`（全书均匀采样，
 *      覆盖信号词没收录的写法）。只有两层都在，模型才可能发现漏网的成人内容。
 *   3. **可复现**：采样完全确定性（无随机数），同一本书必得同一份样本，
 *      这样 AI 建议才可复核、可回归测试。
 *
 * 本模块**不产出分级**。分级只由模型建议 + 人工审核决定，信号词只负责挑样本。
 */
import type { DbClient } from '../db/pool'
import { RESTRICTED_BODY_KEYWORDS, matchRestrictedBodyKeywords } from '@shared/restricted-patterns'

/** 单段样本的正文上限（字符）。 */
export const BODY_EXCERPT_CHARS = 420
/** 信号命中章节的样本条数上限。 */
export const BODY_MATCH_EXCERPT_LIMIT = 6
/** 全书均匀采样的样本条数上限。 */
export const BODY_SPREAD_EXCERPT_LIMIT = 4
/** 采样文本总量上限，防止超长章节把 prompt 撑爆。 */
export const BODY_MAX_TOTAL_CHARS = 5_200
/** 命中点前保留的上下文宽度，用于让模型看到完整句子而不是半截词。 */
const MATCH_CONTEXT_LEAD = 200

export interface ContentRatingBodyExcerpt {
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  /** `match`：信号词命中定位；`spread`：全书均匀采样。 */
  origin: 'match' | 'spread'
  /** 该片段文本里出现的信号词（去重）。 */
  keywords: string[]
  text: string
}

export interface ContentRatingBodyKeywordHit {
  keyword: string
  chapters: number
}

export interface ContentRatingBodySample {
  /** 作品是否有可读正文。false 表示尚未抓取正文，此时判级只能依赖元数据。 */
  hasBody: boolean
  chapterCount: number
  /** 参与统计的正文字符总数。 */
  scannedCharacters: number
  /** 信号词命中的章节数；除以 `chapterCount` 即命中章节占比。 */
  matchedChapterCount: number
  /** 命中章节占比，保留三位小数；无正文时为 0。 */
  matchedChapterRatio: number
  /** 全书各信号词命中的章节数（降序、只保留命中项），用于判断成人内容是普遍还是局部。 */
  keywordHits: ContentRatingBodyKeywordHit[]
  excerpts: ContentRatingBodyExcerpt[]
}

interface BodyChapterRow {
  id: string
  title: string
  sort_order: number
  chars: number
  hit: boolean | string | number | null
}

interface BodyChapterDetailRow {
  id: string
  score: number | string | null
  first_pos: number | string | null
}

interface ExcerptRow {
  id: string
  text: string | null
}

/** 无正文作品的空样本；读取失败时降级使用，prompt 会据此要求压低置信度。 */
export function emptyContentRatingBodySample(): ContentRatingBodySample {
  return { hasBody: false, chapterCount: 0, scannedCharacters: 0, matchedChapterCount: 0, matchedChapterRatio: 0, keywordHits: [], excerpts: [] }
}

function toInt(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function toBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1'
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 合并粗筛正则。信号词全部是中文纯字面量，转义后 JS 与 Postgres 两种正则语法等价，
 * 因此可以在 SQL 里用一次 `~` 扫完全书，而不必为每个词各扫一遍。
 */
const BODY_MATCH_REGEX = `(${RESTRICTED_BODY_KEYWORDS.map((item) => escapeRegex(item.keyword)).join('|')})`

/**
 * 正文规范化：剥掉标签、折叠空白、清除控制字符与零宽字符。
 * 样本要进 prompt 并被审核员阅读，任何残留标记都只会消耗 token。
 */
export function normalizeBodyText(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 章节正文的信号强度合计表达式（只对粗筛命中章节求值）。 */
function buildScoreExpression(): string {
  return RESTRICTED_BODY_KEYWORDS.map(
    (item, index) => `CASE WHEN strpos(content, $${index + 2}) > 0 THEN ${item.weight} ELSE 0 END`,
  ).join(' + ')
}

/**
 * 首个信号词出现的位置。Postgres 的 `least` 忽略 NULL，全部未命中时返回 NULL，
 * 因此可以直接用 `nullif(strpos(...), 0)` 过滤未命中项。
 */
function buildFirstPositionExpression(): string {
  return `least(${RESTRICTED_BODY_KEYWORDS.map((_, index) => `nullif(strpos(content, $${index + 2}), 0)`).join(', ')})`
}

/** 每个信号词命中多少章；单行聚合，避免把逐章布尔矩阵回传到 Node。 */
function buildKeywordCountExpression(): string {
  return RESTRICTED_BODY_KEYWORDS.map(
    (_, index) => `COUNT(*) FILTER (WHERE strpos(content, $${index + 2}) > 0)::int AS kw_${index}`,
  ).join(', ')
}

/** 在按序列表里均匀取 count 个下标（居中取值，避免总取首尾）。 */
function evenlySpacedIndexes(length: number, count: number): number[] {
  if (length <= 0 || count <= 0) return []
  if (length <= count) return Array.from({ length }, (_, index) => index)
  const step = length / count
  const indexes: number[] = []
  for (let index = 0; index < count; index++) {
    indexes.push(Math.min(length - 1, Math.floor(step * index + step / 2)))
  }
  return Array.from(new Set(indexes))
}

function excerptFrom(
  chapter: { id: string; title: string; sort_order: number },
  origin: 'match' | 'spread',
  text: string,
): ContentRatingBodyExcerpt {
  const normalized = normalizeBodyText(text)
  return {
    chapterId: String(chapter.id),
    chapterTitle: String(chapter.title || ''),
    chapterOrder: toInt(chapter.sort_order),
    origin,
    keywords: matchRestrictedBodyKeywords(normalized),
    text: normalized,
  }
}

/**
 * 采集一本书的正文样本。
 *
 * 查询顺序即成本顺序：粗筛（全书一遍）→ 命中章节的逐词统计与权重 → 选中章节的片段。
 * 正文只在最后一步按需回传，且被选中章节数有上限。
 */
export async function loadContentRatingBodySample(
  query: DbClient['query'],
  novelId: string,
  options: { matchLimit?: number; spreadLimit?: number } = {},
): Promise<ContentRatingBodySample> {
  const matchLimit = Math.max(0, Math.trunc(options.matchLimit ?? BODY_MATCH_EXCERPT_LIMIT))
  const spreadLimit = Math.max(0, Math.trunc(options.spreadLimit ?? BODY_SPREAD_EXCERPT_LIMIT))

  const chapters = (
    await query<BodyChapterRow>(
      `SELECT id, title, sort_order, length(content) AS chars, (content ~ $2) AS hit
         FROM chapters
        WHERE novel_id = $1 AND length(content) > 0
        ORDER BY sort_order ASC, id ASC`,
      [novelId, BODY_MATCH_REGEX],
    )
  ).rows.map((row) => ({
    id: String(row.id),
    title: String(row.title || ''),
    sort_order: toInt(row.sort_order),
    chars: toInt(row.chars),
    hit: toBool(row.hit),
  }))
  if (!chapters.length) return emptyContentRatingBodySample()

  const scannedCharacters = chapters.reduce((total, chapter) => total + chapter.chars, 0)
  const matched = chapters.filter((chapter) => chapter.hit)
  const keywordParams: unknown[] = [novelId, ...RESTRICTED_BODY_KEYWORDS.map((item) => item.keyword)]

  let keywordHits: ContentRatingBodyKeywordHit[] = []
  const detailById = new Map<string, { score: number; firstPos: number }>()
  if (matched.length) {
    // 逐词统计与权重只作用于命中章节：粗筛已经把范围收窄，这里不必再扫全书。
    const keywordRows = await query<Record<string, unknown>>(
      `SELECT ${buildKeywordCountExpression()}
         FROM chapters
        WHERE novel_id = $1 AND length(content) > 0 AND content ~ $${RESTRICTED_BODY_KEYWORDS.length + 2}`,
      [...keywordParams, BODY_MATCH_REGEX],
    )
    const keywordCounts = keywordRows.rows[0] || {}
    keywordHits = RESTRICTED_BODY_KEYWORDS.map((item, index) => ({
      keyword: item.keyword,
      chapters: toInt(keywordCounts[`kw_${index}`]),
    }))
      .filter((item) => item.chapters > 0)
      .sort((a, b) => b.chapters - a.chapters || a.keyword.localeCompare(b.keyword))

    const details = await query<BodyChapterDetailRow>(
      `SELECT id, (${buildScoreExpression()}) AS score, (${buildFirstPositionExpression()}) AS first_pos
         FROM chapters
        WHERE novel_id = $1 AND length(content) > 0 AND content ~ $${RESTRICTED_BODY_KEYWORDS.length + 2}`,
      [...keywordParams, BODY_MATCH_REGEX],
    )
    for (const row of details.rows) detailById.set(String(row.id), { score: toInt(row.score), firstPos: toInt(row.first_pos) })
  }

  // 命中章节的挑选：先按信号强度取候选池，再在候选池里按章节顺序均匀取样。
  // 直接取 top-N 会让样本全部集中在某一卷，无法反映全书分布。
  const ranked = matched
    .map((chapter) => ({ chapter, ...(detailById.get(chapter.id) || { score: 0, firstPos: 0 }) }))
    .sort((a, b) => b.score - a.score || a.chapter.sort_order - b.chapter.sort_order)
  const candidatePool = ranked.slice(0, Math.max(matchLimit * 3, matchLimit)).sort((a, b) => a.chapter.sort_order - b.chapter.sort_order)
  const matchPicked = evenlySpacedIndexes(candidatePool.length, Math.min(matchLimit, candidatePool.length)).map((index) => candidatePool[index]!)

  const matchIds = new Set(matchPicked.map((item) => item.chapter.id))
  const spreadPool = chapters.filter((chapter) => !matchIds.has(chapter.id))
  const spreadPicked = evenlySpacedIndexes(spreadPool.length, Math.min(spreadLimit, spreadPool.length)).map((index) => spreadPool[index]!)

  const matchTargets = matchPicked.map((item) => ({
    chapter: item.chapter,
    origin: 'match' as const,
    // 从命中点前 200 字开始，保证片段里含完整句子与上下文。
    startAt: Math.max(1, item.firstPos > 0 ? item.firstPos - MATCH_CONTEXT_LEAD : 1),
    take: BODY_EXCERPT_CHARS,
  }))
  const spreadTargets = spreadPicked.map((chapter) => ({
    chapter,
    origin: 'spread' as const,
    // 均匀样本取章节中段：开头多为承接上章的过渡句，结尾常是下一章的钩子。
    startAt: Math.max(1, Math.floor(chapter.chars * 0.35)),
    take: BODY_EXCERPT_CHARS,
  }))
  // 截断顺序 = 证据强度顺序：命中片段先占用预算，均匀样本只补剩余空间。
  const targets = [...matchTargets, ...spreadTargets]

  const base = {
    hasBody: true,
    chapterCount: chapters.length,
    scannedCharacters,
    matchedChapterCount: matched.length,
    matchedChapterRatio: Number((matched.length / chapters.length).toFixed(3)),
    keywordHits,
  }
  if (!targets.length) return { ...base, excerpts: [] }

  const excerptRows = await query<ExcerptRow>(
    `SELECT c.id, substring(c.content FROM g.start_at FOR g.take) AS text
       FROM chapters c
       JOIN unnest($1::text[], $2::int[], $3::int[]) AS g(id, start_at, take) ON g.id = c.id`,
    [targets.map((item) => item.chapter.id), targets.map((item) => item.startAt), targets.map((item) => item.take)],
  )
  const textById = new Map(excerptRows.rows.map((row) => [String(row.id), String(row.text || '')]))

  const excerpts: ContentRatingBodyExcerpt[] = []
  let totalChars = 0
  for (const target of targets) {
    const excerpt = excerptFrom(target.chapter, target.origin, textById.get(target.chapter.id) || '')
    if (!excerpt.text) continue
    if (totalChars + excerpt.text.length > BODY_MAX_TOTAL_CHARS) break
    totalChars += excerpt.text.length
    excerpts.push(excerpt)
  }
  // 呈现顺序：命中片段排前，模型与审核员先看到最直接的判级依据。
  excerpts.sort((a, b) => (a.origin === b.origin ? a.chapterOrder - b.chapterOrder : a.origin === 'match' ? -1 : 1))

  return { ...base, excerpts }
}
