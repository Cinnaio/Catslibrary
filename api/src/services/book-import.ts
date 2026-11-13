import { normalizeImportCover, coverSnapshot, coverFingerprint } from './book-import-cover'
import { prepareCoverDisplays } from './cover-display'
import { parseExportText } from './novel-export-text'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type {
  BookImportAnomaly,
  BookImportChapterDiff,
  BookImportChapterResolution,
  BookImportChapterInput,
  BookImportCommitResult,
  BookImportDiagnostics,
  BookImportLineEvidence,
  BookImportMetadataDiff,
  BookImportNovelCandidate,
  BookImportPayload,
  BookImportPreview,
  BookImportRollbackResult,
  BookImportSplitStats,
  BookImportVerdictConfidence,
  Novel,
} from '@shared/types'
import { all, withTx } from '../db/query'
import { planImportInsertions } from '@shared/book-import-resolution'
import type { Db } from '../db/pool'
import { newId } from './auth'
import { normalizeCategories } from './categories'
import { rowToNovel, safeJsonParse, type NovelRow } from '../db/mappers'
import { simplifyChapterForSource, simplifyNovelForSource } from './zh-convert'
import { evaluateContentRatingRules, loadContentRatingRuleSet } from './content-rating-rules'
import { applyContentRatingChange } from './content-rating-governance'
import { detectMeta, collectChapterLinks } from './scraper/meta'
import { cleanHtml, cleanText, extractContent, extractLinks, extractText } from './scraper/parse'
import { adapterForUrl } from './scraper/sources'
import { getPresetForUrl, type ScrapeStore } from './scraper/store'
import type { FetchHtmlOptions, FetchResult } from './scraper/fetch'
import type { SitePreset } from './scraper/presets'

const MAX_IMPORT_BYTES = 25 * 1024 * 1024
const MAX_IMPORT_CHAPTERS = 1000
/**
 * 章节标题识别。
 * 真实 TXT 里正文首行可能以「第一回体验性爱……」这种长句开头，它同样符合
 * 「第 + 数字 + 回」却是一句正文。这样一行被当成标题，会把整章正文挂到它名下、
 * 前面的章级标题变成空章（实测一份 53 章的文件因此只剩 34 章）。
 * 因此标题长度封顶，且不允许以句读结尾。
 */
const CHAPTER_HEADING_TEXT = '(?:第\\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\\s*[章节回卷集部篇]|chapter\\s*\\d+|\\d+[.、．])'
const CHAPTER_HEADING = new RegExp(`^\\s*(${CHAPTER_HEADING_TEXT}(?:\\s*.*)?)\\s*$`, 'i')

/**
 * 行首不可见字符：站点导出常把零宽空格 U+2061（函数应用符）、U+FEFF 等
 * 混进标题行开头，如 `⁡ 0083 和哥哥同居啦！`。不剥离会让整行识别失败。
 */
const LEADING_INVISIBLE = /^[\u200B-\u200F\u2060-\u206F\uFEFF]+/

/**
 * 裸数字标题（编号后有空白）：`0073 我们做夫妻也是可以的`、`32 她才不想要呢……`。
 * 同一份站点导出里常与「第0073章 标题」混用（本站几十章后切换了写法），
 * 只认「第NNN章」会让中间几十章整段丢失（实测一份 90 章的文件因此只剩 45 章）。
 * 无空白的紧贴写法由 BARE_NUMBER_TIGHT 兜底。
 */
const BARE_NUMBER_HEADING = /^\s*([0-9０-９]{1,4})(?:[ \t\u3000]+)(\S[^\n]*?)\s*$/

const MAX_CHAPTER_TITLE_LENGTH = 40
/**
 * 正文句子的收尾标点。标题以句号或省略号结尾很罕见，出现即倾向正文
 * （「第一回体验性爱就被内射，谢溪大脑空白了一瞬……」）。
 *
 * 但不能一律否决：`第0006章 傅哥哥，疼……` 是真实章名，只是以省略号收尾。
 * 故与叹号规则一样按长度二次约束——正文长句同时满足「句读收尾」与「超长」，
 * 短标题不会。实测该文件因此丢过第 6 章。
 */
const PROSE_ENDING = /[。…]$/
/** 叹号/问号：章节名常用（「休得如此荒唐！」「李云儿，没啦！」），不能一律否决。 */
const EXCLAIM_ENDING = /[！？；]$/
/**
 * 短标题阈值（≤26 字）：这一长度内的标题无论以何种标点收尾都视为正常章名。
 * 「傅哥哥，疼……」「李云儿，没啦！」「休得如此荒唐！」都落在此区间。
 */
const MAX_SHORT_TITLE_LENGTH = 26
/**
 * 裸数字标题的长度上限。真实章名可达 35 字左右
 * （「0079在哥哥注视下骑乘吃他肉棒，最后被他从下面撞击，被肏哭肏喷（高h）【2900珠加更】」），
 * 而正文长句普遍更长，故取 48 作分界。
 */
const MAX_BARE_TITLE_LENGTH = 48
/**
 * 裸数字标题的编号上限（含）。中文网文单本极少超过 999 章；
 * 而正文里的年份（2016）≥ 1000，会被这条挡掉。
 */
const MAX_BARE_NUMBER = 999
/**
 * 紧贴写法（`32标题`、`0083和哥哥同居啦`）的编号上限。三位数字紧贴中文的正文串
 * （「1200珠加更」「365天」）风险较高，故仅认 1-4 位、首字非数字、且后续非空白。
 * 四位年份（2016年……）由编号上限与句读否决共同挡掉。
 */
const BARE_NUMBER_TIGHT = /^\s*([0-9０-９]{1,4})([^\s0-9０-９][^\n]*?)\s*$/u

/**
 * 论坛/评论区楼层标记，出现在裸数字标题的标题文本位置：`1楼`、`2楼楼主`、`6楼:回复内容`。
 *
 * 站点把「论坛番外」这类章内论坛体导出成 TXT 时，楼层会退化成紧贴的「编号 + 楼」，
 * 而它天然符合裸数字章节的形状，于是每个楼层都被切成独立章节——实测一份 59 章的文件
 * 因此多出 46 个幽灵章节（「1 楼」「2 楼楼主」…「46 楼」）。
 *
 * 剥掉编号后，标题文本的形态只有三种：`楼`（纯楼层）、`楼楼主`（楼主自述）、`楼:内容`（引用）。
 * 显式列举这三种，避免误伤真正以「楼」开头的章名——「12楼上的秘密」不会被否决。
 */
const FORUM_FLOOR_BODY = /^楼(?:楼主)?(?:[:：]|$)/u

/**
 * 行首缩进（半角空格或全角空格）。
 *
 * 导出格式里章节标题位于行首，正文段落才带缩进。紧贴写法没有分隔符、歧义最大，
 * 因此额外要求该行未缩进——实测「117骗了她！」「117有点慌，……」这类以系统名 117
 * 开头的正文段落都带缩进，而真章节「0117世界三:…」在行首。
 */
const LEADING_INDENT = /^[ \t\u3000]/

/**
 * 剥掉编号后紧跟冒号：`1：男强女弱…`、`4:默认男主已结扎！！！`。
 * 这是编号列表项（排雷/说明清单）的写法，不是章节——真章节的冒号出现在标题内部
 * （`0117世界三:性瘾症亲侄女…`），不会紧贴编号。
 */
const LIST_MARKER_BODY = /^[:：]/

/**
 * 剥掉编号后紧跟数量单位：`1万点积分？…`、`99%了，只差临门一脚…`。
 * 这些是正文里的数量（万/亿/%/‰），不是章节号。
 */
const QUANTITY_BODY = /^(?:万|亿|%|‰|珠(?:的|加更|到|了|，|,|$))/u

/**
 * 首个章节标题之前、短于此长度的残留块视为站点前置信息（宣传位、避雷说明），不是章节。
 *
 * 取 600：这几份导出里真实章节均在 1000 字以上（病弱本 217-2760、炉鼎本 1756-3541），
 * 而前置块只有 31-455 字。留出余量后既能清掉前置块，又不会把「首章未标标题」
 * 的文件里那一章正文误删。
 */
const MAX_FRONT_MATTER_LENGTH = 600

/**
 * 裸数字编号是否可能是章节号。
 *
 * 下界排除 0：章节号从 1 开始，正文里却常出现「0个人问你脸和身材」（网络语「没有人」）
 * 这类以 0 开头紧贴中文的句子，它们天然满足裸数字标题的形状。
 * 上界排除年份与珠数：`2016年`、`1200珠` 不是章节号。
 */
function isPlausibleChapterNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= MAX_BARE_NUMBER
}

/**
 * 行判定探针：命中返回标题，未命中带出否决理由。
 *
 * 判定不再只返回 string | null —— 诊断面板要回答「这一行为什么被当成 / 没当成
 * 章节标题」，AI 复核要据此挑出证据不足的行。把理由丢弃在正则里，出问题时
 * 只能靠人肉猜，也无法区分「规则判错」与「模型判错」。
 */
export interface HeadingProbe {
  /** 命中的标题原文；未命中为 null。 */
  title: string | null
  /** 命中的规则标识；未命中时为 prose。 */
  rule: string
  confidence: BookImportVerdictConfidence
  /** 形似章节却被否决时，触发否决的规则标识。 */
  rejectedBy?: string
  /** 证据不足，值得送模型复核。 */
  uncertain: boolean
}

/** 未命中任何标题形状时的统一标识。 */
const PROSE_RULE = 'prose'

/**
 * 无编号但形态像章名的短行：序章/楔子/尾声/番外这类真实存在的章名，
 * 现有正则只认数字编号，整类会被判成正文——这是复核最该救回的漏判。
 */
const UNNUMBERED_HEADING_SHAPE = /^(?:序章|序言|序|楔子|引子|前言|尾声|终章|尾章|后记|番外|外传|大结局)(?:[\s:：].*)?$/u

/**
 * 判断一行是否为可用的章节标题行。
 * 返回标题原文（已去首尾空白），非标题返回 null。
 * 行为与引入证据前完全一致：probeChapterHeadingLine(line).title 即原返回值。
 */
export function isChapterHeadingLine(line: string): string | null {
  return probeChapterHeadingLine(line).title
}

/**
 * 逐行判定并带出证据。判定顺序与阈值与历史实现一致，只是不再丢弃否决理由。
 */
export function probeChapterHeadingLine(line: string): HeadingProbe {
  // 行首零宽字符（U+200B-U+200F、U+2060-U+206F、U+FEFF）是站点导出的常见污染，
  // 不剥离会让整行识别失败。
  const raw = String(line || '').replace(LEADING_INVISIBLE, '')
  if (/^\s*\d+\s*[vV]\s*\d+(?:\b|[，,、])/u.test(raw)) {
    return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'relationship-tag', uncertain: false }
  }
  if (/^\s*第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*(?:回合|节课)/u.test(raw)) {
    return { title: null, rule: PROSE_RULE, confidence: 'medium', rejectedBy: 'prose-number-expression', uncertain: true }
  }
  const match = raw.match(CHAPTER_HEADING)
  if (match) {
    const title = match[1]!.trim()
    if (title.length > MAX_CHAPTER_TITLE_LENGTH) {
      return { title: null, rule: PROSE_RULE, confidence: 'medium', rejectedBy: 'overlong-title', uncertain: true }
    }
    // 结尾标点按「是否短标题」二次约束，两类标点都不能一律否决：
    // - 「。」「…」倾向正文，但短标题合法（`第0006章 傅哥哥，疼……`）；
    // - 「！」「？」章节名常用（`第0022章 （纯剧情章）休得如此荒唐！`）。
    // 正文长句同时满足「句读收尾」与「超长」，短标题不会，故用长度区分。
    if (title.length > MAX_SHORT_TITLE_LENGTH && (PROSE_ENDING.test(title) || EXCLAIM_ENDING.test(title))) {
      return { title: null, rule: PROSE_RULE, confidence: 'medium', rejectedBy: 'prose-ending-long-title', uncertain: true }
    }
    return { title, rule: 'numbered-heading', confidence: 'high', uncertain: false }
  }
  // 裸数字标题：`0073 我们做夫妻也是可以的【2500珠加更】`（编号后有空白）
  const bare = raw.match(BARE_NUMBER_HEADING)
  if (bare) {
    // 保留原始编号字符串（含前导零）：`003 我们走吧` 归一成 `3` 会丢掉站点导出的位宽，
    // 也让「按编号对齐」在跨版本比对时认不出同一章。
    const digits = bare[1]!.normalize('NFKC')
    const number = Number(digits)
    const body = bare[2]!
    if (!isPlausibleChapterNumber(number)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'implausible-number', uncertain: false }
    }
    if (body.length > MAX_BARE_TITLE_LENGTH) {
      return { title: null, rule: PROSE_RULE, confidence: 'medium', rejectedBy: 'overlong-title', uncertain: true }
    }
    // 论坛楼层（`1 楼`、`2 楼楼主`）不是章节，见 FORUM_FLOOR_BODY。
    if (FORUM_FLOOR_BODY.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'forum-floor', uncertain: false }
    }
    // 编号列表项（`1：男强女弱…`）与数量（`1万点积分…`）不是章节。
    if (LIST_MARKER_BODY.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'list-marker', uncertain: false }
    }
    if (QUANTITY_BODY.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'quantity-unit', uncertain: false }
    }
    // 编号后有显式空白时，句读不参与否决：作者会把公告类章名写成
    // 「81 晚点更新。顺便安利篇很香的兄妹骨。」，带句号仍是标题。
    // 真正需要挡掉的是超长正文，已由长度上限覆盖。
    return { title: `${digits} ${body}`.trim(), rule: 'bare-number-spaced', confidence: 'medium', uncertain: false }
  }
  // 紧贴写法：`32她才不想要呢……【400珠加更】`、`0083和哥哥同居啦！`——编号与正文之间无空白。
  const tight = raw.match(BARE_NUMBER_TIGHT)
  if (tight) {
    const digits = tight[1]!.normalize('NFKC')
    const number = Number(digits)
    const body = tight[2]!
    if (!isPlausibleChapterNumber(number)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'implausible-number', uncertain: false }
    }
    if (body.length > MAX_BARE_TITLE_LENGTH) {
      return { title: null, rule: PROSE_RULE, confidence: 'medium', rejectedBy: 'overlong-title', uncertain: true }
    }
    // 论坛楼层几乎都写成紧贴的 `1楼`/`2楼楼主`，是这条规则最容易吃进来的噪声。
    if (FORUM_FLOOR_BODY.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'forum-floor', uncertain: false }
    }
    // 编号列表项与数量：`4:默认男主已结扎！！！`、`1万点积分？…`、`99%了，…`。
    if (LIST_MARKER_BODY.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'list-marker', uncertain: false }
    }
    if (QUANTITY_BODY.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'high', rejectedBy: 'quantity-unit', uncertain: false }
    }
    // 无分隔符时风险最高，额外要求行首未缩进：标题在行首，正文段落带缩进。
    // 「117骗了她！」「117有点慌，……」都以缩进开头，是正文而非章节。
    // 但这条同样会挡住「缩进排版的正文章节标题」，故标记待复核而非确定否决。
    if (LEADING_INDENT.test(raw)) {
      return { title: null, rule: PROSE_RULE, confidence: 'low', rejectedBy: 'leading-indent', uncertain: true }
    }
    // 句号收尾一律否决：「69是什么，她之前其实没有听过。」是正文，不是「69」章的标题。
    if (PROSE_ENDING.test(body)) {
      return { title: null, rule: PROSE_RULE, confidence: 'low', rejectedBy: 'prose-ending', uncertain: true }
    }
    return { title: `${digits} ${body}`.trim(), rule: 'bare-number-tight', confidence: 'low', uncertain: true }
  }
  // 无编号章名（序章/楔子/尾声/番外）：形态像标题却不带编号，现有规则整类漏判。
  const shaped = raw.trim()
  if (shaped && shaped.length <= MAX_CHAPTER_TITLE_LENGTH && !LEADING_INDENT.test(raw) && UNNUMBERED_HEADING_SHAPE.test(shaped)) {
    return { title: null, rule: PROSE_RULE, confidence: 'low', rejectedBy: 'unnumbered-heading-shape', uncertain: true }
  }
  return { title: null, rule: PROSE_RULE, confidence: 'high', uncertain: false }
}

/**
 * 因「长度 / 句读 / 缩进」这类弱证据被否决的理由。这些行只是「形似正文」，
 * 并非确定不是章节，因此允许由编号缺口回填救回。
 *
 * 论坛楼层、编号列表项、数量单位、编号超界不在此列：它们是被形态确定排除的，
 * 编号缺口也救不回（否则会把「2016 年……」这类正文重新吃成章节）。
 */
const WEAK_REJECTION_REASONS = new Set(['overlong-title', 'prose-ending-long-title', 'prose-ending', 'leading-indent'])

/**
 * 单次回填允许填补的最大缺口。缺口越大，「候选恰好填满」越不可能是巧合，
 * 但也越可能是作者跳号或文件残缺；取 50 作上界，避免为超大缺口做无谓扫描。
 */
const MAX_RESCUE_RUN = 50

/**
 * 卷/部/篇是容器级标题，不是章节。真实站点导出的 TXT 里「第三卷」往往直接跟在
 * 上一章正文后面，若当章节切，上一章正文会被截到卷标题为止。
 */
const VOLUME_HEADING = /^第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[卷部篇](?:\s|$)/u

/** 卷标题里常带章节名（如「第三卷 第四十九章 反击」），取末尾章节编号用于去重。 */
const EMBEDDED_VOLUME_CHAPTER = /第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章回节]/u

/** 「第0009章」「第九章」这类标题前缀；中文数字也要剥，两种写法指的是同一章。 */
const NUMBERED_HEADING_PREFIX = /^第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?\s*/u

export interface StoredImportRun {
  supplementary_binding_id?: string
  supplementary_file_key?: string
  id: string
  source_type: 'file' | 'url'
  source_label: string
  source_url: string
  target_novel_id: string
  status: string
  payload_json: string
  preview_json: string
  changes_json: string
  /**
   * 原始文本快照（仅 TXT 导入有内容）。AI 边界复核后的重切与诊断复盘
   * 都依赖原始行序。历史列表刻意不选这一列，避免整份文件进列表响应。
   */
  source_text: string
  revision?: number
  source_hash?: string
  source_expires_at?: number
  created_at: number
  applied_at: number
  rolled_back_at: number
}

export interface ImportPreviewOptions {
  sourceType: 'file' | 'url'
  sourceLabel: string
  sourceUrl: string
  payload: BookImportPayload
  targetNovelId?: string | null
  runId?: string
  /** 解析诊断；URL 复核与旧快照可能没有。 */
  diagnostics?: BookImportDiagnostics
  /** 附加源确认流程：保留融合序号、只追加尾章，并禁选作品元数据。 */
  preserveLocalOrder?: boolean
}

export interface ChapterRow {
  id: string
  title: string
  sort_order: number
  content: string
  source_url: string
}

interface AppliedChange {
  id: string
  kind: 'create-chapter' | 'update-chapter' | 'reorder-chapter' | 'metadata' | 'create-novel' | 'cover-image'
  title: string
  novelId: string
  chapterId?: string
  before?: Record<string, unknown> | null
  after: Record<string, unknown>
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\u0000/g, '').trim()
}

/** 标题匹配只忽略格式噪声，不做繁简转换，避免不同版本作品被静默合并。 */
export function normalizeImportTitle(value: unknown): string {
  return text(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[《》「」『』【】()[\]{}]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function normalizeImportChapterTitle(value: unknown): string {
  let title = text(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
  for (let round = 0; round < 4; round++) {
    const next = title
      // 逐层剥离导出编号与作者编号，包含「64 第六十一章 标题」这样的混排。
      .replace(/^第\s*[0-9０-９]+\s*[章节回卷集部篇]?\s*/i, '')
      .replace(/^第\s*[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?\s*/i, '')
      .replace(/^chapter\s*\d+\s*/i, '')
      // 点后排除数字，保留「12.5公里的路」等标题中的小数。
      .replace(/^(?:[0-9０-９]{1,4}(?:\s+|[.、．](?![0-9０-９])\s*))+/, '')
    if (next === title) break
    title = next
  }
  return title.replace(/[^\p{L}\p{N}]+/gu, '')
}

export function normalizeImportContent(value: unknown): string {
  return String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function importContentHash(value: unknown): string {
  return createHash('sha256').update(normalizeImportContent(value)).digest('hex')
}

function safeSourceUrl(value: unknown): string {
  const candidate = text(value)
  if (!candidate) return ''
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

function normalizedCategories(value: unknown): string[] {
  return normalizeCategories(Array.isArray(value) ? value.map(text) : text(value).split(/[,，、]/))
}

export function normalizeImportPayload(raw: Partial<BookImportPayload>): BookImportPayload {
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .map((chapter, index): BookImportChapterInput => ({
          title: text(chapter?.title) || `第 ${index + 1} 章`,
          order: Number(chapter?.order) || index + 1,
          content: String(chapter?.content ?? ''),
          sourceUrl: safeSourceUrl(chapter?.sourceUrl),
          ...(chapter?.volumeTitle ? { volumeTitle: text(chapter.volumeTitle) } : {}),
        }))
        .filter((chapter) => chapter.content.trim() || chapter.title.trim())
        .slice(0, MAX_IMPORT_CHAPTERS)
    : []

  const title = text(raw.title)
  if (!title) throw new Error('导入文件缺少书名')
  if (!chapters.length) throw new Error('导入内容没有可识别的章节')

  return {
    title,
    ...(raw.coverImage ? { coverImage: normalizeImportCover(raw.coverImage) } : {}),
    author: text(raw.author) || '未知作者',
    description: text(raw.description),
    coverUrl: safeSourceUrl(raw.coverUrl),
    categories: normalizedCategories(raw.categories),
    status: text(raw.status) === 'completed' ? 'completed' : 'ongoing',
    sourceUrl: safeSourceUrl(raw.sourceUrl),
    chapters,
  }
}

/**
 * 文件名里的排版噪声：[更73]、[完结]、【完结】这类更新标记，以及「作者：归雾」「by 归雾」署名。
 * 它们属于导出习惯，不属于书名——不去掉会让「[更73] 某某 作者：归雾」与库里的「某某」永不相等。
 */
const FILE_NAME_NOISE = [
  /^[\s]*[[【(（]\s*(?:更|更新|完结|全本|番外|精校|校对|未删减|完结+番外)\s*[0-9０-９]*\s*[\]】)）]\s*/u,
  /[\s]*[[【(（]\s*(?:更|更新|完结|全本|番外|精校|校对|未删减|完结+番外)\s*[0-9０-９]*\s*[\]】)）][\s]*/gu,
  /[\s]*[-—–_|｜]?\s*(?:作者|著者|原著)\s*[:：]?\s*\S+\s*$/u,
  /[\s]*[-—–_|｜]\s*(?:by|By|BY)\s+\S+\s*$/u,
]

function fileStem(name: string): string {
  let stem = text(name).replace(/\.[^.]+$/, '')
  for (const pattern of FILE_NAME_NOISE) stem = stem.replace(pattern, '')
  return stem.replace(/[._-]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * 匹配用的标题归一化：去掉卷册标记、更新标记、空白与标点。
 * 只做格式噪声处理，不做繁简转换——那是刻意保留的，避免不同版本被静默合并。
 */
function matchKey(value: unknown): string {
  return normalizeImportTitle(
    text(value)
      .replace(/[[【(（]\s*(?:更|更新|完结|全本|番外|精校|校对|未删减)[^\])）】]*[\])）】]/gu, '')
      .replace(/\b(?:第\s*[0-9]+\s*[卷部册]|卷[0-9]+)\b/gu, ''),
  )
}

// 只识别独立的标签，保留英文单词或编号末尾的相同字母。
const TRAILING_TITLE_TAG = /(?:\(\s*NPH?\s*\)|\[\s*NPH?\s*\]|【\s*NPH?\s*】|(?<![\p{Script=Latin}\p{N}])NPH?)$/iu

function titleKey(value: unknown, ignoreTag = false): string {
  let title = text(value)
  for (const pattern of FILE_NAME_NOISE) title = title.replace(pattern, '')
  if (ignoreTag) {
    title = title.normalize('NFKC').replace(/》$/u, '').trimEnd()
      .replace(TRAILING_TITLE_TAG, '')
  }
  return matchKey(title)
}

/** 只允许清理导出标记后的完整书名相同，包含关系不能证明是同一本书。 */
function titlesMatch(a: unknown, b: unknown): boolean {
  const left = titleKey(a)
  const right = titleKey(b)
  return Boolean(left && right && left === right)
}

function knownAuthor(value: unknown): string {
  const author = matchKey(value)
  return author === matchKey('未知作者') ? '' : author
}

/**
 * 切分阶段的章节去重键。
 * 「第0001章 初入」和正文首行重抄的「第一章」指的是同一章，但两者剥号后的标题文本
 * 完全不同（初入 / 空）。真正的共同点是章节编号，所以键取编号本身。
 * 无编号标题（「前言」）回退到归一化标题。
 */
export function importChapterKey(title: unknown): string {
  const raw = text(title)
  if (!raw) return ''
  const normalized = raw.normalize('NFKC').trim()
  const numbered = normalized.match(NUMBERED_HEADING_PREFIX)
  if (numbered) {
    const digits = numbered[0].replace(/[^0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]/gu, '')
    if (digits) return `#${normalizeImportChapterNumber(digits)}`
  }
  // 裸数字标题（`0073 我们做夫妻也是可以的`）同样以编号为键，
  // 否则它与「第0073章」写法会被当成两章。
  const bare = normalized.match(BARE_NUMBER_HEADING)
    || normalized.match(/^([0-9]{1,4})[.、](?![0-9])\s*\S/u)
    || normalized.match(/^chapter\s*(\d+)\b/i)
    || normalized.match(/^([0-9]{1,4})(?=[^\s0-9.、:：])/u)
  if (bare) return `#${normalizeImportChapterNumber(bare[1]!)}`
  return normalizeImportChapterTitle(raw)
}

/**
 * 从疑似标题行里取章节编号，取不到返回 null。
 * 复用 importChapterKey 的编号归一化，保证回填出来的键与常规路径逐字一致——
 * 幂等键一旦分叉，增量导入就会把已有章节整片误判成新增。
 */
export function chapterNumberFromTitle(title: unknown): number | null {
  const key = importChapterKey(title)
  if (!key.startsWith('#')) return null
  const value = Number(key.slice(1))
  return Number.isFinite(value) && value >= 1 ? value : null
}

/** 导出编号之外还有明确作者编号时，用内层编号辨认版本，保留原始标题用于展示和诊断。 */
function chapterVersionKey(title: string): string {
  const raw = title.normalize('NFKC').trim()
  const inner = raw.replace(NUMBERED_HEADING_PREFIX, '').replace(/^\d+\s+(?=(?:第|\d+[.、]))/u, '')
  return inner !== raw && CHAPTER_HEADING.test(inner) ? importChapterKey(inner) : importChapterKey(raw)
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
}
const CHINESE_UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000 }

/** 把「0009」「九」「十九」「一百零八」统一成数字字符串，用于跨写法去重。 */
export function normalizeImportChapterNumber(value: unknown): string {
  const raw = String(value ?? '').normalize('NFKC').trim()
  if (!raw) return ''
  if (/^[0-9]+$/.test(raw)) return String(Number(raw))
  let total = 0
  let section = 0
  let current = 0
  for (const char of raw) {
    if (char in CHINESE_DIGITS) {
      current = CHINESE_DIGITS[char]!
      continue
    }
    const unit = CHINESE_UNITS[char]
    if (unit === undefined) continue
    if (unit === 10000) {
      total = (total + section + current) * unit
      section = 0
      current = 0
      continue
    }
    section += (current || 1) * unit
    current = 0
  }
  const result = total + section + current
  return result > 0 ? String(result) : raw
}

/** 诊断里保留的证据行上限：够覆盖真实问题文件，又不至于让快照膨胀。 */
const MAX_DIAGNOSTIC_LINES = 300
/** 证据行原文与上下文的截断长度。 */
const MAX_DIAGNOSTIC_RAW = 200
const MAX_DIAGNOSTIC_CONTEXT = 120

/**
 * 当前启发式版本。AI 复核结果与标注样本据此判断基线是否已变——
 * 拿旧模型结论对照新规则，会把规则修复误读成模型失误。
 * 版本 3：增加编号缺口回填，长章名不再需要人工或 AI 复核。
 * 版本 4：独立简介段落、完整编号统计、原文位置约束及数量/正文形态排除。
 * 版本 5：前置说明列表与分段简介、确定重复合并、不同正文版本互斥确认。
 */
export const IMPORT_HEURISTIC_VERSION = 5

/**
 * 行号覆盖。AI 边界复核只回答「哪几行是章节边界」，切分与幂等键生成仍由
 * 确定性代码完成：模型不参与编号归一化，那是增量导入的命脉（键一变，
 * 整库已存在章节会被误判成新增）。
 */
export interface TextImportOverrides {
  /** 强制视为章节标题的行号（1-based）。 */
  forceHeadings?: Iterable<number>
  /** 强制否决的行号（1-based），即使启发式命中了标题。 */
  denyHeadings?: Iterable<number>
  reviewedLines?: Iterable<number>
}

export interface TextImportResult {
  /** 包括之后因无正文被丢弃的章节边界，供调整效果解释使用。 */
  boundaryLines?: number[]
  frontMatterContent?: string
  chapterRanges?: Array<{ startLine: number; endLine: number }>
  payload: BookImportPayload
  diagnostics: BookImportDiagnostics
}

interface DiagnosticsInput {
  parser: BookImportSplitStats['parser']
  totalLines: number
  headingLines: number
  volumeHeadingLines: number
  mergedHeadingLines: number
  frontMatterLines: number
  frontMatterChars: number
  droppedEmptyChapters: number
  chapters: BookImportChapterInput[]
  uncertain: BookImportLineEvidence[]
  uncertainTotal: number
  /** 由编号缺口回填救回的章节数；0 表示未触发回填。 */
  rescuedHeadings: number
}

/** 正文字符数分位（忽略空白），用于识别切碎与漏切。 */
function chapterCharStats(chapters: BookImportChapterInput[]): { min: number; median: number; max: number } {
  const sizes = chapters
    .map((chapter) => String(chapter.content || '').replace(/\s/g, '').length)
    .sort((a, b) => a - b)
  if (!sizes.length) return { min: 0, median: 0, max: 0 }
  const mid = Math.floor(sizes.length / 2)
  const median = sizes.length % 2 ? sizes[mid]! : Math.round((sizes[mid - 1]! + sizes[mid]!) / 2)
  return { min: sizes[0]!, median, max: sizes[sizes.length - 1]! }
}

/**
 * 章节编号序列统计。跳号指向漏切（90 章的文件只认出 45 章），
 * 重号指向伪章节（论坛楼层被切成独立章节）——比字数分布更早暴露问题。
 */
function chapterNumberingStats(chapters: BookImportChapterInput[]): BookImportSplitStats['numbering'] {
  const numbers: number[] = []
  for (const chapter of chapters) {
    const key = importChapterKey(chapter.title)
    if (!key.startsWith('#')) continue
    const value = Number(key.slice(1))
    if (Number.isFinite(value) && value >= 1) numbers.push(value)
  }
  if (!numbers.length) return { detected: 0, min: 0, max: 0, missing: 0, duplicated: 0 }
  const distinct = new Set(numbers)
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  return {
    detected: numbers.length,
    min,
    max,
    missing: Math.max(0, max - min + 1 - distinct.size),
    duplicated: numbers.length - distinct.size,
  }
}

/**
 * 异常信号检测。这是「导入完了才发现 90 章只剩 45 章」的防线：
 * 把静默的切分错误变成预览页上的可见告警，而不是等管理员事后翻章节列表。
 * 阈值取保守值——宁可少报，也不要让正常文件淹没在噪声里。
 */
export function detectImportAnomalies(stats: BookImportSplitStats, uncertainCount: number): BookImportAnomaly[] {
  const anomalies: BookImportAnomaly[] = []
  const { numbering, chapterChars, chapterCount } = stats

  if (chapterCount > 0 && stats.headingLines === 0) {
    anomalies.push({ code: 'no-heading-detected', severity: 'warning', message: '整份文件没有识别到章节标题，已按单章导入' })
  }
  if (stats.droppedEmptyChapters > 0) {
    anomalies.push({
      code: 'empty-chapters-dropped',
      severity: 'warning',
      message: `有 ${stats.droppedEmptyChapters} 个仅有编号、没有有效章名和正文的条目未纳入，请核对原文件；有明确章名的空正文条目会保留`,
    })
  }
  // 切碎：章节数不少但中位字数极低——论坛楼层、编号列表被当成了章节。
  if (chapterCount >= 10 && chapterChars.median > 0 && chapterChars.median < 300) {
    anomalies.push({
      code: 'chapters-fragmented',
      severity: 'warning',
      message: `章节中位字数仅 ${chapterChars.median} 字，疑似把正文段落切成了章节`,
    })
  }
  // 漏切：识别到的最大编号远大于实际切出的章节数——中段标题写法变了，整段被并进上一章。
  const numberingRatioOutlier = numbering.detected >= 5 && numbering.max > numbering.detected * 1.5
  if (numberingRatioOutlier) {
    anomalies.push({
      code: 'chapters-missing',
      severity: 'warning',
      message: `识别到的最大章节编号为 ${numbering.max}，但只切出 ${numbering.detected} 章，疑似有章节未识别`,
    })
  }
  if (!numberingRatioOutlier && numbering.missing > 0) {
    anomalies.push({
      code: 'numbering-gaps',
      severity: 'info',
      message: `章节编号在 ${numbering.min}-${numbering.max} 之间缺 ${numbering.missing} 个编号，请核对原文件跳号、空白条目或未识别边界；不会自动补章`,
    })
  }
  if (numbering.duplicated > 0) {
    anomalies.push({
      code: 'numbering-duplicated',
      severity: numbering.duplicated > Math.max(2, numbering.detected * 0.1) ? 'warning' : 'info',
      message: `有 ${numbering.duplicated} 个章节编号重复，可能存在伪章节或编号错位`,
    })
  }
  if (chapterCount >= 5 && chapterChars.median > 0 && chapterChars.max > chapterChars.median * 20) {
    anomalies.push({
      code: 'chapter-length-outlier',
      severity: 'info',
      message: `最长章节 ${chapterChars.max} 字，是中位数的 ${Math.round(chapterChars.max / chapterChars.median)} 倍，可能有章节未切开`,
    })
  }
  if (stats.frontMatterChars >= MAX_FRONT_MATTER_LENGTH) {
    anomalies.push({
      code: 'front-matter-oversized',
      severity: 'info',
      message: `首个章节标题前有 ${stats.frontMatterChars} 字未归入任何章节，已保留为首页`,
    })
  }
  if (uncertainCount > 0) {
    anomalies.push({
      code: 'uncertain-lines',
      severity: 'info',
      message: `有 ${uncertainCount} 行证据不足，建议运行 AI 复核`,
    })
  }
  return anomalies
}

/**
 * 证据行排序权重：漏判（丢内容）比误判（多切章）更该先被看到，
 * 同权重按行号，便于对照原文复现。
 */
function uncertainPriority(item: BookImportLineEvidence): number {
  if (item.verdict === 'prose' && item.rejectedBy) return 0
  if (item.verdict === 'heading' && item.confidence === 'low') return 1
  return 2
}

function buildImportDiagnostics(input: DiagnosticsInput): BookImportDiagnostics {
  const ordered = [...input.uncertain].sort((a, b) => uncertainPriority(a) - uncertainPriority(b) || a.line - b.line)
  const stats: BookImportSplitStats = {
    parser: input.parser,
    totalLines: input.totalLines,
    headingLines: input.headingLines,
    volumeHeadingLines: input.volumeHeadingLines,
    mergedHeadingLines: input.mergedHeadingLines,
    frontMatterLines: input.frontMatterLines,
    droppedEmptyChapters: input.droppedEmptyChapters,
    chapterCount: input.chapters.length,
    chapterChars: chapterCharStats(input.chapters),
    frontMatterChars: input.frontMatterChars,
    numbering: chapterNumberingStats(input.chapters),
  }
  const anomalies = detectImportAnomalies(stats, input.uncertainTotal)
  if (input.rescuedHeadings > 0) {
    // 回填是「规则自己修好了」，不是异常；但必须让管理员看见，否则无法判断
    // 某个长章名是被规则救回的还是被人工/AI 指定的。
    anomalies.unshift({
      code: 'numbering-gap-filled',
      severity: 'info',
      message: `按编号缺口补回 ${input.rescuedHeadings} 个超长章名，无需人工复核`,
    })
  }
  return {
    stats,
    uncertain: ordered.slice(0, MAX_DIAGNOSTIC_LINES),
    uncertainTotal: input.uncertainTotal,
    anomalies,
    heuristicVersion: IMPORT_HEURISTIC_VERSION,
  }
}

/**
 * TXT 章节切分。
 *
 * 真实站点导出的 TXT 有两层标题：章级「第0009章 标题」和正文首行的「第九章」。
 * 两者都命中章节规则，若一行一章直接切，前半段会被上一行截走——抽出「第0009章」
 * 得到空正文，真正的正文挂在下一行的「第九章」上。所以这里先按标题编号去重，
 * 重复编号只作为正文首行保留，同时兼容 0001/第一章 混排与 第一章/1. 混排。
 *
 * 返回切分结果与诊断。诊断是 AI 复核的对照基准：没有它，AI 介入后无法区分
 * 「规则判错」与「模型判错」，只是把黑盒从一层叠成两层。
 */
export function parseTextImportDetailed(
  input: string,
  fileName = '未命名.txt',
  overrides: TextImportOverrides = {},
): TextImportResult {
  const exported = parseExportText(String(input || ''))
  if (exported) {
    const payload = normalizeImportPayload(exported.payload)
    const totalLines = String(input).split('\n').length
    const diagnostics = buildImportDiagnostics({ parser: 'text', totalLines,
      headingLines: payload.chapters.length, volumeHeadingLines: 0, mergedHeadingLines: 0,
      frontMatterLines: (exported.boundaries[0] || totalLines + 1) - 1, frontMatterChars: 0,
      droppedEmptyChapters: 0, chapters: payload.chapters, uncertain: [], uncertainTotal: 0, rescuedHeadings: 0 })
    diagnostics.pendingCount = 0
    diagnostics.truncatedCount = 0
    return { payload, diagnostics, boundaryLines: exported.boundaries, chapterRanges: exported.ranges, frontMatterContent: '' }
  }
  const lines = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  /** 切分期的内部章节：额外记住它是否由权威标题（第NNN章 / NNN）开出，用于识别重抄标题。 */
  type WorkingChapter = BookImportChapterInput & { fromAuthoritative?: boolean; startLine?: number; endLine?: number }
  const chapters: WorkingChapter[] = []
  const boundaryLines: number[] = []
  let current: WorkingChapter | null = null
  let currentVolume = ''
  const byKey = new Map<string, WorkingChapter>()
  /** 首个章节标题之前的所有行：站点前置信息（元数据、宣传位、避雷说明）。 */
  const frontMatter: string[] = []

  const forceSet = new Set(overrides.forceHeadings || [])
  const explicitForceSet = new Set(forceSet)
  const denySet = new Set(overrides.denyHeadings || [])
  const reviewedSet = new Set(overrides.reviewedLines || [])
  let reviewedCount = 0

  // 仅在明确元信息之后、首个可靠的第 1 章之前识别连续编号列表。
  // 已有正文段落夹在两项之间、或文件直接以点分章节开篇时，不把章节当书前说明。
  const prefaceListLines = new Set<number>()
  const firstChapterIndex = lines.findIndex(line => {
    const probe = probeChapterHeadingLine(line)
    return probe.title && chapterNumberFromTitle(probe.title) === 1 &&
      /^(?:第\s*[0-9０-９零〇一壹]+\s*[章节回]|[0０]{1,3}[1１]\s)/u.test(probe.title)
  })
  if (firstChapterIndex > 0 && lines.slice(0, firstChapterIndex).some(line => /^\s*(?:简介|内容简介|文案|食用须知|阅读须知|排雷|避雷)\s*[:：]/u.test(line))) {
    let run: number[] = []
    const finish = () => { if (run.length >= 2) run.forEach(index => prefaceListLines.add(index + 1)); run = [] }
    for (let index = 0; index < firstChapterIndex; index++) {
      const raw = lines[index]!.trim()
      if (!raw) continue
      const match = raw.match(/^([1-9]\d?)[.、．](?!\d)\s*\S/u)
      if (!match || Number(match[1]) !== run.length + 1) { finish(); if (match?.[1] === '1') run.push(index) }
      else run.push(index)
    }
    finish()
  }

  // ---- 编号缺口回填 ----
  /**
   * 长度与句读阈值挡掉的是「正文长句」，但它们同样会挡掉真实的长章名：
   * 实测《同时做四个人的金丝雀》第 15 章标题 47 字、第 32 章标题 70 字，都是
   * 真章节，却因超长被判为正文，38 章的文件只切出 36 章（文件名「更38」）。
   *
   * 阈值本身不能放宽——放宽会把正文首句吃成标题，那是负收益。真正的判据是
   * 全文编号序列：若被否决的行其编号恰好落在前后两个已识别章节之间，且完整
   * 填满这段缺口，它就是漏掉的章节边界。这条判据与长度无关，不随作者写法失效。
   *
   * 关键在于「完整填满」：只有当缺口 (prev, next) 内的每个编号都恰好有一个候选
   * 时才算数。文件本身跳号、或正文里恰好出现同号长句时，缺口都填不满，不会误切。
   */
  const rescuedHeadings = new Set<number>()
  {
    const acceptedNumbers = new Set<number>()
    const acceptedLines = new Map<number, number[]>()
    const rejectedByNumber = new Map<number, Array<{ line: number; title: string }>>()
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1
      if (denySet.has(lineNumber)) continue
      if (prefaceListLines.has(lineNumber) && !forceSet.has(lineNumber)) continue
      const forcedRaw = forceSet.has(lineNumber) ? text(String(line || '').replace(LEADING_INVISIBLE, '')) : ''
      const probe: HeadingProbe = forcedRaw
        ? { title: probeChapterHeadingLine(forcedRaw).title || forcedRaw, rule: 'forced-heading', confidence: 'high', uncertain: false }
        : probeChapterHeadingLine(line)
      if (probe.title) {
        // 卷标题并进正文，不参与章节编号序列。
        if (VOLUME_HEADING.test(probe.title)) continue
        const number = chapterNumberFromTitle(probe.title)
        if (number !== null) {
          acceptedNumbers.add(number)
          const positions = acceptedLines.get(number) || []
          positions.push(lineNumber)
          acceptedLines.set(number, positions)
        }
        continue
      }
      if (!probe.rejectedBy || !WEAK_REJECTION_REASONS.has(probe.rejectedBy)) continue
      const raw = text(String(line || '').replace(LEADING_INVISIBLE, ''))
      const number = chapterNumberFromTitle(raw)
      if (number === null || !isPlausibleChapterNumber(number)) continue
      const list = rejectedByNumber.get(number) || []
      list.push({ line: lineNumber, title: raw })
      rejectedByNumber.set(number, list)
    }

    const accepted = [...acceptedNumbers].sort((a, b) => a - b)
    for (const number of [...rejectedByNumber.keys()].sort((a, b) => a - b)) {
      if (acceptedNumbers.has(number)) continue
      let prev: number | undefined
      let next: number | undefined
      for (const value of accepted) {
        if (value < number) prev = value
        else if (value > number) { next = value; break }
      }
      if (prev === undefined || next === undefined) continue
      const gapSize = next - prev - 1
      if (gapSize <= 0 || gapSize > MAX_RESCUE_RUN) continue
      const expected: number[] = []
      for (let value = prev + 1; value < next; value++) expected.push(value)
      // 每个编号必须恰好一个候选；多一个候选就说明有正文长句混进来了，整段放弃。
      if (!expected.every((value) => rejectedByNumber.get(value)?.length === 1)) continue
      const positions = expected.map(value => rejectedByNumber.get(value)![0]!.line)
      // 数值连续还不够：候选必须按顺序位于原文件的前后锚点之间。
      if (positions.some((line, index) => index > 0 && line <= positions[index - 1]!)) continue
      if (!acceptedLines.get(prev)!.some(line => line < positions[0]!) ||
        !acceptedLines.get(next)!.some(line => line > positions.at(-1)!)) continue
      for (const value of expected) rescuedHeadings.add(rejectedByNumber.get(value)![0]!.line)
    }
  }
  for (const line of rescuedHeadings) forceSet.add(line)

  // ---- 诊断累积 ----
  let headingLines = 0
  let volumeHeadingLines = 0
  let mergedHeadingLines = 0
  let uncertainTotal = 0
  const uncertainBuckets: BookImportLineEvidence[][] = [[], [], []]
  const nearbyContent = (start: number, direction: number): string => {
    for (let index = start, distance = 0; index >= 0 && index < lines.length && distance < 12; index += direction, distance++) {
      if (lines[index]!.trim()) return lines[index]!.trim().slice(0, MAX_DIAGNOSTIC_CONTEXT)
    }
    return ''
  }
  const recordUncertain = (lineNumber: number, raw: string, probe: HeadingProbe): void => {
    uncertainTotal++
    if (reviewedSet.has(lineNumber)) { reviewedCount++; return }
    const priority = !probe.title && probe.rejectedBy ? 0 : probe.title && probe.confidence === 'low' ? 1 : 2
    const bucket = uncertainBuckets[priority]!
    if (bucket.length >= MAX_DIAGNOSTIC_LINES) return
    const evidence: BookImportLineEvidence = {
      line: lineNumber,
      raw: raw.slice(0, MAX_DIAGNOSTIC_RAW),
      verdict: probe.title ? 'heading' : 'prose',
      rule: probe.rule,
      confidence: probe.confidence,
      ...(probe.rejectedBy ? { rejectedBy: probe.rejectedBy } : {}),
      contextBefore: nearbyContent(lineNumber - 2, -1),
      contextAfter: nearbyContent(lineNumber, 1),
    }
    // 每个风险等级各留最早 300 行，扫描全文后统一排序；内存有界且每行 O(1)。
    bucket.push(evidence)
  }

  const stripHeading = (title: string) => title.replace(/\s+/g, ' ').trim()

  const beginChapter = (title: string, keys: string[], fromAuthoritative = false): WorkingChapter => {
    const chapter: WorkingChapter = { title, order: chapters.length + 1, content: '', fromAuthoritative, ...(currentVolume ? { volumeTitle: currentVolume } : {}) }
    chapters.push(chapter)
    for (const key of keys) if (key && !byKey.has(key)) byKey.set(key, chapter)
    return chapter
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1
    const forced = forceSet.has(lineNumber)
    const denied = denySet.has(lineNumber)
    const forcedRaw = forced ? text(String(line || '').replace(LEADING_INVISIBLE, '')) : ''
    const forcedTitle = forcedRaw ? probeChapterHeadingLine(forcedRaw).title || forcedRaw : ''
    const probe: HeadingProbe = forcedTitle
      ? { title: forcedTitle, rule: 'forced-heading', confidence: 'high', uncertain: false }
      : probeChapterHeadingLine(line)
    const headingTitle = denied || (prefaceListLines.has(lineNumber) && !forced) ? null : probe.title
    // 强制覆盖过的行已是确定结论，不再作为待复核证据留档。
    if (!forcedTitle && !denied && probe.uncertain) recordUncertain(lineNumber, line, probe)

    if (headingTitle && !forced && VOLUME_HEADING.test(headingTitle)) {
      // 卷标题并进正文：既保住卷名，也防止它把上一章的正文截走。
      volumeHeadingLines++
      currentVolume = headingTitle.match(/^第.*?[卷部篇]/u)?.[0] || headingTitle
      if (current) current.content += `${text(headingTitle)}\n`
      continue
    }
    if (headingTitle) {
      headingLines++
      const title = text(headingTitle)
      const key = importChapterKey(title)
      // 卷标题里的章节号优先，用它判断「第三卷 第四十九章 反击」是否等于已有的第 49 章。
      const embedded = title.match(EMBEDDED_VOLUME_CHAPTER)
      const embeddedKey = embedded ? importChapterKey(title.slice(embedded.index!)) : ''
      // 完整章级标题（第0003章 / 0032 / 32标题）是权威章节边界，永远自己开一章：
      // 这份导出里「第0003章」标题后面正文开头写的是「第四章」（原文编号本身错位），
      // 若让它归并进已有的第 4 章，就会整章丢失。
      const authoritative =
        forced || /^第\s*[0-9０-９]+\s*[章节回]/u.test(title) ||
        /^[0-9０-９]{1,4}\s/u.test(title) ||
        /^[0-9０-９]{1,3}[^\s0-9０-９]/u.test(title)
      // 非权威标题（「第一章」「第九章」）只在「当前章节是权威标题开出来、且尚未见到正文」
      // 时才算重抄的标题副本——这是「第0001章 标题 / 第一章 / 正文」这种两层写法。
      // 若当前章节已经有正文，或本文件根本不用「第NNN章」（纯「第一章 标题」的常见格式），
      // 它就是一个正常的章节边界，必须开新章。
      const openChapter = current
      if (!authoritative && openChapter && openChapter.fromAuthoritative && !openChapter.content.trim()) {
        const stripped = stripHeading(title)
        if (stripped && !openChapter.content.includes(`${stripped}\n`)) openChapter.content += `${stripped}\n`
        mergedHeadingLines++
        continue
      }
      current = beginChapter(title, [embeddedKey, key], authoritative)
      current.startLine = lineNumber
      boundaryLines.push(lineNumber)
      continue
    }
    if (current) {
      current.content += `${line}\n`
    } else {
      // 首个章节标题之前的行一律进前置缓冲，不再就地开「正文」伪章。
      // 就地开章会带来两个麻烦：前置信息变成幽灵章节，以及后续要靠「按文本匹配」
      // 把它摘掉——而正文里可能出现与简介完全相同的句子（实测「镇子上闹妖魔，
      // 两个仙君远道而来。」既在简介又在第 1 章正文），按文本摘会误删正文。
      frontMatter.push(line)
    }
  }

  chapters.forEach((chapter, index) => { chapter.endLine = (chapters[index + 1]?.startLine || lines.length + 1) - 1 })
  // 打赏/公告等已识别且有明确章名的条目即使无正文也保留，避免后续章节序号前移。
  // 仅有编号或被强制标成标题的数量正文不因此变成有效空章；不按「打赏」关键词特判。
  let kept = chapters.filter((chapter) => chapter.content.trim() || !importChapterKey(chapter.title) ||
    (normalizeImportChapterTitle(chapter.title) && (probeChapterHeadingLine(chapter.title).title || CHAPTER_HEADING.test(chapter.title) || UNNUMBERED_HEADING_SHAPE.test(chapter.title))))
  const droppedEmptyChapters = chapters.length - kept.length
  // 不比较相似度，也不选「更新」版本：只有非空正文除空白外逐字相同且有效章名相同才去重。
  const duplicates = new Map<string, WorkingChapter>()
  const duplicateLines: Array<{ line: number; keptLine: number }> = []
  kept = kept.filter(chapter => {
    const title = normalizeImportChapterTitle(chapter.title)
    const body = chapter.content.replace(/\s/gu, '')
    if (!title || !body || explicitForceSet.has(chapter.startLine || 0)) return true
    const key = `${normalizeImportTitle(chapter.volumeTitle)}:${chapterVersionKey(chapter.title)}:${title}:${createHash('sha256').update(body).digest('hex')}`
    const existing = duplicates.get(key)
    if (!existing) { duplicates.set(key, chapter); return true }
    duplicateLines.push({ line: chapter.startLine!, keptLine: existing.startLine! })
    return false
  })
  const payloadChapters = kept.length ? kept : chapters

  // 首个章节标题之前的区域是站点前置信息：书名/作者/分类/简介等元数据，以及宣传位
  // （「点击直达……」「连载文:」）与避雷说明（「男洁！男洁！男洁！！！」）。
  const meta = parseTextImportMeta(frontMatter)
  const leftover = meta.leftover
  const hasRealHeading = payloadChapters.length > 0
  if (!hasRealHeading) {
    // 全文没有任何章节标题：整个文件就是正文，前置块即正文本身，必须保留。
    payloadChapters.push({ title: '正文', order: 1, content: (leftover.length ? leftover : frontMatter).join('\n').trim() })
  } else if (leftover.join('').replace(/\s/g, '').length >= MAX_FRONT_MATTER_LENGTH) {
    // 残留块达到一章的体量，可能是「首章未标标题」的正文，保留为首页；否则丢弃。
    payloadChapters.unshift({ title: '正文', order: 1, content: leftover.join('\n') })
  }

  const finalChapters = payloadChapters.length ? payloadChapters : chapters
  finalChapters.forEach((chapter, index) => { chapter.order = index + 1 })

  const payload = normalizeImportPayload({
    title: meta.title || fileStem(fileName) || '未命名作品',
    author: meta.author || '未知作者',
    description: meta.description,
    chapters: finalChapters,
  })

  const diagnostics = buildImportDiagnostics({
    parser: 'text',
    totalLines: lines.length,
    headingLines,
    volumeHeadingLines,
    mergedHeadingLines,
    frontMatterLines: frontMatter.length,
    frontMatterChars: leftover.join('').replace(/\s/g, '').length,
    droppedEmptyChapters,
    chapters: payload.chapters,
    uncertain: uncertainBuckets.flat(),
    uncertainTotal,
    rescuedHeadings: rescuedHeadings.size,
  })

  diagnostics.reviewedCount = reviewedCount
  if (prefaceListLines.size) diagnostics.anomalies.push({ code: 'front-matter-list', severity: 'info', message: `已将书前连续编号说明 ${prefaceListLines.size} 行归入前置信息，不作为章节` })
  if (duplicateLines.length) diagnostics.anomalies.push({ code: 'duplicate-chapters-merged', severity: 'info', message: `已合并 ${duplicateLines.length} 个章名和正文一致的重复条目（忽略空白排版）；原文行号 ${duplicateLines.slice(0, 12).map(c => `${c.line}→${c.keptLine}`).join('、')}${duplicateLines.length > 12 ? '等' : ''}，原始文件快照保留` })
  diagnostics.pendingCount = uncertainTotal - reviewedCount
  if (reviewedCount > 0) {
    diagnostics.anomalies = diagnostics.anomalies.filter((item) => item.code !== 'uncertain-lines')
    if (diagnostics.pendingCount > 0) diagnostics.anomalies.push({ code: 'uncertain-lines', severity: 'info', message: `还有 ${diagnostics.pendingCount} 行证据不足且尚未复核` })
  }
  diagnostics.truncatedCount = Math.max(0, uncertainTotal - reviewedCount - diagnostics.uncertain.length)
  const chapterRanges = payload.chapters.map((_, index) => ({
    startLine: (finalChapters[index] as WorkingChapter)?.startLine || 1,
    endLine: (finalChapters[index] as WorkingChapter)?.endLine || (index + 1 < payload.chapters.length ? ((finalChapters[index + 1] as WorkingChapter)?.startLine || lines.length + 1) - 1 : lines.length),
  }))
  return { payload, diagnostics, chapterRanges, boundaryLines, frontMatterContent: leftover.join('\n').trim() }
}

/** TXT 章节切分。诊断走 parseTextImportDetailed，这里只取切分结果。 */
export function parseTextImport(input: string, fileName = '未命名.txt', overrides: TextImportOverrides = {}): BookImportPayload {
  return parseTextImportDetailed(input, fileName, overrides).payload
}

/** 头部元信息块允许出现的字段前缀；命中即是元信息而非正文。 */
const TEXT_META_LINE = /^\s*(书名|作品名|标题|题名|作者|作\s*者|简介|内容简介|文案|分类|标签|Tag列表|状态|字数|来源|出处|更新)\s*[:：]\s*(.*)$/i

interface TextImportMeta {
  title?: string
  author?: string
  description?: string
  /** 未被识别为元数据的残留行（宣传位、避雷说明等），由调用方决定是否保留。 */
  leftover: string[]
}

/**
 * 解析 TXT 头部的前置信息块，提取书名/作者/简介。
 *
 * 该块位于第一个章节标题之前，形如：
 *   书名：和哥哥在乱交世界里假装do爱
 *   作者：归雾
 *   分类：簡體版 骨科 高H 1V1
 *   简介：谢溪16岁才回到谢家……
 *   哥哥不喜欢她，甚至有些讨厌她。   ← 简介的续行
 * 简介可跨多行，直到遇到空行、字段行或首个章节标题为止。
 *
 * 只做「读」不做「改」：识别到的行记入 meta，其余原样放进 leftover 交给调用方。
 * 早期版本在这里按文本把已消费行从各章正文中摘除，结果正文里与简介相同的句子
 * 会被连带删掉（实测第 1 章正文少了一句 16 字的叙述）。
 */
function parseTextImportMeta(frontMatter: string[]): TextImportMeta {
  const meta: TextImportMeta = { leftover: [] }
  const consumed = new Set<number>()
  let sawMeta = false
  let descriptionOpen = false
  let standaloneDescription = false
  const hasDescriptionSections = frontMatter.some(line => /^(?:食用须知|阅读须知|剧情简介|排雷|避雷|作者说明|作者有话说|ps|p\.s\.)\s*[:：]/i.test(line.trim()))

  for (let i = 0; i < frontMatter.length; i++) {
    const trimmed = frontMatter[i]!.trim()
    if (!trimmed) {
      if (standaloneDescription) {
        consumed.add(i)
        if (meta.description) meta.description += '\n'
        continue
      }
      // 空行结束简介续行；但整块尚未开始时只是普通前导空行。
      descriptionOpen = false
      continue
    }
    // 独立「内容简介」是整个前置信息块的段落标题；站点导出常在每段之间插空行。
    if (/^(?:内容简介|简介|文案)\s*[:：]?$/.test(trimmed)) {
      consumed.add(i)
      sawMeta = true
      descriptionOpen = true
      standaloneDescription = true
      continue
    }
    if (!sawMeta && !meta.title && /^《[^》]+》$/.test(trimmed)) {
      meta.title = trimmed.slice(1, -1).trim()
      consumed.add(i)
      continue
    }
    const field = trimmed.match(TEXT_META_LINE)
    if (field) {
      standaloneDescription = false
      sawMeta = true
      consumed.add(i)
      const key = field[1]!.replace(/\s/g, '')
      const value = field[2]!.trim()
      if (key === '书名' || key === '作品名' || key === '标题' || key === '题名') {
        if (value && !meta.title) meta.title = value
      } else if (key === '作者') {
        if (value && !meta.author) meta.author = value
      } else if (key === '简介' || key === '内容简介' || key === '文案') {
        descriptionOpen = true
        standaloneDescription = hasDescriptionSections
        if (value) meta.description = value
      }
      continue
    }
    // 简介续行：紧跟「简介：」之后、且未遇空行的普通文本行。
    if (descriptionOpen) {
      consumed.add(i)
      meta.description = meta.description ? `${meta.description}\n${trimmed}` : trimmed
      continue
    }
    // 元信息块开始后、遇到无法识别的行：说明元数据部分已结束，其余归入 leftover。
    if (sawMeta) break
  }

  for (let i = 0; i < frontMatter.length; i++) {
    if (!consumed.has(i)) meta.leftover.push(frontMatter[i]!)
  }
  meta.description = meta.description?.trim()
  return meta
}

function xmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return String(match?.[1] || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .trim()
}

function zipEntry(entries: Record<string, Uint8Array>, name: string): string {
  const normalized = name.replace(/^\//, '')
  const value = entries[normalized]
  return value ? strFromU8(value) : ''
}

/** 轻量 EPUB 解析：读取 OPF spine 顺序，正文以 XHTML 文本形式导入。 */
export function parseEpubImport(data: Uint8Array, fileName = '未命名.epub'): BookImportPayload {
  const entries = unzipSync(data)
  const container = zipEntry(entries, 'META-INF/container.xml')
  const rootfile = container.match(/rootfile[^>]+full-path=["']([^"']+)["']/i)?.[1]
  if (!rootfile) throw new Error('EPUB 缺少有效的 OPF 目录')
  const opf = zipEntry(entries, rootfile)
  if (!opf) throw new Error('无法读取 EPUB 的 OPF 目录')

  const base = posix.dirname(rootfile)
  const manifest = new Map<string, string>()
  for (const match of opf.matchAll(/<item\b[^>]*\bid=["']([^"']+)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    manifest.set(match[1]!, posix.normalize(posix.join(base, decodeURIComponent(match[2]!))))
  }

  const spineIds = [...opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]!)
  const chapters: BookImportChapterInput[] = []
  for (const [index, id] of spineIds.entries()) {
    const path = manifest.get(id)
    if (!path) continue
    const html = zipEntry(entries, path)
    const title = html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]
      ?.replace(/<[^>]*>/g, '')
      .replace(/&amp;/gi, '&')
      .trim()
    const content = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (content.length < 20) continue
    chapters.push({ title: title || `第 ${index + 1} 章`, order: index + 1, content })
  }

  return normalizeImportPayload({
    title: xmlText(opf, 'dc:title') || fileStem(fileName) || '未命名作品',
    author: xmlText(opf, 'dc:creator') || '未知作者',
    chapters,
  })
}

export interface UploadedBookResult {
  payload: BookImportPayload
  diagnostics: BookImportDiagnostics
}

/**
 * 非 TXT 来源的诊断：没有行级证据（无行号可指），只给切分统计与异常信号。
 * 结构化来源的章节边界是显式的，本来就不需要逐行裁决。
 */
function structuredDiagnostics(parser: 'epub' | 'json' | 'url', chapters: BookImportChapterInput[]): BookImportDiagnostics {
  const stats: BookImportSplitStats = {
    parser,
    totalLines: 0,
    headingLines: chapters.length,
    volumeHeadingLines: 0,
    mergedHeadingLines: 0,
    frontMatterLines: 0,
    droppedEmptyChapters: 0,
    chapterCount: chapters.length,
    chapterChars: chapterCharStats(chapters),
    frontMatterChars: 0,
    numbering: chapterNumberingStats(chapters),
  }
  return {
    stats,
    uncertain: [],
    uncertainTotal: 0,
    anomalies: detectImportAnomalies(stats, 0),
    heuristicVersion: IMPORT_HEURISTIC_VERSION,
  }
}

/** 上传文件解析（带诊断）。TXT 走逐行判定，EPUB / JSON 只有结构化统计。 */
export async function parseUploadedBookDetailed(fileName: string, data: Uint8Array): Promise<UploadedBookResult> {
  if (data.byteLength > MAX_IMPORT_BYTES) throw new Error('导入文件不能超过 25 MB')
  const lower = fileName.toLocaleLowerCase()
  if (lower.endsWith('.epub')) {
    const payload = parseEpubImport(data, fileName)
    return { payload, diagnostics: structuredDiagnostics('epub', payload.chapters) }
  }
  const content = new TextDecoder('utf-8').decode(data)
  if (lower.endsWith('.json')) {
    try {
      const payload = normalizeImportPayload(JSON.parse(content) as Partial<BookImportPayload>)
      return { payload, diagnostics: structuredDiagnostics('json', payload.chapters) }
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error('JSON 文件格式不正确')
      throw err
    }
  }
  if (lower.endsWith('.txt') || lower.endsWith('.text') || !fileName.includes('.')) {
    const result = parseTextImportDetailed(content, fileName)
    return { payload: result.payload, diagnostics: result.diagnostics }
  }
  throw new Error('暂时支持 TXT、JSON 和 EPUB 文件')
}

export async function parseUploadedBook(fileName: string, data: Uint8Array): Promise<BookImportPayload> {
  return (await parseUploadedBookDetailed(fileName, data)).payload
}

export interface UrlImportDeps {
  store: ScrapeStore
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>
}

export interface UrlImportResult {
  payload: BookImportPayload
  warnings: string[]
  diagnostics: BookImportDiagnostics
}

/**
 * URL 导入复用现有书源识别与正文清洗逻辑，只把结果落到书籍导入的统一结构。
 * 抓取在服务端执行，前端只接收预览所需的元数据和差异快照。
 */
export async function parseBookUrl(sourceUrl: string, deps: UrlImportDeps): Promise<UrlImportResult> {
  let normalizedUrl: string
  try {
    const url = new URL(String(sourceUrl || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('书籍 URL 必须使用 HTTP 或 HTTPS')
    normalizedUrl = url.href
  } catch (err) {
    if (err instanceof Error && err.message.includes('必须使用')) throw err
    throw new Error('书籍 URL 格式不正确')
  }

  const meta = await detectMeta(normalizedUrl, { store: deps.store, fetchHtml: deps.fetchHtml })
  const preset = (await getPresetForUrl(normalizedUrl, deps.store)) as (SitePreset & { source?: string }) | null
  const reader = adapterForUrl(normalizedUrl)?.chapters
  const selectors = meta.selectors || {}
  const listUrl = meta.chapterListUrl || normalizedUrl
  const listResult = await deps.fetchHtml(listUrl, { forceEncoding: meta.encoding })
  reader?.assertResponse(listResult.finalUrl || listUrl, listResult.html)

  let links: Array<{ href: string; text: string; order?: number }> = []
  const warnings: string[] = []
  if (reader) {
    links = reader.readDirectory(listResult.html, listUrl).links.map((link, index) => ({ ...link, order: index + 1 }))
  } else if (preset?.selectors?.chapterList) {
    const collected = await collectChapterLinks(
      listResult.html,
      preset,
      listUrl,
      meta.encoding,
      (url) => deps.fetchHtml(url, { forceEncoding: meta.encoding }),
    )
    links = collected.links
    if (collected.limited) warnings.push('目录页数较多，本次预览只读取了前几页。')
  } else {
    links = extractLinks(listResult.html, selectors.chapterList || 'a', listUrl)
  }

  const uniqueLinks = links
    .filter((link) => link.href && /^https?:\/\//i.test(link.href))
    .filter((link, index, allLinks) => allLinks.findIndex((other) => other.href === link.href) === index)
  if (!uniqueLinks.length) warnings.push('未识别到章节目录，请确认 URL 是作品详情页或配置对应书源。')
  if (uniqueLinks.length > MAX_IMPORT_CHAPTERS) warnings.push(`本次最多导入前 ${MAX_IMPORT_CHAPTERS} 章，超出部分暂不读取。`)

  const chapters = new Array<BookImportChapterInput | null>(Math.min(uniqueLinks.length, MAX_IMPORT_CHAPTERS)).fill(null)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor++
      const link = uniqueLinks[index]
      if (!link || index >= chapters.length) return
      try {
        const request = reader?.chapterRequest(link, meta.encoding, 12000) ??
          { url: link.href, options: { forceEncoding: meta.encoding, timeoutMs: 12000 } }
        const chapterResult = await deps.fetchHtml(request.url, request.options)
        reader?.assertResponse(chapterResult.finalUrl || request.url, chapterResult.html)
        const parsed = reader?.parseChapter(chapterResult.html, link.text || '')
        const title = cleanText(parsed?.title || extractText(chapterResult.html, selectors.chapterTitle || '') || link.text || `第 ${index + 1} 章`)
        const rawContent = parsed?.content || extractContent(chapterResult.html, selectors.chapterContent || '')
        const content = cleanText(cleanHtml(rawContent || '').trim())
        if (content.replace(/\s/g, '').length < 20) throw new Error('正文内容过短或未识别')
        chapters[index] = {
          title: title || `第 ${index + 1} 章`,
          order: Number(link.order) || index + 1,
          content,
          sourceUrl: link.href,
        }
      } catch (err) {
        warnings.push(`第 ${Number(link.order) || index + 1} 章读取失败：${(err as Error).message || '未知错误'}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, chapters.length)) }, () => worker()))

  const novel = meta.novel
  const urlTitle = normalizedUrl.split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ') || '未命名作品'
  const title = novel.title && novel.title !== '(未识别)' ? novel.title : urlTitle
  const payload = normalizeImportPayload({
    title,
    author: novel.author === '未知作者' ? '' : novel.author,
    description: novel.description,
    coverUrl: novel.coverUrl,
    categories: novel.categories,
    status: novel.status,
    sourceUrl: normalizedUrl,
    chapters: chapters.filter((chapter): chapter is BookImportChapterInput => Boolean(chapter)),
  })
  if (payload.chapters.length < uniqueLinks.length) warnings.push(`成功读取 ${payload.chapters.length}/${uniqueLinks.length} 章。`)
  return { payload, warnings: Array.from(new Set(warnings)), diagnostics: structuredDiagnostics('url', payload.chapters) }
}

function metadataValue(novel: Novel | null, field: BookImportMetadataDiff['field']): string {
  if (!novel) return ''
  const value = novel[field]
  return Array.isArray(value) ? value.join('、') : text(value)
}

function incomingMetadataValue(book: BookImportPayload, field: BookImportMetadataDiff['field']): string {
  if (field === 'coverUrl' && book.coverImage) return '压缩包中的本地封面'
  const value = book[field]
  return Array.isArray(value) ? value.join('、') : text(value)
}

const METADATA_FIELDS: Array<[BookImportMetadataDiff['field'], string]> = [
  ['title', '标题'],
  ['author', '作者'],
  ['description', '简介'],
  ['coverUrl', '封面'],
  ['categories', '分类'],
  ['status', '状态'],
  ['sourceUrl', '源网址'],
]

export function buildMetadataDiff(book: BookImportPayload, novel: Novel | null): BookImportMetadataDiff[] {
  return METADATA_FIELDS.map(([field, label]) => {
    const localValue = metadataValue(novel, field)
    const incomingValue = incomingMetadataValue(book, field)
    const changed = Boolean(incomingValue) && localValue !== incomingValue
    return { field, label, localValue, incomingValue, changed, selected: !novel ? Boolean(incomingValue) : changed && !localValue }
  })
}

function importVariantGroups(chapters: BookImportChapterInput[]): Map<number, string> {
  const groups = new Map<string, number[]>()
  const byNumber = new Map<string, number[]>()
  chapters.forEach((chapter, index) => {
    const title = normalizeImportChapterTitle(chapter.title)
    if (!title) return
    const volume = normalizeImportTitle(chapter.volumeTitle)
    const key = `${volume}:${chapterVersionKey(chapter.title)}:${title}`
    groups.set(key, [...(groups.get(key) || []), index])
    const number = chapterNumberFromTitle(chapter.title)
    const numberKey = `${volume}:${number}`
    if (number !== null) byNumber.set(numberKey, [...(byNumber.get(numberKey) || []), index])
  })
  // 「错章／修订」与同号正文即使改过章名，也属于需要人工选择的一组。
  byNumber.forEach((indexes, number) => {
    if (indexes.length > 1 && indexes.some(index => /错章|錯章|误章|誤章|修订|修訂|修正版|重发|重發|重贴|重貼/.test(chapters[index]!.title))) groups.set(`correction:${number}`, indexes)
  })
  const result = new Map<number, string>()
  groups.forEach((indexes, key) => {
    if (indexes.length < 2 || new Set(indexes.map(index => chapters[index]!.content.replace(/\s/gu, ''))).size < 2) return
    const id = createHash('sha256').update(key).digest('hex')
    indexes.forEach(index => result.set(index, id))
  })
  return result
}

export function buildChapterDiff(book: BookImportPayload, local: ChapterRow[], options: { preserveLocalOrder?: boolean } = {}): BookImportChapterDiff[] {
  const variantGroups = importVariantGroups(book.chapters)
  const bySourceUrl = new Map<string, ChapterRow[]>()
  const byOrderAndTitle = new Map<string, ChapterRow[]>()
  const byOrder = new Map<number, ChapterRow[]>()
  const byTitle = new Map<string, ChapterRow[]>()
  const byContent = new Map<string, ChapterRow[]>()
  const add = (map: Map<string, ChapterRow[]>, key: string, chapter: ChapterRow) => {
    const values = map.get(key) || []
    values.push(chapter)
    map.set(key, values)
  }
  for (const chapter of local) {
    const sourceUrl = safeSourceUrl(chapter.source_url)
    if (sourceUrl) add(bySourceUrl, sourceUrl, chapter)
    const key = `${chapter.sort_order}:${normalizeImportChapterTitle(chapter.title)}`
    add(byOrderAndTitle, key, chapter)
    if (normalizeImportContent(chapter.content)) add(byContent, importContentHash(chapter.content), chapter)
    const orderValues = byOrder.get(chapter.sort_order) || []
    orderValues.push(chapter)
    byOrder.set(chapter.sort_order, orderValues)
    // 纯编号标题（第三章）归一化后为空串，不能当作「同名」——否则整本会被算成一个同名桶。
    const titleKey = normalizeImportChapterTitle(chapter.title)
    if (!titleKey) continue
    const values = byTitle.get(titleKey) || []
    values.push(chapter)
    byTitle.set(titleKey, values)
  }

  const used = new Set<string>()
  const usedVariants = new Map<string, string>()
  const diffs: BookImportChapterDiff[] = book.chapters.map((incoming, index) => {
    const sourceUrl = safeSourceUrl(incoming.sourceUrl)
    const titleKey = normalizeImportChapterTitle(incoming.title)
    const sourceMatches = sourceUrl ? bySourceUrl.get(sourceUrl) || [] : []
    const sourceCandidate = sourceMatches.length === 1 ? sourceMatches[0] : undefined
    // 附加文件的片段只记录当时的切分位置。修正首页/边界后位置会改变，不能覆盖内容与标题证据。
    const positionalSource = /#chapter=\d+$/.test(sourceUrl)
    const strong = sourceCandidate && (!positionalSource ||
      (titleKey && normalizeImportChapterTitle(sourceCandidate.title) === titleKey) ||
      (normalizeImportContent(incoming.content) && importContentHash(sourceCandidate.content) === importContentHash(incoming.content)))
      ? sourceCandidate : undefined
    const exactMatches = byOrderAndTitle.get(`${incoming.order}:${titleKey}`) || []
    const exact = strong || (exactMatches.length === 1 ? exactMatches[0] : undefined)
    // 只有编号没有标题时按序号对齐：序号唯一才认，避免不同写法互相抢。
    const sameOrder = !titleKey ? byOrder.get(incoming.order) || [] : []
    const sameTitle = titleKey ? byTitle.get(titleKey) || [] : []
    const sameContent = normalizeImportContent(incoming.content) ? byContent.get(importContentHash(incoming.content)) || [] : []
    const candidate = exact || (sameOrder.length === 1 ? sameOrder[0] : undefined) || (sameTitle.length === 1 ? sameTitle[0] : undefined)
      || (sameContent.length === 1 ? sameContent[0] : undefined)
    const variantGroup = variantGroups.get(index)
    const reused = candidate ? used.has(candidate.id) && !(variantGroup && usedVariants.get(candidate.id) === variantGroup) : false
    const conflict = reused || (!candidate && (exactMatches.length > 1 || sameTitle.length > 1 || sameContent.length > 1 || (!titleKey && sameOrder.length > 1)))
    if (candidate && !conflict) used.add(candidate.id)
    if (candidate && !conflict && variantGroup) usedVariants.set(candidate.id, variantGroup)
    const contentChanged = candidate ? importContentHash(candidate.content) !== importContentHash(incoming.content) : false
    const titleChanged = candidate ? normalizeImportChapterTitle(candidate.title) !== titleKey || candidate.title !== incoming.title : false
    let status: BookImportChapterDiff['status'] = 'new'
    let confidence: BookImportChapterDiff['confidence'] = 'high'
    let reason = '导入源存在，本地没有对应章节'
    if (conflict) {
      status = 'conflict'
      confidence = 'low'
      reason = reused ? '多个导入章节对应同一本地章节，需核对边界与重复内容' : '发现多个可能对应的章节，无法自动判断对应关系'
    } else if (candidate) {
      status = contentChanged || titleChanged ? 'changed' : 'unchanged'
      confidence = exact ? 'high' : 'medium'
      reason = strong ? '来源地址一致' : exact ? '序号与标题一致' : sameTitle.length === 1 ? '标题一致，序号不同或来源地址缺失' : sameOrder.length === 1 ? '纯编号章节按唯一序号对应' : '正文唯一一致，标题或序号已变化，请核对融合结果'
    } else if (!titleKey) {
      confidence = 'low'
      reason = '章节只有编号没有标题，按序号未能唯一对应'
    }
    return {
      id: `chapter-${index + 1}`,
      status,
      localChapterId: candidate?.id,
      localOrder: candidate?.sort_order,
      incomingOrder: incoming.order,
      localTitle: candidate?.title,
      incomingTitle: incoming.title,
      localContent: candidate?.content,
      incomingContent: incoming.content,
      variantGroup,
      localSourceUrl: candidate?.source_url,
      incomingSourceUrl: sourceUrl,
      confidence,
      reason,
      selected: status === 'new',
    }
  })
  if (options.preserveLocalOrder) {
    let lastMatched = -1
    diffs.forEach((c, index) => { if (c.localChapterId && c.status !== 'conflict') lastMatched = index })
    let nextOrder = Math.max(0, ...local.map(c => c.sort_order))
    diffs.forEach((diff, index) => {
      if (diff.localOrder !== undefined) diff.incomingOrder = diff.localOrder
      if (diff.status !== 'new') return
      if (index < lastMatched || (local.length > 0 && lastMatched < 0)) {
        diff.status = 'conflict'
        diff.confidence = 'low'
        diff.reason = '新增条目位于已有章节之间，或没有可靠的本地对应关系，请先核对边界与融合映射'
        diff.selected = false
      } else {
        diff.incomingOrder = ++nextOrder
        diff.reason = '附加源新增尾章，按本地末尾序号追加，保留融合后的已有序号'
      }
    })
  }
  const versionOrders = new Map<string, number>()
  diffs.forEach(diff => { if (diff.variantGroup && !versionOrders.has(diff.variantGroup)) versionOrders.set(diff.variantGroup, diff.incomingOrder) })
  diffs.forEach(diff => {
    if (!diff.variantGroup) return
    diff.selected = false
    diff.incomingOrder = diff.localOrder ?? versionOrders.get(diff.variantGroup)!
    if (diff.status !== 'conflict' && diff.status !== 'unchanged') {
      diff.confidence = 'low'
      diff.reason = '同一章节存在不同正文版本，默认不选；请展开核对并只选择一个版本'
    }
  })
  return diffs
}

async function findCandidates(db: Db, book: BookImportPayload, sourceType: ImportPreviewOptions['sourceType']): Promise<BookImportNovelCandidate[]> {
  const rows = await all<NovelRow>(db, 'SELECT * FROM novels ORDER BY updated_at DESC')
  const incomingAuthor = knownAuthor(book.author)
  const incomingSource = safeSourceUrl(book.sourceUrl)
  const untaggedTitle = sourceType === 'file' && incomingAuthor ? titleKey(book.title, true) : ''
  const candidates = rows
    .map<BookImportNovelCandidate | null>((row) => {
      const novel = rowToNovel(row)
      if (!novel) return null
      const sameSource = incomingSource && safeSourceUrl(novel.sourceUrl) === incomingSource
      if (sameSource) return { novel, matchReason: 'source-url', score: 100 }
      const sameTitle = titlesMatch(novel.title, book.title)
      const sameAuthor = incomingAuthor && knownAuthor(novel.author) === incomingAuthor
      if (sameTitle) return sameAuthor
        ? { novel, matchReason: 'title-author', score: 95 }
        : { novel, matchReason: 'title', score: 80 }
      if (sameAuthor && untaggedTitle && titleKey(novel.title, true) === untaggedTitle) {
        return { novel, matchReason: 'title-tag', score: 70 }
      }
      return null
    })
    .filter((candidate): candidate is BookImportNovelCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || b.novel.updatedAt - a.novel.updatedAt)
  const directMatches = candidates.filter(candidate => candidate.matchReason !== 'title-tag')
  return directMatches.length ? directMatches : candidates
}

async function loadLocalChapters(db: Db, novelId: string): Promise<ChapterRow[]> {
  return all<ChapterRow>(db, 'SELECT id, title, sort_order, content, source_url FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC', [novelId])
}

export function importResolutionSnapshot(local: ChapterRow[]): string {
  return createHash('sha256').update(JSON.stringify([...local].sort((a, b) => a.id.localeCompare(b.id)).map(row => [row.id, row.title, row.sort_order, row.content, row.source_url]))).digest('hex')
}

export function resolvedChapterDiffs(base: BookImportChapterDiff[], local: ChapterRow[], resolutions: BookImportChapterResolution[]): BookImportChapterDiff[] {
  const diffs = base.map(item => ({ ...item }))
  const headers = local.map(row => ({ id: row.id, title: row.title, order: row.sort_order }))
  const sorted = [...resolutions].sort((a, b) => diffs.findIndex(c => c.id === a.chapterId) - diffs.findIndex(c => c.id === b.chapterId))
  for (const resolution of sorted) {
    const diff = diffs.find(item => item.id === resolution.chapterId)
    if (!diff) throw new Error('人工确认章节不存在，请重新预览')
    if (resolution.action === 'match') {
      const row = local.find(item => item.id === resolution.localChapterId)
      if (!row) throw new Error('本地对应章节不存在，请重新预览')
      if (diffs.some(other => other.id !== diff.id && other.localChapterId === row.id && other.status !== 'conflict' && !(diff.variantGroup && other.variantGroup === diff.variantGroup))) throw new Error('该本地章节已对应其他导入章节，请先核对重复内容或章节边界')
      Object.assign(diff, { localChapterId: row.id, localOrder: row.sort_order, localTitle: row.title, localContent: row.content, localSourceUrl: row.source_url,
        incomingOrder: row.sort_order, status: importContentHash(row.content) === importContentHash(diff.incomingContent) && row.title === diff.incomingTitle ? 'unchanged' : 'changed',
        confidence: 'high', selected: false, reason: '已人工确认对应关系；请展开比较正文后选择是否更新' })
    } else {
      Object.assign(diff, { localChapterId: undefined, localOrder: undefined, localTitle: undefined, localContent: undefined, localSourceUrl: undefined,
        status: 'new', confidence: 'high', selected: true, reason: '已人工确认是新章节；按指定位置插入，必要时顺延后续序号' })
    }
  }
  const chosenGroups = new Map<string, BookImportChapterDiff>()
  for (const resolution of resolutions) {
    const diff = diffs.find(c => c.id === resolution.chapterId)!
    if (resolution.action !== 'insert' || !diff.variantGroup) continue
    const previous = chosenGroups.get(diff.variantGroup)
    if (previous) previous.selected = false
    chosenGroups.set(diff.variantGroup, diff)
  }
  const plan = planImportInsertions(headers, sorted, new Set(diffs.filter(c => c.selected).map(c => c.id)))
  let tail = plan.maxOrder
  if (resolutions.some(r => r.action === 'insert')) for (const diff of diffs) {
    if (plan.insertOrders.has(diff.id)) diff.incomingOrder = plan.insertOrders.get(diff.id)!
    else if (diff.status === 'new' && diff.selected) diff.incomingOrder = ++tail
  }
  return diffs
}

export async function createPreview(db: Db, opts: ImportPreviewOptions): Promise<BookImportPreview> {
  const payload = normalizeImportPayload(opts.payload)
  const candidates = await findCandidates(db, payload, opts.sourceType)
  const unique = candidates.length === 1 ? candidates[0]! : null
  const authorConflict = unique?.matchReason === 'title' && knownAuthor(payload.author) && knownAuthor(unique.novel.author)
  // undefined 表示首次自动匹配；null 表示管理员明确选择新建，不能回退到旧书。
  const targetNovelId = opts.targetNovelId !== undefined
    ? opts.targetNovelId
    : unique && unique.matchReason !== 'title-tag' && !authorConflict ? unique.novel.id : null
  const targetCandidate = candidates.find((candidate) => candidate.novel.id === targetNovelId)
  let targetNovel = targetCandidate?.novel || null
  // 附加源已由管理员确认别名，目标作品不必再次满足自动书名匹配。
  if (targetNovelId && !targetNovel && opts.targetNovelId !== undefined) {
    const rows = await all<NovelRow>(db,'SELECT * FROM novels WHERE id=$1',[targetNovelId])
    targetNovel = rowToNovel(rows[0])
    if (!targetNovel) throw new Error('导入目标作品不存在，请重新预览')
  }
  const local = targetNovel ? await loadLocalChapters(db, targetNovel.id) : []
  const metadataDiff = buildMetadataDiff(payload, targetNovel).map(field => opts.preserveLocalOrder ? { ...field, selected: false } : field)
  if (payload.coverImage && targetNovel) {
    const cover = await all<{source:string}>(db, 'SELECT source FROM novel_covers WHERE novel_id=$1', [targetNovel.id])
    const field = metadataDiff.find(item => item.field === 'coverUrl')
    if (field && cover[0] && cover[0].source !== 'default') {
      field.localValue = field.localValue || '已有本地封面'
      field.selected = false
    }
  }
  const chapters = buildChapterDiff(payload, local, { preserveLocalOrder: opts.preserveLocalOrder })
  const summary = {
    newCount: chapters.filter((chapter) => chapter.status === 'new').length,
    changedCount: chapters.filter((chapter) => chapter.status === 'changed').length,
    unchangedCount: chapters.filter((chapter) => chapter.status === 'unchanged').length,
    conflictCount: chapters.filter((chapter) => chapter.status === 'conflict').length,
  }
  const warnings: string[] = []
  if (opts.targetNovelId === undefined && candidates.length > 1 && !targetNovel) warnings.push('发现多个候选作品，请核对书名和作者后选择。')
  if (opts.targetNovelId === undefined && unique?.matchReason === 'title-tag') warnings.push('忽略书名末尾的分类标签后，书名和作者一致。请核对后选择已有作品或新建作品。')
  if (authorConflict) warnings.push('同名候选的作者与导入作品不同，请核对后选择已有作品或新建作品。')
  if (summary.conflictCount) warnings.push(`有 ${summary.conflictCount} 个章节存在对应关系冲突，默认不会导入。`)
  const versionCount = new Set(chapters.map(chapter => chapter.variantGroup).filter(Boolean)).size
  if (versionCount) warnings.push(`有 ${versionCount} 组同章不同版本，默认均不选择；请展开比较，每组只选一个版本。选择后保留该章首次出现的位置。`)
  if (payload.chapters.length >= MAX_IMPORT_CHAPTERS) warnings.push(`最多展示前 ${MAX_IMPORT_CHAPTERS} 章，超出部分未进入预览。`)

  return {
    runId: opts.runId || newId('import'),
    sourceType: opts.sourceType,
    sourceLabel: text(opts.sourceLabel) || (opts.sourceType === 'url' ? opts.sourceUrl : '导入文件'),
    sourceUrl: safeSourceUrl(opts.sourceUrl || payload.sourceUrl),
    book: { ...payload, coverImage: undefined },
    candidates,
    targetNovelId,
    targetNovel,
    metadataDiff,
    chapters,
    chapterResolutions: [],
    resolutionSnapshot: undefined,
    localChapters: local.map(row => ({ id: row.id, title: row.title, order: row.sort_order })),
    summary,
    warnings,
    diagnostics: opts.diagnostics,
    aiReview: null,
  }
}

function metadataPatch(book: BookImportPayload, fields: Set<string>, current: Novel | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const canUse = (field: string, value: unknown) => fields.has(field) && Boolean(text(value)) && (!current || !metadataValue(current, field as BookImportMetadataDiff['field']))
  if (canUse('title', book.title)) patch.title = book.title
  if (canUse('author', book.author)) patch.author = book.author
  if (canUse('description', book.description)) patch.description = book.description
  if (canUse('coverUrl', book.coverUrl)) patch.coverUrl = book.coverUrl
  if (canUse('categories', book.categories?.join('、'))) patch.categories = book.categories
  if (canUse('status', book.status)) patch.status = book.status
  if (canUse('sourceUrl', book.sourceUrl)) patch.sourceUrl = book.sourceUrl
  return patch
}

function snapshotNovel(novel: Novel): Record<string, unknown> {
  return {
    id: novel.id,
    title: novel.title,
    author: novel.author,
    description: novel.description,
    coverUrl: novel.coverUrl,
    categories: novel.categories,
    status: novel.status,
    sourceUrl: novel.sourceUrl,
    updatedAt: novel.updatedAt,
    contentRating: novel.contentRating,
    contentRatingRevision: novel.contentRatingRevision || 0,
  }
}

function snapshotChapter(row: ChapterRow): Record<string, unknown> {
  return { id: row.id, title: row.title, order: row.sort_order, content: row.content, sourceUrl: row.source_url }
}

function sameSnapshotChapter(row: Record<string, unknown> | undefined, after: Record<string, unknown>): boolean {
  if (!row) return false
  return (
    importContentHash(row.content) === importContentHash(after.content) &&
    String(row.title || '') === String(after.title || '') &&
    Number(row.sort_order ?? row.order) === Number(after.order) &&
    safeSourceUrl(row.source_url) === safeSourceUrl(after.sourceUrl)
  )
}

function sameSnapshotNovel(row: Record<string, unknown> | undefined, after: Record<string, unknown>): boolean {
  if (!row) return false
  const rowCategories = safeJsonParse<string[]>(String(row.categories || '[]'), [])
  const afterCategories = Array.isArray(after.categories) ? after.categories.map(text) : []
  return (
    String(row.title || '') === String(after.title || '') &&
    String(row.author || '') === String(after.author || '') &&
    String(row.description || '') === String(after.description || '') &&
    String(row.cover_url || '') === String(after.coverUrl || '') &&
    JSON.stringify(rowCategories) === JSON.stringify(afterCategories) &&
    String(row.status || '') === String(after.status || '') &&
    String(row.source_url || '') === String(after.sourceUrl || '') &&
    (after.contentRatingRevision === undefined || Number(row.content_rating_revision || 0) === Number(after.contentRatingRevision)) &&
    (after.contentRating === undefined || String(row.content_rating) === String(after.contentRating))
  )
}

export async function applyImport(
  db: Db,
  opts: {
    run: StoredImportRun
    targetNovelId?: string | null
    selectedChapterIds: string[]
    metadataFields: string[]
    metadataMode: 'missing' | 'replace'
    actorUserId: string
  },
): Promise<BookImportCommitResult> {
  let preview = safeJsonParse<BookImportPreview>(opts.run.preview_json, {} as BookImportPreview)
  let payload = normalizeImportPayload(safeJsonParse<BookImportPayload>(opts.run.payload_json, {} as BookImportPayload))
  const targetNovelId = opts.targetNovelId || preview.targetNovelId || null
  const selectedChapters = new Set(opts.selectedChapterIds)
  const applied: AppliedChange[] = []
  const conflicts: Array<{ id: string; title: string; reason: string }> = []
  let novelId = targetNovelId || ''
  let novelCreated = false
  let created = 0
  let updated = 0
  let skipped = 0
  const metadataUpdated: string[] = []

  await withTx(db, async (q) => {
    const lockedRun = await q<StoredImportRun>('SELECT * FROM book_import_runs WHERE id = $1 FOR UPDATE', [opts.run.id])
    if (!lockedRun.rows.length) throw new Error('导入预览不存在')
    if (lockedRun.rows[0]!.status !== 'preview') throw new Error('这次导入已经提交，不能重复提交')
    if (Number(lockedRun.rows[0]!.source_expires_at) > 0 && Number(lockedRun.rows[0]!.source_expires_at) <= Date.now()) throw new Error('预览已过期，请重新生成预览')
    if (Number(lockedRun.rows[0]!.revision || 0) !== Number(opts.run.revision || 0)) throw new Error('预览版本已变化，请重新预览后提交')
    preview = safeJsonParse<BookImportPreview>(lockedRun.rows[0]!.preview_json, preview)
    payload = normalizeImportPayload(safeJsonParse<BookImportPayload>(lockedRun.rows[0]!.payload_json, payload))
    const chosenVariants = new Set<string>()
    for (const [index, group] of importVariantGroups(payload.chapters)) {
      if (!selectedChapters.has(`chapter-${index + 1}`)) continue
      if (chosenVariants.has(group)) throw new Error('同一章节存在多个正文版本，请只选择其中一个版本后提交')
      if (preview.chapters[index]?.variantGroup !== group) throw new Error('旧预览缺少版本选择信息，请重新生成预览后核对')
      chosenVariants.add(group)
    }
    const supplementary = !!lockedRun.rows[0]!.supplementary_binding_id
    if (supplementary) {
      if (!novelId || novelId !== lockedRun.rows[0]!.target_novel_id || opts.metadataFields.length) throw new Error('附加源只能更新绑定作品的章节，不能修改作品信息或导入目标')
      const mapped=preview.chapters.filter(c=>selectedChapters.has(c.id)&&c.localChapterId).map(c=>c.localChapterId)
      if(new Set(mapped).size!==mapped.length)throw new Error('所选章节重复对应同一本地章节，请重新核对预览')
      payload.chapters = payload.chapters.map(chapter=>({...chapter,sourceUrl:`${lockedRun.rows[0]!.source_url}#chapter=${chapter.order}`}))
    }
    let currentNovel: Novel | null = null
    if (novelId) {
      const row = await q<NovelRow>('SELECT * FROM novels WHERE id = $1 FOR UPDATE', [novelId])
      currentNovel = rowToNovel(row.rows[0])
      if (!currentNovel) throw new Error('导入目标作品不存在，请重新预览')
    } else {
      novelId = newId('novel')
      novelCreated = true
      const now = Date.now()
      const categories = normalizeCategories(payload.categories || [])
      const ruleSet = await loadContentRatingRuleSet(q)
      const ruleDecision = evaluateContentRatingRules({ title: payload.title, description: payload.description || '', categories }, ruleSet)
      const createdNovel = simplifyNovelForSource(
        {
          id: novelId,
          title: payload.title,
          author: payload.author,
          description: payload.description || '',
          coverUrl: payload.coverUrl || '',
          categories,
          status: payload.status || 'ongoing',
          contentRating: ruleDecision.rating,
          sourceUrl: payload.sourceUrl || '',
          chapterCount: 0,
          remoteChapterCount: 0,
          updateCheckedAt: 0,
          createdAt: now,
          updatedAt: now,
        },
        payload.sourceUrl || '',
      )
      await q(
        `INSERT INTO novels (id, title, author, description, cover_url, categories, status, content_rating, source_url, chapter_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$10)`,
        [novelId, createdNovel.title, createdNovel.author, createdNovel.description, createdNovel.coverUrl, JSON.stringify(categories), createdNovel.status, createdNovel.contentRating, createdNovel.sourceUrl, now],
      )
      await applyContentRatingChange(q, {
        novelId,
        rating: createdNovel.contentRating,
        source: 'source_import',
        actorUserId: opts.actorUserId,
        reason: '书籍导入时执行内容分级规则',
        evidence: ruleDecision.evidence,
        ruleVersion: ruleDecision.ruleVersion || '',
        operationId: opts.run.id,
      })
      currentNovel = rowToNovel((await q<NovelRow>('SELECT * FROM novels WHERE id=$1', [novelId])).rows[0])!
      applied.push({ id: `novel:${novelId}`, kind: 'create-novel', title: createdNovel.title, novelId, before: null, after: snapshotNovel(currentNovel) })
    }

    const localRows = await q<ChapterRow>('SELECT id, title, sort_order, content, source_url FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC FOR UPDATE', [novelId])
    const resolutions = preview.chapterResolutions || []
    if (resolutions.length) {
      if (!preview.resolutionSnapshot || preview.resolutionSnapshot !== importResolutionSnapshot(localRows.rows)) throw new Error('本地章节已变化，请重新生成预览并确认对应关系')
      preview.chapters = resolvedChapterDiffs(buildChapterDiff(payload, localRows.rows, { preserveLocalOrder: supplementary }), localRows.rows, resolutions)
      if (resolutions.some(r => r.action === 'insert')) {
        const plan = planImportInsertions(localRows.rows.map(c => ({ id: c.id, title: c.title, order: c.sort_order })), [...resolutions].sort((a,b) => preview.chapters.findIndex(c => c.id===a.chapterId)-preview.chapters.findIndex(c => c.id===b.chapterId)), selectedChapters)
        for (const change of [...plan.changes].sort((a,b) => b.before-a.before)) {
          await q('UPDATE chapters SET sort_order=$1 WHERE id=$2 AND novel_id=$3', [change.after, change.chapterId, novelId])
          applied.push({ id: `order:${change.chapterId}`, kind: 'reorder-chapter', title: change.title, novelId, chapterId: change.chapterId, before: { order: change.before }, after: { order: change.after } })
        }
        for (const row of localRows.rows) row.sort_order = plan.orders.get(row.id)!
        let tail = plan.maxOrder
        for (const diff of preview.chapters) {
          if (diff.localChapterId) { diff.localOrder = plan.orders.get(diff.localChapterId); diff.incomingOrder = diff.localOrder! }
          else if (plan.insertOrders.has(diff.id)) diff.incomingOrder = plan.insertOrders.get(diff.id)!
          else if (diff.status === 'new' && selectedChapters.has(diff.id)) diff.incomingOrder = ++tail
        }
      }
    }
    const localById = new Map(localRows.rows.map((row) => [row.id, row]))
    for (const diff of preview.chapters) {
      if (!selectedChapters.has(diff.id)) {
        skipped++
        continue
      }
      if (diff.status === 'conflict' || diff.status === 'unchanged') {
        skipped++
        continue
      }
      const sourceChapter = payload.chapters.find((chapter, index) => `chapter-${index + 1}` === diff.id)
      if (!sourceChapter) continue
      const incoming = supplementary || diff.variantGroup || resolutions.length ? { ...sourceChapter, order: diff.incomingOrder } : sourceChapter
      if (supplementary || diff.variantGroup || resolutions.length) {
        const occupied = localRows.rows.find(c=>c.sort_order===incoming.order && c.id!==diff.localChapterId)
        if (occupied) { conflicts.push({id:diff.id,title:diff.incomingTitle,reason:'目标序号已被其他章节占用，请核对章节对应关系'}); continue }
        if (diff.status === 'new' && !resolutions.some(r => r.chapterId === diff.id && r.action === 'insert')) {
          const fresh = buildChapterDiff({...payload,chapters:[incoming]},localRows.rows)[0]
          if (fresh?.status === 'unchanged') { skipped++; continue }
          if (fresh?.status !== 'new') { conflicts.push({id:diff.id,title:diff.incomingTitle,reason:'预览后已有对应章节，请重新生成预览'}); continue }
        }
      }
      const current = diff.localChapterId ? localById.get(diff.localChapterId) : undefined
      if (supplementary && current && incoming.order !== current.sort_order) {
        conflicts.push({ id: diff.id, title: diff.incomingTitle, reason: '附加源旧预览会改变融合后的序号，请重新生成预览' })
        continue
      }
      if (diff.status === 'changed') {
        if (!current || importContentHash(current.content) !== importContentHash(diff.localContent) || current.title !== diff.localTitle || current.sort_order !== diff.localOrder) {
          conflicts.push({ id: diff.id, title: diff.incomingTitle, reason: '预览后本地章节已发生变化' })
          continue
        }
        const before = snapshotChapter(current)
        const next = { id: current.id, title: incoming.title, order: incoming.order, content: incoming.content, sourceUrl: safeSourceUrl(incoming.sourceUrl) }
        await q('UPDATE chapters SET title=$1, content=$2, sort_order=$3, word_count=$4, source_url=$5 WHERE id=$6 AND novel_id=$7', [next.title, next.content, next.order, normalizeImportContent(next.content).length, next.sourceUrl, current.id, novelId])
        applied.push({ id: diff.id, kind: 'update-chapter', title: incoming.title, novelId, chapterId: current.id, before, after: next })
        updated++
      } else {
        const id = newId('ch')
        const now = Date.now()
        const chapter = simplifyChapterForSource({ title: incoming.title, content: incoming.content, sourceUrl: safeSourceUrl(incoming.sourceUrl) }, safeSourceUrl(incoming.sourceUrl))
        const next = { id, title: chapter.title, order: incoming.order, content: chapter.content || '', sourceUrl: safeSourceUrl(incoming.sourceUrl) }
        await q(
          `INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, novelId, next.title, next.content, next.order, normalizeImportContent(next.content).length, next.sourceUrl, now],
        )
        applied.push({ id: diff.id, kind: 'create-chapter', title: incoming.title, novelId, chapterId: id, before: null, after: next })
        created++
        if (supplementary) localRows.rows.push({id,title:next.title,sort_order:next.order,content:next.content,source_url:next.sourceUrl})
      }
    }

    const fields = opts.metadataMode === 'replace' ? new Set(opts.metadataFields) : new Set(opts.metadataFields)
    const patch = metadataPatch(payload, fields, currentNovel)
    if (opts.metadataMode === 'replace') {
      if (fields.has('title')) patch.title = payload.title
      if (fields.has('author')) patch.author = payload.author
      if (fields.has('description')) patch.description = payload.description || ''
      if (fields.has('coverUrl')) patch.coverUrl = payload.coverUrl || ''
      if (fields.has('categories')) patch.categories = payload.categories || []
      if (fields.has('status')) patch.status = payload.status || 'ongoing'
      if (fields.has('sourceUrl')) patch.sourceUrl = payload.sourceUrl || ''
    }
    if (payload.coverImage) delete patch.coverUrl
    if (currentNovel && !novelCreated && Object.keys(patch).length) {
      const before = snapshotNovel(currentNovel)
      const next = { ...currentNovel, ...patch, categories: Array.isArray(patch.categories) ? patch.categories : currentNovel.categories, updatedAt: Date.now() } as Novel
      await q(
        `UPDATE novels SET title=$1, author=$2, description=$3, cover_url=$4, categories=$5, status=$6, source_url=$7, chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$8), updated_at=$9 WHERE id=$8`,
        [next.title, next.author, next.description, next.coverUrl, JSON.stringify(next.categories), next.status, next.sourceUrl, novelId, next.updatedAt],
      )
      for (const field of Object.keys(patch)) metadataUpdated.push(field)
      if (!supplementary && currentNovel.contentRating === 'unknown') {
        const ruleSet = await loadContentRatingRuleSet(q)
        const decision = evaluateContentRatingRules({ title: next.title, description: next.description, categories: next.categories }, ruleSet)
        await applyContentRatingChange(q, { novelId, rating: decision.rating, source: 'source_import', actorUserId: opts.actorUserId,
          reason: '导入更新元数据后重新执行分级规则', evidence: decision.evidence, ruleVersion: decision.ruleVersion,
          operationId: opts.run.id, expectedRevision: currentNovel.contentRatingRevision || 0 })
      }
      const after = rowToNovel((await q<NovelRow>('SELECT * FROM novels WHERE id=$1', [novelId])).rows[0])!
      applied.push({ id: 'metadata', kind: 'metadata', title: currentNovel.title, novelId, before, after: snapshotNovel(after) })
    }
    if (payload.coverImage && fields.has('coverUrl')) {
      const rows = await q<Record<string, unknown>>('SELECT * FROM novel_covers WHERE novel_id=$1 FOR UPDATE', [novelId])
      const before = coverSnapshot(rows.rows[0])
      // Filling missing information never overwrites an adopted cover, including uploads with an empty cover_url.
      const hasCover = rows.rows[0] && rows.rows[0].source !== 'default'
      if (novelCreated || opts.metadataMode === 'replace' || (!hasCover && !currentNovel?.coverUrl)) {
        const now = Date.now()
        await q(`INSERT INTO novel_covers(novel_id,data,content_type,source,prompt,metadata,updated_at)
          VALUES($1,$2,$3,'import','','{}',$4) ON CONFLICT(novel_id) DO UPDATE SET
          data=EXCLUDED.data,content_type=EXCLUDED.content_type,source=EXCLUDED.source,prompt=EXCLUDED.prompt,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at`,
          [novelId, Buffer.from(payload.coverImage.dataBase64, 'base64'), payload.coverImage.contentType, now])
        const after = coverSnapshot((await q<Record<string, unknown>>('SELECT * FROM novel_covers WHERE novel_id=$1', [novelId])).rows[0])!
        applied.push({ id: 'cover-image', kind: 'cover-image', title: currentNovel?.title || payload.title, novelId, before, after })
        if (!metadataUpdated.includes('coverUrl')) metadataUpdated.push('coverUrl')
      }
    }
    await q('UPDATE novels SET chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$1), updated_at=$2 WHERE id=$1', [novelId, Date.now()])
    const status = conflicts.length ? 'partial' : 'applied'
    await q('UPDATE book_import_runs SET target_novel_id=$1, status=$2, changes_json=$3, applied_at=$4, history_summary=$6, source_expires_at=$7 WHERE id=$5', [novelId, status, JSON.stringify(applied), Date.now(), opts.run.id, JSON.stringify({ title: preview.book.title, conflicts: conflicts.length, created, updated }), Date.now() + 30 * 86400000])
  })

  if (applied.some(change => change.kind === 'cover-image') && payload.coverImage) {
    await prepareCoverDisplays(db, novelId, {
      data: Buffer.from(payload.coverImage.dataBase64, 'base64'), contentType: payload.coverImage.contentType,
    })
  }
  return { runId: opts.run.id, batchId: opts.run.id, novelId, novelCreated, created, updated, skipped, metadataUpdated, conflicts }
}

export async function rollbackImport(db: Db, run: StoredImportRun): Promise<BookImportRollbackResult> {
  const changes = safeJsonParse<AppliedChange[]>(run.changes_json, [])
  const conflicts: Array<{ id: string; title: string; reason: string }> = []
  let rolledBack = 0
  await withTx(db, async (q) => {
    const lockedRun = await q<{ status: string }>('SELECT status FROM book_import_runs WHERE id = $1 FOR UPDATE', [run.id])
    if (!lockedRun.rows.length) throw new Error('导入记录不存在')
    if (!['applied', 'partial'].includes(lockedRun.rows[0]!.status)) throw new Error('这次导入当前不可撤回')
    // 先保护整本新作品，再处理子项；不能删完章节才发现作品已经被人工审核。
    const protectedNovels = new Set<string>()
    for (const change of changes.filter(item => item.kind === 'cover-image')) {
      const current = coverSnapshot((await q<Record<string, unknown>>('SELECT * FROM novel_covers WHERE novel_id=$1 FOR UPDATE', [change.novelId])).rows[0])
      if (coverFingerprint(current) !== coverFingerprint(change.after)) {
        protectedNovels.add(change.novelId)
        conflicts.push({ id: change.id, title: change.title, reason: '封面已在导入后更改，整本保留以免覆盖后续修改' })
      }
    }
    const orderChanges = changes.filter(change => change.kind === 'reorder-chapter')
    if (orderChanges.length && run.target_novel_id) {
      await q('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [run.target_novel_id])
      const rows = (await q<Record<string, unknown>>('SELECT id,title,sort_order,content,source_url FROM chapters WHERE novel_id=$1 FOR UPDATE', [run.target_novel_id])).rows
      const affected = new Set(changes.filter(c => c.kind === 'reorder-chapter' || c.kind === 'create-chapter').map(c => c.chapterId))
      const changed = changes.some(change => {
        const row = rows.find(c => c.id === change.chapterId)
        if (change.kind === 'reorder-chapter') return !row || Number(row.sort_order) !== Number(change.after.order) || rows.some(c => c.sort_order === change.before?.order && !affected.has(String(c.id)))
        return (change.kind === 'create-chapter' || change.kind === 'update-chapter') && !sameSnapshotChapter(row, change.after)
      })
      if (changed) {
        protectedNovels.add(run.target_novel_id)
        conflicts.push({ id: run.id, title: '人工确认插章', reason: '插章关联章节已变化，本次新增与序号调整整体保留，请人工核对后再撤回' })
      }
    }
    for (const change of changes.filter(item => item.kind === 'create-novel')) {
      const row = await q<Record<string, unknown>>('SELECT * FROM novels WHERE id=$1 FOR UPDATE', [change.novelId])
      if (row.rows[0] && !sameSnapshotNovel(row.rows[0], change.after)) {
        protectedNovels.add(change.novelId)
        conflicts.push({ id: change.id, title: change.title, reason: '新作品已被再次编辑或审核，整本保留' })
      }
    }
    for (const change of [...changes].reverse()) {
      if (protectedNovels.has(change.novelId)) continue
      if (change.kind === 'cover-image') {
        if (change.before) {
          const old = change.before
          await q(`INSERT INTO novel_covers(novel_id,data,content_type,source,prompt,metadata,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(novel_id) DO UPDATE SET data=EXCLUDED.data,content_type=EXCLUDED.content_type,
            source=EXCLUDED.source,prompt=EXCLUDED.prompt,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at`,
            [change.novelId, Buffer.from(String(old.dataBase64), 'base64'), old.content_type, old.source, old.prompt || '', old.metadata || '{}', old.updated_at])
        } else await q('DELETE FROM novel_covers WHERE novel_id=$1', [change.novelId])
        rolledBack++
        continue
      }
      if (change.kind === 'create-novel') {
        const novel = await q<Record<string, unknown>>('SELECT * FROM novels WHERE id = $1 FOR UPDATE', [change.novelId])
        const chapters = await q<Record<string, unknown>>('SELECT id, title, sort_order, content, source_url FROM chapters WHERE novel_id = $1', [change.novelId])
        const untouched = novel.rows.length > 0 && sameSnapshotNovel(novel.rows[0], change.after) && chapters.rows.every((row) => {
          const created = changes.filter((item) => item.kind === 'create-chapter' && item.novelId === change.novelId).find((item) => item.chapterId === row.id)
          return created ? sameSnapshotChapter(row, created.after) : false
        })
        if (!novel.rows.length || !untouched) {
          conflicts.push({ id: change.id, title: change.title, reason: '新作品已被再次编辑，无法安全删除' })
          continue
        }
        await q('DELETE FROM novels WHERE id = $1', [change.novelId])
        rolledBack++
        continue
      }
      if (change.kind === 'create-chapter' && change.chapterId) {
        const row = await q<Record<string, unknown>>('SELECT id, title, sort_order, content, source_url FROM chapters WHERE id = $1 FOR UPDATE', [change.chapterId])
        if (!row.rows.length || !sameSnapshotChapter(row.rows[0], change.after)) {
          conflicts.push({ id: change.id, title: change.title, reason: '章节已被再次编辑，未删除' })
          continue
        }
        await q('DELETE FROM chapters WHERE id = $1', [change.chapterId])
        rolledBack++
        continue
      }
      if (change.kind === 'reorder-chapter' && change.chapterId && change.before) {
        await q('UPDATE chapters SET sort_order=$1 WHERE id=$2 AND novel_id=$3', [change.before.order, change.chapterId, change.novelId])
        rolledBack++
        continue
      }
      if (change.kind === 'update-chapter' && change.chapterId && change.before) {
        const row = await q<Record<string, unknown>>('SELECT id, title, sort_order, content, source_url FROM chapters WHERE id = $1 FOR UPDATE', [change.chapterId])
        if (!row.rows.length || !sameSnapshotChapter(row.rows[0], change.after)) {
          conflicts.push({ id: change.id, title: change.title, reason: '章节已被再次编辑，未恢复' })
          continue
        }
        const before = change.before
        await q('UPDATE chapters SET title=$1, content=$2, sort_order=$3, word_count=$4, source_url=$5 WHERE id=$6', [before.title, before.content, before.order, normalizeImportContent(before.content).length, before.sourceUrl || '', change.chapterId])
        rolledBack++
        continue
      }
      if (change.kind === 'metadata' && change.before) {
        const row = await q<Record<string, unknown>>('SELECT * FROM novels WHERE id = $1 FOR UPDATE', [change.novelId])
        if (!row.rows.length || !sameSnapshotNovel(row.rows[0], change.after)) {
          conflicts.push({ id: change.id, title: change.title, reason: '作品信息已被再次编辑，未恢复' })
          continue
        }
        const before = change.before
        await q('UPDATE novels SET title=$1, author=$2, description=$3, cover_url=$4, categories=$5, status=$6, source_url=$7, updated_at=$8 WHERE id=$9', [before.title, before.author, before.description, before.coverUrl, JSON.stringify(before.categories || []), before.status, before.sourceUrl || '', Date.now(), change.novelId])
        if (before.contentRating !== undefined && before.contentRating !== row.rows[0]?.content_rating) {
          await applyContentRatingChange(q, { novelId: change.novelId, rating: before.contentRating as Novel['contentRating'], source: 'source_import', actorUserId: 'system',
            reason: '撤回导入，恢复原分级', operationId: run.id, expectedRevision: Number(row.rows[0]?.content_rating_revision) || 0 })
        }
        rolledBack++
      }
    }
    if (run.target_novel_id) await q('UPDATE novels SET chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$1), updated_at=$2 WHERE id=$1', [run.target_novel_id, Date.now()])
    await q('UPDATE book_import_runs SET status=$1, rolled_back_at=$2 WHERE id=$3', [conflicts.length ? 'partial' : 'rolled_back', Date.now(), run.id])
  })
  return { runId: run.id, rolledBack, conflicts }
}

export function bookImportTestHelpers() {
  return {
    normalizeImportTitle,
    normalizeImportChapterTitle,
    normalizeImportContent,
    importContentHash,
    importChapterKey,
    isChapterHeadingLine,
    probeChapterHeadingLine,
    fileStem,
    titlesMatch,
    buildChapterDiff,
    buildMetadataDiff,
    parseTextImport,
    parseTextImportDetailed,
    parseUploadedBookDetailed,
    detectImportAnomalies,
  }
}
