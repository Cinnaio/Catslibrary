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
}): Promise<WritingResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const settings = await getAiSettings(db)
  const system = opts.kind === 'write_outline'
    ? '你是中文网络小说策划编辑。请输出可执行的章节大纲，包含主线冲突、人物目标、关键转折和章节安排。只输出内容，不要解释。'
    : settings.writingSystemPrompt
  const user = [
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
    paramsJson: JSON.stringify({ version: 2, temperature, maxTokens }),
    prompt: user,
    result: res.text,
    status: 'draft',
    createdBy: opts.userId,
  })
  await recordUsage(db, { userId: opts.userId, model: res.model, provider: providerLabel(provider.baseUrl), promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: Math.round(res.cost * 100000), novelId: opts.novelId, generationType: opts.kind })
  return { generation, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

export async function recentNovelContext(db: Db, novelId: string, afterChapterId?: string): Promise<string> {
  const rows = await all<{ title: string; content: string }>(db, afterChapterId
    ? 'SELECT title, content FROM chapters WHERE novel_id = $1 AND sort_order <= (SELECT sort_order FROM chapters WHERE id = $2) ORDER BY sort_order DESC LIMIT 3'
    : 'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT 3', [novelId, ...(afterChapterId ? [afterChapterId] : [])])
  return rows.reverse().map((row) => `【${row.title}】\n${cleanWritingText(row.content, 4000)}`).join('\n\n').slice(-MAX_CONTEXT_CHARS)
}
