/** Isolated real-model smoke comparison. Never opens the production database.
 * Usage: npx tsx --tsconfig api/tsconfig.json api/scripts/replay-story-memory.ts --live
 * Without --live, prints instructions and makes no model requests. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createTestDb } from '../src/test/db'
import { AiError, isTextAiConfigured, textProvider } from '../src/services/ai/client'
import { saveAiSettings } from '../src/services/ai/settings'
import { extractPlotState } from '../src/services/ai/plot-state'
import { extractRelationshipProfile } from '../src/services/ai/relationship-profile'
import { ledgerAtAnchor } from '../src/services/ai/story-ledger-store'
import { workingFacts, factLine, LEDGER_PROMPT_VERSION, type LedgerState } from '../src/services/ai/story-ledger'
import { generateStoryGraph } from '../src/services/ai/story-graph'

if (!process.argv.includes('--live')) {
  console.log('添加 --live 才会调用已配置模型。仅使用隔离 PGlite 与虚构样章；不读取或修改生产小说。')
  process.exit(0)
}
if (!isTextAiConfigured()) throw new Error('尚未配置文本模型')
const chapters = [
  '林舟将唯一的铜钥匙交给沈砚保管。两人约定共同寻找地下密道，平等合作，没有主从关系。沈砚不知道密道入口在哪里。与此同时，周宁独自在北海修船，与寻找密道无关。',
  '沈砚听客栈伙计说林舟离开了城，误以为林舟已经远行；实际上林舟一直留在城内查找密道入口。沈砚仍保管着铜钥匙，他没有把钥匙交给别人。周宁在北海买到了修船用的帆布。',
  '林舟在客栈与沈砚见面，明确告诉他自己从未离城。沈砚承认先前听信伙计的话，消除了林舟已经远行的误会。林舟把密道入口的位置指给沈砚，两人已经找到入口，但还没有开门。沈砚拿出铜钥匙检查后放回自己的衣袋。',
]
const stateDir = process.argv.find((arg) => arg.startsWith('--state-dir='))?.slice('--state-dir='.length)
if (stateDir) await mkdir(resolve(stateDir), { recursive: true })
const t = await createTestDb(stateDir ? resolve(stateDir, 'pgdata') : undefined)
const runResults: Array<Record<string, unknown>> = []
let exitCode = 0
let manifestValid = false
let measurements: Record<string, { chapter: number; elapsedMs: number }> = {}
let attemptFailures: Array<{ createdAt: string; error: string }> = []
const readOptional = async (name: string) => {
  if (!stateDir) return undefined
  try {
    return JSON.parse(await readFile(resolve(stateDir, name), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
try {
  await t.applyMigrations()
  if (stateDir) {
    const manifest = { model: textProvider().model, fixture: chapters, ledgerPromptVersion: LEDGER_PROMPT_VERSION }
    const previous = await readOptional('manifest.json')
    if (previous && JSON.stringify(previous) !== JSON.stringify(manifest)) throw new Error('隔离目录属于其他模型、样章或记忆协议，请改用新的 --state-dir')
    await writeFile(resolve(stateDir, 'manifest.json'), JSON.stringify(manifest))
    manifestValid = true
    measurements = (await readOptional('measurements.json')) || {}
    attemptFailures = (await readOptional('failures.json')) || []
  }
  const baselinePath = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length)
  let baselineMeasuredAt: string | undefined
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
    const legacy = Array.isArray(baseline.runResults) ? baseline.runResults.find((run: { engine?: string }) => run.engine === 'legacy') : undefined
    if (!legacy || baseline.model !== textProvider().model || JSON.stringify(baseline.fixture) !== JSON.stringify(chapters))
      throw new Error('基线的模型或样章不一致，不能复用')
    runResults.push(legacy)
    baselineMeasuredAt = baseline.createdAt
  }
  let smokePassed = false
  for (const engine of baselinePath ? (['incremental'] as const) : (['legacy', 'incremental'] as const)) {
    const novelId = `replay-${engine}`
    await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$2,1,1) ON CONFLICT(id) DO NOTHING', [novelId, '虚构的密道调查'])
    await saveAiSettings(t.db, {
      storyMemoryEngine: engine,
      storyMemoryAutoUpdate: false,
      plotStateMaxTokens: 16000,
      relationshipProfileMaxTokens: 16000,
      storyMemoryChapterMaxTokens: 16000,
      storyMemoryReasoningMode: 'disabled',
    })
    const steps: Array<Record<string, unknown>> = []
    for (let index = 0; index < chapters.length; index++) {
      const chapterId = `${novelId}-${index + 1}`
      await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(id) DO NOTHING', [
        chapterId,
        novelId,
        `第${index + 1}章`,
        chapters[index],
        index + 1,
      ])
      const cached = engine === 'incremental' && (await ledgerAtAnchor(t.db, novelId, chapterId))?.complete
      const started = performance.now()
      const opts = { novelId, userId: 'isolated-replay', afterChapterId: chapterId, sampleChapters: 1 }
      await extractPlotState(t.db, opts)
      await extractRelationshipProfile(t.db, opts)
      const elapsedMs = Math.round(performance.now() - started)
      const key = `${engine}:${index + 1}`
      const measurement = cached && measurements[key] ? measurements[key]! : { chapter: index + 1, elapsedMs }
      steps.push({ ...measurement, ...(cached ? { cacheReused: true, replayElapsedMs: elapsedMs } : {}) })
      measurements[key] = measurement
      if (stateDir) await writeFile(resolve(stateDir, 'measurements.json'), JSON.stringify(measurements, null, 2))
      console.log(JSON.stringify({ engine, chapter: index + 1, elapsedMs, cached: !!cached }))
    }
    const stats = (
      await t.db.query(
        'SELECT count(*)::int AS calls,sum(prompt_tokens)::int AS input_tokens,sum(completion_tokens)::int AS output_tokens,sum(reasoning_tokens)::int AS reasoning_tokens,sum(cost_millicents) AS reported_cost_millicents FROM ai_usage WHERE novel_id=$1',
        [novelId],
      )
    ).rows[0]
    const archives = (await t.db.query('SELECT state FROM novel_plot_states WHERE novel_id=$1', [novelId])).rows[0]
    const relationship = (await t.db.query('SELECT profile FROM novel_relationship_profiles WHERE novel_id=$1', [novelId])).rows[0]
    let checks: Record<string, boolean> | undefined
    let current: string[] | undefined
    let records: LedgerState | undefined
    if (engine === 'incremental') {
      const ledger = (await ledgerAtAnchor(t.db, novelId))!
      records = ledger.state
      current = workingFacts(ledger.state).map((f) => factLine(f, ledger.state))
      const earlier = (await ledgerAtAnchor(t.db, novelId, `${novelId}-2`))!
      const graph = await generateStoryGraph(t.db, { novelId, userId: 'isolated-replay' })
      const afterCalls = (await t.db.query<{ count: number }>('SELECT count(*)::int AS count FROM ai_usage WHERE novel_id=$1', [novelId])).rows[0]!.count
      checks = {
        complete: ledger.complete,
        retainedVerbatimEvidence: ledger.state.facts.every((f) => chapters[f.ordinal - 1]!.includes(f.quote)),
        earlierAnchorExcludesFuture: earlier.state.facts.every((f) => f.ordinal <= 2),
        actorBeliefsScoped: ledger.state.facts.filter((f) => f.certainty === 'belief').every((f) => !!f.perspective),
        originalHistoryRetained: ledger.state.facts.some((f) => f.ordinal === 1) && ledger.state.facts.some((f) => f.ordinal === 2),
        graphReusesMemory: graph.status === 'ready' && afterCalls === Number((stats as { calls: number }).calls),
        changedStateSupersedesHistory: ledger.state.facts.some((f) => f.ordinal === 3 && f.replaces.length > 0),
      }
      smokePassed = Object.values(checks).every(Boolean)
    }
    runResults.push({ engine, steps, stats, checks, current, records, archives, relationship })
  }
  const output = resolve('docs/diagnostics/story-memory-ledger-replay.json')
  await mkdir(resolve('docs/diagnostics'), { recursive: true })
  await writeFile(
    output,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        ledgerPromptVersion: LEDGER_PROMPT_VERSION,
        ...(stateDir ? { resumableReplay: true, attemptFailures } : {}),
        ...(baselineMeasuredAt
          ? { baselineMeasuredAt, comparisonMethod: '原流程未改动，复用同模型同样章的真实基线；增量流程重新运行。两次测量不同时，不是受控延迟实验。' }
          : {}),
        model: textProvider().model,
        fixture: chapters,
        runResults,
        limitations:
          '仅三章虚构样章；耗时受中转缓存和网络影响，步骤计时只含成功步骤，失败尝试单列；用量只含收到可计账响应的调用，网络失败可能仍计费；自动检查只覆盖来源、时间和结构，语义质量需人工审阅，不能推断长篇质量或生产加速比例。',
      },
      null,
      2,
    ) + '\n',
  )
  console.log(JSON.stringify({ report: output, structuralSmokePassed: smokePassed }))
  if (!smokePassed) exitCode = 1
} catch (error) {
  const message = error instanceof Error ? error.message : '对照失败'
  attemptFailures.push({ createdAt: new Date().toISOString(), error: message })
  if (stateDir && manifestValid) await writeFile(resolve(stateDir, 'failures.json'), JSON.stringify(attemptFailures, null, 2))
  const output = resolve('docs/diagnostics/story-memory-ledger-replay.json')
  await mkdir(resolve('docs/diagnostics'), { recursive: true })
  await writeFile(
    output,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        model: textProvider().model,
        ledgerPromptVersion: LEDGER_PROMPT_VERSION,
        status: error instanceof AiError && ['disabled', 'timeout', 'upstream'].includes(error.code) ? 'blocked' : 'failed',
        error: message,
        runResults,
        ...(stateDir ? { resumableReplay: true, attemptFailures } : {}),
        limitations: '对照未完成，不能据此评价质量、速度或费用。不记录连接密钥，不修改生产数据库。',
      },
      null,
      2,
    ) + '\n',
  )
  console.error(`真实模型对照未完成，诊断已保存：${output}`)
  exitCode = 1
} finally {
  await t.close()
  process.exitCode = exitCode
}
