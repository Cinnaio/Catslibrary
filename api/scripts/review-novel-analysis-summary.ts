/** Review frozen sources in an isolated database, reusing notes or explicitly reading afresh. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { AnalysisKind, AnalysisNote, AnalysisSource } from '../../shared/novel-analysis'
import { ANALYSIS_KINDS } from '../../shared/novel-analysis'
import { createTestDb } from '../src/test/db'
import { createAnalysis, requireAnalysis } from '../src/services/ai/novel-analysis-store'
import { runNovelAnalysis } from '../src/services/ai/novel-analysis'
import { getAiTask } from '../src/services/ai/tasks'
import { saveAiSettings } from '../src/services/ai/settings'
import { chat, AiError, type AiChatOptions } from '../src/services/ai/client'
import { loadConfig } from '../src/config'
import { withProviderSnapshot } from '../src/services/ai/provider-snapshot'
import type { AiReasoningMode } from '../../shared/ai-text-progress'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const fresh = args.includes('--fresh')
const maxCalls = fresh ? 32 : 9
const maxDurationMs = (fresh ? 30 : 10) * 60_000
if (!args.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan', input: '定向合成样本，或 --snapshot 指定的冻结报告；--fresh 不复用旧记录，从分组阅读开始', reasoning: '--reasoning 显式指定 inherit/disabled/low/high；默认 inherit，不读取开发库设置', maxCalls, maxDurationMs, retries: 0, applicationDatabaseWrites: false, fullPipelineReview: fresh }))
  process.exit(0)
}
const outputArg = option('--output')
if (!outputArg) throw new Error('A new --output directory is required')
const output = path.resolve(outputArg)
const relative = path.relative(path.join(root, '.tmp'), output)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be inside repository .tmp')
const provider = loadConfig().aiText
if (!provider.apiKey || !provider.baseUrl) throw new Error('Text provider unavailable')
const reasoning = option('--reasoning') || 'inherit'
if (!['inherit', 'disabled', 'low', 'high'].includes(reasoning)) throw new Error('Invalid reasoning mode')
// All database access from this point uses a fresh isolated PGlite instance.
process.env.DATABASE_URL = 'postgres://isolated/unused'
const snapshotPath = option('--snapshot')
const fixture = JSON.parse(await readFile(path.join(root, 'api/scripts/fixtures/novel-analysis-reconciliation.json'), 'utf8')) as {
  description: string; chapters: Array<{ title: string; text: string }>; notes: AnalysisNote[]; reviewCriteria: string[]
}
const snapshot = snapshotPath ? JSON.parse(await readFile(path.resolve(snapshotPath), 'utf8')) as {
  source_json: AnalysisSource[]; notes_json: AnalysisNote[]; request_json: { kind: AnalysisKind; question: string }
} : undefined
const notes = fresh ? [] : snapshot?.notes_json ?? fixture.notes
const kind = snapshot?.request_json.kind ?? 'plot'
if (!Object.hasOwn(ANALYSIS_KINDS, kind) || !Array.isArray(notes) || !fresh && (!notes.length || JSON.stringify(notes).length > 28000))
  throw new Error('Summary review requires complete notes that fit without additional condensation')
const chapters = snapshot ? [...new Set(snapshot.source_json.map(s => s.chapterId))].map(id => {
  const parts = snapshot.source_json.filter(s => s.chapterId === id)
  return { title: parts[0]!.chapterTitle, text: parts.map(s => s.text).join('') }
}) : fixture.chapters
if (!chapters.length || chapters.reduce((sum, c) => sum + c.text.length, 0) > 2_000_000) throw new Error('Invalid frozen selection')
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output, { recursive: false })
const t = await createTestDb()
const calls: Array<Record<string, unknown>> = []
const started = Date.now()
const clean = (value: unknown) => JSON.stringify(value, null, 2).replaceAll(provider.apiKey, '[credential]')
const persist = () => writeFile(path.join(output, 'calls.json'), clean({ mode: fresh ? 'fresh-pipeline' : snapshot ? 'existing-notes-replay' : 'synthetic-stale-notes', reasoning, calls }))
const invoke = async (options: AiChatOptions) => {
  if (calls.length >= maxCalls || Date.now() - started > maxDurationMs) throw new AiError('invalid', '本轮报告复核达到调用预算')
  const call: Record<string, unknown> = { messages: options.messages.map(({ reasoning_content: _private, ...message }) => structuredClone(message)), tools: options.tools, toolChoice: options.toolChoice,
    reasoning, stream: options.stream, maxTokens: options.maxTokens, startedAt: new Date().toISOString() }
  calls.push(call)
  try {
    const timeoutMs = fresh ? 300000 : 120000
    const result = await chat({ ...options, timeoutMs,
      onProgress: async update => {
        call.firstThinkingMs ??= update.phase === 'thinking' ? Date.now() - Date.parse(String(call.startedAt)) : undefined
        call.firstWritingMs ??= update.phase === 'writing' ? Date.now() - Date.parse(String(call.startedAt)) : undefined
        call.reasoningCharacters = update.reasoningCharacters
        await options.onProgress?.(update)
      },
      signal: AbortSignal.any([options.signal || new AbortController().signal, AbortSignal.timeout(timeoutMs + 5000), AbortSignal.timeout(Math.max(1, maxDurationMs - (Date.now() - started)))]), maxAttempts: 1, retryOnTimeout: false })
    call.result = { ...result, reasoningContent: undefined }
    return result
  } catch (error) {
    call.error = error instanceof AiError ? { code: error.code, status: error.status, partial: error.partialResult ? { ...error.partialResult, reasoningContent: undefined } : undefined } : { code: 'transport_or_budget' }
    throw error
  } finally {
    call.durationMs = Date.now() - Date.parse(String(call.startedAt))
    await persist()
    console.log(JSON.stringify({ call: calls.length, durationMs: call.durationMs, error: !!call.error }))
  }
}
try {
  await t.applyMigrations()
  await saveAiSettings(t.db, { storyMemoryReasoningMode: reasoning as AiReasoningMode, storyMemoryTimeoutSeconds: fresh ? 300 : 120 })
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('review','review','admin','unused','unused',1,1)")
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('review','隔离汇总复核',1,1)")
  for (const [i, c] of chapters.entries()) await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [`c${i + 1}`, 'review', c.title, c.text, i + 1])
  const receipt = await createAnalysis(t.db, 'review', 'review', { kind, startChapterId: 'c1', endChapterId: `c${chapters.length}`,
    question: snapshot?.request_json.question ?? '' }, 'summary-review-0001')
  const created = await requireAnalysis(t.db, 'review', receipt.reportId)
  const sources = snapshot?.source_json ?? created.source_json
  const ids = new Set(sources.map(s => s.id))
  const notedIds = new Set(notes.flatMap(n => n.sourceIds))
  if (ids.size !== sources.length || !fresh && ([...ids].some(id => !notedIds.has(id)) || [...notedIds].some(id => !ids.has(id)))) throw new Error('Source coverage mismatch')
  if (sources.some(s => typeof s.text !== 'string' || s.text.length > 12000) || notes.some(n => typeof n.content !== 'string')) throw new Error('Malformed source or note')
  await t.db.query('UPDATE novel_analysis_reports SET source_json=$1::jsonb,notes_json=$2::jsonb WHERE id=$3', [JSON.stringify(sources), JSON.stringify(notes), receipt.reportId])
  const sourceHash = createHash('sha256').update(JSON.stringify(sources)).digest('hex')
  const notesHash = createHash('sha256').update(JSON.stringify(notes)).digest('hex')
  await writeFile(path.join(output, 'input.json'), clean({ sources, notes, kind, sourceHash, notesHash, reviewCriteria: snapshot ? '依据用户报告复核记录进行定向检查；不是未见样本' : fixture.reviewCriteria }))
  await withProviderSnapshot(() => runNovelAnalysis(t.db, 'review', receipt.reportId, receipt.taskId, {}, invoke), { text: provider })
  const row = await requireAnalysis(t.db, 'review', receipt.reportId)
  const task = await getAiTask(t.db, receipt.taskId)
  await writeFile(path.join(output, 'result-snapshot.json'), clean(row))
  const summary = { status: task?.status, error: task?.error, calls: calls.length, reasoning, sourceHash, notesHash,
    sourceCount: sources.length, readingGroupsReused: notes.length, reportCharacters: row.content.length,
    readingGroupsCreated: row.notes_json.length - notes.length, processedSources: new Set(row.notes_json.flatMap(note => note.sourceIds)).size,
    checkedSourceIds: row.checked_source_ids, fullPipelineReview: fresh, semanticReview: 'pending' }
  await writeFile(path.join(output, 'report.md'), row.content || task?.error || '')
  await writeFile(path.join(output, 'summary.json'), clean(summary))
  console.log(JSON.stringify(summary))
} finally { await persist(); await t.close() }
