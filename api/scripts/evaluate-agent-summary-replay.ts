/** Two frozen S01 failures, one paid request each. No DB, retries, or tool execution. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import ts from 'typescript'
import type { AiChatResult, AiMessage } from '../src/services/ai/client'

const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') continue
  assert(['--directory', '--source', '--output'].includes(args[i]!) && args[i + 1] && !args[i + 1]!.startsWith('--'), 'Invalid option')
  options.set(args[i]!, args[++i]!)
}
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan', modelCalls: 0, liveMaxCalls: 2, databaseWrites: false, cases: ['S01-A restriction scope', 'S01-B citation range'] }))
  process.exit(0)
}
assert(options.get('--source') && options.get('--directory') && options.get('--output'), 'Source, local directory and new output required')
const raw = await readFile(path.resolve(options.get('--source')!), 'utf8')
const source = JSON.parse(raw) as { syntheticOnly: boolean; requests: Array<{ stage: string; kind: string; messages: AiMessage[] }> }
assert(source.syntheticOnly, 'Synthetic source required')
const directory = path.resolve(options.get('--directory')!)
const relative = path.relative(path.resolve('.tmp/agent-local-review'), directory)
assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Local review configuration required')
const env = JSON.parse(await readFile(path.join(directory, 'runtime-config.json'), 'utf8')) as Record<string, string>
process.env.ENV_FILE = path.join(directory, '.env-unused')
process.env.RUNTIME_CONFIG_DIR = directory
for (const [key, value] of Object.entries(env)) process.env[key] = value
process.env.DATABASE_URL = 'postgres://isolated/unused'
const { textProvider, chat, chatEndpoint, AiError } = await import('../src/services/ai/client')
const { withProviderSnapshot } = await import('../src/services/ai/provider-snapshot')
const { parseAgentSummary } = await import('../src/services/ai/agent-context')
const { AGENT_TOOLS } = await import('../src/services/ai/agent-tools')
const provider = textProvider()
assert(provider.apiKey && provider.baseUrl, 'Configured provider required')
const output = path.resolve(options.get('--output')!)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sourceHashes: Record<string, string> = {}
async function prompt(file: string, name: string) {
  const text = await readFile(file, 'utf8')
  sourceHashes[file] = hash(text)
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  let result = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isNoSubstitutionTemplateLiteral(node.initializer)) result = node.initializer.text
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(result, 'Current literal system prompt required')
  return result
}
const current = { chat: await prompt('api/src/services/ai/agent.ts', 'SYSTEM'), summary: await prompt('api/src/services/ai/agent-context.ts', 'SUMMARY_SYSTEM') }
for (const file of ['api/scripts/evaluate-agent-summary-replay.ts', 'api/src/services/ai/agent-tools.ts', 'api/src/services/ai/client.ts']) sourceHashes[file] = hash(await readFile(file, 'utf8'))
type Sample = { id: string; stage: string; kind: 'chat' | 'summary'; messages: AiMessage[]; calls: number; result?: AiChatResult; error?: string; validOutput?: boolean; parsedSummary?: unknown; humanReview: 'pending' }
const samples: Sample[] = [
  { id: 'S01-A', stage: 'summary_1', kind: 'chat', messages: [], calls: 0, humanReview: 'pending' },
  { id: 'S01-B', stage: 'summary_3', kind: 'summary', messages: [], calls: 0, humanReview: 'pending' },
]
for (const sample of samples) {
  const frozen = source.requests.find(item => item.stage === sample.stage && item.kind === sample.kind)
  assert(frozen?.messages[0]?.role === 'system', 'Frozen first request required')
  sample.messages = frozen.messages.map((message, index) => index === 0 ? { ...message, content: current[sample.kind] } : message)
  assert(sample.messages.every(message => message.role !== 'tool'), 'First request without tool round required')
}
const report = { capturedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes, frozenSourceSha256: hash(raw), syntheticOnly: true, model: provider.model, scope: 'one frozen model request per case; only current system prompt substituted; not an end-to-end rerun', samples }
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
const persist = () => writeFile(output, JSON.stringify(report, null, 2) + '\n')
const realFetch = globalThis.fetch
let sample: Sample
const endpoint = chatEndpoint(provider.baseUrl)
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  assert(url === endpoint && init?.method === 'POST' && sample.calls === 0, 'Retry or non-chat endpoint blocked')
  sample.calls++
  await persist()
  return realFetch(input, { ...init, redirect: 'error' })
}
const safe = (value: string) => value.replaceAll(provider.apiKey, '[credential]').replace(/https?:\/\/[^\s"<>]+/g, '[url]')
try {
  for (sample of samples) {
    try {
      const result = await withProviderSnapshot(() => chat({ messages: sample.messages, ...(sample.kind === 'chat' ? { tools: AGENT_TOOLS } : {}), temperature: sample.kind === 'chat' ? 0.4 : 0.1, maxTokens: 4096, maxAttempts: 1, retryOnTimeout: false, timeoutMs: 120000, signal: AbortSignal.timeout(125000), returnIncompleteResult: true }), { text: provider })
      sample.result = { ...result, text: safe(result.text), reasoningContent: undefined }
      sample.validOutput = !result.refusal && !result.truncated && result.finishReason === 'stop' && !result.toolCalls?.length
      if (sample.validOutput && sample.kind === 'summary') sample.parsedSummary = parseAgentSummary(result.text)
    } catch (error) {
      sample.error = error instanceof AiError ? error.code : 'validation_or_transport_failed'
      if (error instanceof AiError && error.partialResult) sample.result = { ...error.partialResult, text: safe(error.partialResult.text), reasoningContent: undefined }
    }
    await persist()
    console.log(JSON.stringify({ case: sample.id, calls: sample.calls, validOutput: sample.validOutput, error: sample.error, humanReview: sample.humanReview }))
  }
} finally { globalThis.fetch = realFetch }
if (samples.some(item => !item.validOutput || item.error)) process.exitCode = 1
