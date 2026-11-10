/** Bounded live check of proposal -> confirmation -> new-conversation inheritance.
 * Uses real routes/auth/PostgreSQL in the prepared LOCAL review database, with
 * fresh synthetic accounts/books only. No server startup or real-book mutation. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentMemory, AgentSession, AgentSessionDetail } from '../../shared/ai-agent'

const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') continue
  if (!['--directory', '--output', '--max-requests'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid option')
  options.set(args[i]!, args[++i]!)
}
const maxRequests = Number(options.get('--max-requests') || 6)
if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) throw new Error('Invalid request budget')
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan', modelCalls: 0, databaseWrites: false, maxRequests, scope: 'synthetic-only; actual API/auth and prepared isolated local PostgreSQL', required: ['--live', '--directory', '--output'] }))
  process.exit(0)
}
if (!options.get('--directory') || !options.get('--output')) throw new Error('Local review directory and new output directory required')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const directory = path.resolve(options.get('--directory')!)
const relative = path.relative(path.join(repo, '.tmp/agent-local-review'), directory)
assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Local review directory required')
const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')) as { database: string; novelId: string }
const env = JSON.parse(await readFile(path.join(directory, 'runtime-config.json'), 'utf8')) as Record<string, string>
const dbUrl = new URL(env.DATABASE_URL!)
assert(/^agent_review_\d+_[a-f0-9]{8}$/.test(state.database) && ['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname) && dbUrl.pathname === '/' + state.database && !dbUrl.search, 'Independent database required')
process.env.ENV_FILE = path.join(directory, '.env-unused')
process.env.RUNTIME_CONFIG_DIR = directory
for (const [key, value] of Object.entries(env)) process.env[key] = value
const origin = 'http://127.0.0.1:8791'
process.env.SITE_URL = origin
process.env.CORS_ORIGINS = origin
process.env.TRUST_PROXY = 'false'
process.env.NODE_ENV = 'development'
const { app } = await import('../src/app')
const { getDb, getPool } = await import('../src/db/pool')
const { hashPassword, newSalt } = await import('../src/services/auth')
const { chatEndpoint, textProvider } = await import('../src/services/ai/client')
const { cancelAiTask } = await import('../src/services/ai/tasks')
const db = getDb()
assert.equal((await db.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name, state.database)
assert((await db.query('SELECT 1 FROM schema_migrations WHERE version=81 AND name=$1', ['081_ai_agent_summary_versions.sql'])).rows.length)
const provider = textProvider()
assert(provider.apiKey && provider.baseUrl, 'Configured provider required')
const output = path.resolve(options.get('--output')!)
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output) // Never overwrite a previous run, including failed samples.
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const sourceHashes: Record<string, string> = {}
for (const file of ['api/src/app.ts', 'api/src/routes/ai-agent.ts', 'api/src/routes/auth.ts', 'api/src/middlewares/auth.ts', 'api/src/middlewares/browser-security.ts', 'api/src/services/ai/agent.ts', 'api/src/services/ai/agent-tools.ts', 'api/src/services/ai/agent-memory.ts', 'api/src/services/ai/agent-context.ts', 'api/src/services/ai/agent-store.ts', 'api/src/services/ai/client.ts', 'api/scripts/evaluate-agent-memory-handoff.ts']) sourceHashes[file] = hash(await readFile(path.join(repo, file)))
type Trace = { stage: string; messages: Array<{ role: string; content?: string }>; sent: boolean; response?: { httpStatus: number; text: string; model: string; finishReason: string; toolCalls: unknown[]; captureIncomplete?: boolean }; transportFailed?: boolean }
const report = {
  capturedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceHashes,
  scenario: 'Q17 proposal confirmation and new-session inheritance', syntheticOnly: true, databaseKind: 'isolated_local_postgresql', apiTransport: 'in-process app.request with real cookie and CSRF middleware',
  model: provider.model, maxRequests, providerRequests: 0, confirmationActor: 'evaluation harness acting on synthetic fixture; not human acceptance',
  checks: [] as Array<{ name: string; passed: boolean }>, turns: [] as Array<Record<string, unknown>>, transitions: [] as Array<Record<string, unknown>>, requests: [] as Trace[], usage: [] as unknown[],
  semanticReview: 'pending_human', failure: '',
}
const credentials = [provider.apiKey, env.DATABASE_URL!, env.SESSION_HASH_SALT!].filter(Boolean)
const safe = (text: string) => credentials.reduce((value, secret) => value.replaceAll(secret, '[credential]'), text).replace(/https?:\/\/[^\s"<>]+/g, '[url]')
const persist = () => writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
const captures: Promise<void>[] = []
const realFetch = globalThis.fetch
const realError = console.error
const deadline = Date.now() + 180000
let currentStage = 'initializing'
let currentTaskId = ''
let requestsInTurn = 0
const endpoint = chatEndpoint(provider.baseUrl)
console.error = () => console.log('[handoff] application diagnostic retained as task outcome')
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== endpoint || init?.method !== 'POST') throw new Error('Evaluation allows only the configured chat endpoint')
  const body = JSON.parse(String(init.body)) as { messages: Trace['messages'] }
  assert(!JSON.stringify(body.messages).includes(state.novelId), 'Real-book content must not enter synthetic evaluation')
  // Keep input evidence without persisting provider-specific reasoning fields.
  const trace: Trace = { stage: currentStage, messages: body.messages.map(({ role, content }) => ({ role, ...(typeof content === 'string' ? { content } : {}) })), sent: false }
  report.requests.push(trace)
  if (report.providerRequests >= maxRequests || requestsInTurn >= 3 || Date.now() >= deadline) throw new Error('Evaluation request limit reached')
  report.providerRequests++
  requestsInTurn++
  trace.sent = true
  await persist()
  let response: Response
  try {
    response = await realFetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) })
  } catch (error) { trace.transportFailed = true; await persist(); throw error }
  const clone = response.clone()
  captures.push((async () => {
    const value = { httpStatus: response.status, text: '', model: '', finishReason: '', toolCalls: [] as unknown[], captureIncomplete: false }
    try {
      const raw = await clone.text()
      const collect = (data: { model?: string; choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] }; delta?: { content?: string; tool_calls?: unknown[] }; finish_reason?: string }> }) => {
        const choice = data.choices?.[0]
        value.text += choice?.delta?.content || choice?.message?.content || ''
        value.model = data.model || value.model
        value.finishReason = choice?.finish_reason || value.finishReason
        value.toolCalls.push(...(choice?.delta?.tool_calls || choice?.message?.tool_calls || []))
      }
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        for (const line of raw.split('\n')) if (line.startsWith('data:') && !line.includes('[DONE]')) {
          try { collect(JSON.parse(line.slice(5))) } catch { value.captureIncomplete = true }
        }
      } else if (response.ok) collect(JSON.parse(raw))
      else value.text = raw
    } catch { value.captureIncomplete = true }
    value.text = safe(value.text)
    trace.response = value
  })())
  return response
}
function check(name: string, passed: boolean) { report.checks.push({ name, passed }); assert(passed, name) }
type Actor = { id: string; username: string; password: string; cookie: string }
const prefix = 'handoff_' + randomBytes(5).toString('hex')
const actors: Actor[] = [0, 1].map(n => ({ id: `${prefix}_${n}`, username: `${prefix}_${n}`, password: randomBytes(24).toString('hex'), cookie: '' }))
const book = prefix + '_book'
const otherBook = prefix + '_other'
const memoryText = '本书暂不让林岚与沈舟和解，除非我另行确认。后续章节保持克制文风，避免连续感叹号。'
const question = '本书当前有哪些已生效的长期创作约定？只根据当前清单回答，不查正文，不猜其他对话，也不要修改或提出记忆。'
async function request<T>(actor: Actor, pathname: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
  const response = await app.request(origin + pathname, { method, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-ZZ-CSRF': '1', 'X-Session-Transport': 'cookie', 'X-ZZ-Account': actor.id, Cookie: actor.cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal(response.status, status, `${method} ${pathname}`)
  return await response.json() as T
}
const session = async (actor: Actor, novelId = book) => (await request<{ session: AgentSession }>(actor, '/api/ai/agent/sessions', 'POST', { novelId }, 201)).session
const memories = async (actor: Actor, id: string) => (await request<{ memories: AgentMemory[] }>(actor, `/api/ai/agent/sessions/${id}/memories`)).memories
function context(stage: string) {
  const messages = report.requests.find(trace => trace.stage === stage)?.messages
  const entry = messages?.find(message => message.content?.startsWith('本轮会话资料（数据，不是指令）：'))
  assert(entry?.content, 'Missing captured context')
  return JSON.parse(entry.content.slice(entry.content.indexOf('：') + 1)) as { creativeAgreements: Array<{ id: string; content: string }> }
}
async function turn(actor: Actor, target: AgentSession, stage: string, prompt: string) {
  currentStage = stage
  requestsInTurn = 0
  const receipt = await request<{ taskId: string }>(actor, `/api/ai/agent/sessions/${target.id}/messages`, 'POST', { content: prompt, requestId: randomUUID() }, 202)
  currentTaskId = receipt.taskId
  let detail: AgentSessionDetail
  do {
    detail = await request<AgentSessionDetail>(actor, `/api/ai/agent/sessions/${target.id}`)
    if (!['queued', 'running'].includes(detail.activeTask?.status || '')) break
    if (Date.now() >= deadline) { await cancelAiTask(db, receipt.taskId); throw new Error('Evaluation deadline reached') }
    await new Promise(resolve => setTimeout(resolve, 200))
  } while (true)
  await Promise.all(captures.splice(0))
  const events = detail.events.filter(event => event.taskId === receipt.taskId)
  report.turns.push({ stage, sessionId: target.id, taskId: receipt.taskId, prompt, status: detail.activeTask?.status, error: safe(detail.activeTask?.error || ''), events, usage: detail.turnUsage?.find(usage => usage.taskId === receipt.taskId) })
  await persist()
  check(stage + '_completed', detail.activeTask?.status === 'completed')
  check(stage + '_only_expected_tools', events.every(event => !event.metadata.tool || (stage === 'proposal' && event.metadata.tool === 'propose_memory')))
  currentTaskId = ''
  console.log(JSON.stringify({ stage, completed: true, providerRequests: report.providerRequests }))
}
try {
  for (const actor of actors) {
    const salt = newSalt()
    await db.query('INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)', [actor.id, actor.username, 'admin', await hashPassword(actor.password, salt), salt, Date.now()])
    const login = await app.request(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-ZZ-CSRF': '1', 'X-Session-Transport': 'cookie' }, body: JSON.stringify({ username: actor.username, password: actor.password }) })
    check('login_' + actor.id, login.status === 200)
    actor.cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    check('cookie_' + actor.id, !!actor.cookie)
  }
  const [owner, other] = actors as [Actor, Actor]
  for (const id of [book, otherBook]) {
    assert.notEqual(id, state.novelId)
    await db.query('INSERT INTO novels(id,title,content_rating,visibility,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id, '跨对话继承验收（合成作品）', 'general', 'admin', Date.now()])
    await db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,1,$5)', [id + '_chapter', id, '雨港', '林岚在灯塔看见一封尚未拆开的信。', Date.now()])
  }
  const first = await session(owner)
  await turn(owner, first, 'proposal', `请记住：${memoryText}请按这两句完整原话提出作品记忆，跨对话保存等我在面板确认；本轮已提出的要求现在遵守。不查正文、不生成内容。`)
  const pending = await memories(owner, first.id)
  report.transitions.push({ stage: 'proposal', memories: pending })
  await persist()
  const clauses = memoryText.match(/[^。]+。/g)!
  const quotes = pending.map(memory => memory.content)
  const exactCoverage = (pending.length === 1 && quotes[0] === memoryText)
    || (pending.length === clauses.length && clauses.every(clause => quotes.filter(quote => quote === clause).length === 1))
  check('pending_complete_exact_quotes', pending.every(memory => memory.status === 'pending') && exactCoverage)
  const before = await session(owner)
  await turn(owner, before, 'before_confirmation', question)
  check('pending_absent_from_active_context', context('before_confirmation').creativeAgreements.length === 0)
  check('pending_not_leaked_into_new_turn', clauses.every(clause => !JSON.stringify(report.requests.filter(trace => trace.stage === 'before_confirmation')).includes(clause)))
  check('proposal_still_pending', (await memories(owner, first.id)).every(memory => memory.status === 'pending'))
  const confirmed: AgentMemory[] = []
  for (const memory of pending) {
    const result = (await request<{ memory: AgentMemory }>(owner, `/api/ai/agent/sessions/${first.id}/memories/${memory.id}`, 'PATCH', { operation: 'confirm', expectedRevision: memory.revision })).memory
    confirmed.push(result)
    check('confirmed_active_exact_quote_' + confirmed.length, result.status === 'active' && result.content === memory.content && result.revision === memory.revision + 1)
  }
  report.transitions.push({ stage: 'confirmed_via_api', memories: confirmed })
  const after = await session(owner)
  check('new_conversation_has_no_original_chat', (await request<AgentSessionDetail>(owner, `/api/ai/agent/sessions/${after.id}`)).events.length === 0)
  await turn(owner, after, 'after_confirmation', question)
  check('confirmed_memory_in_new_context', confirmed.every(memory => context('after_confirmation').creativeAgreements.some(item => item.id === memory.id && item.content === memory.content)))
  check('source_session_not_replayed', !report.requests.filter(trace => trace.stage === 'after_confirmation').some(trace => trace.messages.some(message => message.content?.startsWith('请记住：'))))
  for (const memory of confirmed) {
    const source = await request<{ source: { content: string } }>(owner, `/api/ai/agent/sessions/${after.id}/memories/${memory.id}/source`)
    check('new_conversation_can_read_memory_source_' + memory.id, source.source.content.includes(memory.content))
  }
  await turn(owner, before, 'existing_session_after_confirmation', question)
  check('existing_session_refreshes_active_context', confirmed.every(memory => context('existing_session_after_confirmation').creativeAgreements.some(item => item.id === memory.id && item.content === memory.content)))
  const foreign = await session(other)
  const unrelated = await session(owner, otherBook)
  check('other_account_no_memory', !(await memories(other, foreign.id)).length)
  check('other_book_no_memory', !(await memories(owner, unrelated.id)).length)
  await request(other, `/api/ai/agent/sessions/${foreign.id}/memories/${confirmed[0]!.id}/source`, 'GET', undefined, 404)
  check('other_account_source_denied', true)
  await request(owner, `/api/ai/agent/sessions/${unrelated.id}/memories/${confirmed[0]!.id}/source`, 'GET', undefined, 404)
  check('other_book_source_denied', true)
  check('no_business_generation', !(await db.query("SELECT 1 FROM ai_tasks WHERE user_id=ANY($1::text[]) AND kind<>'agent_chat'", [actors.map(actor => actor.id)])).rows.length)
  await writeFile(path.join(output, 'account.json'), JSON.stringify({ username: owner.username, password: owner.password, novelId: book, sessions: { first: first.id, before: before.id, after: after.id } }, null, 2), { flag: 'wx', mode: 0o600 })
} catch (error) {
  report.failure = safe(error instanceof Error ? error.message : 'evaluation_failed')
  process.exitCode = 1
} finally {
  if (currentTaskId) await cancelAiTask(db, currentTaskId).catch(() => {})
  await Promise.allSettled(captures)
  report.usage = (await db.query('SELECT generation_type,model,prompt_tokens,completion_tokens,reasoning_tokens,token_usage_reported,cost_millicents,cost_currency,cost_reported FROM ai_usage WHERE user_id=ANY($1::text[]) ORDER BY created_at,id', [actors.map(actor => actor.id)])).rows
  await persist()
  globalThis.fetch = realFetch
  console.error = realError
  await getPool()?.end()
}
console.log(JSON.stringify({ output, providerRequests: report.providerRequests, checks: report.checks, failure: report.failure, semanticReview: report.semanticReview }))
