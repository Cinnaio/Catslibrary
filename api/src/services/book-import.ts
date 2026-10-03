import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type {
  BookImportChapterDiff,
  BookImportChapterInput,
  BookImportCommitResult,
  BookImportMetadataDiff,
  BookImportNovelCandidate,
  BookImportPayload,
  BookImportPreview,
  BookImportRollbackResult,
  Novel,
} from '@shared/types'
import { all, withTx } from '../db/query'
import type { Db } from '../db/pool'
import { newId } from './auth'
import { normalizeCategories } from './categories'
import { rowToNovel, safeJsonParse, type NovelRow } from '../db/mappers'
import { simplifyChapterForSource, simplifyNovelForSource } from './zh-convert'
import { evaluateContentRatingRules, loadContentRatingRuleSet } from './content-rating-rules'
import { applyContentRatingChange } from './content-rating-governance'
import { detectMeta, collectChapterLinks } from './scraper/meta'
import { cleanHtml, cleanText, extractContent, extractLinks, extractText } from './scraper/parse'
import { isPo18twLoginPage, parsePo18twChapterContent, parsePo18twChapterLinks, po18ChapterContentUrl } from './scraper/enrich'
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
 * 正文句子的收尾标点。标题几乎不会以句号或省略号结尾；出现即说明这行是正文首句，
 * 而非章节名（「第一回体验性爱就被内射，谢溪大脑空白了一瞬，身体也仿佛……被置于一整片虚空之中。」）。
 */
const PROSE_ENDING = /[。…]$/
/** 叹号/问号：章节名常用（「休得如此荒唐！」「李云儿，没啦！」），不能一律否决。 */
const EXCLAIM_ENDING = /[！？；]$/
/** 「！」「？」收尾的短标题（≤26 字）视为正常章节名，超过则按正文可疑处理。 */
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
 * 判断一行是否为可用的章节标题行。
 * 返回标题原文（已去首尾空白），非标题返回 null。
 */
export function isChapterHeadingLine(line: string): string | null {
  // 先剥掉行首零宽字符，否则 `⁡ 0083 和哥哥同居啦！` 这类行会整行漏判。
  const raw = String(line || '').replace(LEADING_INVISIBLE, '')
  const match = raw.match(CHAPTER_HEADING)
  if (match) {
    const title = match[1]!.trim()
    if (title.length > MAX_CHAPTER_TITLE_LENGTH) return null
    // 结尾标点要分开看：
    // - 「。」「…」是正文句子的特征（「第一回体验性爱就被内射，谢溪大脑空白了一瞬……」），
    //   标题里几乎不出现，出现即否决。
    // - 「！」「？」在章节名里极常见（「第0022章 （纯剧情章）休得如此荒唐！」
    //   「第0034章 李云儿，没啦！」「0060 图穷匕见/魔修闯进来了！（550珠加更）」），
    //   一律否决会让这些章整章丢失。
    // 「！」「？」只在标题超过短标题阈值时才可疑，故按长度二次约束。
    if (PROSE_ENDING.test(title)) return null
    if (EXCLAIM_ENDING.test(title) && title.length > MAX_SHORT_TITLE_LENGTH) return null
    return title
  }
  // 裸数字标题：`0073 我们做夫妻也是可以的【2500珠加更】`（编号后有空白）
  const bare = raw.match(BARE_NUMBER_HEADING)
  if (bare) {
    // 保留原始编号字符串（含前导零）：`003 我们走吧` 归一成 `3` 会丢掉站点导出的位宽，
    // 也让「按编号对齐」在跨版本比对时认不出同一章。
    const digits = bare[1]!.normalize('NFKC')
    const number = Number(digits)
    const body = bare[2]!
    if (Number.isFinite(number) && number > MAX_BARE_NUMBER) return null
    if (body.length > MAX_BARE_TITLE_LENGTH) return null
    // 编号后有显式空白时，句读不参与否决：作者会把公告类章名写成
    // 「81 晚点更新。顺便安利篇很香的兄妹骨。」，带句号仍是标题。
    // 真正需要挡掉的是超长正文，已由长度上限覆盖。
    return `${digits} ${body}`.trim()
  }
  // 紧贴写法：`32她才不想要呢……【400珠加更】`、`0083和哥哥同居啦！`——编号与正文之间无空白。
  const tight = raw.match(BARE_NUMBER_TIGHT)
  if (tight) {
    const digits = tight[1]!.normalize('NFKC')
    const number = Number(digits)
    const body = tight[2]!
    if (number > MAX_BARE_NUMBER) return null
    if (body.length > MAX_BARE_TITLE_LENGTH) return null
    // 无分隔符时风险更高，句号收尾一律否决：
    // 「69是什么，她之前其实没有听过。」是正文，不是「69」章的标题。
    if (PROSE_ENDING.test(body)) return null
    return `${digits} ${body}`.trim()
  }
  return null
}

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
  id: string
  source_type: 'file' | 'url'
  source_label: string
  source_url: string
  target_novel_id: string
  status: string
  payload_json: string
  preview_json: string
  changes_json: string
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
}

interface ChapterRow {
  id: string
  title: string
  sort_order: number
  content: string
  source_url: string
}

interface AppliedChange {
  id: string
  kind: 'create-chapter' | 'update-chapter' | 'metadata' | 'create-novel'
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
  return text(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    // 中文数字编号（第一章、第九章）此前不参与剥号，导致「第0009章 谢俞」与正文首行
    // 的「第九章」算成两个不同章节，正文被挂到后者、前者成为空章。两种写法都要剥。
    .replace(/^第\s*[0-9０-９]+\s*[章节回卷集部篇]?\s*/i, '')
    .replace(/^第\s*[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]?\s*/i, '')
    .replace(/^chapter\s*\d+\s*/i, '')
    // 裸数字标题的编号前缀同样要剥（「32 她才不想要呢」→「她才不想要呢」）。
    // 库里存的是不带编号的章节名，不剥这一层，导入侧每个裸数字章节都会被误判成新增。
    .replace(/^[0-9０-９]{1,4}\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
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
        }))
        .filter((chapter) => chapter.content.trim() || chapter.title.trim())
        .slice(0, MAX_IMPORT_CHAPTERS)
    : []

  const title = text(raw.title)
  if (!title) throw new Error('导入文件缺少书名')
  if (!chapters.length) throw new Error('导入内容没有可识别的章节')

  return {
    title,
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

/** 书名相同、或一侧完整包含另一侧（长边至少 4 字）时算同一本书。 */
function titlesMatch(a: unknown, b: unknown): boolean {
  const left = matchKey(a)
  const right = matchKey(b)
  if (!left || !right) return false
  if (left === right) return true
  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  return short.length >= 4 && long.includes(short)
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
  if (bare) return `#${normalizeImportChapterNumber(bare[1]!)}`
  return normalizeImportChapterTitle(raw)
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

/**
 * TXT 章节切分。
 *
 * 真实站点导出的 TXT 有两层标题：章级「第0009章 标题」和正文首行的「第九章」。
 * 两者都命中章节规则，若一行一章直接切，前半段会被上一行截走——抽出「第0009章」
 * 得到空正文，真正的正文挂在下一行的「第九章」上。所以这里先按标题编号去重，
 * 重复编号只作为正文首行保留，同时兼容 0001/第一章 混排与 第一章/1. 混排。
 */
export function parseTextImport(input: string, fileName = '未命名.txt'): BookImportPayload {
  const lines = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  /** 切分期的内部章节：额外记住它是否由权威标题（第NNN章 / NNN）开出，用于识别重抄标题。 */
  type WorkingChapter = BookImportChapterInput & { fromAuthoritative?: boolean }
  const chapters: WorkingChapter[] = []
  let current: WorkingChapter | null = null
  const byKey = new Map<string, WorkingChapter>()

  const stripHeading = (title: string) => title.replace(/\s+/g, ' ').trim()

  const beginChapter = (title: string, keys: string[], fromAuthoritative = false) => {
    const chapter: WorkingChapter = { title, order: chapters.length + 1, content: '', fromAuthoritative }
    chapters.push(chapter)
    for (const key of keys) if (key && !byKey.has(key)) byKey.set(key, chapter)
    current = chapter
  }

  for (const line of lines) {
    const headingTitle = isChapterHeadingLine(line)
    if (headingTitle && VOLUME_HEADING.test(headingTitle)) {
      // 卷标题并进正文：既保住卷名，也防止它把上一章的正文截走。
      if (current) current.content += `${text(headingTitle)}\n`
      continue
    }
    if (headingTitle) {
      const title = text(headingTitle)
      const key = importChapterKey(title)
      // 卷标题里的章节号优先，用它判断「第三卷 第四十九章 反击」是否等于已有的第 49 章。
      const embedded = title.match(EMBEDDED_VOLUME_CHAPTER)
      const embeddedKey = embedded ? importChapterKey(title.slice(embedded.index!)) : ''
      // 完整章级标题（第0003章 / 0032 / 32标题）是权威章节边界，永远自己开一章：
      // 这份导出里「第0003章」标题后面正文开头写的是「第四章」（原文编号本身错位），
      // 若让它归并进已有的第 4 章，就会整章丢失。
      const authoritative =
        /^第\s*[0-9０-９]+\s*[章节回]/u.test(title) ||
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
        continue
      }
      beginChapter(title, [embeddedKey, key], authoritative)
      continue
    }
    if (current) {
      current.content += `${line}\n`
    } else if (text(line)) {
      const chapter: BookImportChapterInput = { title: '正文', order: 1, content: `${line}\n` }
      chapters.push(chapter)
      current = chapter
    }
  }

  // 空正文的编号章节是章节切分炸掉的信号，宁可丢弃也不要写入空章。
  const kept = chapters.filter((chapter) => chapter.content.trim() || !importChapterKey(chapter.title))
  const payloadChapters = kept.length ? kept : chapters
  if (!payloadChapters.length) payloadChapters.push({ title: '正文', order: 1, content: String(input || '').trim() })

  // 头部元信息块（`书名：X` / `作者：X` / `简介：X`）。站点导出的 TXT 把书名、作者、
  // 分类、简介写在首个章节标题之前，若不管它，这段会被切成一个名为「正文」的伪章，
  // 并让「书名」退回文件名。这里提取元数据，并把该块从正文中剔除。
  const meta = parseTextImportMeta(lines, payloadChapters)
  // 元信息被摘掉后可能留下空壳的「正文」兜底章——它由「首个章节标题之前出现正文行」开出，
  // 本身既非编号章节也无内容，必须丢弃，否则预览里会多出一条幽灵章节。
  const cleaned = payloadChapters.filter((chapter) => chapter.content.trim() || (chapter.title !== '正文' && importChapterKey(chapter.title)))
  const finalChapters = cleaned.length ? cleaned : payloadChapters
  finalChapters.forEach((chapter, index) => { chapter.order = index + 1 })

  return normalizeImportPayload({
    title: meta.title || fileStem(fileName) || '未命名作品',
    author: meta.author || '未知作者',
    description: meta.description,
    chapters: finalChapters,
  })
}

/** 头部元信息块允许出现的字段前缀；命中即是元信息而非正文。 */
const TEXT_META_LINE = /^\s*(书名|作品名|标题|作者|作\s*者|简介|内容简介|文案|分类|标签|状态|字数|来源|出处|更新)\s*[:：]\s*(.*)$/

/**
 * 解析 TXT 头部的元信息块。
 *
 * 该块位于第一个章节标题之前，形如：
 *   书名：和哥哥在乱交世界里假装do爱
 *   作者：归雾
 *   分类：簡體版 骨科 高H 1V1
 *   简介：谢溪16岁才回到谢家……
 *   哥哥不喜欢她，甚至有些讨厌她。   ← 简介的续行
 * 简介可跨多行，直到遇到空行、字段行或首个章节标题为止。
 *
 * 副作用：把已消费的元信息行从章节正文中移除，避免生成「正文」伪章。
 */
function parseTextImportMeta(lines: string[], chapters: BookImportChapterInput[]): { title?: string; author?: string; description?: string } {
  const meta: { title?: string; author?: string; description?: string } = {}
  const consume = new Set<number>()
  let sawMeta = false
  let descriptionOpen = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // 章节标题之前的行才可能是元信息；一旦出现标题就停止。
    if (isChapterHeadingLine(line)) break
    const trimmed = line.trim()
    if (!trimmed) {
      // 空行结束简介续行；但整块尚未开始时只是普通前导空行。
      descriptionOpen = false
      continue
    }
    const field = trimmed.match(TEXT_META_LINE)
    if (field) {
      sawMeta = true
      consume.add(i)
      const key = field[1]!.replace(/\s/g, '')
      const value = field[2]!.trim()
      if (key === '书名' || key === '作品名' || key === '标题') {
        if (value && !meta.title) meta.title = value
      } else if (key === '作者') {
        if (value && !meta.author) meta.author = value
      } else if (key === '简介' || key === '内容简介' || key === '文案') {
        descriptionOpen = true
        if (value) meta.description = value
      }
      continue
    }
    // 简介续行：紧跟「简介：」之后、且未遇空行的普通文本行。
    if (descriptionOpen) {
      consume.add(i)
      meta.description = meta.description ? `${meta.description}\n${trimmed}` : trimmed
      continue
    }
    // 元信息块开始后、遇到无法识别的行：说明块已结束，交回正文处理。
    if (sawMeta) break
  }

  if (!consume.size) return meta

  // 把已消费的行从章节正文里去掉。元信息只会出现在首章正文开头。
  const consumedLines = new Set<string>()
  for (const index of consume) consumedLines.add(lines[index]!.trim())
  for (const chapter of chapters) {
    const keptLines = chapter.content
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        if (!t) return true
        if (consumedLines.has(t)) return false
        return !TEXT_META_LINE.test(t)
      })
    chapter.content = keptLines.join('\n').replace(/^\n+/, '')
  }

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

export async function parseUploadedBook(fileName: string, data: Uint8Array): Promise<BookImportPayload> {
  if (data.byteLength > MAX_IMPORT_BYTES) throw new Error('导入文件不能超过 25 MB')
  const lower = fileName.toLocaleLowerCase()
  if (lower.endsWith('.epub')) return parseEpubImport(data, fileName)
  const content = new TextDecoder('utf-8').decode(data)
  if (lower.endsWith('.json')) {
    try {
      return normalizeImportPayload(JSON.parse(content) as Partial<BookImportPayload>)
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error('JSON 文件格式不正确')
      throw err
    }
  }
  if (lower.endsWith('.txt') || lower.endsWith('.text') || !fileName.includes('.')) return parseTextImport(content, fileName)
  throw new Error('暂时支持 TXT、JSON 和 EPUB 文件')
}

export interface UrlImportDeps {
  store: ScrapeStore
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>
}

export interface UrlImportResult {
  payload: BookImportPayload
  warnings: string[]
}

function isPo18ImportUrl(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase()
    return host === 'po18.tw' || host.endsWith('.po18.tw')
  } catch {
    return false
  }
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
  const po18 = isPo18ImportUrl(normalizedUrl) || meta.selectors.chapterList === '@po18tw:chapter-list'
  const selectors = meta.selectors || {}
  const listUrl = meta.chapterListUrl || normalizedUrl
  const listResult = await deps.fetchHtml(listUrl, { forceEncoding: meta.encoding })
  if (po18 && isPo18twLoginPage(listResult.html)) throw new Error('POPO 目录需要登录，请先配置 POPO 账号或 Cookie')

  let links: Array<{ href: string; text: string; order?: number }> = []
  const warnings: string[] = []
  if (po18) {
    links = parsePo18twChapterLinks(listResult.html, listUrl).links.map((link, index) => ({ ...link, order: index + 1 }))
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
        const targetUrl = po18 ? po18ChapterContentUrl(link.href) : link.href
        const requestOptions: FetchHtmlOptions = po18
          ? {
              forceEncoding: meta.encoding,
              timeoutMs: 12000,
              headers: { Referer: link.href, 'X-Requested-With': 'XMLHttpRequest' },
            }
          : { forceEncoding: meta.encoding, timeoutMs: 12000 }
        const chapterResult = await deps.fetchHtml(targetUrl, requestOptions)
        if (po18 && isPo18twLoginPage(chapterResult.html)) throw new Error('返回了登录页')
        const parsed = po18 ? parsePo18twChapterContent(chapterResult.html, link.text || '') : null
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
  return { payload, warnings: Array.from(new Set(warnings)) }
}

function metadataValue(novel: Novel | null, field: BookImportMetadataDiff['field']): string {
  if (!novel) return ''
  const value = novel[field]
  return Array.isArray(value) ? value.join('、') : text(value)
}

function incomingMetadataValue(book: BookImportPayload, field: BookImportMetadataDiff['field']): string {
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

export function buildChapterDiff(book: BookImportPayload, local: ChapterRow[]): BookImportChapterDiff[] {
  const bySourceUrl = new Map<string, ChapterRow>()
  const byOrderAndTitle = new Map<string, ChapterRow>()
  const byOrder = new Map<number, ChapterRow[]>()
  const byTitle = new Map<string, ChapterRow[]>()
  for (const chapter of local) {
    const sourceUrl = safeSourceUrl(chapter.source_url)
    if (sourceUrl) bySourceUrl.set(sourceUrl, chapter)
    const key = `${chapter.sort_order}:${normalizeImportChapterTitle(chapter.title)}`
    byOrderAndTitle.set(key, chapter)
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
  return book.chapters.map((incoming, index) => {
    const sourceUrl = safeSourceUrl(incoming.sourceUrl)
    const titleKey = normalizeImportChapterTitle(incoming.title)
    const strong = sourceUrl ? bySourceUrl.get(sourceUrl) : undefined
    const exact = strong || byOrderAndTitle.get(`${incoming.order}:${titleKey}`)
    // 只有编号没有标题时按序号对齐：序号唯一才认，避免不同写法互相抢。
    const sameOrder = !titleKey ? byOrder.get(incoming.order) || [] : []
    const sameTitle = titleKey ? byTitle.get(titleKey) || [] : []
    const candidate = exact || (sameOrder.length === 1 ? sameOrder[0] : undefined) || (sameTitle.length === 1 ? sameTitle[0] : undefined)
    const conflict = !exact && (sameTitle.length > 1 || (!titleKey && sameOrder.length > 1))
    if (candidate) used.add(candidate.id)
    const contentChanged = candidate ? importContentHash(candidate.content) !== importContentHash(incoming.content) : false
    const titleChanged = candidate ? normalizeImportChapterTitle(candidate.title) !== titleKey || candidate.title !== incoming.title : false
    let status: BookImportChapterDiff['status'] = 'new'
    let confidence: BookImportChapterDiff['confidence'] = 'high'
    let reason = '导入源存在，本地没有对应章节'
    if (conflict) {
      status = 'conflict'
      confidence = 'low'
      reason = '发现多个同名章节，无法自动判断对应关系'
    } else if (candidate) {
      status = contentChanged || titleChanged ? 'changed' : 'unchanged'
      confidence = exact ? 'high' : 'medium'
      reason = exact ? (sourceUrl ? '来源地址一致' : '序号与标题一致') : '标题一致，序号不同或来源地址缺失'
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
      localSourceUrl: candidate?.source_url,
      incomingSourceUrl: sourceUrl,
      confidence,
      reason,
      selected: status === 'new',
    }
  })
}

async function findCandidates(db: Db, book: BookImportPayload): Promise<BookImportNovelCandidate[]> {
  const rows = await all<NovelRow>(db, 'SELECT * FROM novels ORDER BY updated_at DESC')
  const incomingAuthor = matchKey(book.author)
  const incomingSource = safeSourceUrl(book.sourceUrl)
  return rows
    .map((row) => {
      const novel = rowToNovel(row)
      if (!novel) return null
      const sameSource = incomingSource && safeSourceUrl(novel.sourceUrl) === incomingSource
      const sameTitle = titlesMatch(novel.title, book.title)
      if (!sameSource && !sameTitle) return null
      const sameAuthor = incomingAuthor && matchKey(novel.author) === incomingAuthor
      // 作者也对得上时才给最高分，避免「书名包含」的弱匹配盖过真正的同名同作者作品。
      const score = sameSource ? 100 : sameTitle && sameAuthor ? 95 : sameAuthor ? 90 : 80
      const matchReason: BookImportNovelCandidate['matchReason'] = sameSource ? 'source-url' : sameAuthor ? 'title-author' : 'title'
      return { novel, matchReason, score }
    })
    .filter((candidate): candidate is BookImportNovelCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || b.novel.updatedAt - a.novel.updatedAt)
}

async function loadLocalChapters(db: Db, novelId: string): Promise<ChapterRow[]> {
  return all<ChapterRow>(db, 'SELECT id, title, sort_order, content, source_url FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC', [novelId])
}

export async function createPreview(db: Db, opts: ImportPreviewOptions): Promise<BookImportPreview> {
  const payload = normalizeImportPayload(opts.payload)
  const candidates = await findCandidates(db, payload)
  const targetNovelId = opts.targetNovelId || (candidates.length === 1 ? candidates[0]!.novel.id : null)
  const targetCandidate = candidates.find((candidate) => candidate.novel.id === targetNovelId)
  const targetNovel = targetCandidate?.novel || null
  const local = targetNovel ? await loadLocalChapters(db, targetNovel.id) : []
  const chapters = buildChapterDiff(payload, local)
  const summary = {
    newCount: chapters.filter((chapter) => chapter.status === 'new').length,
    changedCount: chapters.filter((chapter) => chapter.status === 'changed').length,
    unchangedCount: chapters.filter((chapter) => chapter.status === 'unchanged').length,
    conflictCount: chapters.filter((chapter) => chapter.status === 'conflict').length,
  }
  const warnings: string[] = []
  if (candidates.length > 1 && !targetNovel) warnings.push('发现多个同名作品，请先选择导入目标。')
  if (summary.conflictCount) warnings.push(`有 ${summary.conflictCount} 个章节存在同名冲突，默认不会导入。`)
  if (payload.chapters.length >= MAX_IMPORT_CHAPTERS) warnings.push(`最多展示前 ${MAX_IMPORT_CHAPTERS} 章，超出部分未进入预览。`)

  return {
    runId: opts.runId || newId('import'),
    sourceType: opts.sourceType,
    sourceLabel: text(opts.sourceLabel) || (opts.sourceType === 'url' ? opts.sourceUrl : '导入文件'),
    sourceUrl: safeSourceUrl(opts.sourceUrl || payload.sourceUrl),
    book: payload,
    candidates,
    targetNovelId,
    targetNovel,
    metadataDiff: buildMetadataDiff(payload, targetNovel),
    chapters,
    summary,
    warnings,
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
  const preview = safeJsonParse<BookImportPreview>(opts.run.preview_json, {} as BookImportPreview)
  const payload = normalizeImportPayload(safeJsonParse<BookImportPayload>(opts.run.payload_json, {} as BookImportPayload))
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
    const lockedRun = await q<{ status: string }>('SELECT status FROM book_import_runs WHERE id = $1 FOR UPDATE', [opts.run.id])
    if (!lockedRun.rows.length) throw new Error('导入预览不存在')
    if (lockedRun.rows[0]!.status !== 'preview') throw new Error('这次导入已经提交，不能重复提交')
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

    const localRows = await q<ChapterRow>('SELECT id, title, sort_order, content, source_url FROM chapters WHERE novel_id = $1 ORDER BY sort_order ASC', [novelId])
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
      const incoming = payload.chapters.find((chapter, index) => `chapter-${index + 1}` === diff.id)
      if (!incoming) continue
      const current = diff.localChapterId ? localById.get(diff.localChapterId) : undefined
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
    if (currentNovel && !novelCreated && Object.keys(patch).length) {
      const before = snapshotNovel(currentNovel)
      const next = { ...currentNovel, ...patch, categories: Array.isArray(patch.categories) ? patch.categories : currentNovel.categories, updatedAt: Date.now() } as Novel
      await q(
        `UPDATE novels SET title=$1, author=$2, description=$3, cover_url=$4, categories=$5, status=$6, source_url=$7, chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$8), updated_at=$9 WHERE id=$8`,
        [next.title, next.author, next.description, next.coverUrl, JSON.stringify(next.categories), next.status, next.sourceUrl, novelId, next.updatedAt],
      )
      for (const field of Object.keys(patch)) metadataUpdated.push(field)
      if (currentNovel.contentRating === 'unknown') {
        const ruleSet = await loadContentRatingRuleSet(q)
        const decision = evaluateContentRatingRules({ title: next.title, description: next.description, categories: next.categories }, ruleSet)
        await applyContentRatingChange(q, { novelId, rating: decision.rating, source: 'source_import', actorUserId: opts.actorUserId,
          reason: '导入更新元数据后重新执行分级规则', evidence: decision.evidence, ruleVersion: decision.ruleVersion,
          operationId: opts.run.id, expectedRevision: currentNovel.contentRatingRevision || 0 })
      }
      const after = rowToNovel((await q<NovelRow>('SELECT * FROM novels WHERE id=$1', [novelId])).rows[0])!
      applied.push({ id: 'metadata', kind: 'metadata', title: currentNovel.title, novelId, before, after: snapshotNovel(after) })
    }
    await q('UPDATE novels SET chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$1), updated_at=$2 WHERE id=$1', [novelId, Date.now()])
    const status = conflicts.length ? 'partial' : 'applied'
    await q('UPDATE book_import_runs SET target_novel_id=$1, status=$2, changes_json=$3, applied_at=$4 WHERE id=$5', [novelId, status, JSON.stringify(applied), Date.now(), opts.run.id])
  })

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
    for (const change of changes.filter(item => item.kind === 'create-novel')) {
      const row = await q<Record<string, unknown>>('SELECT * FROM novels WHERE id=$1 FOR UPDATE', [change.novelId])
      if (row.rows[0] && !sameSnapshotNovel(row.rows[0], change.after)) {
        protectedNovels.add(change.novelId)
        conflicts.push({ id: change.id, title: change.title, reason: '新作品已被再次编辑或审核，整本保留' })
      }
    }
    for (const change of [...changes].reverse()) {
      if (protectedNovels.has(change.novelId)) continue
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
  return { normalizeImportTitle, normalizeImportChapterTitle, normalizeImportContent, importContentHash, importChapterKey, isChapterHeadingLine, fileStem, titlesMatch, buildChapterDiff, buildMetadataDiff, parseTextImport }
}
