/** Bounded follow-up using preserved failed samples. Dry run by default; only a new PGlite clone is written. */
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Item = Record<string, any>
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const sceneOnly = args.includes('--scene-only')
const plan = { maxCalls: sceneOnly ? 1 : 6, maxMinutes: 20, requestSeconds: 180, applicationDatabaseWrites: 0,
  lengthAcceptance: { target: 500, minimum: 400, maximum: 650, metric: 'stored body Unicode characters excluding whitespace, including punctuation' },
  cases: sceneOnly ? ['preserved-spliced-quote-offline', 'real-scene-transition'] : ['preserved-spliced-quote-offline', 'original-draft-review', 'ordinary-500', 'real-scene-transition', 'shorten-original-draft', 'contradiction-review'],
  manualAcceptance: ['public daytime setting with coherent transition and preserved facts', 'no replay of ended events', 'shortening retains known facts'],
  noCherryPicking: 'Each live case runs once; unsuccessful outputs and response metadata remain recorded.' }
if (!args.includes('--live')) { console.log(JSON.stringify({ mode: 'plan', ...plan })); process.exit(0) }
if (!option('--output')) throw new Error('Use --live --output <new .tmp directory>')
const output = path.resolve(root, option('--output')!)
const relative = path.relative(path.join(root, '.tmp'), output)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a new .tmp child')
const prior = path.join(root, '.tmp/writing-analysis-live-2026-11-10')
const followup = path.join(root, '.tmp/writing-analysis-followup-2026-11-10')
const { loadConfig } = await import('../src/config')
const config = loadConfig(), provider = config.aiText
if (!provider.apiKey || !provider.baseUrl) throw new Error('Configured text provider required')
process.env.DATABASE_URL = 'postgres://isolated/unused'
await mkdir(output)
await cp(path.join(prior, 'database'), path.join(output, 'database'), { recursive: true, errorOnExist: true, force: false })
const { createTestDb } = await import('../src/test/db')
const { setDbForTests } = await import('../src/db/pool')
const { createSession } = await import('../src/services/sessions')
const { generationContentRevision } = await import('../src/services/ai/generations')
const { parseReview } = await import('../src/services/ai/writing-review')
const { chatEndpoint } = await import('../src/services/ai/client')
const { readSse } = await import('../../shared/sse')
const t = await createTestDb(path.join(output, 'database'))
setDbForTests(t.db)
const { app } = await import('../src/app')
const user = (await t.db.query<Item>('SELECT id FROM users LIMIT 1')).rows[0]!.id
const token = await createSession(t.db, user, 'isolated-quality-review', config.sessionHashSalt)
const endpoint = chatEndpoint(provider.baseUrl), origin = new URL(endpoint).origin
const hash = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
const beforeSources = hash((await t.db.query('SELECT id,content FROM chapters ORDER BY id')).rows)
const beforeReports = hash((await t.db.query('SELECT * FROM novel_analysis_reports ORDER BY id')).rows)
const beforeSettings = hash((await t.db.query("SELECT * FROM app_settings WHERE key='ai_settings'")).rows)
let calls = 0, stage = 'offline-replay'
const started = Date.now(), records: Item[] = [], captures: Promise<void>[] = [], checks: Item[] = [], api: Item[] = [], drafts: Item[] = []
const clean = (v: unknown) => JSON.stringify(v, (k, v) => /^(reasoning_content|reasoningContent)$/.test(k) ? undefined : v, 2).replaceAll(provider.apiKey, '[credential]')
const save = (name: string, value: unknown) => writeFile(path.join(output, name), clean(value) + '\n')
await save('plan.json', plan)
const sourceScript = await readFile(fileURLToPath(import.meta.url), 'utf8')
const sourceDiff = execFileSync('git', ['diff'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
await writeFile(path.join(output, 'runner.ts'), sourceScript)
await writeFile(path.join(output, 'source.patch'), sourceDiff)
const realFetch = globalThis.fetch, realError = console.error
console.error = () => console.log(JSON.stringify({ stage, diagnostic: 'application-error-omitted' }))
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== endpoint || init?.method !== 'POST') {
    const target = new URL(url)
    if (target.origin === origin && (!init?.method || init.method === 'GET') && ['/api/status', '/api/log/token'].includes(target.pathname))
      return realFetch(input, { ...init, redirect: 'error' })
    throw new Error('Unexpected outbound request blocked')
  }
  if (calls >= plan.maxCalls || Date.now() - started > plan.maxMinutes * 60000) throw new Error('Evaluation budget reached')
  const item: Item = { stage, call: ++calls, request: JSON.parse(String(init.body)), startedAt: new Date().toISOString() }
  records.push(item)
  await save('requests.json', records)
  console.log(JSON.stringify({ stage, call: item.call, state: 'started' }))
  try {
    const response = await realFetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(plan.requestSeconds * 1000)]) })
    item.headersAfterMs = Date.now() - Date.parse(item.startedAt)
    const clone = response.clone()
    captures.push((async () => {
      const result: Item = { status: response.status, text: '', finishReason: '' }
      const collect = (d: Item) => {
        result.text += d.choices?.[0]?.delta?.content || d.choices?.[0]?.message?.content || ''
        result.finishReason = d.choices?.[0]?.finish_reason || result.finishReason
        result.usage = d.usage || result.usage
      }
      try {
        if (clone.headers.get('content-type')?.includes('event-stream') && clone.body) await readSse(clone.body, value => { if (value.trim() !== '[DONE]') collect(JSON.parse(value)) })
        else if (response.ok) collect(await clone.json() as Item)
      } catch { result.incomplete = true }
      item.response = result
      item.durationMs = Date.now() - Date.parse(item.startedAt)
      await save('requests.json', records)
      console.log(JSON.stringify({ stage: item.stage, call: item.call, state: 'received', finish: result.finishReason, characters: result.text.length, incomplete: result.incomplete }))
    })())
    return response
  } catch (error) { item.error = error instanceof Error ? error.name : 'transport'; await save('requests.json', records); throw error }
}
async function request(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await app.request(route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json() as Item
  api.push({ stage, route, method, input: body, status: response.status, data })
  await save('api.json', api)
  return { status: response.status, data }
}
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed: !!passed, detail })
  console.log(JSON.stringify(checks.at(-1)))
}
async function waitTask(id: string) {
  if (!id) throw new Error('Missing task receipt')
  const deadline = Date.now() + 5 * 60000
  while (Date.now() < deadline) {
    const row = (await t.db.query<Item>('SELECT * FROM ai_tasks WHERE id=$1', [id])).rows[0]
    if (row && !['queued', 'running'].includes(row.status)) return row
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  await t.db.query("UPDATE ai_tasks SET status='cancelled' WHERE id=$1", [id])
  throw new Error('Task deadline reached')
}
const bodyCount = (text: string) => Array.from(text.replace(/\s/gu, '')).length
async function continuation(label: string, body: Item) {
  stage = label
  const selected = await request(`/api/ai/writing/analysis-references/${body.novelId}?afterChapterId=${encodeURIComponent(body.afterChapterId)}`)
  const receipt = await request('/api/ai/writing/continue', { ...body, analysisReferences: selected.data.defaults, operationId: randomUUID(), targetWords: 500 })
  check(stage + ':accepted', receipt.status === 202, receipt.status)
  if (receipt.status !== 202) return
  const task = await waitTask(receipt.data.taskId)
  check(stage + ':completed', task.status === 'completed', task.error)
  if (task.status !== 'completed') return
  const row = (await t.db.query<Item>("SELECT * FROM ai_generations WHERE params_json::jsonb->>'taskId'=$1 ORDER BY created_at", [task.id])).rows[0]!
  drafts.push({ stage, ...row })
  await save('drafts.json', drafts)
  const length = bodyCount(row.result)
  check(stage + ':length', length >= plan.lengthAcceptance.minimum && length <= plan.lengthAcceptance.maximum, length)
  check(stage + ':analysis-frozen', !!JSON.parse(row.params_json).continuationSnapshot.analysisReferences.length)
}
try {
  const oldCases = JSON.parse(await readFile(path.join(prior, 'cases.json'), 'utf8')) as Item[]
  const oldDrafts = JSON.parse(await readFile(path.join(prior, 'generations.json'), 'utf8')) as Item[]
  const oldResponses = JSON.parse(await readFile(path.join(followup, 'requests.json'), 'utf8')) as Item[]
  const replay = oldResponses.find(x => x.stage === 'review-repeat')!
  const material = JSON.parse(replay.request.messages.find((m: Item) => m.role === 'user').content)
  const parsed = parseReview(replay.response.text, material.draft, material.sources)
  check('replay:valid-eight-rejected-one', parsed.findings.length === 8 && parsed.rejectedFindings === 1 && parsed.completeness === 'partial')
  await save('replayed-review.json', parsed)
  const original = oldCases.find(c => c.stage === 'draft-review' && c.route?.endsWith('/review'))!
  const draftId = original.route.split('/')[5]
  const originalDraft = oldDrafts.find(d => d.id === draftId)!
  if (!sceneOnly) {
  stage = 'original-draft-review'
  const reviewed = await request(original.route, original.input)
  check(stage + ':complete', reviewed.status === 200 && reviewed.data.report?.completeness === 'complete', { status: reviewed.status, completeness: reviewed.data.report?.completeness, findings: reviewed.data.report?.findings?.length, rejected: reviewed.data.report?.rejectedFindings })
  const readBack = await request(original.route)
  check(stage + ':attempt-recorded', !!readBack.data.attempt?.stage)
  await continuation('ordinary-500', oldCases.find(c => c.stage === 'continuation' && c.input?.novelId)?.input)
  }
  await continuation('real-scene-transition', oldCases.find(c => c.stage === 'real-continuation' && c.input?.instruction)?.input)
  if (!sceneOnly) {
  stage = 'shorten-original-draft'
  const shortening = await request(`/api/ai/writing/drafts/${draftId}/rewrite`, { baseRevision: generationContentRevision(originalDraft.result), startUTF16: 0, endUTF16: originalDraft.result.length, selectedText: originalDraft.result, mode: 'shorten', instruction: '将整章正文精简至约500字（不计空白，包含标点）。保留关键事实、人物状态、因果与自然结尾，删除重复铺陈，不新增剧情。', clientRequestId: randomUUID() })
  check(stage + ':accepted', shortening.status === 202, shortening.status)
  if (shortening.status === 202) {
    const task = await waitTask(shortening.data.taskId)
    check(stage + ':completed', task.status === 'completed', task.error)
    await save('shortening-task.json', task)
    if (task.status === 'completed') {
      const result = JSON.parse(task.result), length = bodyCount(result.suggestion)
      check(stage + ':length', length >= 400 && length <= 650 && length < bodyCount(originalDraft.result), length)
    }
  }
  check('shorten:original-preserved', (await t.db.query<Item>('SELECT result FROM ai_generations WHERE id=$1', [draftId])).rows[0]?.result === originalDraft.result)
  stage = 'contradiction-review'
  const wrong = '铜牌从来没有交给郁禾，一直由迟夏保管。西棚水泵才是坏的，东棚运转正常。封筒早已打开，里面的内容大家都知道。'
  await request(`/api/ai/writing/drafts/${draftId}`, { result: wrong }, 'PUT')
  const negative = await request(original.route, { expectedRevision: generationContentRevision(wrong) })
  check(stage + ':complete', negative.status === 200 && negative.data.report?.completeness === 'complete', negative.status)
  const findings = negative.data.report?.findings || []
  check(stage + ':three-known-contradictions', ['铜牌', '水泵', '封筒'].every(term => findings.some((f: Item) => f.category === 'consistency' && f.draftQuote.includes(term))), findings.length)
  }
  check('sources:unchanged', beforeSources === hash((await t.db.query('SELECT id,content FROM chapters ORDER BY id')).rows))
  check('reports:unchanged', beforeReports === hash((await t.db.query('SELECT * FROM novel_analysis_reports ORDER BY id')).rows))
  check('settings:unchanged', beforeSettings === hash((await t.db.query("SELECT * FROM app_settings WHERE key='ai_settings'")).rows))
} catch (error) { check('runner:completed', false, error instanceof Error ? error.message.replaceAll(provider.apiKey, '[credential]') : 'unknown') }
finally {
  await Promise.allSettled(captures)
  const usage = (await t.db.query('SELECT generation_type,model,prompt_tokens,completion_tokens,token_usage_reported,cost_millicents,cost_reported,cost_currency FROM ai_usage WHERE created_at >= $1 ORDER BY created_at,id', [started])).rows
  await save('summary.json', { plan, calls, checks, usage, semanticReview: 'pending-manual-reading', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDiffHash: hash(sourceDiff), sourceScriptHash: hash(sourceScript), applicationDatabaseWrites: 0 })
  globalThis.fetch = realFetch; console.error = realError; setDbForTests(null); await t.close()
  process.exitCode = checks.some(c => !c.passed) ? 1 : 0
  console.log(JSON.stringify({ output, calls, failed: checks.filter(c => !c.passed).length }))
}
