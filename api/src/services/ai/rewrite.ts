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

export async function runRewriteTask(db: Db, opts: { taskId: string; userId: string; params: RewriteTaskParams; ipAddress?: string; userAgent?: string }): Promise<RewriteSuggestionResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const settings = await getAiSettings(db)
  const { params } = opts
  const system = '你是中文网络小说编辑。只输出改写后的选段正文，不要解释、不要添加标题，不要泄露或扩写选段之外的内容。'
  const user = [
    `改写模式：${modeInstruction(params.mode)}`,
    params.instruction ? `用户补充要求：${params.instruction}` : '',
    `选段前文（仅供衔接）：\n${params.contextBefore}`,
    `待改写选段：\n${params.selectedText}`,
    `选段后文（仅供衔接）：\n${params.contextAfter}`,
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
    const result: RewriteSuggestionResult = { version: 1, draftId: params.draftId, baseRevision: params.baseRevision, startUTF16: params.startUTF16, endUTF16: params.endUTF16, selectedText: params.selectedText, mode: params.mode, suggestion }
    await recordUsage(db, { userId: opts.userId, model: res.model, provider: providerLabel(provider.baseUrl), promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: Math.round(res.cost * 100000), generationType: 'rewrite_selection', ipAddress: opts.ipAddress, userAgent: opts.userAgent })
    await updateAiTask(db, opts.taskId, { status: 'completed', current: 1, total: 1, step: '改写建议已生成', result: JSON.stringify(result) })
    return result
  } finally {
    stopHeartbeat()
  }
}
