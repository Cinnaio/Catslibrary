/**
 * AI 文本服务客户端 —— OpenAI 兼容 /chat/completions 封装。
 * 供应商由 .env / 安装向导配置（AI_TEXT_BASE_URL / AI_TEXT_API_KEY / AI_TEXT_MODEL），
 * 默认 deepseek-v4-flash；未配置时一律抛 AiError('disabled')，调用方据此隐藏入口。
 */
import type { AiProviderConfig } from '../../config'
import { providerForScope } from './provider-snapshot'
import type { AiReasoningMode } from '@shared/ai-text-progress'
import { outboundFetch } from '../outbound-fetch'
import { upstreamCost } from './upstream-cost'
import { resolveUpstreamBilling } from './upstream-billing'
import { upstreamUsage, type UpstreamUsage } from './upstream-usage'
import {
  contentRefusalMessage,
  detectContentCancellation,
  detectStructuredContentRefusal,
  detectStructuredContentRefusalFromDetail,
  stripCancellationTail,
} from './prompt-policy'

export type AiErrorCode = 'disabled' | 'timeout' | 'upstream' | 'invalid' | 'conflict' | 'truncated' | 'cancelled'

export class AiError extends Error {
  code: AiErrorCode
  status: number
  constructor(code: AiErrorCode, message: string, status = 502) {
    super(message)
    this.name = 'AiError'
    this.code = code
    this.status = status
  }
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: AiToolCall[]
  /** Some compatible reasoning providers require this opaque field on tool continuations. */
  reasoning_content?: string
}

export interface AiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AiFunctionTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AiChatOptions {
  messages: AiMessage[]
  tools?: AiFunctionTool[]
  /** Tool orchestration uses one attempt; uncertain paid calls are never silently replayed. */
  maxAttempts?: number
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  /** 默认保持既有重试；长耗时分析可关闭本地超时和 HTTP 408/504 的自动重放。 */
  retryOnTimeout?: boolean
  reasoningMode?: AiReasoningMode
  onProgress?: (progress: AiChatProgress) => void | Promise<void>
  signal?: AbortSignal
  /** 审计调用方先记账，再自行拒绝空回复、拒答与截断。 */
  returnIncompleteResult?: boolean
}

export interface AiChatProgress {
  phase: 'thinking' | 'writing'
  reasoningCharacters: number
}

export interface AiChatResult extends UpstreamUsage {
  toolCalls?: AiToolCall[]
  reasoningContent?: string
  streamed?: boolean
  refusal?: string
  text: string
  model: string
  promptTokens: number
  completionTokens: number
  finishReason: string
  /** 上游 usage.cost / cost（货币单位），缺失或无效时为 0 */
  cost: number
  /**
   * 上游用 finish_reason 标记「已生成的内容被策略截断」，但正文实际回传了。
   *
   * 这类响应与「模型拒绝回复」必须区分：拒绝时 content 为空，截断时 content 有值，
   * 只是尾部被换成一句拒绝语。调用方据此保留正文并按截断处理，而不是整包丢弃。
   */
  truncated?: boolean
}

export type AiChatDeltaHandler = (text: string) => void | Promise<void>

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 3
/** 仅对「重试可能有用」的失败退避重试：限流、网关抖动、超时。 */
const RETRIABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

export function textProvider(): AiProviderConfig {
  return providerForScope('text')
}

/** 文本能力是否可用：baseUrl + apiKey 都配了才算。 */
export function isTextAiConfigured(): boolean {
  const p = textProvider()
  return !!p.baseUrl && !!p.apiKey
}

/** baseUrl 允许写到 /v1 或直接写到 /chat/completions，两种都归一。 */
export function chatEndpoint(baseUrl: string): string {
  const base = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base) return ''
  if (/\/chat\/completions$/i.test(base)) return base
  return base + '/chat/completions'
}

/** 供应商域名，仅用于 ai_usage.provider 记账，不含路径与密钥。 */
export function providerLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return ''
  }
}

/** 单轮对话补全。失败按 AiError 语义化抛出，上层只需分辨 code。 */
export async function chat(opts: AiChatOptions): Promise<AiChatResult> {
  throwIfCancelled(opts.signal)
  const provider = textProvider()
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)

  const endpoint = chatEndpoint(provider.baseUrl)
  const model = opts.model || provider.model
  const body = JSON.stringify({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
    stream: false,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto', parallel_tool_calls: false } : {}),
    ...reasoningFields(model, opts.reasoningMode),
  })

  let lastError: AiError | null = null
  const attempts = Math.max(1, Math.min(MAX_ATTEMPTS, opts.maxAttempts ?? MAX_ATTEMPTS))
  for (let attempt = 1; attempt <= attempts; attempt++) {
    throwIfCancelled(opts.signal)
    try {
      return await once(endpoint, provider.apiKey, body, model, opts)
    } catch (err) {
      throwIfCancelled(opts.signal)
      const aiErr = err instanceof AiError ? err : new AiError('upstream', (err as Error)?.message || '未知错误')
      lastError = aiErr
      if (attempt >= attempts || !isRetriable(aiErr, opts)) break
      await sleep(attempt * 700, opts.signal)
    }
  }
  throw lastError || new AiError('upstream', 'AI 请求失败')
}

/**
 * 单轮对话流式补全。
 *
 * 上游按 OpenAI 兼容 SSE 返回时逐片回调；如果供应商忽略 stream=true 而仍返回 JSON，
 * 则退回一次性解析，保证不同网关的兼容性。已经收到部分内容后不再自动重试，避免重复拼接。
 */
export async function chatStream(opts: AiChatOptions, onDelta: AiChatDeltaHandler): Promise<AiChatResult> {
  throwIfCancelled(opts.signal)
  const provider = textProvider()
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)

  const endpoint = chatEndpoint(provider.baseUrl)
  const model = opts.model || provider.model
  const body = JSON.stringify({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
    stream: true,
    stream_options: { include_usage: true },
    ...reasoningFields(model, opts.reasoningMode),
  })

  let lastError: AiError | null = null
  let emitted = false
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    throwIfCancelled(opts.signal)
    try {
      return await onceStream(endpoint, provider.apiKey, body, model, { ...opts, onProgress: async (progress) => {
        if (progress.reasoningCharacters > 0) emitted = true
        await opts.onProgress?.(progress)
      } }, async (delta) => {
        emitted = true
        await onDelta(delta)
      })
    } catch (err) {
      throwIfCancelled(opts.signal)
      const aiErr = err instanceof AiError ? err : new AiError('upstream', (err as Error)?.message || '未知错误')
      lastError = aiErr
      if (emitted || attempt >= MAX_ATTEMPTS || !isRetriable(aiErr, opts)) break
      await sleep(attempt * 700, opts.signal)
    }
  }
  throw lastError || new AiError('upstream', 'AI 请求失败')
}

async function once(endpoint: string, apiKey: string, body: string, model: string, opts: AiChatOptions): Promise<AiChatResult> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = opts.signal ? anySignal([timeout, opts.signal]) : timeout

  let res: Response
  try {
    res = await outboundFetch(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal,
      },
      { scope: 'ai-text' },
    )
  } catch (err) {
    const name = (err as Error)?.name || ''
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', 'AI 服务响应超时', 504)
    throw new AiError('upstream', 'AI 服务连接失败')
  }

  if (!res.ok) {
    // 上游错误：解析出网关返回的 message，连同状态码一并带出，方便定位「模型无可用渠道」等真实原因。
    const detail = (await res.text().catch((err) => { rethrowResponseTimeout(err, opts, timeout); return '' })).slice(0, 500)
    console.error('[ai] upstream %d %s', res.status, detail)
    const refusal = detectStructuredContentRefusalFromDetail(detail)
    if (refusal) throw new AiError('invalid', contentRefusalMessage(refusal), 422)
    throw new AiError('upstream', describeUpstreamError(res.status, detail), res.status)
  }

  const data = await readChatResponseJson(res, opts, timeout)
  const refusal = detectStructuredContentRefusal(data)
  if (refusal && !opts.returnIncompleteResult) throw new AiError('invalid', contentRefusalMessage(refusal), 422)
  const choice = data?.choices?.[0]
  const text = extractContent(choice?.message?.content)
  const finishReason = String(choice?.finish_reason || '')
  const toolCalls = opts.tools?.length && Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : undefined

  if (!text && !toolCalls?.length && !opts.returnIncompleteResult) {
    // 推理模型（deepseek-v4 等）会先把 max_tokens 花在 reasoning_content 上，
    // 预算不够时 content 为空且 finish_reason=length —— 这与「上游异常」是两回事，分开报。
    console.error('[ai] 空回复 finish_reason=%s usage=%o', finishReason, data?.usage || null)
    if (finishReason === 'length') {
      throw new AiError('invalid', 'AI 输出被 max_tokens 截断：推理模型会先消耗思考 token，请调高上限')
    }
    throw new AiError('invalid', 'AI 服务返回内容为空')
  }

  const cancellation = detectContentCancellation(text, finishReason)
  // Keep the real analysis the model did produce; drop only the refusal sentence
  // the gateway appends when it marks the response as filtered.
  const usableText = cancellation ? stripCancellationTail(text) : text
  const usage = upstreamUsage(data)
  const cost = upstreamCost(data)
  return {
    text: usableText,
    ...(toolCalls?.length ? { toolCalls, reasoningContent: extractContent(choice?.message?.reasoning_content, false) } : {}),
    ...(refusal ? { refusal: contentRefusalMessage(refusal) } : {}),
    model: String(data?.model || model),
    ...usage,
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    finishReason,
    ...(cancellation ? { truncated: true } : {}),
    ...await resolveUpstreamBilling(endpoint, apiKey, res.headers, cost, opts.signal),
  }
}

async function onceStream(
  endpoint: string,
  apiKey: string,
  body: string,
  model: string,
  opts: AiChatOptions,
  onDelta: AiChatDeltaHandler,
): Promise<AiChatResult> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = opts.signal ? anySignal([timeout, opts.signal]) : timeout

  let res: Response
  try {
    res = await outboundFetch(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal,
      },
      { scope: 'ai-text' },
    )
  } catch (err) {
    const name = (err as Error)?.name || ''
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', 'AI 服务响应超时', 504)
    throw new AiError('upstream', 'AI 服务连接失败')
  }

  if (!res.ok) {
    const detail = (await res.text().catch((err) => { rethrowResponseTimeout(err, opts, timeout); return '' })).slice(0, 500)
    console.error('[ai] upstream %d %s', res.status, detail)
    const refusal = detectStructuredContentRefusalFromDetail(detail)
    if (refusal) throw new AiError('invalid', contentRefusalMessage(refusal), 422)
    throw new AiError('upstream', describeUpstreamError(res.status, detail), res.status)
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('text/event-stream')) {
    const data = await readChatResponseJson(res, opts, timeout)
    const refusal = detectStructuredContentRefusal(data)
    if (refusal && !opts.returnIncompleteResult) throw new AiError('invalid', contentRefusalMessage(refusal), 422)
    const parsed = parseChatCompletion(data, model)
    if (!parsed.text && !opts.returnIncompleteResult) throw emptyChatResponseError(parsed.finishReason, data)
    if (parsed.text) { await opts.onProgress?.({ phase: 'writing', reasoningCharacters: 0 }); await onDelta(parsed.text) }
    return { ...parsed, streamed: false, ...(refusal ? { refusal: contentRefusalMessage(refusal) } : {}), ...await resolveUpstreamBilling(endpoint, apiKey, res.headers, parsed.costReported ? parsed.cost : null, opts.signal) }
  }

  if (!res.body) throw new AiError('upstream', 'AI 服务未返回流式内容')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let responseModel = model
  let promptTokens = 0
  let completionTokens = 0
  let cost = 0
  let cacheReadTokens: number | null = null
  let cacheWriteTokens: number | null = null
  let reasoningTokens: number | null = null
  let costReported = false
  let finishReason = ''
  let responseRefusal: string | undefined
  let reasoningCharacters = 0
  let streamDone = false

  const consumeLine = async (line: string): Promise<void> => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!normalized.startsWith('data:')) return
    const payload = normalized.slice(5).trim()
    if (payload === '[DONE]') { streamDone = true; return }
    if (!payload) return

    let data: ChatCompletionStreamChunk
    try {
      data = JSON.parse(payload) as ChatCompletionStreamChunk
    } catch {
      throw new AiError('invalid', 'AI 流式响应格式不正确')
    }

    const refusal = detectStructuredContentRefusal(data)
    if (refusal) {
      if (!opts.returnIncompleteResult) throw new AiError('invalid', contentRefusalMessage(refusal), 422)
      responseRefusal = contentRefusalMessage(refusal)
    }

    if (data.model) responseModel = String(data.model)
    const usage = upstreamUsage(data)
    promptTokens = usage.promptTokens ?? promptTokens
    completionTokens = usage.completionTokens ?? completionTokens
    cacheReadTokens = usage.cacheReadTokens ?? cacheReadTokens
    cacheWriteTokens = usage.cacheWriteTokens ?? cacheWriteTokens
    reasoningTokens = usage.reasoningTokens ?? reasoningTokens
    if (upstreamCost(data) !== null) costReported = true
    cost = upstreamCost(data) ?? cost

    const choice = data.choices?.[0]
    const reasoning = extractContent(choice?.delta?.reasoning_content)
    if (reasoning) {
      reasoningCharacters += reasoning.length
      await opts.onProgress?.({ phase: 'thinking', reasoningCharacters })
    }
    if (choice?.finish_reason) finishReason = String(choice.finish_reason)
    const delta = extractContent(choice?.delta?.content, false)
    if (!delta) return
    text += delta
    await opts.onProgress?.({ phase: 'writing', reasoningCharacters })
    await onDelta(delta)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\n/)
      buffer = lines.pop() || ''
      for (const line of lines) await consumeLine(line)
    }
    buffer += decoder.decode()
    if (buffer) await consumeLine(buffer)
  } catch (err) {
    rethrowResponseTimeout(err, opts, timeout)
    throw err
  } finally {
    reader.releaseLock()
  }

  const trimmed = text.trim()
  if (!streamDone && !finishReason) throw new AiError('upstream', 'AI 流式响应在完成标记前中断，未保存未完成内容')
  if (!trimmed && !opts.returnIncompleteResult) throw emptyChatResponseError(finishReason, null)
  const cancellation = detectContentCancellation(trimmed, finishReason)
  return {
    streamed: true,
    ...(responseRefusal ? { refusal: responseRefusal } : {}),
    text: cancellation ? stripCancellationTail(trimmed) : trimmed,
    ...(cancellation ? { truncated: true } : {}),
    model: responseModel,
    promptTokens,
    completionTokens,
    finishReason,
    ...await resolveUpstreamBilling(endpoint, apiKey, res.headers, costReported ? cost : null, opts.signal),
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  }
}

function parseChatCompletion(data: ChatCompletionResponse | null, model: string): AiChatResult {
  const choice = data?.choices?.[0]
  const text = extractContent(choice?.message?.content)
  const usage = upstreamUsage(data)
  const cost = upstreamCost(data)
  const finishReason = String(choice?.finish_reason || '')
  return {
    text,
    model: String(data?.model || model),
    ...usage,
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    finishReason,
    ...(detectContentCancellation(text, finishReason) ? { truncated: true } : {}),
    cost: cost ?? 0,
    costReported: cost !== null,
  }
}

function emptyChatResponseError(finishReason: string, data: ChatCompletionResponse | null): AiError {
  console.error('[ai] 空回复 finish_reason=%s usage=%o', finishReason, data?.usage || null)
  if (finishReason === 'length') {
    return new AiError('invalid', 'AI 输出被 max_tokens 截断：推理模型会先消耗思考 token，请调高上限')
  }
  return new AiError('invalid', 'AI 服务返回内容为空')
}

/** content 可能是字符串，也可能是 [{type:'text',text}] 分片（部分网关如此）。 */
function extractContent(content: unknown, trim = true): string {
  if (typeof content === 'string') return trim ? content.trim() : content
  if (Array.isArray(content)) {
    const value = content.map((part) => (typeof part === 'string' ? part : String((part as { text?: unknown })?.text || ''))).join('')
    return trim ? value.trim() : value
  }
  return ''
}

interface ChatCompletionResponse {
  model?: string
  refusal?: unknown
  choices?: Array<{ message?: { content?: unknown; refusal?: unknown; tool_calls?: AiToolCall[]; reasoning_content?: unknown }; finish_reason?: string; finishReason?: string }>
  usage?: Record<string, unknown> | null
  usageMetadata?: Record<string, unknown>
  cost?: string | number
  error?: unknown
  code?: string
  type?: string
  message?: unknown
}

interface ChatCompletionStreamChunk {
  model?: string
  refusal?: unknown
  choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; refusal?: unknown }; message?: { refusal?: unknown }; finish_reason?: string; finishReason?: string }>
  usage?: Record<string, unknown> | null
  usageMetadata?: Record<string, unknown>
  cost?: string | number
  error?: unknown
  code?: string
  type?: string
  message?: unknown
}

async function readChatResponseJson(res: Response, opts: AiChatOptions, timeout: AbortSignal): Promise<ChatCompletionResponse | null> {
  try {
    return await res.json() as ChatCompletionResponse
  } catch (err) {
    rethrowResponseTimeout(err, opts, timeout)
    return null
  }
}

function rethrowResponseTimeout(err: unknown, opts: AiChatOptions, timeout: AbortSignal): void {
  throwIfCancelled(opts.signal)
  if (timeout.aborted || (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
    throw new AiError('timeout', 'AI 服务响应正文读取超时', 504)
  }
}

function isRetriable(err: AiError, opts: AiChatOptions): boolean {
  if (opts.retryOnTimeout === false && (err.code === 'timeout' || err.code === 'upstream' && (err.status === 408 || err.status === 504))) return false
  if (err.code === 'timeout') return true
  if (err.code === 'upstream') return err.status === 502 || RETRIABLE_STATUS.has(err.status)
  return false
}

function reasoningFields(model: string, mode: AiReasoningMode = 'inherit'): Record<string, unknown> {
  if (mode === 'inherit') return {}
  if (!/(^|\/)deepseek(?:[-_/]|$)/i.test(model)) throw new AiError('invalid', '当前思考模式设置只支持 DeepSeek 兼容模型；请将该任务的思考模式设为跟随供应商', 422)
  return mode === 'disabled'
    ? { thinking: { type: 'disabled' }, reasoning_effort: 'none' }
    : { thinking: { type: 'enabled' }, reasoning_effort: mode }
}

/**
 * 把上游网关返回的 JSON 错误体解析成人类可读的中文提示。
 * 例如 new-api / distributor 常见：{"error":{"code":"model_not_found","message":"No available channel for model X"}}
 * 解析失败时退回到「AI 服务返回 <status>」。
 */
function describeUpstreamError(status: number, detail: string): string {
  const prefix = `AI 服务返回 ${status}`
  const body = (detail || '').trim()
  if (!body) return prefix
  try {
    const parsed = JSON.parse(body)
    const errObj = (parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error: unknown }).error : parsed) as
      { code?: string; message?: string; type?: string } | undefined
    const code = errObj?.code ? String(errObj.code) : ''
    const message = errObj?.message ? String(errObj.message) : ''
    if (!code && !message) return prefix

    // 把常见上游错误码映射成更直白的中文
    const codeHints: Record<string, string> = {
      model_not_found: '上游无可用模型渠道',
      no_available_channel: '上游无可用渠道',
      insufficient_quota: '上游额度不足',
      invalid_api_key: '上游密钥无效',
      access_denied: '上游拒绝访问',
    }
    const hint = code ? codeHints[code] || code : ''
    return [prefix, hint, message].filter(Boolean).join('：')
  } catch {
    // 非 JSON 响应，直接带上原文（截断）
    return `${prefix}：${body}`
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AiError('cancelled', 'AI 请求已取消', 499)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal)
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new AiError('cancelled', 'AI 请求已取消', 499))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** AbortSignal.any 的兜底实现（Node 20 起原生支持）。 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const AnyCapable = AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }
  if (typeof AnyCapable.any === 'function') return AnyCapable.any(signals)
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}
