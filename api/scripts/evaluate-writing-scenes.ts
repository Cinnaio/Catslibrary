/** Three paired scene cases through the real API. Dry run by default; writes only a new isolated clone. */
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Item = Record<string, any>
type Variant = 'baseline' | 'candidate'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const baselineCommit = '33de75ec'
// Evaluated once and rejected; this candidate remains in the harness, not the application prompt.
const candidateRule = '落笔前按作者本轮要求和本章大纲核对时间、地点及本章要实际发生的事件。作者明确指定本章主要场景时，尽早在该场景展开核心情节；允许直接从指定时间、地点起笔，用简短回顾交代必要过渡。要求在该场景发生的对话、行动或结果必须在正文中实际展开，不能只写准备、赶路，或以抵达该地点结束来代替完成要求。作者明确安排的途中事件、多场景顺序、阶段性结尾及后续章节边界照常保留，不强行跳过；没有指定转场时自然承接前文，不另造地点或时间跳跃。延续既有事实和人物状态，不重复已经结束的事件。只输出本次要求的正文，不输出检查过程。'
const cases = [
  {
    id: 'same-scene', sourceStage: 'continuation', variants: ['baseline', 'candidate'] as Variant[],
    instruction: '紧接上一章，在东棚水泵旁展开本章对话。梅岑向梅涔说明坏的是东棚滤芯，梅涔明确承认自己弄错了，并当面说清西棚水泵正常；这次对话完成澄清，不再次把误解留作结尾。新滤芯仍未安装，铜牌仍由郁禾保管，封筒保持关闭。不转场、不跳到次日，只写一章普通工作日常。',
    rubric: ['主要对话始终在东棚水泵旁，无新转场或跨日', '梅涔当面承认误解并说清西棚正常，澄清实际完成', '东棚滤芯尚未安装、铜牌归属及封筒状态不被改写'],
  },
  {
    id: 'real-public-scene', sourceStage: 'real-continuation', variants: ['candidate', 'baseline'] as Variant[],
    rubric: ['沿用先前失败用例的原始作者要求，不增写具体地点或开场', '白天公共场所承载主要日常对话，不能只在结尾抵达', '合理延续人物与事实，不重演已结束事件，不含露骨或亲密行为'],
  },
  {
    id: 'next-day', sourceStage: 'continuation', variants: ['baseline', 'candidate'] as Variant[],
    instruction: '本章从次日上午温室外的公共公交站起笔。迟夏和郁禾已在那里等车，以日常对话核对今天的分工：迟夏继续清点未完成的花盆，郁禾保管铜牌并负责工具登记；双方在站台上确认各自职责，最后上车结束。省略早餐和前往车站的路程，不回温室重演昨天的对话。东棚滤芯仍未安装，西棚水泵正常，封筒保持关闭。只写一章。',
    rubric: ['开场已是次日上午公交站，省略早餐与去车站的过程', '两人在站台实际确认分工，随后上车收尾，保留作者指定顺序', '未完成工作、物品归属及设备状态延续，不重复昨日事件'],
  },
]
const plan = {
  baselineCommit, maxCalls: 6, maxMinutes: 20, requestSeconds: 180, applicationDatabaseWrites: 0,
  comparison: 'Same API input and model configuration for each pair; candidate replaces only the final scene rule at the provider transport boundary. The evaluated candidate was not retained in the application.',
  length: 'Observed only; excluded from acceptance by user instruction.',
  semanticAcceptance: 'Manual review against the frozen per-case rubric; transport success is not a content pass.',
  noCherryPicking: 'One provider call per variant per case, all outputs and failures retained; no model judge or regeneration.',
  cases,
}
const hash = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
if (option('--verify-records')) {
  const directory = path.resolve(root, option('--verify-records')!)
  const rules = JSON.parse(await readFile(path.join(directory, 'rules.json'), 'utf8')) as Item
  const records = JSON.parse(await readFile(path.join(directory, 'requests.json'), 'utf8')) as Item[]
  if (rules.candidateRule !== candidateRule || rules.baselineCommit !== baselineCommit) throw new Error('Saved comparison rules differ')
  for (const sample of cases) {
    const pair = sample.variants.map(v => {
      const matching = records.filter(r => r.stage === `${sample.id}:${v}`)
      if (matching.length !== 1) throw new Error(`Expected exactly one call for ${sample.id}:${v}`)
      const wire = structuredClone(matching[0]!.request)
      const expected = v === 'baseline' ? rules.baselineRule : rules.candidateRule
      let occurrences = 0
      for (const message of wire.messages) {
        if (typeof message.content !== 'string') continue
        occurrences += message.content.split(expected).length - 1
        message.content = message.content.replace(expected, '[SCENE_RULE]')
      }
      if (occurrences !== 1) throw new Error(`Invalid scene rule for ${sample.id}:${v}`)
      return hash(wire)
    })
    if (pair[0] !== pair[1]) throw new Error(`Pair differs beyond scene rule: ${sample.id}`)
  }
  if (records.length !== plan.maxCalls) throw new Error('Unexpected model call count')
  console.log(JSON.stringify({ mode: 'verify-records', pairs: cases.length, onlySceneRuleDiffers: true, semanticAcceptance: 'not asserted' }))
  process.exit(0)
}
if (!args.includes('--live')) { console.log(JSON.stringify({ mode: 'plan', ...plan }, null, 2)); process.exit(0) }
if (!option('--output')) throw new Error('Use --live --output <new .tmp directory>')
const output = path.resolve(root, option('--output')!)
const relative = path.relative(path.join(root, '.tmp'), output)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a new .tmp child')
const prior = path.join(root, '.tmp/writing-analysis-live-2026-11-10')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const oldCompiler = execFileSync('git', ['show', `${baselineCommit}:api/src/services/ai/writing-prompt.ts`], { cwd: root, encoding: 'utf8' })
const baselineRule = oldCompiler.match(/^\s+\? '(落笔前核对[^'\r\n]+)'$/m)?.[1]
if (!baselineRule || baselineRule === candidateRule) throw new Error('Distinct baseline scene rule required')
const { loadConfig } = await import('../src/config')
const config = loadConfig(), provider = config.aiText
if (!provider.apiKey || !provider.baseUrl) throw new Error('Configured text provider required')
process.env.DATABASE_URL = 'postgres://isolated/unused'
await mkdir(output)
await cp(path.join(prior, 'database'), path.join(output, 'database'), { recursive: true, errorOnExist: true, force: false })
const { createTestDb } = await import('../src/test/db')
const { setDbForTests } = await import('../src/db/pool')
const { createSession } = await import('../src/services/sessions')
const { chatEndpoint } = await import('../src/services/ai/client')
const { readSse } = await import('../../shared/sse')
const t = await createTestDb(path.join(output, 'database'))
setDbForTests(t.db)
const { app } = await import('../src/app')
const user = (await t.db.query<Item>('SELECT id FROM users LIMIT 1')).rows[0]!.id
const token = await createSession(t.db, user, 'isolated-scene-comparison', config.sessionHashSalt)
const endpoint = chatEndpoint(provider.baseUrl), origin = new URL(endpoint).origin
const protectedState = async () => ({
  sources: hash((await t.db.query('SELECT id,content FROM chapters ORDER BY id')).rows),
  reports: hash((await t.db.query('SELECT * FROM novel_analysis_reports ORDER BY id')).rows),
  settings: hash((await t.db.query("SELECT * FROM app_settings WHERE key='ai_settings'")).rows),
})
const before = await protectedState()
let calls = 0, stage = 'setup', variant: Variant = 'baseline'
const started = Date.now(), records: Item[] = [], captures: Promise<void>[] = [], checks: Item[] = [], api: Item[] = [], drafts: Item[] = []
const clean = (v: unknown) => JSON.stringify(v, (k, v) => /^(reasoning_content|reasoningContent)$/.test(k) ? undefined : v, 2).replaceAll(provider.apiKey, '[credential]')
let writes = Promise.resolve()
const save = (name: string, value: unknown) => {
  const text = clean(value) + '\n'
  writes = writes.then(() => writeFile(path.join(output, name), text))
  return writes
}
const sourceScript = await readFile(fileURLToPath(import.meta.url), 'utf8')
const sourceDiff = execFileSync('git', ['diff', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const compilerSource = await readFile(path.join(root, 'api/src/services/ai/writing-prompt.ts'), 'utf8')
await save('plan.json', plan)
await save('rules.json', { baselineCommit, baselineRule, candidateRule })
await writeFile(path.join(output, 'runner.ts'), sourceScript)
await writeFile(path.join(output, 'source.patch'), sourceDiff)
await writeFile(path.join(output, 'writing-prompt.ts'), compilerSource)
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
  if (calls >= plan.maxCalls || Date.now() - started > plan.maxMinutes * 60000 || records.some(r => r.stage === stage))
    throw new Error('Evaluation budget reached; automatic provider replay blocked')
  const assembled = JSON.parse(String(init.body)) as Item
  const wire = structuredClone(assembled)
  const matches = wire.messages.filter((m: Item) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(baselineRule))
  if (matches.length !== 1 || matches[0].content.split(baselineRule).length !== 2) throw new Error('Current scene rule has drifted from the comparison baseline')
  if (variant === 'candidate') matches[0].content = matches[0].content.replace(baselineRule, candidateRule)
  const item: Item = { stage, variant, call: ++calls, request: wire, normalizedRequestHash: hash(assembled), startedAt: new Date().toISOString() }
  records.push(item)
  await save('requests.json', records)
  console.log(JSON.stringify({ stage, call: item.call, state: 'started' }))
  try {
    const response = await realFetch(input, { ...init, body: JSON.stringify(wire), redirect: 'error', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(plan.requestSeconds * 1000)]) })
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
      console.log(JSON.stringify({ stage: item.stage, state: 'received', finish: result.finishReason, characters: result.text.length, incomplete: !!result.incomplete }))
    })())
    return response
  } catch (error) {
    item.error = error instanceof Error ? error.name : 'transport'
    await save('requests.json', records)
    throw error
  }
}
async function request(route: string, body?: unknown) {
  const response = await app.request(route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json() as Item
  api.push({ stage, route, input: body, status: response.status, data })
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
try {
  const oldCases = JSON.parse(await readFile(path.join(prior, 'cases.json'), 'utf8')) as Item[]
  const frozenCases = []
  for (const sample of cases) {
    const original = oldCases.find(c => c.stage === sample.sourceStage && c.input?.instruction)?.input
    if (!original) throw new Error(`Missing preserved case: ${sample.sourceStage}`)
    const selected = await request(`/api/ai/writing/analysis-references/${original.novelId}?afterChapterId=${encodeURIComponent(original.afterChapterId)}`)
    if (selected.status !== 200 || !selected.data.defaults?.length) throw new Error('Missing analysis references')
    const body: Item = { ...original, analysisReferences: selected.data.defaults, chapterCount: 1 }
    delete body.operationId
    if (sample.instruction) { body.instruction = sample.instruction; delete body.outline }
    frozenCases.push({ ...sample, body })
  }
  await save('frozen-cases.json', frozenCases)
  for (const sample of frozenCases) {
    for (const requestedVariant of sample.variants) {
      variant = requestedVariant
      stage = `${sample.id}:${variant}`
      const receipt = await request('/api/ai/writing/continue', { ...sample.body, operationId: randomUUID() })
      check(stage + ':accepted', receipt.status === 202, receipt.status)
      if (receipt.status !== 202) continue
      const task = await waitTask(receipt.data.taskId)
      check(stage + ':completed', task.status === 'completed', task.error)
      if (task.status !== 'completed') continue
      const row = (await t.db.query<Item>("SELECT * FROM ai_generations WHERE params_json::jsonb->>'taskId'=$1 ORDER BY created_at", [task.id])).rows[0]
      check(stage + ':draft', !!row?.result)
      if (!row) continue
      drafts.push({ stage, variant, bodyCharacters: Array.from(row.result.replace(/\s/gu, '')).length, ...row })
      await save('drafts.json', drafts)
      check(stage + ':analysis-frozen', !!JSON.parse(row.params_json).continuationSnapshot.analysisReferences.length)
    }
    const pair = records.filter(r => r.stage.startsWith(sample.id + ':'))
    check(sample.id + ':only-rule-differs', pair.length === 2 && pair[0]?.normalizedRequestHash === pair[1]?.normalizedRequestHash)
  }
  check('sources-reports-settings:unchanged', hash(before) === hash(await protectedState()))
} catch (error) {
  check('runner:completed', false, error instanceof Error ? error.message.replaceAll(provider.apiKey, '[credential]') : 'unknown')
} finally {
  const captureResults = await Promise.allSettled(captures)
  check('response-captures:complete', captureResults.every(r => r.status === 'fulfilled'))
  const usage = (await t.db.query('SELECT generation_type,model,prompt_tokens,completion_tokens,token_usage_reported,cost_millicents,cost_reported,cost_currency FROM ai_usage WHERE created_at >= $1 ORDER BY created_at,id', [started])).rows
  await save('summary.json', { plan, calls, checks, usage, semanticReview: 'pending-manual-reading', sourceCommit, sourceDiffHash: hash(sourceDiff), sourceScriptHash: hash(sourceScript), compilerHash: hash(compilerSource), applicationDatabaseWrites: 0 })
  globalThis.fetch = realFetch; console.error = realError; setDbForTests(null); await t.close()
  process.exitCode = checks.some(c => !c.passed) ? 1 : 0
  console.log(JSON.stringify({ output, calls, failed: checks.filter(c => !c.passed).length, semanticReview: 'pending-manual-reading' }))
}
