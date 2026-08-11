/**
 * AI 文本服务客户端 —— OpenAI 兼容 /chat/completions 封装。
 * 供应商由 .env / 安装向导配置（AI_TEXT_BASE_URL / AI_TEXT_API_KEY / AI_TEXT_MODEL），
 * 默认 deepseek-v4-flash；未配置时一律抛 AiError('disabled')，调用方据此隐藏入口。
 */
import { loadConfig, type AiProviderConfig } from '../../config'

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
}

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
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
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

async function once(endpoint: string, apiKey: string, body: string, model: string, opts: AiChatOptions): Promise<AiChatResult> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = opts.signal ? anySignal([timeout, opts.signal]) : timeout

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
      signal,
    })
  } catch (err) {
    const name = (err as Error)?.name || ''
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', 'AI 服务响应超时', 504)
    throw new AiError('upstream', 'AI 服务连接失败')
  }

  if (!res.ok) {
    // 上游错误详情只进服务端日志，客户端只拿到状态码
    const detail = (await res.text().catch(() => '')).slice(0, 500)
    console.error('[ai] upstream %d %s', res.status, detail)
    throw new AiError('upstream', `AI 服务返回 ${res.status}`, res.status)
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
  }
}

/** content 可能是字符串，也可能是 [{type:'text',text}] 分片（部分网关如此）。 */
function extractContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : String((part as { text?: unknown })?.text || '')))
      .join('')
      .trim()
  }
  return ''
}

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function isRetriable(err: AiError): boolean {
  if (err.code === 'timeout') return true
  if (err.code === 'upstream') return err.status === 502 || RETRIABLE_STATUS.has(err.status)
  return false
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
