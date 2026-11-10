/** Offline replay of saved responses. No model, application database or original report writes. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnalysisReport, AnalysisSource } from '../../shared/novel-analysis'
import { checkAnalysisEvidence, findAnalysisQuote } from '../src/services/ai/novel-analysis-evidence'
import { parseAnalysisFactResult } from '../src/services/ai/novel-analysis-facts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = process.argv[2]
if (!arg) throw new Error('Supply the saved .tmp evaluation directory')
const directory = path.resolve(root, arg), relative = path.relative(path.join(root, '.tmp'), directory)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Replay requires an existing .tmp child')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const calls = JSON.parse(await readFile(path.join(directory, 'calls.json'), 'utf8')) as Array<{
  stage: string; messages: Array<{ content: string }>; result?: { text: string }; durationMs: number
}>
const results = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8')) as Array<{
  id: string; expected: boolean; report: AnalysisReport; after?: AnalysisReport; agentAfter?: { content: string; revision: string }
  writingAfter?: { reports: Array<{ content: string; revision: number }> }
}>
const replay = results.map(row => {
  const call = calls.find(c => c.stage === row.id)
  if (!call?.result) return { id: row.id, status: 'no-response', matchesPredefinedExpectation: false, actualIssueCount: 0 }
  const materials = JSON.parse(call.messages[1]!.content) as { sources: Array<{ id: string; text: string }> }
  const sources = row.report.sources.flatMap(s => {
    const material = materials.sources.find(m => m.id === s.id)
    return material ? [{ ...s, text: material.text }] : []
  })
  const result = parseAnalysisFactResult(call.result.text, { coverage: row.report.reviews![0]!.coverage, sources })
  const suggestions = result.items.map(item => {
    const content = row.report.content.slice(0, item.start) + item.suggestion + row.report.content.slice(item.end)
    const check = checkAnalysisEvidence(content, sources)
    return { kind: item.kind, original: item.original, suggestion: item.suggestion,
      evidenceVerified: item.evidence.every(e => findAnalysisQuote(e.quote, sources.filter(s => e.sourceIds.includes(s.id))).length > 0),
      quoteStatusesAfter: check.items.map(q => q.status) }
  })
  return { id: row.id, status: row.report.reviews?.[0]?.status, expectedIssue: row.expected, actualIssueCount: result.items.length,
    matchesPredefinedExpectation: row.expected === (result.items.length > 0), partial: result.partial, rejected: result.rejected,
    durationMs: call.durationMs, responseHash: hash(call.result.text), suggestions,
    ...(row.after ? { propagation: { originalRetained: row.after.originalContent === row.report.originalContent,
      revisionIncreased: row.after.revision === row.report.revision + 1,
      writingUsesRevision: row.writingAfter?.reports[0]?.revision === row.after.revision,
      writingUsesContent: row.writingAfter?.reports[0]?.content === row.after.content,
      agentUsesRevision: row.agentAfter?.revision === String(row.after.revision), agentUsesContent: row.agentAfter?.content === row.after.content } } : {}) }
})
const prior = path.join(root, '.tmp/novel-analysis-stream-2026-11-10-fresh-low')
const { sources } = JSON.parse(await readFile(path.join(prior, 'input.json'), 'utf8')) as { sources: AnalysisSource[] }
const content = await readFile(path.join(prior, 'report.md'), 'utf8')
const audit = JSON.parse(await readFile(path.join(root, 'docs/diagnostics/novel-analysis-bounded-review-2026-11-10.json'), 'utf8')) as {
  targetedQuoteReview: { results: Array<{ id: string; quoteHash: string; source: string; exactAtExpectedSource: boolean }> }
}
const check = checkAnalysisEvidence(content, sources)
const known = audit.targetedQuoteReview.results.map(sample => {
  const items = check.items.filter(q => hash(q.quote) === sample.quoteHash)
  return { id: sample.id, expectedExact: sample.exactAtExpectedSource,
    exactAtExpected: items.some(q => findAnalysisQuote(q.quote, sources.filter(s => s.id === sample.source)).length > 0),
    scanner: items.map(q => ({ status: q.status, cited: q.citedSourceIds, matches: q.matches.map(m => m.sourceIds) })) }
})
const files = ['api/src/services/ai/novel-analysis-evidence.ts', 'api/src/services/ai/novel-analysis-facts.ts', 'api/src/services/ai/novel-analysis-review.ts']
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(root, file), 'utf8'))])))
const output = { mode: 'offline-saved-response-replay', modelCalls: 0, applicationDatabaseWrites: 0, sourceHashes, replay, known }
await writeFile(path.join(directory, 'replay.json'), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ cases: replay.map(r => ({ id: r.id, expected: r.matchesPredefinedExpectation, issues: r.actualIssueCount })),
  known: known.map(k => ({ id: k.id, exact: k.exactAtExpected, statuses: k.scanner.map(s => s.status) })) }))
