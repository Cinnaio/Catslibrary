import { removeAdPatterns } from '@shared/ad-cleaner'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { chat, isTextAiConfigured, providerLabel, textProvider, AiError } from './client'
import { saveGeneration, type Generation } from './generations'
import { recordUsage } from './usage'
import { getAiSettings } from './settings'

const MAX_CONTEXT_CHARS = 12000

export interface WritingResult {
  generation: Generation
  usage: { model: string; promptTokens: number; completionTokens: number }
}

export interface WritingTitlesResult {
  titles: string[]
  usage: { model: string; promptTokens: number; completionTokens: number }
}

export function cleanWritingText(raw: string, maxChars = MAX_CONTEXT_CHARS): string {
  return removeAdPatterns(String(raw || ''))
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars)
}

export function parseWritingTitles(raw: string): string[] {
  const source = String(raw || '').trim()
  let candidates: unknown[] = []
  try {
    const parsed = JSON.parse(source) as unknown
    if (Array.isArray(parsed)) candidates = parsed
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { titles?: unknown }).titles)) candidates = (parsed as { titles: unknown[] }).titles
  } catch {
    candidates = source.split(/\r?\n/)
  }
  return candidates
    .map((item) => String(item || '').replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '').replace(/^['"“”「」]+|['"“”「」]+$/g, '').trim())
    .filter((title, index, list) => title.length >= 2 && title.length <= 40 && list.indexOf(title) === index)
    .slice(0, 3)
}

export async function generateWritingTitles(db: Db, opts: {
  userId: string
  novelId?: string
  content: string
  contextTitle?: string
  ipAddress?: string
  userAgent?: string
}): Promise<WritingTitlesResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const prompt = [
    '请为下面的中文网络小说正文拟定 1-3 个章节标题。标题要贴合正文的核心事件、情绪或悬念，简洁自然，避免剧透，不要使用书名号。',
    '只返回 JSON 数组，例如：["标题一","标题二","标题三"]，不要解释。',
    opts.contextTitle ? `已有标题或上下文：${opts.contextTitle}` : '',
    `正文：\n${cleanWritingText(opts.content)}`,
  ].filter(Boolean).join('\n\n')
  const res = await chat({
    messages: [
      { role: 'system', content: '你是中文网络小说编辑，擅长根据正文提炼准确、有吸引力且不夸张的章节标题。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    maxTokens: 160,
    timeoutMs: 120_000,
  })
  const titles = parseWritingTitles(res.text)
  if (!titles.length) throw new AiError('invalid', 'AI 未返回有效的标题候选')
  await recordUsage(db, {
    userId: opts.userId,
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    costMillicents: Math.round(res.cost * 100000),
    novelId: opts.novelId,
    generationType: 'writing_title',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
  return { titles, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

export async function generateWriting(db: Db, opts: {
  userId: string
  novelId: string
  kind: 'write_outline' | 'write_chapter' | 'continue'
  title: string
  instruction: string
  outline?: string
  context?: string
  maxTokens?: number
  temperature?: number
  targetWords?: number
  chapterCount?: number
  ipAddress?: string
  userAgent?: string
}): Promise<WritingResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const settings = await getAiSettings(db)
  const system = opts.kind === 'write_outline'
    ? '你是中文网络小说策划编辑。请输出可执行的章节大纲，包含主线冲突、人物目标、关键转折和章节安排。只输出内容，不要解释。'
    : settings.writingSystemPrompt
  const optionInstructions = [
    opts.targetWords ? `Target length: approximately ${Math.max(300, Math.min(30000, Math.trunc(opts.targetWords)))} Chinese characters.` : '',
    opts.chapterCount && opts.chapterCount > 1 ? `Continuation chapter count: ${Math.max(1, Math.min(5, Math.trunc(opts.chapterCount)))} chapters.` : '',
  ].filter(Boolean)
  const user = [
    ...optionInstructions,
    `作品：《${opts.title || '未命名作品'}》`,
    opts.instruction ? `创作要求：${opts.instruction}` : '',
    opts.outline ? `大纲：\n${cleanWritingText(opts.outline)}` : '',
    opts.context ? `已有剧情上下文：\n${cleanWritingText(opts.context)}` : '',
  ].filter(Boolean).join('\n\n')
  const temperature = opts.temperature ?? settings.writingTemperature
  const maxTokens = opts.maxTokens ?? settings.writingMaxTokens
  const res = await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, maxTokens: Math.min(1000000, Math.max(300, maxTokens)), timeoutMs: 600000 })
  const generation = await saveGeneration(db, {
    novelId: opts.novelId,
    chapterId: '',
    kind: opts.kind,
    model: res.model,
    paramsJson: JSON.stringify({ version: 4, temperature, maxTokens, targetWords: opts.targetWords || 0, chapterCount: opts.chapterCount || 1 }),
    prompt: user,
    result: res.text,
    status: 'draft',
    createdBy: opts.userId,
  })
  await recordUsage(db, { userId: opts.userId, model: res.model, provider: providerLabel(provider.baseUrl), promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: Math.round(res.cost * 100000), novelId: opts.novelId, generationType: opts.kind, ipAddress: opts.ipAddress, userAgent: opts.userAgent })
  return { generation, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

export async function recentNovelContext(db: Db, novelId: string, afterChapterId?: string): Promise<string> {
  const rows = await all<{ title: string; content: string }>(db, afterChapterId
    ? 'SELECT title, content FROM chapters WHERE novel_id = $1 AND sort_order <= (SELECT sort_order FROM chapters WHERE id = $2) ORDER BY sort_order DESC LIMIT 3'
    : 'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT 3', [novelId, ...(afterChapterId ? [afterChapterId] : [])])
  return rows.reverse().map((row) => `【${row.title}】\n${cleanWritingText(row.content, 4000)}`).join('\n\n').slice(-MAX_CONTEXT_CHARS)
}
