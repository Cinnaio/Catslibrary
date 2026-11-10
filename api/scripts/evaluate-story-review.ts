/** Eight paired development cases, one real request per case, no retries.
 * These are known diagnostics, never a held-out story acceptance result. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from '../src/services/ai/client'
import { partialUsageRecorder } from '../src/services/ai/partial-usage'
import { reviewChapterMemory, semanticReviewMessages } from '../src/services/ai/story-ledger-review'
import { emptyLedger, type ChapterMemory, type MemoryFact, type LedgerState } from '../src/services/ai/story-ledger'
import { createTestDb } from '../src/test/db'
import { recordUsage } from '../src/services/ai/usage'
import { usageAuditFields } from '../src/services/ai/upstream-usage'

const fact = (id: string, label: string, summary: string, quote: string, patch: Partial<MemoryFact> = {}): MemoryFact => ({
  id, label, summary, quote, memoryType: 'state', kind: 'state', subjects: ['box'], certainty: 'fact', status: 'active', scope: 'local',
  replaces: [], chapterId: 'case', ordinal: 1, ...patch,
})
const entities: LedgerState['entities'] = [
  { id: 'box', name: '封箱', kind: 'item', aliases: [] },
  { id: 'person', name: '岑遥', kind: 'person', aliases: [] },
  { id: 'dock', name: '码头', kind: 'place', aliases: [] },
  { id: 'rope', name: '钟绳', kind: 'item', aliases: [] },
  { id: 'pool', name: '水池', kind: 'place', aliases: [] },
]
const boxText = '封箱未开，内容无人知道。'
const box = fact('box-status', '开启状态', '封箱未开。', boxText)
const unknown = fact('box-contents', '封箱内容', '封箱内容未知。', boxText, { kind: 'clue', certainty: 'clue' })
const progressText = '岑遥在码头收拢工具，尚未结束。'
const location = fact('location', '当前位置', '岑遥在码头。', progressText, { kind: 'place', subjects: ['person'] })
const progress = fact('progress', '收拢工具进度', '岑遥收拢工具尚未结束。', progressText, { subjects: ['person'] })
const poolText = '岑遥已经排空水池，水池现在是空的。'
const pool = fact('pool-state', '水池状态', '水池现在是空的。', poolText, { subjects: ['pool'] })
const goalText = '岑遥计划更换钟绳，尚未开始。'
const goal = fact('old-goal', '更换钟绳', '岑遥计划更换钟绳。', goalText, { kind: 'goal', subjects: ['person'] })
const cases: Array<{ id: string; expected: 'accept' | 'reject'; text: string; draft: ChapterMemory; previous: LedgerState }> = []
const add = (id: string, expected: 'accept' | 'reject', text: string, facts: MemoryFact[], previous = emptyLedger(), goalReviews?: ChapterMemory['goalReviews']) =>
  cases.push({ id, expected, text, draft: { version: 1, entities, facts, ...(goalReviews ? { goalReviews } : {}) }, previous })
add('unknown-content-missing', 'reject', boxText, [box])
add('unknown-content-saved', 'accept', boxText, [box, unknown])
add('progress-mixed-location', 'reject', progressText, [location, { ...progress, summary: '岑遥在码头收拢工具，尚未结束。' }])
add('progress-separated', 'accept', progressText, [location, progress])
add('completed-current-state', 'accept', poolText, [pool])
add('event-without-current-state', 'reject', poolText, [{ ...pool, memoryType: 'event', summary: '岑遥已经排空水池。' }])
add('new-goal-empty-review-scope', 'accept', goalText, [goal, fact('goal-progress', '更换钟绳进度', '岑遥更换钟绳尚未开始。', goalText, { subjects: ['person'] })])
add('ended-goal-incorrect-continue', 'reject', '岑遥已把钟绳换妥，更换工作就此告一段落。', [], { entities, facts: [goal] }, [{ id: goal.id, decision: 'continue' }])

const output = resolve(process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) || '.tmp/story-review-development.json')
if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({ mode: 'fixture-only', cases: cases.map(({ id, expected }) => ({ id, expected })), maxRequests: cases.length }))
  process.exit(0)
}
if (!isTextAiConfigured()) throw new Error('尚未配置文本模型')
try { await readFile(output); throw new Error('输出已存在，禁止覆盖已有开发诊断') }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
await mkdir(dirname(output), { recursive: true })
const db = await createTestDb()
const results: Array<Record<string, unknown>> = []
try {
  await db.applyMigrations()
  for (const entry of cases) {
    let response: Awaited<ReturnType<typeof chat>> | undefined
    let error: string | undefined
    const started = Date.now()
    try {
      await reviewChapterMemory(entry, async (messages) => {
        response = await chat({ messages, stream: false, temperature: 0.1, maxTokens: 8000, timeoutMs: 180000, reasoningMode: 'disabled', retryOnTimeout: false, maxAttempts: 1, returnIncompleteResult: true,
          onIncomplete: partialUsageRecorder(db.db, { userId: 'review-evaluator', novelId: entry.id, generationType: 'story_memory', provider: providerLabel(textProvider().baseUrl) }),
        })
        await recordUsage(db.db, { userId: 'review-evaluator', novelId: entry.id, generationType: 'story_memory', model: response.model, provider: providerLabel(textProvider().baseUrl), promptTokens: response.promptTokens, completionTokens: response.completionTokens, costMillicents: response.cost * 100000, ...usageAuditFields(response) })
        if (response.truncated || response.finishReason === 'length' || response.refusal || !response.text.trim()) throw new Error('复核响应不完整')
        return response
      })
    } catch (cause) {
      error = cause instanceof AiError && cause.code === 'invalid' ? cause.message : '请求或复核响应失败'
    }
    const observed = error ? 'reject' : 'accept'
    results.push({ ...entry, observed, error, matchedExpectedDecision: observed === entry.expected, elapsedMs: Date.now() - started,
      systemPromptHash: createHash('sha256').update(semanticReviewMessages(entry)[0]!.content).digest('hex'),
      response: response ? { text: response.text, model: response.model, promptTokens: response.promptTokens, completionTokens: response.completionTokens, cost: response.cost, ...usageAuditFields(response) } : null,
    })
    const usage = (await db.db.query('SELECT count(*)::int AS calls, sum(prompt_tokens)::int AS input_tokens, sum(completion_tokens)::int AS output_tokens, count(*) FILTER (WHERE cost_reported)::int AS reported_calls, sum(cost_millicents) FILTER (WHERE cost_reported) AS cost_millicents FROM ai_usage')).rows[0]
    await writeFile(output, JSON.stringify({ purpose: 'known-development-cases', maxRequests: cases.length, configuredModel: textProvider().model, results, usage, note: '预期拒绝但因格式/范围/引用错误而失败不算语义检出；须逐项人工检查原始响应。' }, null, 2) + '\n')
    console.log(JSON.stringify({ id: entry.id, expected: entry.expected, observed, matched: observed === entry.expected }))
  }
} finally { await db.close() }
