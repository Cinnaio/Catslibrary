/**
 * AI 文本服务客户端 —— OpenAI 兼容 /chat/completions 封装。
 * 供应商由 .env / 安装向导配置（AI_TEXT_BASE_URL / AI_TEXT_API_KEY / AI_TEXT_MODEL），
 * 默认 deepseek-v4-flash；未配置时一律抛 AiError('disabled')，调用方据此隐藏入口。
 */
import { loadConfig, type AiProviderConfig } from '../../config'
import { outboundFetch } from '../outbound-fetch'

export type AiErrorCode = 'disabled' | 'timeout' | 'upstream' | 'invalid'

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
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatOptions {
  messages: AiMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface AiChatResult {
  text: string
  model: string
  promptTokens: number
  completionTokens: number
  finishReason: string
  /** 上游回显的成本（货币单位），缺失或非数字时为 0 */
  cost: number
}

export type AiChatDeltaHandler = (text: string) => void | Promise<void>

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 3
/** 仅对「重试可能有用」的失败退避重试：限流、网关抖动、超时。 */
const RETRIABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

export function textProvider(): AiProviderConfig {
  return loadConfig().aiText
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
  })

  let lastError: AiError | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await once(endpoint, provider.apiKey, body, model, opts)
    } catch (err) {
      const aiErr = err instanceof AiError ? err : new AiError('upstream', (err as Error)?.message || '未知错误')
      lastError = aiErr
      if (attempt >= MAX_ATTEMPTS || !isRetriable(aiErr)) break
      await sleep(attempt * 700)
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
  })

  let lastError: AiError | null = null
  let emitted = false
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await onceStream(endpoint, provider.apiKey, body, model, opts, async (delta) => {
        emitted = true
        await onDelta(delta)
      })
    } catch (err) {
      const aiErr = err instanceof AiError ? err : new AiError('upstream', (err as Error)?.message || '未知错误')
      lastError = aiErr
      if (emitted || attempt >= MAX_ATTEMPTS || !isRetriable(aiErr)) break
      await sleep(attempt * 700)
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
    const detail = (await res.text().catch(() => '')).slice(0, 500)
    console.error('[ai] upstream %d %s', res.status, detail)
    throw new AiError('upstream', describeUpstreamError(res.status, detail), res.status)
  }

  const data = (await res.json().catch(() => null)) as ChatCompletionResponse | null
  const choice = data?.choices?.[0]
  const text = extractContent(choice?.message?.content)
  const finishReason = String(choice?.finish_reason || '')

  if (!text) {
    // 推理模型（deepseek-v4 等）会先把 max_tokens 花在 reasoning_content 上，
    // 预算不够时 content 为空且 finish_reason=length —— 这与「上游异常」是两回事，分开报。
    console.error('[ai] 空回复 finish_reason=%s usage=%o', finishReason, data?.usage || null)
    if (finishReason === 'length') {
      throw new AiError('invalid', 'AI 输出被 max_tokens 截断：推理模型会先消耗思考 token，请调高上限')
    }
    throw new AiError('invalid', 'AI 服务返回内容为空')
  }

  return {
    text,
    model: String(data?.model || model),
    promptTokens: Number(data?.usage?.prompt_tokens) || 0,
    completionTokens: Number(data?.usage?.completion_tokens) || 0,
    finishReason,
    cost: Number(data?.cost) || 0,
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
    const detail = (await res.text().catch(() => '')).slice(0, 500)
    console.error('[ai] upstream %d %s', res.status, detail)
    throw new AiError('upstream', describeUpstreamError(res.status, detail), res.status)
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('text/event-stream')) {
    const data = (await res.json().catch(() => null)) as ChatCompletionResponse | null
    const parsed = parseChatCompletion(data, model)
    if (!parsed.text) throw emptyChatResponseError(parsed.finishReason, data)
    await onDelta(parsed.text)
    return parsed
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
  let finishReason = ''

  const consumeLine = async (line: string): Promise<void> => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!normalized.startsWith('data:')) return
    const payload = normalized.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let data: ChatCompletionStreamChunk
    try {
      data = JSON.parse(payload) as ChatCompletionStreamChunk
    } catch {
      throw new AiError('invalid', 'AI 流式响应格式不正确')
    }

    if (data.model) responseModel = String(data.model)
    const usage = data.usage
    if (usage) {
      promptTokens = Number(usage.prompt_tokens) || promptTokens
      completionTokens = Number(usage.completion_tokens) || completionTokens
    }
    if (data.cost !== undefined) cost = Number(data.cost) || cost

    const choice = data.choices?.[0]
    if (choice?.finish_reason) finishReason = String(choice.finish_reason)
    const delta = extractContent(choice?.delta?.content, false)
    if (!delta) return
    text += delta
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
  } finally {
    reader.releaseLock()
  }

  const trimmed = text.trim()
  if (!trimmed) throw emptyChatResponseError(finishReason, null)
  return { text: trimmed, model: responseModel, promptTokens, completionTokens, finishReason, cost }
}

function parseChatCompletion(data: ChatCompletionResponse | null, model: string): AiChatResult {
  const choice = data?.choices?.[0]
  const text = extractContent(choice?.message?.content)
  return {
    text,
    model: String(data?.model || model),
    promptTokens: Number(data?.usage?.prompt_tokens) || 0,
    completionTokens: Number(data?.usage?.completion_tokens) || 0,
    finishReason: String(choice?.finish_reason || ''),
    cost: Number(data?.cost) || 0,
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
    const value = content
      .map((part) => (typeof part === 'string' ? part : String((part as { text?: unknown })?.text || '')))
      .join('')
    return trim ? value.trim() : value
  }
  return ''
}

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  cost?: string | number
}

interface ChatCompletionStreamChunk {
  model?: string
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  cost?: string | number
}

function isRetriable(err: AiError): boolean {
  if (err.code === 'timeout') return true
  if (err.code === 'upstream') return err.status === 502 || RETRIABLE_STATUS.has(err.status)
  return false
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
