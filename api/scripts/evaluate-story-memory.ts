/** Ten-chapter, real-model evaluation in an isolated PGlite database.
 * npx tsx --tsconfig api/tsconfig.json api/scripts/evaluate-story-memory.ts --live
 * No --live: validate/print the fixture only. No production DB is opened.
 * --state-dir=... --resume explicitly retries from the last valid chapter.
 * Responses are retained only for this synthetic fixture; never headers/keys.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createTestDb } from '../src/test/db'
import { AiError, chatEndpoint, isTextAiConfigured, textProvider } from '../src/services/ai/client'
import { saveAiSettings } from '../src/services/ai/settings'
import { extractPlotState } from '../src/services/ai/plot-state'
import { getMemoryAttempt } from '../src/services/ai/story-memory'
import { ledgerAtAnchor } from '../src/services/ai/story-ledger-store'
import { factLine, LEDGER_PROMPT_VERSION, relevantLedger, workingFacts } from '../src/services/ai/story-ledger'
import { stateIdentity } from '../src/services/ai/story-ledger-state'
import { upstreamUsage } from '../src/services/ai/upstream-usage'

const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const fixturePath = option('fixture') ? resolve(option('fixture')!) : new URL('./fixtures/story-memory-evaluation.json', import.meta.url)
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Array<{
  title: string
  text: string
  expectations: string[]
}>
if (fixture.length !== 10 || fixture.some((chapter) => !chapter.title || !chapter.text || !chapter.expectations.length)) throw new Error('评估样本无效')
if (!process.argv.includes('--live')) {
  console.log(
    JSON.stringify({
      mode: 'fixture-only',
      chapters: fixture.length,
      characters: fixture.reduce((n, c) => n + c.text.length, 0),
      checkpoints: fixture.reduce((n, c) => n + c.expectations.length, 0),
    }),
  )
  process.exit(0)
}
if (!isTextAiConfigured()) throw new Error('尚未配置文本模型')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const stateDir = resolve(option('state-dir') || `.tmp/story-memory-evaluation-${runId}`)
const output = resolve(option('output') || `${stateDir}/report.json`)
const frozen = process.argv.includes('--frozen')
const configuration = {
  storyMemoryEngine: 'incremental' as const,
  storyMemoryAutoUpdate: false,
  storyMemoryStreamEnabled: false,
  storyMemoryChapterMaxTokens: 16000,
  storyMemoryTimeoutSeconds: 300,
  storyMemoryReasoningMode: 'disabled' as const,
}
const policy = { maxChapterAttempts: 3, maxFailedAttempts: 5, maxRequests: 40, automaticSemanticRetries: false }
const collectSources = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? collectSources(resolve(directory, entry.name)) :
    entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [resolve(directory, entry.name)] : []))).flat()
}
const sourceFiles = frozen
  ? [...await collectSources(resolve('api/src')), ...await collectSources(resolve('shared')), resolve('api/scripts/evaluate-story-memory.ts'), resolve('package-lock.json')].sort()
  : ['story-ledger.ts', 'story-ledger-integrity.ts', 'story-ledger-state.ts', 'story-ledger-goals.ts', 'story-ledger-names.ts', 'story-ledger-engine.ts'].map((file) => resolve('api/src/services/ai', file))
const hashImplementation = async () => {
  const hash = createHash('sha256')
  for (const file of sourceFiles) hash.update(await readFile(file))
  return hash.digest('hex')
}
const implementationHash = await hashImplementation()
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const providerFingerprint = createHash('sha256').update(textProvider().baseUrl).digest('hex')
const manifest = {
  fixtureHash: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
  model: textProvider().model,
  ledgerPromptVersion: LEDGER_PROMPT_VERSION,
  ...(frozen ? { frozen: true, implementationHash, sourceCommit, configuration, policy, providerFingerprint } : {}),
}
const optionalJson = async (file: string) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
const previous = await optionalJson(resolve(stateDir, 'manifest.json'))
if (previous && (!process.argv.includes('--resume') || JSON.stringify(previous) !== JSON.stringify(manifest)))
  throw new Error('已有评估目录；恢复要求样本、模型和规则一致，冻结模式还要求提交、实现与配置完全一致')
const steps: Array<Record<string, unknown>> = (await optionalJson(resolve(stateDir, 'steps.json'))) || []
const responses: Array<Record<string, unknown>> = (await optionalJson(resolve(stateDir, 'responses.json'))) || []
const requestLog: Array<{ chapter: number; phase: 'extract' | 'review'; status: string }> = (await optionalJson(resolve(stateDir, 'request-log.json'))) || []
if (frozen) {
  const failed = steps.filter((step) => step.status === 'failed')
  if (failed.length >= policy.maxFailedAttempts || failed.some((step) => !steps.some((other) => other.chapter === step.chapter && other.status === 'passed') && steps.filter((other) => other.chapter === step.chapter).length >= policy.maxChapterAttempts))
    throw new Error('冻结评估达到预先约定的人工重试上限，保留结果并停止')
  if (requestLog.length >= policy.maxRequests) throw new Error('冻结评估达到预先约定的总请求上限，保留结果并停止')
}
await mkdir(stateDir, { recursive: true })
await mkdir(dirname(output), { recursive: true })
await writeFile(resolve(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
const t = await createTestDb(resolve(stateDir, 'pgdata'))
const novelId = 'synthetic-story-evaluation'
let chapter = 0
let requests = 0
let result = 'running'
const originalFetch = globalThis.fetch
const originalInfo = console.info
const endpoint = chatEndpoint(textProvider().baseUrl)
// A standalone-process observer, not a production client change. Forward every
// request unchanged and capture only synthetic model text, never auth headers.
globalThis.fetch = async (input, init) => {
  const observed = String(input) === endpoint && init?.method === 'POST'
  if (observed && requestLog.length >= policy.maxRequests) throw new Error('评估达到跨恢复累计 40 次请求上限')
  if (observed && frozen && (await hashImplementation() !== implementationHash || createHash('sha256').update(textProvider().baseUrl).digest('hex') !== providerFingerprint || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sourceCommit))
    throw new Error('冻结评估的实现或供应商发生变化，已停止请求')
  const request = observed && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
  const context = request?.messages?.[1]?.content ? JSON.parse(request.messages[1].content) : undefined
  const phase = context?.draft ? 'review' as const : 'extract' as const
  const entry = { chapter, phase, status: 'started' }
  if (observed) {
    requests++
    requestLog.push(entry)
    // Reserve the budget before transmission, including interrupted requests.
    await writeFile(resolve(stateDir, 'request-log.json'), JSON.stringify(requestLog, null, 2))
  }
  let response: Response
  try { response = await originalFetch(input, init) }
  catch (error) {
    if (observed) {
      entry.status = 'transport-failed'
      await writeFile(resolve(stateDir, 'request-log.json'), JSON.stringify(requestLog, null, 2))
    }
    throw error
  }
  if (observed) {
    entry.status = String(response.status)
    await writeFile(resolve(stateDir, 'request-log.json'), JSON.stringify(requestLog, null, 2))
    let content: string | null = null
    let reportedUsage: ReturnType<typeof upstreamUsage> | undefined
    let returnedModel: string | undefined
    if (response.ok) {
      try {
        const body = (await response.clone().json()) as { choices?: Array<{ message?: { content?: unknown } }>; model?: string }
        const text = body.choices?.[0]?.message?.content
        content = typeof text === 'string' ? text : null
        reportedUsage = upstreamUsage(body)
        returnedModel = body.model
      } catch {
        /* Client records invalid/non-JSON responses. */
      }
    }
    responses.push({
      runId,
      chapter,
      phase,
      reportedUsage,
      returnedModel,
      status: response.status,
      requestedHistory: context?.requestedHistory,
      previousValidationError: context?.previousValidationError,
      suppliedFactIds: context?.previous?.facts?.map((fact: { id: string }) => fact.id),
      reviewTargets: context?.targets,
      reviewedGoalDecisions: context?.draft?.goalReviews,
      content,
      systemPromptHash: createHash('sha256').update(request?.messages?.[0]?.content || '').digest('hex'),
    })
    await writeFile(resolve(stateDir, 'responses.json'), JSON.stringify(responses, null, 2))
  }
  return response
}
console.info = (...args: unknown[]) => {
  if (!String(args[0]).startsWith('[outbound]')) originalInfo(...args)
}
const persist = async () => {
  const ledger = await ledgerAtAnchor(t.db, novelId)
  const usage = (
    await t.db.query(
      `SELECT count(*)::int AS recorded_calls, COALESCE(sum(prompt_tokens),0)::bigint AS input_tokens,
    COALESCE(sum(completion_tokens),0)::bigint AS output_tokens, count(*) FILTER (WHERE cost_reported)::int AS calls_with_reported_cost,
    sum(cost_millicents) FILTER (WHERE cost_reported) AS reported_cost_millicents
    FROM ai_usage WHERE novel_id=$1`,
      [novelId],
    )
  ).rows[0]
  const snapshot = ledger?.state
  const costsByCurrency = (await t.db.query(
    `SELECT cost_currency, count(*)::int AS calls, sum(cost_millicents) AS reported_cost_millicents
     FROM ai_usage WHERE novel_id=$1 AND cost_reported GROUP BY cost_currency`, [novelId],
  )).rows
  const report = {
    runId,
    implementationHash,
    ...manifest,
    status: result,
    requestsThisRun: requests,
    requestLog,
    responseUsageByPhase: ['extract', 'review'].map((phase) => {
      const selected = responses.filter((response) => response.phase === phase)
      const usage = selected.map((response) => response.reportedUsage as ReturnType<typeof upstreamUsage> | undefined)
      return {
        phase, responses: selected.length,
        promptTokens: usage.reduce((total, value) => total + (value?.promptTokens || 0), 0),
        completionTokens: usage.reduce((total, value) => total + (value?.completionTokens || 0), 0),
        missingTokenUsage: usage.filter((value) => value?.promptTokens == null || value?.completionTokens == null).length,
      }
    }),
    fixture,
    processedChapters: ledger?.processed ?? 0,
    steps,
    firstAttempts: fixture.map((_, index) => {
      const attempts = steps.filter((step) => step.chapter === index + 1)
      return { chapter: index + 1, firstAttempt: attempts[0]?.status || 'not-run', attempts: attempts.length }
    }),
    usage,
    costsByCurrency,
    responses,
    state: snapshot,
    current: snapshot ? workingFacts(snapshot).map((fact) => ({ id: fact.id, line: factLine(fact, snapshot) })) : [],
    explicitHistory: snapshot ? relevantLedger(snapshot, '', snapshot.facts.filter((fact) => fact.resolves?.length || fact.goalOutcome).map((fact) => fact.label)) : null,
    structuralChecks: snapshot
      ? {
          fullCoverage: ledger?.processed === fixture.length,
          sourceQuotesMatch: snapshot.facts.every((fact) => fixture[fact.ordinal - 1]?.text.includes(fact.quote)),
          beliefsHavePerspective: snapshot.facts
            .filter((fact) => fact.certainty === 'belief')
            .every((fact) => !!fact.perspective && fact.subjects.includes(fact.perspective)),
          uniqueActiveStateKeys: (() => {
            const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]))
            const keys = workingFacts(snapshot).flatMap((fact) => {
              const identity = stateIdentity(fact, entities)
              return identity ? [identity.key] : []
            })
            return keys.length === new Set(keys).size
          })(),
          historicalTargetsMarked: relevantLedger(snapshot, '', snapshot.facts.filter((fact) => fact.resolves?.length || fact.goalOutcome).map((fact) => fact.label))
            .facts.filter((fact) => !workingFacts(snapshot).some((active) => active.id === fact.id))
            .every((fact) => fact.stillActive === false),
        }
      : null,
    manualReview: '逐章依据 expectations 人工核对；结构检查通过不代表内容准确或完整。',
    limitations:
      '10 章短合成故事，不代表真实长篇准确率或性能。未开生产数据库；当前非流式、关闭思考，每次最多16000输出token、300秒。独立语义复核额外调用且不保证判断正确；分阶段响应Token与数据库累计账单分开统计。收到响应后失败也计账，未回传费用为未知；不自动重试语义或传输失败。历史补查沿用产品路径，显式 resume 的每次尝试保留记录。',
  }
  await writeFile(resolve(stateDir, 'steps.json'), JSON.stringify(steps, null, 2))
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
}
try {
  await t.applyMigrations()
  await saveAiSettings(t.db, configuration)
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,'十章合成故事评估',1,1) ON CONFLICT(id) DO NOTHING", [novelId])
  for (const [index, entry] of fixture.entries()) {
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(id) DO NOTHING', [
      `eval-${index + 1}`,
      novelId,
      entry.title,
      entry.text,
      index + 1,
    ])
  }
  let processed = (await ledgerAtAnchor(t.db, novelId))?.processed ?? 0
  for (; processed < fixture.length; processed++) {
    chapter = processed + 1
    const started = Date.now()
    console.log(JSON.stringify({ chapter, status: 'started' }))
    try {
      await extractPlotState(t.db, { novelId, userId: 'synthetic-evaluator', sampleChapters: 1 })
      const ledger = (await ledgerAtAnchor(t.db, novelId))!
      if (ledger.processed !== chapter) throw new Error('章节检查点未按预期推进')
      steps.push({
        runId,
        implementationHash,
        chapter,
        status: 'passed',
        elapsedMs: Date.now() - started,
        facts: ledger.state.facts.filter((f) => f.ordinal === chapter).length,
        attempt: await getMemoryAttempt(t.db, novelId, 'plot'),
      })
    } catch (error) {
      const message =
        error instanceof AiError && error.code === 'invalid'
          ? error.message
          : error instanceof AiError
            ? `模型请求失败：${error.code} / ${error.status}`
            : '评估运行失败，需检查本地环境'
      steps.push({
        runId,
        implementationHash,
        chapter,
        status: 'failed',
        elapsedMs: Date.now() - started,
        error: message,
        attempt: await getMemoryAttempt(t.db, novelId, 'plot'),
      })
      result = 'failed'
      process.exitCode = 1
    }
    await persist()
    console.log(JSON.stringify({ chapter, status: result === 'failed' ? 'failed' : 'passed', elapsedMs: Date.now() - started }))
    if (result === 'failed') break
  }
  if (result !== 'failed') result = 'completed'
  await persist()
  console.log(JSON.stringify({ status: result, report: output, stateDir }))
} finally {
  globalThis.fetch = originalFetch
  console.info = originalInfo
  await t.close()
  if (result === 'failed') process.exitCode = 1
}
