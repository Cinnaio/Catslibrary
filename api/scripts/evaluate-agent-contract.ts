/** Frozen failure replay, never connects to a database. Each matrix cell is one
 * explicit request, no retries/fallbacks. Original responses stay in ignored files. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AiChatResult, AiMessage, AiResponseFormat } from '../src/services/ai/client'
import { AGENT_SUMMARY_FORMAT } from '../src/services/ai/agent-summary-contract'

const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') continue
  if (!['--source', '--output'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid option')
  options.set(args[i]!, args[++i]!)
}
const matrix = ['inherit', 'disabled'].flatMap(reasoning => ['prompt', 'json_object', 'json_schema'].map(format => ({ kind: 'failure_replay', reasoning, format })))
matrix.push(...['inherit', 'disabled'].map(reasoning => ({ kind: 'schema_enforcement_probe', reasoning, format: 'json_schema' })))
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan', matrix, requests: 8, maxTokens: 4096, retries: 0, database: false }, null, 2))
  process.exit(0)
}
if (!options.get('--source') || !options.get('--output')) throw new Error('Live mode requires --source and a new --output path')
const rawSource = await readFile(path.resolve(options.get('--source')!), 'utf8')
const source = JSON.parse(rawSource) as { samples: Array<{ requests: Array<{ kind: string; messages: AiMessage[]; response?: { finishReason?: string } }> }> }
const failed = source.samples.flatMap(s => s.requests).find(r => r.kind === 'summary' && r.response?.finishReason === 'length')
if (!failed) throw new Error('Source has no length-failed summary')
const output = path.resolve(options.get('--output')!)
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sourceHashes = Object.fromEntries(await Promise.all(['api/scripts/evaluate-agent-contract.ts', 'api/src/services/ai/client.ts', 'api/src/services/ai/agent-context.ts', 'api/src/services/ai/agent-summary-contract.ts'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify({ status: 'initializing' }), { flag: 'wx' })
process.env.DATABASE_URL = 'postgres://isolated/unused'
const { loadConfig } = await import('../src/config')
const provider = loadConfig().aiText
if (!provider.apiKey || !provider.baseUrl || !/(^|\/)deepseek(?:[-_/]|$)/i.test(provider.model)) throw new Error('Configured DeepSeek-compatible text preset required')
const { chat, chatEndpoint, AiError } = await import('../src/services/ai/client')
const { parseAgentSummary } = await import('../src/services/ai/agent-context')
const { withProviderSnapshot } = await import('../src/services/ai/provider-snapshot')
const realFetch = globalThis.fetch
const endpoint = chatEndpoint(provider.baseUrl)
const scrub = (value: string) => value.replaceAll(provider.apiKey, '[credential]').replace(/https?:\/\/[^\s"<>]+/g, '[url]')
type Sample = {
  kind: string; reasoning: string; format: string; messages: AiMessage[]; transportCalls: number
  request?: unknown; httpStatus?: number; rawResponse?: string; result?: AiChatResult
  error?: { code: string; status?: number }; validSummary?: boolean; validation?: string
  schemaEnforced?: boolean; durationMs?: number; humanReview: 'pending'
}
const samples: Sample[] = []
let sample: Sample
let capture: Promise<void> | undefined
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== endpoint || init?.method !== 'POST' || sample.transportCalls) throw new Error('Unexpected endpoint or implicit retry blocked')
  sample.transportCalls++
  sample.request = JSON.parse(String(init.body))
  const response = await realFetch(input, { ...init, redirect: 'error' })
  sample.httpStatus = response.status
  const clone = response.clone()
  capture = clone.text().then(text => { sample.rawResponse = scrub(text) }).catch(() => { sample.validation = 'capture_incomplete' })
  return response
}
try {
  for (const cell of matrix) {
    const probe = cell.kind === 'schema_enforcement_probe'
    const messages: AiMessage[] = probe
      ? [{ role: 'system', content: '输出 JSON。仅输出 {"unexpected":123}，不要输出其他字段。' }]
      : failed.messages
    sample = { ...cell, messages, transportCalls: 0, humanReview: 'pending' }
    samples.push(sample)
    const format: AiResponseFormat | undefined = cell.format === 'json_schema' ? AGENT_SUMMARY_FORMAT : cell.format === 'json_object' ? { type: 'json_object' } : undefined
    const started = Date.now()
    try {
      const response = await withProviderSnapshot(() => chat({
        messages, responseFormat: format, reasoningMode: cell.reasoning as 'inherit' | 'disabled',
        maxTokens: probe ? 512 : 4096, temperature: 0.1, timeoutMs: 120000,
        signal: AbortSignal.timeout(125000), maxAttempts: 1, retryOnTimeout: false, returnIncompleteResult: true,
      }), { text: provider })
      sample.result = { ...response, text: scrub(response.text), reasoningContent: undefined }
      if (response.finishReason !== 'stop' || response.refusal || response.truncated || response.toolCalls?.length) throw new Error('incomplete_or_refused')
      try { parseAgentSummary(response.text); sample.validSummary = true }
      catch { sample.validSummary = false; sample.validation = 'strict_summary_validation_failed' }
      if (probe) sample.schemaEnforced = sample.validSummary
    } catch (error) {
      sample.error = error instanceof AiError ? { code: error.code, status: error.status } : { code: 'incomplete_or_transport_failed' }
      if (error instanceof AiError && error.partialResult) sample.result = { ...error.partialResult, text: scrub(error.partialResult.text), reasoningContent: undefined }
    }
    await capture
    capture = undefined
    sample.durationMs = Date.now() - started
    await writeFile(output, JSON.stringify({ status: samples.length === matrix.length ? 'complete' : 'running', model: provider.model, sourceCommit, sourceHashes, sourceHash: createHash('sha256').update(rawSource).digest('hex'), inputHash: createHash('sha256').update(JSON.stringify(failed.messages)).digest('hex'), matrix, samples }, null, 2))
    console.log(JSON.stringify({ ...cell, httpStatus: sample.httpStatus, finishReason: sample.result?.finishReason, validSummary: sample.validSummary, error: sample.error, completionTokens: sample.result?.completionTokens, reasoningTokens: sample.result?.reasoningTokens }))
  }
} finally { globalThis.fetch = realFetch }
