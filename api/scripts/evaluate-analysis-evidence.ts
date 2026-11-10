/** Frozen cases, one live attempt each. Only a fresh PGlite database receives writes. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { AnalysisSource } from '../../shared/novel-analysis'
import { createTestDb } from '../src/test/db'
import { loadConfig } from '../src/config'
import { saveAiSettings } from '../src/services/ai/settings'
import { chat, type AiChatOptions } from '../src/services/ai/client'
import { withProviderSnapshot } from '../src/services/ai/provider-snapshot'
import { createAnalysis, readAnalysis } from '../src/services/ai/novel-analysis-store'
import { createAnalysisReview, runAnalysisReview, applyAnalysisFinding } from '../src/services/ai/novel-analysis-review'
import { getAnalysisReferences } from '../src/services/ai/analysis-reference'
import { createAgentSession } from '../src/services/ai/agent-store'
import { readAgentAnalysis } from '../src/services/ai/agent-retrieval'
import { checkAnalysisEvidence, findAnalysisQuote } from '../src/services/ai/novel-analysis-evidence'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const fixtureText = await readFile(path.join(root, 'api/scripts/fixtures/novel-analysis-evidence.json'), 'utf8')
const fixture = JSON.parse(fixtureText) as { description: string; cases: Array<{ id: string; chapters: string[]; report: string; expectIssue: boolean; criterion: string }> }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const plan = { fixtureHash: hash(fixtureText), maxCalls: 8, retries: 0, reasoning: 'low', timeoutSeconds: 300, maxMinutes: 35,
  applicationDatabaseWrites: 0, cases: fixture.cases.map(({ id, expectIssue, criterion }) => ({ id, expectIssue, criterion })),
  acceptance: '人工对照每项结果，区分运行完成与语义通过；正确对照不得被无根据改写。' }
if (!args.includes('--live')) { console.log(JSON.stringify(plan)); process.exit(0) }
const outputArg = option('--output')
if (!outputArg) throw new Error('Use a new --output under .tmp')
const output = path.resolve(root, outputArg), relative = path.relative(path.join(root, '.tmp'), output)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a new .tmp child')
const provider = loadConfig().aiText
if (!provider.apiKey || !provider.baseUrl) throw new Error('Configured provider required')
process.env.DATABASE_URL = 'postgres://isolated/unused'
await mkdir(output)
const save = (name: string, data: unknown) => writeFile(path.join(output, name), JSON.stringify(data,
  (key, value) => /^(reasoningContent|reasoning_content)$/.test(key) ? undefined : value, 2).replaceAll(provider.apiKey, '[credential]') + '\n')
await save('plan.json', plan)
await writeFile(path.join(output, 'fixture.json'), fixtureText)
const t = await createTestDb(path.join(output, 'database'))
const calls: Array<Record<string, unknown>> = [], results: Array<Record<string, unknown>> = []
const started = Date.now()
let stage = ''
const invoke = async (options: AiChatOptions) => {
  if (calls.length >= plan.maxCalls || Date.now() - started > plan.maxMinutes * 60000 || calls.some(c => c.stage === stage))
    throw new Error('Frozen evaluation budget reached')
  const call: Record<string, unknown> = { stage, messages: options.messages, reasoning: options.reasoningMode, timeoutMs: options.timeoutMs, startedAt: new Date().toISOString() }
  calls.push(call); await save('calls.json', calls)
  console.log(JSON.stringify({ stage, state: 'started', call: calls.length }))
  try {
    const response = await chat(options)
    call.result = response
    return response
  } catch (error) { call.error = error instanceof Error ? error.name : 'unknown'; throw error }
  finally { call.durationMs = Date.now() - Date.parse(String(call.startedAt)); await save('calls.json', calls); console.log(JSON.stringify({ stage, state: 'received', durationMs: call.durationMs })) }
}
try {
  await t.applyMigrations()
  // Same low/300 settings as the recorded development acceptance; no shared setting changes.
  await saveAiSettings(t.db, { storyMemoryReasoningMode: 'low', storyMemoryTimeoutSeconds: 300 })
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('review','review','admin','x','x',1,1)")
  for (const test of fixture.cases) {
    stage = test.id
    await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$1,1,1)', [test.id])
    for (const [i, text] of test.chapters.entries()) await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [`${test.id}-${i}`, test.id, `第${i + 1}章`, text, i + 1])
    const end = `${test.id}-${test.chapters.length - 1}`
    const receipt = await createAnalysis(t.db, 'review', test.id, { kind: 'characters', startChapterId: `${test.id}-0`, endChapterId: end, question: '' }, `report-${test.id}`)
    // Seed the frozen defective/correct report, without paying to regenerate or selecting outputs.
    await t.db.query('UPDATE novel_analysis_reports SET content=$1 WHERE id=$2', [test.report, receipt.reportId])
    await t.db.query("UPDATE ai_tasks SET status='completed' WHERE id=$1", [receipt.taskId])
    const review = await createAnalysisReview(t.db, 'review', test.id, receipt.reportId, `check-${test.id}`, 1)
    await withProviderSnapshot(() => runAnalysisReview(t.db, test.id, receipt.reportId, review.reviewId, review.taskId, {}, invoke), { text: provider })
    const report = await readAnalysis(t.db, test.id, receipt.reportId)
    const findings = report.reviews?.[0]?.result?.items || []
    const result: Record<string, unknown> = { id: test.id, expected: test.expectIssue, report, criterion: test.criterion,
      issuesDetected: findings.length, automaticReferences: (await getAnalysisReferences(t.db, test.id, end)).reports.map(r => r.id) }
    if (test.id === 'presence-bad' && findings.length) {
      const session = await createAgentSession(t.db, 'review', { novelId: test.id, afterChapterId: end })
      result.agentBefore = await readAgentAnalysis(t.db, session, receipt.reportId)
      await applyAnalysisFinding(t.db, test.id, receipt.reportId, review.reviewId, findings[0]!.id, 1)
      result.after = await readAnalysis(t.db, test.id, receipt.reportId)
      result.writingAfter = await getAnalysisReferences(t.db, test.id, end)
      result.agentAfter = await readAgentAnalysis(t.db, session, receipt.reportId)
    }
    results.push(result); await save('results.json', results)
    console.log(JSON.stringify({ stage, status: report.reviews?.[0]?.status, findings: findings.length, expected: test.expectIssue }))
  }
  // Known private quote samples are replayed offline only; never print or publish their text.
  const prior = path.join(root, '.tmp/novel-analysis-stream-2026-11-10-fresh-low')
  const input = JSON.parse(await readFile(path.join(prior, 'input.json'), 'utf8')) as { sources: AnalysisSource[] }
  const original = await readFile(path.join(prior, 'report.md'), 'utf8')
  const audit = JSON.parse(await readFile(path.join(root, 'docs/diagnostics/novel-analysis-bounded-review-2026-11-10.json'), 'utf8')) as {
    targetedQuoteReview: { results: Array<{ id: string; quoteHash: string; source: string; exactAtExpectedSource: boolean }> }
  }
  const evidence = checkAnalysisEvidence(original, input.sources)
  await save('known-quotes-private.json', evidence)
  const quotes = [...original.matchAll(/“([^”\n]+)”|「([^」\n]+)」|"([^"\n]+)"/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
  await save('known-quotes-summary.json', audit.targetedQuoteReview.results.map(sample => {
    const quote = quotes.find(q => hash(q) === sample.quoteHash)
    return { id: sample.id, found: quote !== undefined, expectedExact: sample.exactAtExpectedSource,
      exactAtExpected: quote !== undefined && findAnalysisQuote(quote, input.sources.filter(s => s.id === sample.source)).length > 0,
      scanner: evidence.items.filter(i => hash(i.quote) === sample.quoteHash).map(i => ({ status: i.status, cited: i.citedSourceIds, matched: i.matches.map(m => m.sourceIds) })) }
  }))
  await save('usage.json', (await t.db.query('SELECT model,generation_type,prompt_tokens,completion_tokens,cost_millicents,cost_reported,cost_currency,token_usage_reported FROM ai_usage')).rows)
} finally { await t.close() }
