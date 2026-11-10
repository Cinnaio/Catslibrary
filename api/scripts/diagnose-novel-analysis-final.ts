/** One frozen final request; record response shape without persisting private reasoning or credentials. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chat, chatEndpoint, AiError, type AiChatOptions } from '../src/services/ai/client'
import { loadConfig } from '../src/config'
import { withProviderSnapshot } from '../src/services/ai/provider-snapshot'
import type { AiReasoningMode } from '../../shared/ai-text-progress'
import { ANALYSIS_KINDS, type AnalysisKind } from '../../shared/novel-analysis'
import { finalAnalysisMessages } from '../src/services/ai/novel-analysis'
import { analysisPrompt } from '../src/services/ai/novel-analysis-prompts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan', purpose: '复用 --trace 的最后一轮，核对原始响应结构与客户端结果；--current-final --kind plot 使用当前报告提示和结束工具流程；--reasoning high 使用模块16000上限；--stream 仅改变传输方式，记录时序不保存思考正文', maxCalls: 1, retries: 0, databaseWrites: false, reasoningTextSaved: false }))
  process.exit(0)
}
const traceArg = option('--trace')
const outputArg = option('--output')
if (!traceArg || !outputArg) throw new Error('Require --trace and a new --output directory')
const output = path.resolve(outputArg)
const relative = path.relative(path.join(root, '.tmp'), output)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be inside repository .tmp')
const trace = JSON.parse(await readFile(path.resolve(traceArg), 'utf8')) as {
  reasoning: AiReasoningMode; calls: Array<Pick<AiChatOptions, 'messages' | 'tools' | 'toolChoice'> & { result?: { model?: string } }>
}
const final = trace.calls.at(-1)
if (!final?.messages?.length || final.tools?.length || !['inherit', 'disabled', 'low', 'high'].includes(trace.reasoning)) throw new Error('Expected a frozen final request without tools and explicit reasoning mode')
const currentFinal = args.includes('--current-final')
const kind = option('--kind')
if (currentFinal && (!kind || !Object.hasOwn(ANALYSIS_KINDS, kind) || !final.messages.some(message => message.role === 'tool') && final.toolChoice !== 'none')) throw new Error('Current final mode requires --kind and tool evidence or an already-closed final request')
const messages = currentFinal ? final.messages.some(message => message.role === 'tool')
  ? finalAnalysisMessages(final.messages, kind as AnalysisKind)
  : [{ role: 'system' as const, content: analysisPrompt('final', kind as AnalysisKind) }, ...final.messages.slice(1)]
  : final.messages
const toolChoice = currentFinal ? 'none' : final.toolChoice
const reasoning = option('--reasoning') || trace.reasoning
if (!['inherit', 'disabled', 'low', 'high'].includes(reasoning) || option('--reasoning') && !currentFinal) throw new Error('Reasoning override requires current-final mode')
const maxTokens = currentFinal && reasoning === 'high' ? 16000 : 8000
const stream = args.includes('--stream')
const provider = loadConfig().aiText
if (!provider.apiKey || !provider.baseUrl || final.result?.model !== provider.model) throw new Error('Original configured provider/model required')
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output, { recursive: false })
const clean = (value: unknown) => JSON.stringify(value, null, 2).replaceAll(provider.apiKey, '[credential]')
const originalFetch = globalThis.fetch
let requests = 0
const wire: Array<Record<string, unknown>> = []
const shape = (value: unknown): unknown => {
  if (value === null) return { type: 'null' }
  if (typeof value === 'string') return { type: 'string', characters: value.length, trimmedCharacters: value.trim().length }
  if (Array.isArray(value)) return { type: 'array', items: value.map(shape) }
  if (value && typeof value === 'object') return { type: 'object', fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) }
  return { type: typeof value }
}
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== chatEndpoint(provider.baseUrl) || init?.method !== 'POST') return originalFetch(input, init)
  if (++requests > 1) throw new Error('Single request budget exhausted')
  const response = await originalFetch(input, init)
  if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
    const entry: Record<string, unknown> = { status: response.status, contentType: 'text/event-stream', headersMs: Date.now() - started, chunks: 0, bytes: 0 }
    wire.push(entry)
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        entry.firstByteMs ??= Date.now() - started
        entry.lastByteMs = Date.now() - started
        entry.chunks = Number(entry.chunks) + 1
        entry.bytes = Number(entry.bytes) + chunk.byteLength
        controller.enqueue(chunk)
      },
    }))
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  const body: unknown = await response.clone().json().catch(() => undefined)
  wire.push({ status: response.status, responseShape: shape(body) })
  await writeFile(path.join(output, 'wire-shape.json'), clean(wire))
  return response
}
const started = Date.now()
const progress: { firstThinkingMs?: number; firstWritingMs?: number; reasoningCharacters: number; textCharacters: number } = { reasoningCharacters: 0, textCharacters: 0 }
try {
  const result = await withProviderSnapshot(() => chat({ messages, toolChoice, stream, temperature: 0.2, maxTokens,
    onProgress: update => {
      if (update.phase === 'thinking') progress.firstThinkingMs ??= Date.now() - started
      progress.reasoningCharacters = update.reasoningCharacters
    },
    onDelta: text => { progress.firstWritingMs ??= Date.now() - started; progress.textCharacters += text.length },
    reasoningMode: reasoning as AiReasoningMode, maxAttempts: 1, retryOnTimeout: false, returnIncompleteResult: true,
    timeoutMs: 300000, signal: AbortSignal.timeout(305000) }), { text: provider })
  await writeFile(path.join(output, 'result.json'), clean({ ...result, reasoningContent: undefined }))
  await writeFile(path.join(output, 'report.md'), result.text)
  console.log(JSON.stringify({ requests, textCharacters: result.text.length, toolCalls: result.toolCalls?.length || 0, finishReason: result.finishReason, refusal: !!result.refusal, truncated: !!result.truncated }))
} catch (error) {
  const failure = error instanceof AiError ? { code: error.code, status: error.status, partial: error.partialResult ? { ...error.partialResult, reasoningContent: undefined } : undefined } : { code: 'diagnostic_failed' }
  await writeFile(path.join(output, 'error.json'), clean(failure))
  console.log(JSON.stringify({ requests, error: failure.code }))
  process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch
  await writeFile(path.join(output, 'wire-shape.json'), clean(wire))
  await writeFile(path.join(output, 'request-summary.json'), clean({ originalTrace: path.relative(root, path.resolve(traceArg)), messagesHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
    currentFinal, kind, toolChoice, stream, progress, model: provider.model, reasoning, maxTokens, maxCalls: 1, requests, durationMs: Date.now() - started, databaseWrites: false }))
}
