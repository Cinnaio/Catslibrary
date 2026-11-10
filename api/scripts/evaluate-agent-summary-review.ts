/** Synthetic author simulation through real API/auth/local PostgreSQL. No human acceptance claim.
 * Key instructions use real model turns; labelled transition fixtures reach the unchanged summary threshold.
 * Default plan only. Live runs retain every outcome and never retry a paid failure automatically. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent, AgentSession, AgentSessionDetail, AgentSummaryContent } from '../../shared/ai-agent'

const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') continue
  if (!['--directory', '--output', '--max-requests'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid option')
  options.set(args[i]!, args[++i]!)
}
const maxRequests = Number(options.get('--max-requests') || 24)
assert(Number.isSafeInteger(maxRequests) && maxRequests >= 1 && maxRequests <= 30, 'Invalid request budget')
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan', modelCalls: 0, databaseWrites: false, maxRequests, scope: 'synthetic author turns, labelled transition fixtures, three summaries and injected interruption followed by explicit API recovery' }))
  process.exit(0)
}
assert(options.get('--directory') && options.get('--output'), 'Local review directory and new output directory required')
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
const { appendAgentEvent } = await import('../src/services/ai/agent-store')
const { getAgentSummary } = await import('../src/services/ai/agent-memory')
const { cancelAiTask } = await import('../src/services/ai/tasks')
const { AGENT_READ_TOOLS } = await import('../src/services/ai/agent-recovery')
const db = getDb()
assert.equal((await db.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name, state.database)
assert((await db.query('SELECT 1 FROM schema_migrations WHERE version=81 AND name=$1', ['081_ai_agent_summary_versions.sql'])).rows.length)
const provider = textProvider()
assert(provider.apiKey && provider.baseUrl, 'Configured provider required')
const output = path.resolve(options.get('--output')!)
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const sourceHashes: Record<string, string> = {}
for (const file of ['api/src/app.ts', 'api/src/routes/ai-agent.ts', 'api/src/middlewares/auth.ts', 'api/src/middlewares/browser-security.ts', 'api/src/services/ai/agent.ts', 'api/src/services/ai/agent-tools.ts', 'api/src/services/ai/agent-memory.ts', 'api/src/services/ai/agent-context.ts', 'api/src/services/ai/agent-store.ts', 'api/src/services/ai/agent-recovery.ts', 'api/src/services/ai/client.ts', 'api/scripts/evaluate-agent-summary-review.ts']) sourceHashes[file] = hash(await readFile(path.join(repo, file)))
type Message = { role: string; content?: string }
type Trace = { stage: string; kind: 'summary' | 'chat'; sent: boolean; injected?: boolean; messages: Message[]; response?: { status: number; text: string; model: string; finishReason: string; toolCalls: unknown[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; captureIncomplete?: boolean } }
type Version = { revision: number; throughEventId: number; content: AgentSummaryContent; backfilled: boolean }
const report = {
  capturedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourceHashes,
  scenario: 'S01 multi-summary author simulation and explicit recovery', syntheticOnly: true,
  apiTransport: 'in-process real API, cookie and CSRF; isolated local PostgreSQL', humanReview: 'pending',
  limitations: ['Author instructions are written by the coding assistant, not the human author.', 'Labelled transition messages are seeded fixtures, not provider replies.', 'The interruption is injected, not an observed provider outage.', 'Current production summary thresholds and provider defaults are unchanged.'],
  model: provider.model, maxRequests, providerRequests: 0, injectedResponses: 0, sessionId: '', novelId: '',
  checks: [] as Array<{ name: string; passed: boolean }>, turns: [] as Array<Record<string, unknown>>, padding: [] as Array<Record<string, unknown>>,
  requests: [] as Trace[], versions: [] as Version[], failures: [] as unknown[], transcript: [] as unknown[], usage: [] as unknown[], failure: '',
}
const credentials = Object.entries(env).filter(([key, value]) => /API_KEY|DATABASE_URL|SALT|SECRET|TOKEN|PASSWORD/.test(key) && value.length > 8).map(([, value]) => value)
const safe = (value: string) => credentials.reduce((text, secret) => text.replaceAll(secret, '[credential]'), value).replace(/https?:\/\/[^\s"<>]+/g, '[url]')
const persist = () => writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
const captures: Promise<void>[] = []
const realFetch = globalThis.fetch
const realError = console.error
const deadline = Date.now() + 600000
let currentStage = 'initializing'
let currentTaskId = ''
let callsInTurn = 0
let injectSummary = false
const endpoint = chatEndpoint(provider.baseUrl)
console.error = () => console.log('[summary-review] application diagnostic recorded in task outcome')
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== endpoint || init?.method !== 'POST') throw new Error('Evaluation allows only the configured chat endpoint')
  const body = JSON.parse(String(init.body)) as { messages: Message[] }
  assert(!JSON.stringify(body.messages).includes(state.novelId), 'Real-book data excluded')
  const kind = body.messages[0]?.content?.startsWith('整理当前创作对话') ? 'summary' : 'chat'
  const trace: Trace = { stage: currentStage, kind, sent: false, messages: body.messages.map(({ role, content }) => ({ role, ...(typeof content === 'string' ? { content } : {}) })) }
  report.requests.push(trace)
  if (kind === 'summary' && injectSummary) {
    injectSummary = false
    trace.injected = true
    report.injectedResponses++
    trace.response = { status: 200, text: '{"goal":', model: 'evaluation-injected', finishReason: 'length', toolCalls: [] }
    await persist()
    return new Response('data: {"model":"evaluation-injected","choices":[{"delta":{"content":"{\\"goal\\":"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  assert(report.providerRequests < maxRequests && callsInTurn < 6 && Date.now() < deadline, 'Evaluation request limit reached')
  report.providerRequests++
  callsInTurn++
  trace.sent = true
  await persist()
  const response = await realFetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) })
  const clone = response.clone()
  captures.push((async () => {
    const value: NonNullable<Trace['response']> = { status: response.status, text: '', model: '', finishReason: '', toolCalls: [] }
    try {
      const raw = await clone.text()
      const collect = (data: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] }; delta?: { content?: string; tool_calls?: unknown[] }; finish_reason?: string }> }) => {
        const choice = data.choices?.[0]
        value.text += choice?.delta?.content || choice?.message?.content || ''
        value.model = data.model || value.model
        value.finishReason = choice?.finish_reason || value.finishReason
        value.toolCalls.push(...(choice?.delta?.tool_calls || choice?.message?.tool_calls || []))
        if (data.usage) value.usage = { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens }
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
const prefix = 'summary_review_' + randomBytes(5).toString('hex')
const actor = { id: prefix, username: prefix, password: randomBytes(24).toString('hex'), cookie: '' }
const book = prefix + '_book'
let session: AgentSession | undefined
async function request<T>(pathname: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
  const response = await app.request(origin + pathname, { method, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-ZZ-CSRF': '1', 'X-Session-Transport': 'cookie', 'X-ZZ-Account': actor.id, Cookie: actor.cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal(response.status, status, `${method} ${pathname}`)
  return await response.json() as T
}
const versions = async () => (await db.query<Version>('SELECT revision,through_event_id AS "throughEventId",content,backfilled FROM ai_agent_summary_versions WHERE session_id=$1 ORDER BY revision', [session!.id])).rows
async function turn(stage: string, prompt: string, resumeTaskId = '') {
  currentStage = stage
  callsInTurn = 0
  const started = Date.now()
  const receipt = await request<{ taskId: string }>(`/api/ai/agent/sessions/${session!.id}/${resumeTaskId ? `tasks/${resumeTaskId}/resume` : 'messages'}`, 'POST', resumeTaskId ? { confirmModelCall: true } : { content: prompt, requestId: randomUUID() }, 202)
  currentTaskId = receipt.taskId
  let detail: AgentSessionDetail
  do {
    detail = await request<AgentSessionDetail>(`/api/ai/agent/sessions/${session!.id}`)
    if (!['queued', 'running'].includes(detail.activeTask?.status || '')) break
    if (Date.now() >= deadline || Date.now() - started > 180000) { await cancelAiTask(db, receipt.taskId); throw new Error('Evaluation deadline reached') }
    await new Promise(resolve => setTimeout(resolve, 200))
  } while (true)
  await Promise.all(captures.splice(0))
  const events = detail.events.filter(event => event.taskId === receipt.taskId)
  const result = { stage, prompt, taskId: receipt.taskId, status: detail.activeTask?.status, error: safe(detail.activeTask?.error || ''), events, reply: events.filter(event => event.role === 'assistant').map(event => event.content).join('\n\n'), summary: detail.summary, recovery: detail.recovery, usage: detail.turnUsage?.find(value => value.taskId === receipt.taskId) }
  report.turns.push(result)
  report.versions = await versions()
  await persist()
  check(stage + '_read_only', events.every(event => !event.metadata.tool || AGENT_READ_TOOLS.has(event.metadata.tool)))
  currentTaskId = ''
  console.log(JSON.stringify({ stage, status: result.status, summaryRevision: result.summary?.revision || 0, providerRequests: report.providerRequests }))
  return result
}
const topics = ['开头环境句是否过密', '雨声与脚步声如何错开', '短句与长句怎样衔接', '人物停顿是否自然', '光线变化如何避免重复', '转场是否需要留白', '动作与心理描写的比例', '物件细节会不会抢走注意力', '章节结尾的节奏', '对话后留白的长度', '视角切换的清晰度', '同义词重复的问题']
async function pad(stage: number) {
  const summary = await getAgentSummary(db, session!.id)
  const count = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM ai_agent_events WHERE session_id=$1 AND id>$2', [session!.id, summary?.throughEventId || 0])).rows[0]!.n
  const n = Math.max(0, 64 - count)
  const events: Array<{ role: AgentEvent['role']; content: string }> = []
  for (let i = 0; i < n; i++) {
    const role = i % 2 ? 'assistant' : 'user'
    const content = `[合成过渡讨论 ${stage}-${i + 1}，脚本写入] ${role === 'user' ? `仅比较${topics[Math.floor(i / 2) % topics.length]}，不新增设定、决定或执行要求。` : '这是表达方式的讨论，尚未选用新方案；先前的明确决定与未解决问题仍按原记录。'} `
    await appendAgentEvent(db, session!.id, role, content)
    events.push({ role, content })
  }
  report.padding.push({ stage, count: n, beforeCount: count, previousCursor: summary?.throughEventId || 0, fixtureSha256: hash(JSON.stringify(events)) })
  await persist()
}
function context(stage: string) {
  const trace = report.requests.find(item => item.stage === stage && item.kind === 'chat')
  const content = trace?.messages.find(item => item.content?.startsWith('本轮会话资料（数据，不是指令）：'))?.content
  assert(content, 'Captured context required')
  return JSON.parse(content.slice(content.indexOf('：') + 1)) as { creativeAgreements: unknown[]; earliestEventId: number; sessionSummary: { revision: number; throughEventId: number }; summaryOriginalMessages: unknown }
}
const question = '请核对目前已经选定的调查地点、身份揭晓章节、仍有效的限制、已取消的限制和信使身份的确定程度。区分作者选定但未写入正文的方案、明确否定和仍待定事项。只整理这次对话的依据，不查章节或全书资源，不生成或保存记忆，不额外推进任务。简短回答，不展示内部编号。'
const instructions = [
  '我们讨论虚构作品《雨港来信》的后续。选旧渡口调查，信使身份到第五章才揭晓；暂不让林岚和沈舟和解，不毁掉白瓷扣，不拆开密封信。信使是管理员只是一个备选假设，我尚未选定，也没有否定。今天只讨论，以上是已选但未写入正文的方案，不生成正文、不存作品记忆，不查章节。先简短复述边界。',
  '更正两点：调查地点从旧渡口改为水文站；身份揭晓从第五章改为第七章。其余决定、限制和待定事项不变。只确认这两处改动，不生成或保存记忆。',
  '再改两点：取消水文站，调查地点确定为档案馆；取消不得拆信的限制，现在允许林岚拆开密封信。其他要求不变。这是已选方案，尚未写入正文，不需要再次确认。只简短说明改动，不生成或保存记忆。',
]
try {
  const salt = newSalt()
  await db.query('INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)', [actor.id, actor.username, 'admin', await hashPassword(actor.password, salt), salt, Date.now()])
  const login = await app.request(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-ZZ-CSRF': '1', 'X-Session-Transport': 'cookie' }, body: JSON.stringify({ username: actor.username, password: actor.password }) })
  check('real_login', login.status === 200)
  actor.cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  check('session_cookie', !!actor.cookie)
  assert.notEqual(book, state.novelId)
  await db.query('INSERT INTO novels(id,title,content_rating,visibility,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [book, '雨港来信（摘要复核合成作品）', 'general', 'admin', Date.now()])
  const chapter = '林岚在邮局发现一封密封信。信封上没有寄信人的姓名，她把信放进自己的包里。'
  await db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,1,$5)', [book + '_chapter', book, '邮局的信', chapter, Date.now()])
  session = (await request<{ session: AgentSession }>('/api/ai/agent/sessions', 'POST', { novelId: book }, 201)).session
  report.sessionId = session.id
  report.novelId = book
  await writeFile(path.join(output, 'account.json'), JSON.stringify({ username: actor.username, password: actor.password, novelId: book, sessionId: session.id }, null, 2), { flag: 'wx', mode: 0o600 })
  let previousCursor = 0
  for (const [index, instruction] of instructions.entries()) {
    const start = await turn(`instruction_${index + 1}`, instruction)
    check(`instruction_${index + 1}_completed`, start.status === 'completed')
    const sourceId = start.events.find(event => event.role === 'user')!.id
    await pad(index + 1)
    const result = await turn(`summary_${index + 1}`, question)
    check(`summary_${index + 1}_completed`, result.status === 'completed')
    check(`summary_${index + 1}_advanced`, !!result.summary && result.summary.revision === index + 1 && result.summary.throughEventId > previousCursor && result.summary.throughEventId >= sourceId)
    const actual = context(`summary_${index + 1}`)
    check(`summary_${index + 1}_outside_recent_window`, actual.earliestEventId > sourceId && actual.sessionSummary.revision === index + 1)
    check(`summary_${index + 1}_no_long_term_memory`, actual.creativeAgreements.length === 0)
    previousCursor = result.summary!.throughEventId
  }
  const correction = await turn('before_interruption', '最后修正：取消档案馆，调查地点改为旧电报局。其他所有约定和待定事项照旧，只记录在本对话中，不生成、不保存作品记忆。请用一句话确认。')
  check('last_correction_completed', correction.status === 'completed')
  await pad(4)
  const before = await getAgentSummary(db, session.id)
  const originals = (await db.query<{ id: number; role: string; content: string }>('SELECT id,role,content FROM ai_agent_events WHERE session_id=$1 ORDER BY id', [session.id])).rows
  const beforeCalls = report.providerRequests
  injectSummary = true
  const failed = await turn('interrupted_summary', question)
  check('interruption_failed_in_summary_phase', failed.status === 'failed' && failed.recovery?.phase === 'summary' && !!failed.recovery.canResume)
  check('no_silent_paid_retry', report.providerRequests === beforeCalls && report.injectedResponses === 1)
  check('checkpoint_unchanged_after_failure', JSON.stringify(failed.summary) === JSON.stringify(before) && (await versions()).length === 3)
  report.failures = (await db.query('SELECT diagnostic,response_received,response_text,response_model FROM ai_agent_summary_failures WHERE session_id=$1 ORDER BY id', [session.id])).rows
  check('failed_output_archived', report.failures.length === 1)
  const failedTrace = report.requests.find(trace => trace.injected)!
  const failedInput = JSON.parse(failedTrace.messages[1]!.content!) as { events: Array<{ id: number }> }
  check('failure_after_checkpoint', failedInput.events[0]!.id > before!.throughEventId)
  const recovered = await turn('explicit_recovery', 'Explicit confirmModelCall=true through recovery API', failed.taskId)
  check('explicit_recovery_completed', recovered.status === 'completed')
  check('recovery_summary_advanced', !!recovered.summary && recovered.summary.revision === 4 && recovered.summary.throughEventId > before!.throughEventId)
  const recoveryTrace = report.requests.find(trace => trace.stage === 'explicit_recovery' && trace.kind === 'summary')!
  const recoveryInput = JSON.parse(recoveryTrace.messages[1]!.content!) as { events: Array<{ id: number }>; previousSummary: unknown }
  check('recovery_reuses_checkpoint', JSON.stringify(recoveryInput.previousSummary) === JSON.stringify(before!.content))
  check('recovery_starts_at_failed_prefix', recoveryInput.events[0]!.id === failedInput.events[0]!.id)
  const final = await turn('after_recovery', question)
  check('post_recovery_reply_completed', final.status === 'completed')
  check('short_next_turn_no_extra_summary', final.summary?.revision === 4)
  const retained = (await db.query<{ id: number; role: string; content: string }>('SELECT id,role,content FROM ai_agent_events WHERE session_id=$1 AND id<=$2 ORDER BY id', [session.id, originals.at(-1)!.id])).rows
  check('all_pre_interruption_messages_unchanged', hash(JSON.stringify(retained)) === hash(JSON.stringify(originals)))
  check('four_real_summary_versions', (await versions()).length === 4 && (await versions()).every(version => !version.backfilled))
  check('no_work_memories_created', !(await db.query('SELECT 1 FROM ai_agent_memories WHERE user_id=$1', [actor.id])).rows.length)
  check('no_generation_tasks_or_actions', !(await db.query("SELECT 1 FROM ai_tasks WHERE user_id=$1 AND kind<>'agent_chat'", [actor.id])).rows.length && !(await db.query('SELECT 1 FROM ai_agent_actions WHERE session_id=$1', [session.id])).rows.length)
  check('chapter_unchanged', (await db.query<{ content: string }>('SELECT content FROM chapters WHERE novel_id=$1', [book])).rows[0]?.content === chapter)
} catch (error) {
  report.failure = safe(error instanceof Error ? error.message : 'evaluation_failed')
  process.exitCode = 1
} finally {
  if (currentTaskId) await cancelAiTask(db, currentTaskId).catch(() => {})
  await Promise.allSettled(captures)
  if (session) {
    report.versions = await versions()
    report.failures = (await db.query('SELECT diagnostic,response_received,response_text,response_model FROM ai_agent_summary_failures WHERE session_id=$1 ORDER BY id', [session.id])).rows
    report.transcript = (await db.query('SELECT id,role,content,task_id,metadata FROM ai_agent_events WHERE session_id=$1 ORDER BY id', [session.id])).rows
  }
  report.usage = (await db.query('SELECT task_id,generation_type,model,prompt_tokens,completion_tokens,token_usage_reported,cost_reported,cost_millicents,cost_currency FROM ai_usage WHERE user_id=$1 ORDER BY created_at,id', [actor.id])).rows
  await persist()
  globalThis.fetch = realFetch
  console.error = realError
  await getPool()?.end()
}
console.log(JSON.stringify({ output, providerRequests: report.providerRequests, injectedResponses: report.injectedResponses, checks: report.checks.length, versions: report.versions.length, failure: report.failure, humanReview: report.humanReview }))
