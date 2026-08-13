/**
 * AI 图像服务客户端 —— OpenAI 兼容 /images/generations 封装。
 * 供应商由 .env / 安装向导 / 后台配置（AI_IMAGE_BASE_URL / AI_IMAGE_API_KEY / AI_IMAGE_MODEL），
 * 默认 mimo-v2.5；未配置时一律抛 AiError('disabled')。
 * 与 client.ts 的 chat() 对称：同款 AiError 语义、退避重试、上游错误中文提示。
 */
import { loadConfig, type AiProviderConfig } from '../../config'
import { AiError } from './client'

export interface AiImageOptions {
  prompt: string
  size?: string
  quality?: string
  responseFormat?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface AiImageResult {
  data: Uint8Array
  contentType: string
  model: string
  /** 上游回显的成本（货币单位），缺失或非数字时为 0 */
  cost: number
}

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 3
const DEFAULT_SIZE = '1024x1024'
/** 仅对「重试可能有用」的失败退避重试：限流、网关抖动、超时。 */
const RETRIABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

export function imageProvider(): AiProviderConfig {
  return loadConfig().aiImage
}

/** 图像能力是否可用：baseUrl + apiKey 都配了才算。 */
export function isImageAiConfigured(): boolean {
  const p = imageProvider()
  return !!p.baseUrl && !!p.apiKey
}

/** 供应商域名，仅用于 ai_usage.provider 记账，不含路径与密钥。 */
export function imageProviderLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return ''
  }
}

/** baseUrl 允许写到 /v1 或直接写到 /images/generations，两种都归一。 */
function imageEndpoint(baseUrl: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  if (/\/images\/generations$/i.test(base)) return base
  return base + '/images/generations'
}

/**
 * 生成一张图片。失败按 AiError 语义化抛出，与 chat() 一致。
 * 默认走 b64_json：多数 OpenAI 兼容网关支持，避免二进制流解析坑。
 */
export async function generateImage(opts: AiImageOptions): Promise<AiImageResult> {
  const provider = imageProvider()
  if (!isImageAiConfigured()) throw new AiError('disabled', 'AI 图像服务未配置', 503)
  if (!opts.prompt?.trim()) throw new AiError('invalid', '图像 prompt 不能为空', 422)

  const endpoint = imageEndpoint(provider.baseUrl)
  const model = provider.model
  const size = opts.size || DEFAULT_SIZE
  const body = JSON.stringify({
    model,
    prompt: opts.prompt,
    size,
    n: 1,
    quality: opts.quality || 'standard',
    response_format: opts.responseFormat || 'b64_json',
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
  throw lastError || new AiError('upstream', 'AI 图像请求失败')
}

async function once(endpoint: string, apiKey: string, body: string, model: string, opts: AiImageOptions): Promise<AiImageResult> {
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
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', 'AI 图像服务响应超时', 504)
    throw new AiError('upstream', 'AI 图像服务连接失败')
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500)
    console.error('[ai-image] upstream %d %s', res.status, detail)
    throw new AiError('upstream', describeUpstreamError(res.status, detail), res.status)
  }

  const data = (await res.json().catch(() => null)) as ImageGenerationResponse | null
  const b64 = await extractB64(data)
  if (!b64) {
    console.error('[ai-image] 空响应 %o', data || null)
    throw new AiError('invalid', 'AI 图像服务未返回图片数据')
  }

  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    throw new AiError('invalid', 'AI 图像服务返回的 base64 数据无效')
  }
  if (!buf.byteLength) throw new AiError('invalid', 'AI 图像服务返回空图片')

  return {
    data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    contentType: 'image/png',
    model: String(data?.model || model),
    cost: Number(data?.cost) || 0,
  }
}

/** b64_json 可能在 data[0].b64_json，也可能在 data[0].url（部分网关忽略 response_format 返回 URL）。 */
async function extractB64(data: ImageGenerationResponse | null): Promise<string | null> {
  const item = data?.data?.[0]
  if (!item) return null
  if (typeof item.b64_json === 'string' && item.b64_json.trim()) return item.b64_json.trim()
  // URL 模式兜底：拉取远程图片再转字节（仍归一为 Uint8Array 返回）
  if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) return fetchUrlToB64(item.url)
  return null
}

/** 部分网关忽略 response_format，直接返回 URL；下载后以 base64 形式交回调用方解码。 */
async function fetchUrlToB64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
    if (!res.ok) return null
    const contentType = res.headers.get('Content-Type') || ''
    if (!/^image\//i.test(contentType)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.toString('base64')
  } catch {
    return null
  }
}

interface ImageGenerationResponse {
  model?: string
  data?: Array<{ b64_json?: string; url?: string }>
  cost?: string | number
}

function isRetriable(err: AiError): boolean {
  if (err.code === 'timeout') return true
  if (err.code === 'upstream') return err.status === 502 || RETRIABLE_STATUS.has(err.status)
  return false
}

/**
 * 把上游网关返回的 JSON 错误体解析成人类可读的中文提示（与 client.ts 同款逻辑）。
 */
function describeUpstreamError(status: number, detail: string): string {
  const prefix = `AI 图像服务返回 ${status}`
  const body = (detail || '').trim()
  if (!body) return prefix
  try {
    const parsed = JSON.parse(body)
    const errObj = (parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error: unknown }).error : parsed) as
      | { code?: string; message?: string; type?: string }
      | undefined
    const code = errObj?.code ? String(errObj.code) : ''
    const message = errObj?.message ? String(errObj.message) : ''
    if (!code && !message) return prefix
    const codeHints: Record<string, string> = {
      model_not_found: '上游无可用模型渠道',
      no_available_channel: '上游无可用渠道',
      insufficient_quota: '上游额度不足',
      invalid_api_key: '上游密钥无效',
      access_denied: '上游拒绝访问',
    }
    const hint = code ? (codeHints[code] || code) : ''
    return [prefix, hint, message].filter(Boolean).join('：')
  } catch {
    return `${prefix}：${body}`
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** AbortSignal.any 的兜底实现（与 client.ts 一致）。 */
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
