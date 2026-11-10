/** Real-provider integration review. Dry run by default; all writes use a new isolated PGlite directory.
 * Requests enter the real authenticated routes. No production workers, publication, or application DB writes.
 * Captures exclude credentials and reasoning text. Content/semantic review is a separate manual step.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import type { AnalysisSource } from '../../shared/novel-analysis'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const option = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
async function verifyRecords(directory: string) {
  const read = async (name: string) => JSON.parse(await readFile(path.join(directory, name), 'utf8'))
  const generations = await read('generations.json') as Array<Record<string, any>>
  const results: Array<{ name: string; passed: boolean }> = []
  const verify = (name: string, passed: boolean) => results.push({ name, passed: !!passed })
  for (const name of ['agent-read', 'real-agent-read']) {
    const data = await read(name + '.json')
    const tools = data.events.map((e: Item) => e.metadata?.tool)
    for (const tool of ['list_novel_analyses', 'read_novel_analysis', 'read_chapter']) verify(name + ':' + tool, tools.includes(tool))
    const sources = data.events.flatMap((e: Item) => e.metadata?.sources || [])
    const answers = data.events.filter((e: Item) => e.role === 'assistant').map((e: Item) => e.content).join('\n')
    const citations = [...answers.matchAll(/\]\(\/read\/([^/]+)\/([^)?#]+)[^)]*\)/g)]
    verify(name + ':citations-to-read-chapters', citations.length > 0 && citations.every(m => sources.some((s: Item) => s.kind === 'chapter' && s.novelId === decodeURIComponent(m[1]!) && s.chapterId === decodeURIComponent(m[2]!))))
    verify(name + ':versioned-report-evidence', sources.some((s: Item) => s.kind === 'analysis' && s.reportId && Number.isSafeInteger(s.reportRevision)))
    verify(name + ':read-only-no-generation', !tools.some((tool: string) => ['generate_draft', 'analyze_novel', 'refresh_memory'].includes(tool)))
  }
  const readTurn = await read('agent-read.json'), generated = await read('agent-generate.json')
  const references = readTurn.events.flatMap((e: Item) => e.metadata?.sources || []).filter((s: Item) => s.kind === 'analysis')
  verify('agent-generate:tool-invoked', generated.events.some((e: Item) => e.metadata?.tool === 'generate_draft'))
  const childDrafts = generated.artifacts.flatMap((a: Item) => a.drafts || [])
  verify('agent-generate:child-completed-with-draft', generated.artifacts.length > 0 && generated.artifacts.every((a: Item) => a.task.status === 'completed') && childDrafts.length > 0)
  for (const child of childDrafts) {
    const row = generations.find(g => g.id === child.id)
    const snapshot = row ? JSON.parse(row.params_json).continuationSnapshot : undefined
    verify('agent-generate:read-report-revision-frozen', snapshot?.version === 2 && snapshot.analysisReferences?.some((r: Item) => references.some((s: Item) => s.reportId === r.id && s.reportRevision === r.revision && r.content.includes(s.excerpt))))
    verify('agent-generate:draft-unpublished', row?.status === 'draft')
  }
  verify('all-drafts:no-control-marker-leak', generations.every(g => !/REPORT_REVISION_CANARY|LEGACY_ARCHIVE_SENTINEL|FUTURE_REPORT_SENTINEL|OTHER_BOOK_SENTINEL/.test(g.result)))
  await writeFile(path.join(directory, 'evidence-checks.json'), JSON.stringify({ checks: results, semanticReview: 'not-covered-by-these-structural-checks' }, null, 2) + '\n')
  return results
}
if (args.includes('--verify-records')) {
  const directory = path.resolve(option('--verify-records') || '')
  const relative = path.relative(path.join(root, '.tmp'), directory)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Records must be inside repository .tmp')
  const results = await verifyRecords(directory)
  console.log(JSON.stringify({ mode: 'offline-evidence-check', checks: results }))
  process.exit(results.some(r => !r.passed) ? 1 : 0)
}
const maxRequests = 26
const plan = { maxRequests, maxMinutes: 35, maxRequestSeconds: 180, applicationDatabaseWrites: 0,
  cases: ['analysis-create-edit-select', 'plot-outline-continuation-review', 'agent-read-cite-generate',
    'explicit-no-report', 'cross-book-future-stale-revision', 'controlled-failure-and-retry', 'frozen-real-novel'] }
if (!args.includes('--live')) { console.log(JSON.stringify({ mode: 'plan', ...plan })); process.exit(0) }
const outputArg = option('--output'), sourceArg = option('--source')
if (!outputArg || !sourceArg) throw new Error('Use --live --output <new .tmp directory> --source <frozen report snapshot>')
const output = path.resolve(outputArg)
const relative = path.relative(path.join(root, '.tmp'), output)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a new child of repository .tmp')
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output)
const { loadConfig } = await import('../src/config')
const config = loadConfig(), provider = config.aiText
if (!provider.apiKey || !provider.baseUrl) throw new Error('Configured text provider required')
const originalUrl = new URL(config.databaseUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(originalUrl.hostname)) throw new Error('Settings may only be read from the local development DB')
let savedSettings: unknown
const sourceDb = new Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 })
try {
  await sourceDb.connect()
  await sourceDb.query('BEGIN READ ONLY')
  const row = (await sourceDb.query<{ value: string }>("SELECT value FROM app_settings WHERE key='ai_settings'")).rows[0]
  savedSettings = row ? JSON.parse(row.value) : {}
} finally { await sourceDb.query('ROLLBACK').catch(() => {}); await sourceDb.end() }
process.env.DATABASE_URL = 'postgres://isolated/unused'
const { createTestDb } = await import('../src/test/db')
const { setDbForTests } = await import('../src/db/pool')
const { saveAiSettings } = await import('../src/services/ai/settings')
const { captureAnalysisSources } = await import('../src/services/ai/novel-analysis-source')
const { generationContentRevision } = await import('../src/services/ai/generations')
const { chatEndpoint } = await import('../src/services/ai/client')
const { app } = await import('../src/app')
const t = await createTestDb(path.join(output, 'database'))
await t.applyMigrations()
setDbForTests(t.db)
const settings = await saveAiSettings(t.db, savedSettings)
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const clean = (value: unknown) => JSON.stringify(value, (key, v) => key === 'reasoning_content' || key === 'reasoningContent' ? undefined : v, 2)
  .replaceAll(provider.apiKey, '[credential]')
const save = async (name: string, value: unknown) => writeFile(path.join(output, name), clean(value) + '\n')
type Item = Record<string, any>
const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = []
const cases: Item[] = [], requests: Item[] = [], errors: Item[] = []
let stage = 'setup', token = '', modelCalls = 0, injectedFailures = 0, blockStage = false
const started = Date.now()
const endpoint = chatEndpoint(provider.baseUrl), providerOrigin = new URL(endpoint).origin
const realFetch = globalThis.fetch, realError = console.error
const captures: Promise<void>[] = []
console.error = () => { errors.push({ stage, category: 'application_diagnostic', at: new Date().toISOString() }) }
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) })
  console.log(JSON.stringify({ check: name, passed: !!passed }))
}
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== endpoint || init?.method !== 'POST') {
    const target = new URL(url)
    if (target.origin === providerOrigin && (!init?.method || init.method === 'GET') && ['/api/status', '/api/log/token'].includes(target.pathname))
      return realFetch(input, { ...init, redirect: 'error' })
    throw new Error('Evaluation blocked an unexpected outbound request')
  }
  if (blockStage) { injectedFailures++; return new Response('{"error":{"message":"evaluation controlled failure"}}', { status: 400, headers: { 'Content-Type': 'application/json' } }) }
  if (modelCalls >= maxRequests || Date.now() - started > plan.maxMinutes * 60_000 || requests.filter(r => r.stage === stage).length >= 8)
    throw new Error('Evaluation budget reached')
  const body = JSON.parse(String(init.body))
  const trace: Item = { stage, call: ++modelCalls, startedAt: new Date().toISOString(), request: body }
  requests.push(trace)
  await save('requests.json', requests)
  console.log(JSON.stringify({ stage, modelCall: trace.call, state: 'started' }))
  try {
    const response = await realFetch(input, { ...init, redirect: 'error',
      signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(plan.maxRequestSeconds * 1000)]) })
    const clone = response.clone()
    captures.push((async () => {
      let text = '', finishReason = '', model = '', usage: unknown, toolCalls: unknown[] = []
      const collect = (data: Item) => {
        model = data.model || model
        const choice = data.choices?.[0]
        text += choice?.delta?.content || choice?.message?.content || ''
        finishReason = choice?.finish_reason || finishReason
        usage = data.usage || usage
        toolCalls = toolCalls.concat(choice?.delta?.tool_calls || choice?.message?.tool_calls || [])
      }
      try {
        const raw = await clone.text()
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          for (const line of raw.split('\n')) if (line.startsWith('data:') && !line.includes('[DONE]')) {
            try { collect(JSON.parse(line.slice(5))) } catch { /* Transport parsing remains the product's responsibility. */ }
          }
        } else if (response.ok) collect(JSON.parse(raw))
        trace.response = { status: response.status, model, finishReason, text, toolCalls, usage }
      } catch { trace.response = { status: response.status, captureIncomplete: true } }
      trace.durationMs = Date.now() - Date.parse(trace.startedAt)
      await save('requests.json', requests)
      console.log(JSON.stringify({ stage: trace.stage, modelCall: trace.call, state: 'received', finishReason, characters: text.length }))
    })())
    return response
  } catch (error) {
    trace.error = error instanceof Error ? error.name : 'transport'
    await save('requests.json', requests)
    throw error
  }
}
async function request(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await app.request(route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json() as Item
  if (!route.startsWith('/api/auth/')) cases.push({ stage, route, method, input: body, status: response.status, data })
  return { status: response.status, data }
}
async function waitTask(id: string) {
  if (!id) throw new Error('Missing task receipt')
  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    const row = (await t.db.query<Item>('SELECT * FROM ai_tasks WHERE id=$1', [id])).rows[0]
    if (row && !['queued', 'running'].includes(row.status)) { cases.push({ stage, task: row }); return row }
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  await t.db.query("UPDATE ai_tasks SET status='cancelled' WHERE id=$1", [id])
  throw new Error('Evaluation task deadline reached')
}
async function draftFor(taskId: string) {
  return (await t.db.query<Item>("SELECT * FROM ai_generations WHERE params_json::jsonb->>'taskId'=$1 ORDER BY created_at", [taskId])).rows[0]
}
async function writing(label: string, route: string, body: Item) {
  stage = label
  const receipt = await request(route, { ...body, operationId: randomUUID() })
  check(label + ':accepted', receipt.status === 202, receipt.status)
  if (receipt.status !== 202) return undefined
  const task = await waitTask(receipt.data.taskId)
  check(label + (label === 'controlled-failure' ? ':failed-as-injected' : ':completed'), task.status === (label === 'controlled-failure' ? 'failed' : 'completed'), { status: task.status, error: task.error })
  return { task, draft: await draftFor(task.id) }
}
async function agentTurn(sessionId: string, label: string, content: string) {
  stage = label
  const receipt = await request(`/api/ai/agent/sessions/${sessionId}/messages`, { content, requestId: randomUUID() })
  check(label + ':accepted', receipt.status === 202, receipt.status)
  if (receipt.status !== 202) return undefined
  const task = await waitTask(receipt.data.taskId)
  check(label + ':completed', task.status === 'completed', { status: task.status, error: task.error })
  // A turn may finish before its generated draft/report; await real child tasks before changing stage.
  const children = (await t.db.query<Item>('SELECT task_id FROM ai_agent_artifacts WHERE session_id=$1', [sessionId])).rows
  for (const child of children) {
    const task = await waitTask(child.task_id)
    check(label + ':child-completed', task.status === 'completed', { kind: task.kind, status: task.status, error: task.error })
  }
  const detail = await request(`/api/ai/agent/sessions/${sessionId}`)
  await save(label + '.json', detail.data)
  return detail.data
}
async function seedBook(id: string, title: string, chapters: Array<{ id: string; title: string; content: string; order: number }>) {
  await t.db.query('INSERT INTO novels(id,title,chapter_count,created_at,updated_at) VALUES($1,$2,$3,1,1)', [id, title, chapters.length])
  for (const c of chapters) await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [c.id, id, c.title, c.content, c.order])
}
async function persist() {
  await save('cases.json', cases)
  await save('generations.json', (await t.db.query('SELECT * FROM ai_generations ORDER BY created_at,id')).rows)
  const usage = (await t.db.query('SELECT generation_type,model,prompt_tokens,completion_tokens,reasoning_tokens,token_usage_reported,cost_millicents,cost_reported,cost_currency FROM ai_usage ORDER BY created_at,id')).rows
  await save('summary.json', { ...plan, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDiffHash: hash(execFileSync('git', ['diff', 'HEAD', '--', 'api/src', 'shared'], { cwd: root, encoding: 'utf8' })),
    model: provider.model, settings: { writingReasoningMode: settings.writingReasoningMode, writingMaxTokens: settings.writingMaxTokens,
      reviewMaxTokens: settings.reviewMaxTokens, storyMemoryReasoningMode: settings.storyMemoryReasoningMode, storyMemoryChapterMaxTokens: settings.storyMemoryChapterMaxTokens },
    startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), modelCalls, injectedFailures, checks, errors, usage,
    semanticReview: 'pending-code-assisted-review', browserValidation: false, iosBuild: false })
}
try {
  const auth = await request('/api/auth/bootstrap-admin', { username: 'integrationreview', password: randomUUID() })
  if (auth.status !== 200 && auth.status !== 201) throw new Error('Isolated account setup failed')
  token = auth.data.token
  const user = (await t.db.query<{ id: string }>('SELECT id FROM users LIMIT 1')).rows[0]!.id
  const fixture = JSON.parse(await readFile(path.join(root, 'api/scripts/fixtures/story-memory-v9-unseen.json'), 'utf8')) as Array<{ title: string; text: string }>
  await seedBook('trial', '温室交班 · 集成复核', fixture.slice(0, 3).map((c, i) => ({ id: `t${i + 1}`, title: c.title, content: c.text, order: i + 1 }))
    .concat([{ id: 't4', title: '未来边界', content: '未来边界专用暗号 FUTURE_REPORT_SENTINEL_781。', order: 4 }]))
  await seedBook('other', '另一部作品', [{ id: 'o1', title: '异书来源', content: 'OTHER_BOOK_SENTINEL_193，人物名是独立的顾舟。', order: 1 }])
  for (const [table, column] of [['novel_style_profiles', 'profile'], ['novel_plot_states', 'state'], ['novel_relationship_profiles', 'profile']])
    await t.db.query(`INSERT INTO ${table}(novel_id,${column},created_at) VALUES('trial','LEGACY_ARCHIVE_SENTINEL_651：铜牌仍由迟夏保管，西棚水泵坏了。',1)`)
  const originalChapters = hash((await t.db.query('SELECT id,content FROM chapters ORDER BY id')).rows)
  stage = 'analysis-create'
  const created = await request('/api/ai/analysis/trial', { requestId: randomUUID(), request: { kind: 'plot', startChapterId: 't1', endChapterId: 't3', question: '约500字核对人物认知、铜牌归属、两个水泵状态、计划取消和替换、封筒状态。引用来源，不添加未来情节。' } })
  check('analysis:accepted', created.status === 201)
  const analysisTask = await waitTask(created.data.taskId)
  check('analysis:completed', analysisTask.status === 'completed', analysisTask.error)
  let report = (await request(`/api/ai/analysis/trial/${created.data.reportId}`)).data
  if (!report.content) throw new Error('No completed report to review')
  await save('generated-analysis.json', report)
  const editedContent = report.content + '\n\n人工核对：铜牌当前由郁禾保管，封筒仍关闭且内容未知；不要把梅涔对西棚水泵的误解写成客观故障。[[S2]] [[S3]]\n修订识别标记：REPORT_REVISION_CANARY_247。此标记仅供检查资料是否被载入，不应出现在小说正文。'
  const edited = await request(`/api/ai/analysis/trial/${report.id}`, { content: editedContent, revision: report.revision }, 'PATCH')
  check('analysis:edit', edited.status === 200)
  report = (await request(`/api/ai/analysis/trial/${report.id}`)).data
  const selected = [{ reportId: report.id, revision: report.revision }]
  const base: Item = { novelId: 'trial', afterChapterId: 't3', analysisReferences: selected, targetWords: 500, maxTokens: 6500 }
  const preview = await request('/api/ai/writing/materials', base)
  check('materials:edited-report-selected', preview.status === 200 && JSON.stringify(preview.data).includes('REPORT_REVISION_CANARY_247'))
  check('materials:no-old-archive-or-future', !/LEGACY_ARCHIVE_SENTINEL|FUTURE_REPORT_SENTINEL/.test(JSON.stringify(preview.data)))
  stage = 'plot-suggestions'
  const plot = await request('/api/ai/writing/plot-suggestions', { ...base, focus: '围绕温室工作和人物误解给出后续方向，封筒暂不打开，铜牌暂不交接。' })
  check('plot:returned', plot.status === 200 && !!plot.data.suggestions?.length, plot.status)
  const outline = await writing('outline', '/api/ai/writing/outline', { ...base, title: '水泵旁的误会', instruction: '只写下一章的简短大纲，先核对故障位置，再在工作对话中推进误解。封筒保持关闭，铜牌不再转手。' })
  const continuation = await writing('continuation', '/api/ai/writing/continue', { ...base, chapterCount: 1,
    instruction: '写约500字温室日常。以对话澄清西棚水泵的误解；东棚新滤芯暂未装好，铜牌不再转手，封筒保持关闭。只写一章。', outline: outline?.draft?.result || '' })
  if (continuation?.draft) {
    const frozen = JSON.parse(continuation.draft.params_json).continuationSnapshot
    check('continuation:report-frozen', frozen?.version === 2 && frozen.analysisReferences?.[0]?.revision === report.revision && frozen.analysisReferences[0].content === editedContent)
    stage = 'draft-review'
    const reviewed = await request(`/api/ai/writing/drafts/${continuation.draft.id}/review`, { expectedRevision: generationContentRevision(continuation.draft.result) })
    check('review:completed-with-analysis', reviewed.status === 200 && reviewed.data.report?.sources?.some((s: Item) => s.reportId === report.id), reviewed.status)
  }
  const session = (await request('/api/ai/agent/sessions', { novelId: 'trial', afterChapterId: 't3' })).data.session
  await agentTurn(session.id, 'agent-read', '先查看本书可用的小说分析目录并阅读最新情节报告，再回读有关正文：铜牌现在由谁保管，坏的是哪台水泵，谁误会了？请给出依据。只查阅和回答，不生成分析或草稿。')
  await agentTurn(session.id, 'agent-generate', '现在请根据刚读过的分析修订版本生成一章约500字的草稿，显式固定这份报告版本。写温室工作对话并澄清水泵误解；封筒不打开，铜牌不转手，新滤芯暂未装好。不要发布。')
  const noReport = await writing('no-report', '/api/ai/writing/continue', { ...base, analysisReferences: [], instruction: '写约500字日常对话，保持正文中的物品归属和水泵状态，封筒暂不打开。', chapterCount: 1 })
  if (noReport?.draft) check('no-report:frozen-empty', JSON.parse(noReport.draft.params_json).continuationSnapshot.analysisReferences.length === 0)
  stage = 'boundary-checks'
  const beforeBoundaries = modelCalls
  for (const [name, body, expected] of [
    ['cross-book', { ...base, novelId: 'other', afterChapterId: 'o1' }, 404],
    ['future-report', { ...base, afterChapterId: 't2' }, 409],
    ['wrong-revision', { ...base, analysisReferences: [{ reportId: report.id, revision: 1 }] }, 409],
  ] as const) { const r = await request('/api/ai/writing/continue', body); check('boundary:' + name, r.status === expected, r.status) }
  await t.db.query("UPDATE chapters SET content=content||'正文已更正。' WHERE id='t1'")
  const stale = await request('/api/ai/writing/continue', base)
  check('boundary:stale-source', stale.status === 409, stale.status)
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [fixture[0]!.text, 't1'])
  for (const route of ['style-profile', 'relationship-profile', 'plot-state', 'memory/trial/rebuild']) {
    const retired = await request('/api/ai/writing/' + route, { novelId: 'trial' })
    check('retired:' + route, retired.status === 410)
  }
  check('boundaries:no-model-calls', beforeBoundaries === modelCalls)
  blockStage = true
  const failed = await writing('controlled-failure', '/api/ai/writing/continue', { ...base, instruction: '约500字温室工作对话，保持已知状态。', chapterCount: 1 })
  blockStage = false
  check('failure:retained-without-draft', failed?.task.status === 'failed' && !failed.draft)
  if (failed) {
    stage = 'retry-valid'
    const retried = await request(`/api/ai/tasks/${failed.task.id}/retry`, { operationId: randomUUID() })
    check('retry:accepted', retried.status === 202, retried.status)
    if (retried.status === 202) { const task = await waitTask(retried.data.taskId); check('retry:completed', task.status === 'completed', task.error) }
    await request(`/api/ai/analysis/trial/${report.id}`, { content: editedContent + '\n再次修订，仅检查版本冲突。', revision: report.revision }, 'PATCH')
    const beforeRetry = modelCalls
    const blocked = await request(`/api/ai/tasks/${failed.task.id}/retry`, { operationId: randomUUID() })
    check('retry:changed-report-rejected', blocked.status === 409 && modelCalls === beforeRetry, blocked.status)
  }
  check('source:synthetic-chapters-unchanged', originalChapters === hash((await t.db.query('SELECT id,content FROM chapters ORDER BY id')).rows))
  stage = 'real-corpus-setup'
  const raw = await readFile(path.resolve(sourceArg), 'utf8')
  const snapshot = JSON.parse(raw) as { source_json: AnalysisSource[]; content: string; edited_content: string | null; request_json: Item }
  const groups = new Map<string, AnalysisSource[]>()
  for (const s of snapshot.source_json) groups.set(s.chapterId, [...(groups.get(s.chapterId) || []), s])
  const realChapters = [...groups.values()].map(parts => ({ id: parts[0]!.chapterId, title: parts[0]!.chapterTitle,
    order: parts[0]!.chapterOrdinal, content: parts.sort((a, b) => a.offset - b.offset).map(p => p.text).join('') }))
  await seedBook('real', '真实作品冻结副本', realChapters)
  const realRequest = { ...snapshot.request_json, startChapterId: realChapters[0]!.id, endChapterId: realChapters.at(-1)!.id }
  const sources = await captureAnalysisSources(t.db, 'real', realRequest as never)
  check('real:source-text-identical', sources.length === snapshot.source_json.length && sources.every((s, i) => s.text === snapshot.source_json[i]!.text && s.id === snapshot.source_json[i]!.id))
  await t.db.query(`INSERT INTO novel_analysis_reports(id,novel_id,user_id,request_id,request_json,source_json,content,revision,task_id,created_at,updated_at)
    VALUES('real-report','real',$1,'real-frozen-report',$2::jsonb,$3::jsonb,$4,1,'frozen-completed',1,1)`, [user, JSON.stringify(realRequest), JSON.stringify(sources), snapshot.edited_content ?? snapshot.content])
  await save('real-source-manifest.json', { snapshotSha256: hash(raw), chapters: realChapters.length, sourcePieces: sources.length,
    characters: realChapters.reduce((n, c) => n + c.content.length, 0), reportSha256: hash(snapshot.edited_content ?? snapshot.content),
    note: 'Frozen normalized text reconstructed in isolated DB; reference revisions recomputed for cloned chapter ordering. Original snapshot unchanged.' })
  const realBase = { novelId: 'real', afterChapterId: realChapters.at(-1)!.id, analysisReferences: [{ reportId: 'real-report', revision: 1 }], targetWords: 500, maxTokens: 6500 }
  const realPreview = await request('/api/ai/writing/materials', realBase)
  check('real:report-selected', realPreview.status === 200 && realPreview.data.analysisReferences?.[0]?.id === 'real-report', realPreview.status)
  await writing('real-continuation', '/api/ai/writing/continue', { ...realBase, chapterCount: 1,
    instruction: '写约500字下一章的开头。延续人物与现实状态，以白天公共场所的普通日常对话推进，尊重报告和最近正文的事实。不得包含成人露骨内容，不写亲密行为；不重演已结束的游戏或已经发生的事件。只写一章。' })
  const realSession = (await request('/api/ai/agent/sessions', { novelId: 'real', afterChapterId: realChapters.at(-1)!.id })).data.session
  await agentTurn(realSession.id, 'real-agent-read', '请先查看并阅读本书现有情节分析，再回读最后一章，简短说明结尾处人物的现实关系和仍不能确认的事，区分报告判断与原文事实。只做非露骨事实概述并给出引用，不生成新分析或草稿。')
  await Promise.all(captures)
  check('all-prompts:no-legacy-archive', requests.every(r => !JSON.stringify(r.request).includes('LEGACY_ARCHIVE_SENTINEL_651')))
  check('synthetic-prompts:no-cross-book-future', requests.filter(r => !r.stage.startsWith('real')).every(r => !/OTHER_BOOK_SENTINEL_193|FUTURE_REPORT_SENTINEL_781/.test(JSON.stringify(r.request))))
  check('agent:old-tools-not-exposed', requests.filter(r => r.request.tools).every(r => !r.request.tools.some((x: Item) => ['read_story_memory', 'refresh_memory'].includes(x.function.name))))
  check('no-report:request-excludes-report', requests.filter(r => r.stage === 'no-report').every(r => !JSON.stringify(r.request).includes('REPORT_REVISION_CANARY_247')))
  for (const name of ['plot-suggestions', 'outline', 'continuation', 'draft-review'])
    check(name + ':wire-includes-edited-report', requests.some(r => r.stage === name && JSON.stringify(r.request).includes('REPORT_REVISION_CANARY_247')))
} catch (error) {
  errors.push({ stage, category: 'runner', message: error instanceof Error ? error.message.replaceAll(provider.apiKey, '[credential]') : 'unknown' })
  console.log(JSON.stringify({ stage, stopped: true, error: errors.at(-1) }))
} finally {
  blockStage = false
  await Promise.allSettled(captures)
  await persist()
  try {
    const evidence = await verifyRecords(output)
    if (evidence.some(item => !item.passed)) process.exitCode = 1
  } catch { process.exitCode = 1 }
  if (checks.some(item => !item.passed) || errors.some(error => error.category === 'runner')) process.exitCode = 1
  globalThis.fetch = realFetch
  console.error = realError
  setDbForTests(null)
  await t.close()
  console.log(JSON.stringify({ output, modelCalls, checks: checks.length, failed: checks.filter(c => !c.passed).length, runnerErrors: errors.filter(e => e.category === 'runner').length }))
}
