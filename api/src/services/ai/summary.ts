/**
 * 章节前情提要 —— 阅读器进入某章时，为「上一章」生成 2-4 句回顾。
 * 只喂上一章正文，天然无剧透；结果按章缓存，全站读者共用一份。
 */
import { removeAdPatterns } from '@shared/ad-cleaner'
import type { Db } from '../../db/pool'
import { first } from '../../db/query'
import { chat, isTextAiConfigured, providerLabel, textProvider, AiError } from './client'
import { cacheKey, findPublished, saveGeneration, type Generation } from './generations'
import { recordUsage } from './usage'

/** 提示词版本：改动下方 prompt 时 +1，历史缓存自动失效重算。 */
export const RECAP_PROMPT_VERSION = 1

/** 正文短于此长度不值得做提要（目录页、作者的话等）。 */
const MIN_CHAPTER_CHARS = 200

const SYSTEM_PROMPT = [
  '你是中文网络小说的阅读助手，负责为读者写「前情提要」。',
  '要求：',
  '1. 用 2-4 句话、120 字以内概括这一章发生了什么；',
  '2. 只写正文中已经发生的事，不推测后续、不补充设定、不做评价；',
  '3. 用第三人称陈述，不要出现「本章」「作者」「这一段」等元叙述词；',
  '4. 直接输出提要正文，不要标题、不要前后缀、不要 Markdown。',
].join('\n')

export interface ChapterRow {
  id: string
  novel_id: string
  title: string
  content: string
  sort_order: number
}

export interface RecapResult {
  generation: Generation
  cached: boolean
  /** 本次真实调用的用量，命中缓存时为 null */
  usage: { model: string; promptTokens: number; completionTokens: number } | null
}

export async function loadChapterForRecap(db: Db, chapterId: string): Promise<ChapterRow | undefined> {
  return first<ChapterRow>(db, 'SELECT id, novel_id, title, content, sort_order FROM chapters WHERE id = $1', [chapterId])
}

/** HTML 章节转纯文本 + 广告清洗 + 截断，控制送进模型的体量。 */
export function prepareChapterText(raw: string, maxChars: number): string {
  const cleaned = removeAdPatterns(raw || '')
  const text = cleaned
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

export interface RecapOptions {
  chapter: ChapterRow
  novelTitle: string
  maxChapterChars: number
  userId: string
  /** true 时忽略缓存强制重算（管理员用） */
  force?: boolean
}

/**
 * 取或生成某章的提要。命中缓存不计用量、不计配额，
 * 因此调用方应当先查缓存再决定是否校验配额（见 routes/ai.ts）。
 */
export async function getCachedRecap(db: Db, chapterId: string, model: string): Promise<Generation | undefined> {
  return findPublished(db, 'summary', chapterId, recapParams(model))
}

export async function generateRecap(db: Db, opts: RecapOptions): Promise<RecapResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)

  const provider = textProvider()
  const text = prepareChapterText(opts.chapter.content, opts.maxChapterChars)
  if (text.length < MIN_CHAPTER_CHARS) throw new AiError('invalid', '章节内容过短，无需提要', 422)

  const userPrompt = buildUserPrompt(opts.novelTitle, opts.chapter, text)
  const res = await chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    // 提要本身只要 ~200 token，但推理模型会先花掉一大截思考预算，留足余量
    maxTokens: 1200,
  })

  const generation = await saveGeneration(db, {
    novelId: opts.chapter.novel_id,
    chapterId: opts.chapter.id,
    kind: 'summary',
    model: res.model,
    // 缓存键用配置模型名而非上游回显模型名，避免同一配置因回显差异反复未命中
    paramsJson: recapParams(provider.model),
    prompt: userPrompt,
    result: res.text,
    // 提要面向读者即时可见，落 published；管理端可事后驳回使其失效
    status: 'published',
    createdBy: opts.userId || '',
  })

  await recordUsage(db, {
    userId: opts.userId || '',
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
  })

  return {
    generation,
    cached: false,
    usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens },
  }
}

export function recapParams(model: string): string {
  return cacheKey({ version: RECAP_PROMPT_VERSION, model: model || '' })
}

function buildUserPrompt(novelTitle: string, chapter: ChapterRow, text: string): string {
  const label = chapter.sort_order ? `第 ${chapter.sort_order} 章` : '本章'
  return [
    `小说：《${novelTitle || '未命名'}》`,
    `章节：${label} ${chapter.title || ''}`.trim(),
    '正文：',
    text,
  ].join('\n')
}
