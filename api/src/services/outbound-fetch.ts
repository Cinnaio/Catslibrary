import { ProxyAgent } from 'undici'
import { connect } from 'node:net'
import { loadConfig } from '../config'
import { safeFetch, type FetchImplementation } from './safe-fetch'

export type ProxySource = 'environment' | 'runtime' | 'none'

export interface OutboundProxyConfig {
  proxyBase?: string
  proxyBypass?: string
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string
}

export interface OutboundFetchOptions {
  scope?: string
  safe?: boolean
  forceProxy?: boolean
  proxyConfig?: OutboundProxyConfig
}

export interface OutboundRequestLog {
  id: number
  timestamp: number
  scope: string
  method: string
  target: string
  targetHost: string
  proxySource: ProxySource
  proxyHost: string
  status: number | null
  durationMs: number
  ok: boolean
  error: string
}

export interface ResolvedProxy {
  url: string
  source: Exclude<ProxySource, 'none'>
}

const MAX_LOGS = 100
const proxyAgents = new Map<string, ProxyAgent>()
const requestLogs: OutboundRequestLog[] = []
let nextLogId = 1

function proxyAgent(proxyUrl: string): NonNullable<RequestInit['dispatcher']> {
  let agent = proxyAgents.get(proxyUrl)
  if (!agent) {
    agent = new ProxyAgent(proxyUrl)
    proxyAgents.set(proxyUrl, agent)
  }
  // Node and the installed undici package expose compatible dispatchers through different declarations.
  return agent as unknown as NonNullable<RequestInit['dispatcher']>
}

function hostMatches(host: string, rule: string): boolean {
  const normalizedHost = host.toLowerCase().replace(/^\[|\]$/g, '')
  const normalizedRule = rule
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^\./, '')
  return Boolean(normalizedRule) && (normalizedHost === normalizedRule || normalizedHost.endsWith('.' + normalizedRule))
}

export function shouldBypassProxy(targetUrl: string, bypassList = ''): boolean {
  const target = new URL(targetUrl)
  const host = target.hostname.toLowerCase()
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')

  return bypassList
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((rule) => {
      if (rule === '*') return true
      let ruleHost = rule
      let rulePort = ''
      if (rule.startsWith('[')) {
        const bracket = rule.indexOf(']')
        if (bracket > 0) {
          ruleHost = rule.slice(1, bracket)
          if (rule[bracket + 1] === ':') rulePort = rule.slice(bracket + 2)
        }
      } else if ((rule.match(/:/g) || []).length === 1) {
        const portIndex = rule.lastIndexOf(':')
        if (/^\d+$/.test(rule.slice(portIndex + 1))) {
          ruleHost = rule.slice(0, portIndex)
          rulePort = rule.slice(portIndex + 1)
        }
      }
      return (!rulePort || rulePort === port) && hostMatches(host, ruleHost)
    })
}

function currentProxyConfig(): OutboundProxyConfig {
  const config = loadConfig()
  return {
    proxyBase: config.proxyBase,
    proxyBypass: config.proxyBypass,
    httpProxy: config.httpProxy,
    httpsProxy: config.httpsProxy,
    noProxy: config.noProxy,
  }
}

/** Resolve the standard forward proxy for a target. Deployment environment variables take priority. */
export function resolveOutboundProxy(targetUrl: string, config: OutboundProxyConfig = currentProxyConfig(), forceProxy = false): ResolvedProxy | null {
  const target = new URL(targetUrl)
  const environmentProxy = target.protocol === 'https:' ? (config.httpsProxy || config.httpProxy || '').trim() : (config.httpProxy || '').trim()
  if (environmentProxy) {
    if (!forceProxy && shouldBypassProxy(target.href, config.noProxy)) return null
    return { url: environmentProxy, source: 'environment' }
  }

  const runtimeProxy = (config.proxyBase || '').trim()
  if (!runtimeProxy) return null
  const bypass = [config.noProxy, config.proxyBypass].filter(Boolean).join(',')
  if (!forceProxy && shouldBypassProxy(target.href, bypass)) return null
  return { url: runtimeProxy, source: 'runtime' }
}

function sanitizedTarget(rawUrl: string): { target: string; host: string } {
  try {
    const url = new URL(rawUrl)
    return { target: `${url.protocol}//${url.host}${url.pathname}`, host: url.host }
  } catch {
    return { target: '[invalid-url]', host: '' }
  }
}

function sanitizedProxyHost(proxyUrl: string): string {
  try {
    return new URL(proxyUrl).host
  } catch {
    return '[invalid-proxy]'
  }
}

const ERROR_TEXT_LIMIT = 320

/** 从错误文本中抹掉 URL 查询串与可能的密钥/凭据，避免写入日志或返回给前端。 */
export function sanitizeErrorText(text: string): string {
  return String(text || '')
    .replace(/([?&][^=\s&]+=)[^&\s]*/g, '$1***') // URL 查询参数值
    .replace(
      /\b(token|api[_-]?key|secret|password|passwd|authorization|signature|credential|access[_-]?key|private[_-]?key)\b\s*[:=]\s*(?!Bearer\b|Basic\b)[^\s,;)]+/gi,
      '$1=***',
    )
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
}

/** 生成可写日志/返回给前端的错误描述：沿 cause 链逐层展开并脱敏（如 undici 的 TypeError 只有 cause 里才有真实原因）。 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) {
    const text = sanitizeErrorText(String(err || '')).trim()
    return text || 'Error'
  }
  const parts: string[] = []
  const seen = new Set<string>()
  let current: Error | undefined = err
  while (current && !seen.has(current.message)) {
    seen.add(current.message)
    const text = sanitizeErrorText(current.message).trim()
    if (text && !parts.includes(text)) parts.push(text)
    current = (current as { cause?: unknown }).cause instanceof Error ? (current as { cause?: Error }).cause : undefined
  }
  const joined = parts.join(' → ').trim()
  return joined || err.name || 'Error'
}

/**
 * 快速探测标准 HTTP Forward Proxy 是否可达（仅 TCP 握手，不发送 CONNECT）。
 * 返回 null 表示可达；否则返回面向管理员的可操作错误描述。
 * 用于代理测试页在抓取失败时区分「代理本身不可达」与「目标经代理不可达」。
 */
export function probeProxyConnectivity(proxyUrl: string, timeoutMs = 3500): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(proxyUrl)
  } catch {
    return Promise.resolve('代理地址格式不正确，应为 http://host:port')
  }
  const host = parsed.hostname
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  if (!host || !port) return Promise.resolve('代理地址缺少主机名或端口')
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const hint = '请确认代理已监听该地址：容器内应使用 host.docker.internal，且代理需开启「允许局域网连接」(allow-lan)'
    const socket = connect({ host, port })
    const timer = setTimeout(() => finish(`无法连接代理服务器 ${host}:${port} —— 连接超时。${hint}`), timeoutMs)
    socket.once('connect', () => finish(null))
    socket.once('error', (err) => {
      const code = (err as { code?: string }).code || (err as Error).message
      finish(`无法连接代理服务器 ${host}:${port}（${code}）。${hint}`)
    })
  })
}

function appendLog(log: Omit<OutboundRequestLog, 'id' | 'timestamp'>): void {
  const entry: OutboundRequestLog = { id: nextLogId++, timestamp: Date.now(), ...log }
  requestLogs.unshift(entry)
  if (requestLogs.length > MAX_LOGS) requestLogs.length = MAX_LOGS
  const route = entry.proxySource === 'none' ? 'direct' : `${entry.proxySource}:${entry.proxyHost}`
  const result = entry.status !== null ? String(entry.status) : entry.error || 'Error'
  console.info(`[outbound] ${entry.scope} ${entry.method} ${entry.target} via ${route} -> ${result} (${entry.durationMs}ms)`)
}

export function listOutboundRequestLogs(limit = 50): OutboundRequestLog[] {
  const safeLimit = Math.max(1, Math.min(MAX_LOGS, Math.trunc(limit) || 50))
  return requestLogs.slice(0, safeLimit).map((entry) => ({ ...entry }))
}

export function clearOutboundRequestLogs(): void {
  requestLogs.length = 0
}

async function performFetch(rawUrl: string, init: RequestInit, options: OutboundFetchOptions): Promise<Response> {
  const startedAt = Date.now()
  const method = (init.method || 'GET').toUpperCase()
  const scope =
    String(options.scope || 'outbound')
      .replace(/[^a-z0-9_-]/gi, '')
      .slice(0, 40) || 'outbound'
  const target = sanitizedTarget(rawUrl)
  let proxy: ResolvedProxy | null = null

  try {
    proxy = resolveOutboundProxy(rawUrl, options.proxyConfig, options.forceProxy)
    const response = await fetch(rawUrl, {
      ...init,
      ...(proxy ? { dispatcher: proxyAgent(proxy.url) } : {}),
    } as RequestInit)
    appendLog({
      scope,
      method,
      target: target.target,
      targetHost: target.host,
      proxySource: proxy?.source || 'none',
      proxyHost: proxy ? sanitizedProxyHost(proxy.url) : '',
      status: response.status,
      durationMs: Date.now() - startedAt,
      ok: response.status < 400,
      error: '',
    })
    return response
  } catch (err) {
    appendLog({
      scope,
      method,
      target: target.target,
      targetHost: target.host,
      proxySource: proxy?.source || 'none',
      proxyHost: proxy ? sanitizedProxyHost(proxy.url) : '',
      status: null,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: describeError(err).slice(0, ERROR_TEXT_LIMIT),
    })
    throw err
  }
}

/** Project-wide outbound fetch with proxy selection and sanitized request logging. */
export async function outboundFetch(rawUrl: string, init: RequestInit = {}, options: OutboundFetchOptions = {}): Promise<Response> {
  const fetchImplementation: FetchImplementation = (url, nextInit) => performFetch(url, nextInit, options)
  return options.safe ? safeFetch(rawUrl, init, fetchImplementation) : performFetch(rawUrl, init, options)
}
