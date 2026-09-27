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
const CHAPTER_HEADING = /^\s*((?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]|chapter\s*\d+|\d+[.、．])(?:\s*.*)?)\s*$/i

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
    .replace(/^第\s*[0-9]+\s*[章节回卷集部篇]?\s*/i, '')
    .replace(/^chapter\s*\d+\s*/i, '')
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

function fileStem(name: string): string {
  return text(name).replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim()
}

export function parseTextImport(input: string, fileName = '未命名.txt'): BookImportPayload {
  const lines = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const chapters: BookImportChapterInput[] = []
  let current: BookImportChapterInput | null = null

  const pushCurrent = () => {
    if (!current) return
    current.content = current.content.trim()
    if (current.content || current.title) chapters.push(current)
  }

  for (const line of lines) {
    const heading = line.match(CHAPTER_HEADING)
    if (heading) {
      pushCurrent()
      current = { title: text(heading[1]), order: chapters.length + 1, content: '' }
    } else if (current) {
      current.content += `${line}\n`
    } else if (text(line)) {
      current = { title: '正文', order: 1, content: `${line}\n` }
    }
  }
  pushCurrent()

  if (!chapters.length) chapters.push({ title: '正文', order: 1, content: String(input || '').trim() })
  return normalizeImportPayload({ title: fileStem(fileName) || '未命名作品', author: '未知作者', chapters })
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
  const byTitle = new Map<string, ChapterRow[]>()
  for (const chapter of local) {
    const sourceUrl = safeSourceUrl(chapter.source_url)
    if (sourceUrl) bySourceUrl.set(sourceUrl, chapter)
    const key = `${chapter.sort_order}:${normalizeImportChapterTitle(chapter.title)}`
    byOrderAndTitle.set(key, chapter)
    const titleKey = normalizeImportChapterTitle(chapter.title)
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
    const sameTitle = byTitle.get(titleKey) || []
    const candidate = exact || (sameTitle.length === 1 ? sameTitle[0] : undefined)
    const conflict = !exact && sameTitle.length > 1
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
  const incomingTitle = normalizeImportTitle(book.title)
  const incomingAuthor = normalizeImportTitle(book.author)
  const incomingSource = safeSourceUrl(book.sourceUrl)
  return rows
    .map((row) => {
      const novel = rowToNovel(row)
      if (!novel) return null
      const sameSource = incomingSource && safeSourceUrl(novel.sourceUrl) === incomingSource
      const sameTitle = normalizeImportTitle(novel.title) === incomingTitle
      if (!sameSource && !sameTitle) return null
      const sameAuthor = incomingAuthor && normalizeImportTitle(novel.author) === incomingAuthor
      const score = sameSource ? 100 : sameAuthor ? 90 : 80
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
    String(row.source_url || '') === String(after.sourceUrl || '')
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
      currentNovel = { ...createdNovel }
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
    if (currentNovel && Object.keys(patch).length) {
      const before = snapshotNovel(currentNovel)
      const next = { ...currentNovel, ...patch, categories: Array.isArray(patch.categories) ? patch.categories : currentNovel.categories, updatedAt: Date.now() } as Novel
      await q(
        `UPDATE novels SET title=$1, author=$2, description=$3, cover_url=$4, categories=$5, status=$6, source_url=$7, chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$8), updated_at=$9 WHERE id=$8`,
        [next.title, next.author, next.description, next.coverUrl, JSON.stringify(next.categories), next.status, next.sourceUrl, novelId, next.updatedAt],
      )
      for (const field of Object.keys(patch)) metadataUpdated.push(field)
      applied.push({ id: 'metadata', kind: 'metadata', title: currentNovel.title, novelId, before, after: snapshotNovel(next) })
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
    for (const change of [...changes].reverse()) {
      if (change.kind === 'create-novel') {
        const novel = await q<Record<string, unknown>>('SELECT id, title, author, description, cover_url, categories, status, source_url FROM novels WHERE id = $1 FOR UPDATE', [change.novelId])
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
        rolledBack++
      }
    }
    if (run.target_novel_id) await q('UPDATE novels SET chapter_count=(SELECT COUNT(*) FROM chapters WHERE novel_id=$1), updated_at=$2 WHERE id=$1', [run.target_novel_id, Date.now()])
    await q('UPDATE book_import_runs SET status=$1, rolled_back_at=$2 WHERE id=$3', [conflicts.length ? 'partial' : 'rolled_back', Date.now(), run.id])
  })
  return { runId: run.id, rolledBack, conflicts }
}

export function bookImportTestHelpers() {
  return { normalizeImportTitle, normalizeImportChapterTitle, normalizeImportContent, importContentHash, buildChapterDiff, buildMetadataDiff, parseTextImport }
}
