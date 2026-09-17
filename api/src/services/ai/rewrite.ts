import { createHash } from 'node:crypto'
import type { Db } from '../../db/pool'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'
import { isAiTaskActive, startAiTaskHeartbeat, updateAiTask } from './tasks'

export type RewriteMode = 'polish' | 'expand' | 'shorten' | 'custom'

export interface RewriteSelectionInput {
  baseRevision: string
  startUTF16: number
  endUTF16: number
  selectedText: string
  mode: RewriteMode
  instruction: string
}

export interface RewriteTaskParams extends RewriteSelectionInput {
  version: 1
  draftId: string
  baseContent: string
  contextBefore: string
  contextAfter: string
}

export interface RewriteSuggestionResult {
  version: 1
  draftId: string
  baseRevision: string
  startUTF16: number
  endUTF16: number
  selectedText: string
  mode: RewriteMode
  suggestion: string
}

const MAX_SELECTED_SCALARS = 6_000
const MAX_INSTRUCTION_SCALARS = 2_000
const MAX_CONTEXT_UTF16 = 2_000
const MAX_RESULT_SCALARS = 12_000
const MODES = new Set<RewriteMode>(['polish', 'expand', 'shorten', 'custom'])

export function rewriteContentRevision(content: string): string {
  return createHash('sha256').update(String(content || ''), 'utf8').digest('hex')
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export function validateRewriteSelection(content: string, input: Partial<RewriteSelectionInput>): { value?: RewriteSelectionInput; error?: string } {
  const source = String(content || '')
  const baseRevision = String(input.baseRevision || '').trim()
  if (!baseRevision) return { error: 'baseRevision 必填' }
  const rawStartUTF16 = input.startUTF16
  const rawEndUTF16 = input.endUTF16
  if (typeof rawStartUTF16 !== 'number' || typeof rawEndUTF16 !== 'number' || !Number.isInteger(rawStartUTF16) || !Number.isInteger(rawEndUTF16) || rawStartUTF16 < 0 || rawEndUTF16 <= rawStartUTF16 || rawEndUTF16 > source.length) {
    return { error: '选区必须是有效的 UTF-16 半开区间' }
  }
  const startUTF16 = rawStartUTF16
  const endUTF16 = rawEndUTF16
  if ((startUTF16 > 0 && isHighSurrogate(source.charCodeAt(startUTF16 - 1))) || (endUTF16 < source.length && isLowSurrogate(source.charCodeAt(endUTF16)))) {
    return { error: '选区不能截断 Unicode 代理对' }
  }
  const selectedText = String(input.selectedText ?? '')
  if (source.slice(startUTF16, endUTF16) !== selectedText) return { error: 'selectedText 与服务端正文不一致，请重新选择' }
  if (Array.from(selectedText).length > MAX_SELECTED_SCALARS) return { error: `选段超过 ${MAX_SELECTED_SCALARS} 个 Unicode 标量` }
  const mode = input.mode
  if (!mode || !MODES.has(mode)) return { error: 'mode 必须是 polish、expand、shorten 或 custom' }
  const instruction = String(input.instruction || '').trim()
  if (Array.from(instruction).length > MAX_INSTRUCTION_SCALARS) return { error: `改写说明超过 ${MAX_INSTRUCTION_SCALARS} 个 Unicode 标量` }
  if (mode === 'custom' && !instruction) return { error: 'custom 模式需要填写改写说明' }
  return { value: { baseRevision, startUTF16, endUTF16, selectedText, mode, instruction } }
}

export function buildRewriteTaskParams(draftId: string, content: string, input: RewriteSelectionInput): RewriteTaskParams {
  return {
    version: 1,
    draftId,
    baseContent: content,
    ...input,
    contextBefore: content.slice(Math.max(0, input.startUTF16 - MAX_CONTEXT_UTF16), input.startUTF16),
    contextAfter: content.slice(input.endUTF16, Math.min(content.length, input.endUTF16 + MAX_CONTEXT_UTF16)),
  }
}

export function parseRewriteTaskParams(value: unknown): RewriteTaskParams | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || typeof raw.draftId !== 'string' || typeof raw.baseContent !== 'string' || typeof raw.baseRevision !== 'string' || typeof raw.selectedText !== 'string' || typeof raw.contextBefore !== 'string' || typeof raw.contextAfter !== 'string') return undefined
  const validated = validateRewriteSelection(raw.baseContent, {
    baseRevision: raw.baseRevision,
    startUTF16: typeof raw.startUTF16 === 'number' ? raw.startUTF16 : Number.NaN,
    endUTF16: typeof raw.endUTF16 === 'number' ? raw.endUTF16 : Number.NaN,
    selectedText: raw.selectedText,
    mode: raw.mode as RewriteMode,
    instruction: raw.instruction as string,
  })
  if (!validated.value) return undefined
  return { ...buildRewriteTaskParams(raw.draftId, raw.baseContent, validated.value), contextBefore: raw.contextBefore, contextAfter: raw.contextAfter }
}

export function parseRewriteSuggestion(value: string, params: RewriteTaskParams): RewriteSuggestionResult | undefined {
  try {
    const raw = JSON.parse(String(value || '')) as Record<string, unknown>
    if (raw.version !== 1 || typeof raw.suggestion !== 'string') return undefined
    return {
      version: 1,
      draftId: params.draftId,
      baseRevision: params.baseRevision,
      startUTF16: params.startUTF16,
      endUTF16: params.endUTF16,
      selectedText: params.selectedText,
      mode: params.mode,
      suggestion: raw.suggestion,
    }
  } catch {
    return undefined
  }
}

function modeInstruction(mode: RewriteMode): string {
  switch (mode) {
    case 'polish': return '润色选段，保留事实、叙事视角和原意，改善表达。'
    case 'expand': return '扩写选段，补充必要的动作、感官或情绪细节，不改变事实。'
    case 'shorten': return '精简选段，保留关键信息和语气，删除重复或无效铺陈。'
    case 'custom': return '按用户的自定义要求改写选段。'
  }
}

/**
 * 检测模型是否「顺着上下文续写」而没有只改写选段。
 *
 * 实测：polish 模式提交 70 字选段返回 2069 字建议，且建议正文里原样出现了
 * 「选段后文」的内容 —— 即模型把上下文当成了待写内容往后写。若直接应用，
 * 正文会变长并在替换点之后重复一大段剧情。这是最危险的一种失败：
 * 结果非空、格式合法、后端 12000 字上限也拦不住，只有读完才能发现。
 *
 * 判定依据是「逐字重复了上下文」，而不是单纯的字数比 —— 扩写模式本就会变长，
 * 按字数比拦截会误伤正常用例。取 40 字连续原文作为阈值：正常改写不会
 * 逐字复现这么长的相邻原文。
 */
const CONTINUATION_PROBE_CHARS = 40

export function detectRewriteContinuation(suggestion: string, params: Pick<RewriteTaskParams, 'contextBefore' | 'contextAfter' | 'selectedText'>): 'after' | 'before' | undefined {
  const text = String(suggestion || '')
  const tail = String(params.contextAfter || '')
  const head = String(params.contextBefore || '')
  // 后文更容易触发（模型倾向于往下写）；两者都查，前后夹写同样有问题
  if (tail.length >= CONTINUATION_PROBE_CHARS && text.includes(tail.slice(0, CONTINUATION_PROBE_CHARS))) return 'after'
  if (head.length >= CONTINUATION_PROBE_CHARS && text.includes(head.slice(-CONTINUATION_PROBE_CHARS))) return 'before'
  return undefined
}

export async function runRewriteTask(db: Db, opts: { taskId: string; userId: string; params: RewriteTaskParams; ipAddress?: string; userAgent?: string }): Promise<RewriteSuggestionResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const settings = await getAiSettings(db)
  const { params } = opts
  // 提示词刻意把「待改写选段」放在上下文之前，并显式给出字数上界。
  // 原先把 2000 字后文放在选段之后，模型会把那段后文当成待写内容继续往下写：
  // 实测 polish 模式提交 70 字选段，返回 2069 字建议（约 30 倍），
  // 应用后正文 2555 → 4554 字且剧情重复。上下文改为只用于衔接语气，
  // 并明确「不得重复、不得续写、字数应与选段相当」。
  const selectedCount = Array.from(params.selectedText).length
  const system = [
    '你是中文网络小说编辑，只做「改写」不做「续写」。',
    '只输出被改写后的那一段正文本身，不要解释、不要标题、不要分段标注、不要输出任何上下文。',
    '严格保持原意与叙事视角；上下文只用来对齐人称、时态与语气，不得把它们写进结果，',
    '也不得在选段结束之后继续写新情节。',
  ].join('')
  const user = [
    `改写任务：${modeInstruction(params.mode)}`,
    params.instruction ? `用户补充要求：${params.instruction}` : '',
    `【待改写选段】（${selectedCount} 字，只输出它的改写版，字数应与它相当）：\n${params.selectedText}`,
    params.contextBefore ? `【选段之前的内容｜仅供衔接，绝对不要输出或改写】：\n${params.contextBefore}` : '',
    params.contextAfter ? `【选段之后的内容｜仅供衔接，绝对不要输出、改写或续写】：\n${params.contextAfter}` : '',
  ].filter(Boolean).join('\n\n')
  const started = await updateAiTask(db, opts.taskId, { status: 'running', step: 'AI 正在生成改写建议', prompt: user })
  if (!started) throw new AiError('invalid', '任务已停止')
  const stopHeartbeat = startAiTaskHeartbeat(db, opts.taskId)
  try {
    const res = await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: settings.writingTemperature, maxTokens: settings.writingMaxTokens, timeoutMs: 600_000 })
    if (!(await isAiTaskActive(db, opts.taskId))) throw new AiError('invalid', '任务已停止')
    const suggestion = res.text.trim()
    if (!suggestion) throw new AiError('invalid', 'AI 未返回有效改写建议')
    if (Array.from(suggestion).length > MAX_RESULT_SCALARS) throw new AiError('invalid', `改写建议超过 ${MAX_RESULT_SCALARS} 个 Unicode 标量`)
    // 模型把上下文当成待写内容续写时，直接判失败而不是返回建议 ——
    // 这种建议一旦被应用会污染正文（重复大段剧情），且从字数上不容易察觉。
    const continuation = detectRewriteContinuation(suggestion, params)
    if (continuation) {
      throw new AiError('invalid', continuation === 'after' ? '改写建议续写了选段之后的内容，未通过校验，请缩小选段或重试' : '改写建议重复了选段之前的内容，未通过校验，请缩小选段或重试')
    }
    const result: RewriteSuggestionResult = { version: 1, draftId: params.draftId, baseRevision: params.baseRevision, startUTF16: params.startUTF16, endUTF16: params.endUTF16, selectedText: params.selectedText, mode: params.mode, suggestion }
    await recordUsage(db, { userId: opts.userId, model: res.model, provider: providerLabel(provider.baseUrl), promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: Math.round(res.cost * 100000), generationType: 'rewrite_selection', ipAddress: opts.ipAddress, userAgent: opts.userAgent })
    await updateAiTask(db, opts.taskId, { status: 'completed', current: 1, total: 1, step: '改写建议已生成', result: JSON.stringify(result) })
    return result
  } finally {
    stopHeartbeat()
  }
}
