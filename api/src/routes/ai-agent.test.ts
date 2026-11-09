import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { loadConfig } from '../config'
import { setDbForTests } from '../db/pool'
import { all, first } from '../db/query'
import { createTestDb, type TestDb } from '../test/db'
import { createSession } from '../services/sessions'
import { createAgentSession, beginAgentTurn, readAgentEvents, trackAgentArtifact, appendAgentEvent } from '../services/ai/agent-store'
import { agentApiAdapter } from './ai-agent'
import { confirmAgentAction, prepareAgentAction, readAgentArtifact } from '../services/ai/agent-actions'
import { executeAgentTool, validateAgentCall } from '../services/ai/agent-tools'
import { runAgentTurn } from '../services/ai/agent'
import { buildRewriteTaskParams } from '../services/ai/rewrite'
import { cancelAiTask, createAiTask, failInterruptedAiTasks, getAiTask, updateAiTask } from '../services/ai/tasks'
import { setAgentPhase } from '../services/ai/agent-recovery'
import { generationContentRevision } from '../services/ai/generations'
import { replaceCoverForAdmin } from '../services/covers'
import { AiError, type AiToolCall } from '../services/ai/client'
import type { AgentSession, AgentSessionDetail } from '@shared/ai-agent'
import { subscribeAiTask } from '../services/ai/task-events'
import { activeAgentMemories, changeAgentMemory, createAgentMemory, getAgentSummary, listAgentMemories, saveAgentSummary } from '../services/ai/agent-memory'
import { loadAgentContext, parseAgentSummary } from '../services/ai/agent-context'

const presetMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ai/provider-presets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/ai/provider-presets')>()),
  getProviderPreset: presetMock,
}))

let t: TestDb
let adminToken = ''
let otherToken = ''
let readerToken = ''
const fetchMock = vi.fn<typeof fetch>()
const originalEnv = new Map<string, string | undefined>()
const keys = ['DATABASE_URL', 'AI_TEXT_BASE_URL', 'AI_TEXT_API_KEY', 'AI_TEXT_MODEL', 'AI_IMAGE_BASE_URL', 'AI_IMAGE_API_KEY', 'AI_IMAGE_MODEL', 'COVER_FETCH_ENABLED']
const summaryContent = { goal: '继续讨论情节', decisions: ['#1 作者确认保留悬念'], rejected: ['#2 作者否定立即和解'], openQuestions: ['#3 助手建议尚未确认'], nextSteps: ['#4 待检查草稿'], references: ['#1'] }
const original = '他转身离开。她没有开口。'

describe('manual agent recovery', () => {
  async function interrupted(status: 'failed' | 'cancelled' = 'failed', preset = '') {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel', afterChapterId: 'chapter' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '继续讨论雨夜冲突', 'interrupted_request', { providerPresetId: preset, model: 'mock-agent' })
    await setAgentPhase(t.db, turn.taskId, 'retrieval', '正在查阅资料')
    if (status === 'cancelled') await cancelAiTask(t.db, turn.taskId)
    else await updateAiTask(t.db, turn.taskId, { status: 'failed', error: '模拟中断' })
    return { session, taskId: turn.taskId, path: `/api/ai/agent/sessions/${session.id}/tasks/${turn.taskId}/resume` }
  }
  it.each(['failed', 'cancelled'] as const)('requires confirmation and deduplicates concurrent retries of a %s turn', async status => {
    const { session, taskId, path } = await interrupted(status, 'text-preset')
    expect((await request(path, 'POST', {})).status).toBe(422)
    expect(fetchMock).not.toHaveBeenCalled()
    const responses = await Promise.all([request(path, 'POST', { confirmModelCall: true }), request(path, 'POST', { confirmModelCall: true })])
    expect(responses.map(r => r.status)).toEqual([202, 202])
    const turns = await Promise.all(responses.map(r => r.json() as Promise<{ taskId: string; created: boolean }>))
    expect(turns[0]!.taskId).toBe(turns[1]!.taskId)
    expect(turns.filter(turn => turn.created)).toHaveLength(1)
    expect((await waitTask(turns[0]!.taskId))?.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
    expect(body.model).toBe('selected-model')
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('read_task')
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).not.toContain('generate_cover')
    const replay = await (await request(path, 'POST', { confirmModelCall: true })).json()
    expect(replay).toEqual({ taskId: turns[0]!.taskId, created: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await getAiTask(t.db, taskId))?.status).toBe(status)
    expect((await readAgentEvents(t.db, session.id)).events.filter(e => e.metadata.recoveryFromTaskId === taskId)).toHaveLength(1)
  })
  it('rejects foreign sessions and superseded tasks without a model request', async () => {
    const { session, path } = await interrupted()
    expect((await request(path, 'POST', { confirmModelCall: true }, otherToken)).status).toBe(404)
    const another = await createAgentSession(t.db, 'admin', { novelId: 'other-novel' })
    expect((await request(path.replace(session.id, another.id), 'POST', { confirmModelCall: true })).status).toBe(404)
    await beginAgentTurn(t.db, 'admin', session.id, '新的请求', 'newer_request')
    expect((await request(path, 'POST', { confirmModelCall: true })).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('recovers persisted state after lease expiry without automatically replaying work', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '读一下资料', 'restart_request')
    const artifact = await createAiTask(t.db, { userId: 'admin', novelId: 'novel', kind: 'write_chapter' })
    const partial = JSON.stringify({ kind: 'text-progress', phase: 'writing', preview: '已保存的草稿片段', generatedCharacters: 8, reasoningCharacters: 0, startedAt: 1, updatedAt: 2 })
    await updateAiTask(t.db, artifact.id, { status: 'running', result: partial })
    await trackAgentArtifact(t.db, session.id, artifact.id)
    await setAgentPhase(t.db, turn.taskId, 'retrieval', '正在查阅')
    await appendAgentEvent(t.db, session.id, 'activity', '较早的失败', turn.taskId, { tool: 'read_chapter', error: true, failurePhase: 'model' })
    await t.db.query('UPDATE ai_tasks SET lease_expires_at=1 WHERE id=$1', [turn.taskId])
    await expect(setAgentPhase(t.db, turn.taskId, 'model', '过期执行')).rejects.toMatchObject({ code: 'cancelled' })
    await failInterruptedAiTasks(t.db)
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    const result = await (await request(`/api/ai/agent/sessions/${session.id}`)).json() as AgentSessionDetail
    expect(result.activeTask?.status).toBe('failed')
    expect(result.recovery).toMatchObject({ taskId: turn.taskId, phase: 'retrieval', canResume: true })
    expect(result.artifacts[0]?.task).toMatchObject({ id: artifact.id, result: partial, updatedAt: expect.any(Number) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects an entire injected write-tool batch and preserves existing outputs and actions', async () => {
    const { session, path } = await interrupted()
    await draft()
    const artifactId = await finishedRewrite(session.id)
    const action = await prepareAgentAction(t.db, session, 'apply_rewrite', artifactId)
    fetchMock.mockResolvedValueOnce(completion('', [call('read_overview', {}, 'read'), call('generate_cover', { instruction: '重复付费生成' }, 'write')]))
    const response = await request(path, 'POST', { confirmModelCall: true })
    expect(response.status).toBe(202)
    const { taskId } = await response.json() as { taskId: string }
    expect((await waitTask(taskId))?.status).toBe('failed')
    const result = await (await request(`/api/ai/agent/sessions/${session.id}`)).json() as AgentSessionDetail
    expect(result.recovery).toMatchObject({ taskId, phase: 'model' })
    expect(result.artifacts.map(item => item.task.id)).toContain(artifactId)
    expect(result.actions.find(item => item.id === action.id)?.status).toBe('pending')
    expect(result.events.some(event => event.taskId === taskId && event.metadata.tool)).toBe(false)
    expect(await all(t.db, "SELECT id FROM ai_tasks WHERE kind='cover'" )).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await all(t.db, 'SELECT result FROM ai_generations')).toEqual([{ result: original }])
  })
  it('allows read tools in recovery and returns saved evidence before answering', async () => {
    const { session, path } = await interrupted()
    fetchMock.mockResolvedValueOnce(completion('', [call('read_chapter', { chapterId: 'chapter' })])).mockResolvedValueOnce(completion('根据已保存的资料，冲突仍未解决。'))
    const { taskId } = await (await request(path, 'POST', { confirmModelCall: true })).json() as { taskId: string }
    expect((await waitTask(taskId))?.status).toBe('completed')
    const events = (await readAgentEvents(t.db, session.id)).events
    expect(events.find(e => e.taskId === taskId && e.metadata.tool === 'read_chapter')?.metadata.sources?.length).toBeGreaterThan(0)
    expect(events.at(-1)?.content).toContain('根据已保存的资料')
  })
  it('finds an accepted request outside the current event page without starting another turn', async () => {
    const { session, taskId } = await interrupted()
    for (let i = 0; i < 65; i++) await appendAgentEvent(t.db, session.id, 'activity', `资料记录 ${i}`)
    const result = await (await request(`/api/ai/agent/sessions/${session.id}?requestId=interrupted_request`)).json() as AgentSessionDetail
    expect(result.messageReceipt).toEqual({ requestId: 'interrupted_request', taskId })
    expect(result.events.some(e => e.requestId === 'interrupted_request')).toBe(false)
    const missing = await (await request(`/api/ai/agent/sessions/${session.id}?requestId=not_received`)).json() as AgentSessionDetail
    expect(missing.messageReceipt).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['assistant', 'activity'] as const)('classifies a failed %s save without making another model call', async role => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '先查阅资料', 'failed_save_request')
    fetchMock.mockResolvedValueOnce(role === 'assistant' ? completion('未保存的回复') : completion('', [call('read_overview')]))
    let rejectSave = true
    const failingDb: typeof t.db = { ...t.db, query: async <T>(sql: string, params?: unknown[]) => {
      if (rejectSave && sql.includes('INSERT INTO ai_agent_events') && params?.[1] === role) {
        rejectSave = false
        throw new Error('模拟保存中断')
      }
      return t.db.query<T>(sql, params)
    } }
    await runAgentTurn(failingDb, session, turn.taskId, 'admin', internalApi())
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('failed')
    const result = await (await request(`/api/ai/agent/sessions/${session.id}`)).json() as AgentSessionDetail
    expect(result.recovery?.phase).toBe('save')
    expect(result.events.some(e => e.content === '未保存的回复')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
function completion(text: string, calls?: AiToolCall[], reasoning?: string) {
  return Response.json({
    model: 'mock-agent',
    choices: [{ message: { content: text, ...(calls ? { tool_calls: calls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
    cost: 0.0001,
  })
}
const call = (name: string, args: Record<string, unknown> = {}, id = 'tool_1'): AiToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})
function request(path: string, method = 'GET', body?: unknown, token = adminToken) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const internalApi = () =>
  agentApiAdapter(new Request('http://localhost/api/ai/agent/sessions', { headers: { Authorization: `Bearer ${adminToken}` } }), (r) => app.fetch(r))
async function draft(id = 'draft', novelId = 'novel', text = original) {
  await t.db.query(
    "INSERT INTO ai_generations(id,novel_id,chapter_id,kind,model,params_json,prompt,result,status,created_by,created_at) VALUES($1,$2,'','write_chapter','mock',$3,'',$4,'draft','admin',$5)",
    [id, novelId, JSON.stringify({ draftTitle: '雨后' }), text, Date.now()],
  )
}
async function finishedRewrite(sessionId: string) {
  const selectedText = '他转身离开。'
  const params = buildRewriteTaskParams('draft', original, {
    baseRevision: generationContentRevision(original),
    selectedText,
    startUTF16: 0,
    endUTF16: selectedText.length,
    mode: 'custom',
    instruction: '让他犹豫一下',
  })
  const task = await createAiTask(t.db, { userId: 'admin', novelId: 'novel', kind: 'rewrite_selection', params: JSON.stringify(params) })
  await updateAiTask(t.db, task.id, { status: 'completed', result: JSON.stringify({ version: 1, suggestion: '他在门边停住了。' }) })
  await trackAgentArtifact(t.db, sessionId, task.id)
  return task.id
}
async function waitTask(id: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const task = await getAiTask(t.db, id)
    if (task && !['queued', 'running'].includes(task.status)) return task
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('mock task did not finish')
}

beforeAll(async () => {
  for (const key of keys) originalEnv.set(key, process.env[key])
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.AI_TEXT_BASE_URL = 'https://agent.test/v1'
  process.env.AI_TEXT_API_KEY = 'mock-key'
  process.env.AI_TEXT_MODEL = 'mock-agent'
  process.env.AI_IMAGE_BASE_URL = 'https://image.test/v1'
  process.env.AI_IMAGE_API_KEY = 'mock-image-key'
  process.env.AI_IMAGE_MODEL = 'mock-image'
  process.env.COVER_FETCH_ENABLED = '0'
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  for (const [id, role] of [
    ['admin', 'super_admin'],
    ['other', 'admin'],
    ['reader', 'reader'],
  ])
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,$2,'test','test',1,1)", [id, role])
  adminToken = await createSession(t.db, 'admin', 'test', loadConfig().sessionHashSalt)
  otherToken = await createSession(t.db, 'other', 'test', loadConfig().sessionHashSalt)
  readerToken = await createSession(t.db, 'reader', 'test', loadConfig().sessionHashSalt)
  for (const id of ['novel', 'other-novel', 'empty-novel'])
    await t.db.query("INSERT INTO novels(id,title,description,created_at,updated_at) VALUES($1,$1,'一部关于雨夜与和解的小说',1,1)", [id])
  for (const [id, novelId, sort] of [
    ['chapter', 'novel', 1],
    ['future', 'novel', 2],
    ['foreign', 'other-novel', 1],
  ])
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$1,$3,$4,1)', [id, novelId, original, sort])
  vi.stubGlobal('fetch', fetchMock)
})
beforeEach(async () => {
  presetMock.mockReset()
  presetMock.mockImplementation((id: string) => {
    if (id !== 'text-preset' && id !== 'image-preset') throw new AiError('invalid', '端点预设不存在', 404)
    return {
      id,
      name: '测试预设',
      scope: id === 'text-preset' ? 'text' : 'image',
      baseUrl: 'https://selected.test/v1',
      apiKey: 'selected-key',
      model: 'selected-model',
    }
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => completion('可以先保留分歧，让合作推动关系。'))
  await t.db.query('DELETE FROM ai_agent_memories')
  await t.db.query('DELETE FROM ai_agent_sessions')
  await t.db.query('DELETE FROM ai_generations')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_usage')
})
afterAll(async () => {
  vi.unstubAllGlobals()
  setDbForTests(null)
  for (const key of keys) {
    const value = originalEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await t.close()
})

describe('creative memory and context regressions', () => {
  const setup = () => createAgentSession(t.db, 'admin', { novelId: 'novel' })
  const manual = (session: AgentSession, title = '文风', content = '保持克制') => createAgentMemory(t.db, 'admin', session, { title, content })
  const context = (session: AgentSession, assertActive = async () => {}) => loadAgentContext(t.db, session, 'admin', new AbortController().signal, assertActive)
  async function longHistory(session: AgentSession, count = 65) {
    for (let i = 0; i < count; i++) await appendAgentEvent(t.db, session.id, i % 2 ? 'assistant' : 'user', `消息 ${i}：保留这条来源`)
  }
  async function proposal(session: AgentSession, supersedesId?: string) {
    await appendAgentEvent(t.db, session.id, 'user', '请记住：保留悬念')
    const source = (await readAgentEvents(t.db, session.id)).events.at(-1)!
    return createAgentMemory(t.db, 'admin', session, { title: '悬念', content: '保留悬念', sourceEventId: source.id, supersedesId }, true)
  }
  it('inherits confirmed agreements in new chats and isolates users and books', async () => {
    const session = await setup()
    const memory = await manual(session)
    const another = await setup()
    const detail = await (await request(`/api/ai/agent/sessions/${another.id}`)).json() as AgentSessionDetail
    expect(detail.memories?.map((item) => item.id)).toEqual([memory.id])
    expect(await activeAgentMemories(t.db, 'other', 'novel')).toEqual([])
    expect(await activeAgentMemories(t.db, 'admin', 'other-novel')).toEqual([])
    const turn = await beginAgentTurn(t.db, 'admin', another.id, '继续讨论', 'memory-inherited')
    await runAgentTurn(t.db, another, turn.taskId, 'admin', internalApi())
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('保持克制')
  })
  it('keeps tool proposals pending and anchors them to this turn after many activities', async () => {
    const session = await setup()
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '请记住保留悬念', 'proposal-turn')
    for (let i = 0; i < 35; i++) await appendAgentEvent(t.db, session.id, 'activity', '查阅章节', turn.taskId)
    const result = await executeAgentTool(t.db, session, 'propose_memory', { title: '悬念', content: '保留悬念' }, 'proposal-tool', internalApi(), 'admin', turn.taskId)
    expect(result.memory).toMatchObject({ status: 'pending' })
    expect(await activeAgentMemories(t.db, 'admin', 'novel')).toEqual([])
    const page = await listAgentMemories(t.db, 'admin', 'novel')
    const source = await (await request(`/api/ai/agent/sessions/${session.id}/memories/${page.memories[0]!.id}/source`)).json() as { source: { id: number; content: string } }
    expect(source.source.content).toBe('请记住保留悬念')
    expect(typeof source.source.id).toBe('number')
    await cancelAiTask(t.db, turn.taskId)
    const confirmed = await changeAgentMemory(t.db, 'admin', session, page.memories[0]!.id, { operation: 'confirm', expectedRevision: 1 })
    expect(confirmed.status).toBe('active')
  })
  it('keeps an active agreement out of other account and other book model requests', async () => {
    const owner = await setup()
    await manual(owner, '仅本人使用', '只以银杏为本书章节的末句意象')
    for (const [userId, novelId] of [['other', 'novel'], ['admin', 'other-novel']] as const) {
      const isolated = await createAgentSession(t.db, userId, { novelId })
      const turn = await beginAgentTurn(t.db, userId, isolated.id, '我的长期约定是什么？', `isolated-${userId}-${novelId}`)
      await runAgentTurn(t.db, isolated, turn.taskId, userId, async () => ({}))
      expect((await getAiTask(t.db, turn.taskId))?.status).toBe('completed')
    }
    expect(await activeAgentMemories(t.db, 'admin', 'novel')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      expect(String(init?.body)).not.toContain('只以银杏')
      expect(JSON.parse(String(init?.body)).messages[1].content).toContain('"creativeAgreements":[]')
    }
  })
  it('retains an old summary as history while presenting an empty current agreement list', async () => {
    const session = await setup()
    const memory = await manual(session, '旧约定', '只以银杏收尾')
    await appendAgentEvent(t.db, session.id, 'user', '请记住只以银杏收尾')
    const source = (await readAgentEvents(t.db, session.id)).events[0]!
    const oldSummary = { ...summaryContent, decisions: [`#${source.id} 作者确认长期保持只以银杏收尾`] }
    await saveAgentSummary(t.db, session, source.id, oldSummary)
    await changeAgentMemory(t.db, 'admin', session, memory.id, { operation: 'archive', expectedRevision: memory.revision })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '当前的长期约定有哪些？', 'archived-with-summary')
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const data = JSON.parse(body.messages[1].content.slice(body.messages[1].content.indexOf('{')))
    expect(data.creativeAgreements).toEqual([])
    expect(data.sessionSummary.content).toEqual(oldSummary)
    expect(await activeAgentMemories(t.db, 'admin', 'novel')).toEqual([])
    expect((await listAgentMemories(t.db, 'admin', 'novel')).memories[0]?.status).toBe('archived')
  })
  it('does not inject pending or archived memories into another chat', async () => {
    const session = await setup()
    await proposal(session)
    const old = await manual(session, '旧文风', '已经失效的特殊约定')
    await changeAgentMemory(t.db, 'admin', session, old.id, { operation: 'archive', expectedRevision: old.revision })
    const another = await setup()
    const turn = await beginAgentTurn(t.db, 'admin', another.id, '继续', 'no-retired-memory')
    await runAgentTurn(t.db, another, turn.taskId, 'admin', internalApi())
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.messages[1].content).toContain('"creativeAgreements":[]')
    expect(body.messages[1].content).not.toContain('已经失效的特殊约定')
  })
  it('confirms replacements atomically and replays confirmation safely', async () => {
    const session = await setup()
    const old = await manual(session)
    const pending = await proposal(session, old.id)
    expect((await activeAgentMemories(t.db, 'admin', 'novel'))[0]!.id).toBe(old.id)
    const confirmed = await changeAgentMemory(t.db, 'admin', session, pending.id, { operation: 'confirm', expectedRevision: 1 })
    expect((await activeAgentMemories(t.db, 'admin', 'novel')).map((item) => item.id)).toEqual([pending.id])
    expect(await changeAgentMemory(t.db, 'admin', session, pending.id, { operation: 'confirm', expectedRevision: 1 })).toEqual(confirmed)
    expect((await listAgentMemories(t.db, 'admin', 'novel')).memories.find((item) => item.id === old.id)?.status).toBe('superseded')
  })
  it('rejects replacement after its target changed without losing the new active version', async () => {
    const session = await setup()
    const old = await manual(session)
    const pending = await proposal(session, old.id)
    const edited = await changeAgentMemory(t.db, 'admin', session, old.id, { operation: 'edit', expectedRevision: 1, title: '新文风', content: '简洁清楚' })
    await expect(changeAgentMemory(t.db, 'admin', session, pending.id, { operation: 'confirm', expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
    expect((await activeAgentMemories(t.db, 'admin', 'novel')).map((item) => item.id)).toEqual([edited.id])
  })
  it('checks pending revisions and preserves draft status when edited', async () => {
    const session = await setup()
    const pending = await proposal(session)
    const edited = await changeAgentMemory(t.db, 'admin', session, pending.id, { operation: 'edit', expectedRevision: 1, title: '调整', content: '修改后的提议' })
    expect(edited).toMatchObject({ status: 'pending', revision: 2 })
    await expect(changeAgentMemory(t.db, 'admin', session, pending.id, { operation: 'confirm', expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
  })
  it('keeps manual creation idempotent even at capacity and does not truncate active context', async () => {
    const session = await setup()
    for (let i = 0; i < 24; i++) await manual(session, `约定 ${i}`)
    await expect(manual(session, '约定 0')).resolves.toMatchObject({ title: '约定 0' })
    await expect(manual(session, '第25条')).rejects.toMatchObject({ status: 409 })
    expect(await activeAgentMemories(t.db, 'admin', 'novel')).toHaveLength(24)
    const old = (await activeAgentMemories(t.db, 'admin', 'novel'))[0]!
    const pending = await proposal(session, old.id)
    await changeAgentMemory(t.db, 'admin', session, pending.id, { operation: 'confirm', expectedRevision: 1 })
    expect(await activeAgentMemories(t.db, 'admin', 'novel')).toHaveLength(24)
  })
  it('blocks mutations while another conversation for this book is running', async () => {
    const session = await setup()
    const old = await manual(session)
    const another = await setup()
    await beginAgentTurn(t.db, 'admin', another.id, '继续写作', 'memory-lock-turn')
    await expect(manual(session, '新的约定')).rejects.toMatchObject({ status: 409 })
    await expect(changeAgentMemory(t.db, 'admin', session, old.id, { operation: 'archive', expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
  })
  it('checks ownership for management, source access and forged proposal sources', async () => {
    const session = await setup()
    const pending = await proposal(session)
    const base = `/api/ai/agent/sessions/${session.id}/memories`
    expect((await request(base, 'GET', undefined, otherToken)).status).toBe(404)
    expect((await request(`${base}/${pending.id}/source`, 'GET', undefined, otherToken)).status).toBe(404)
    expect((await request(base, 'GET', undefined, readerToken)).status).toBe(403)
    const another = await createAgentSession(t.db, 'admin', { novelId: 'other-novel' })
    expect((await request(`/api/ai/agent/sessions/${another.id}/memories/${pending.id}/source`)).status).toBe(404)
    await appendAgentEvent(t.db, another.id, 'user', '别的作品')
    const message = (await readAgentEvents(t.db, another.id)).events.at(-1)!
    await expect(createAgentMemory(t.db, 'admin', session, { title: '伪造', content: '来源', sourceEventId: message.id }, true)).rejects.toMatchObject({ status: 422 })
  })
  it.each([0, -1, 1.5, null, 'bad'])('rejects invalid revision %s at the route', async (expectedRevision) => {
    const session = await setup()
    const memory = await manual(session)
    const response = await request(`/api/ai/agent/sessions/${session.id}/memories/${memory.id}`, 'PATCH', { operation: 'archive', expectedRevision })
    expect(response.status).toBe(422)
    expect(await activeAgentMemories(t.db, 'admin', 'novel')).toHaveLength(1)
  })
  it('validates length and prevents public proposal flags bypassing running locks', async () => {
    const session = await setup()
    const path = `/api/ai/agent/sessions/${session.id}/memories`
    expect((await request(path, 'POST', { title: 'x'.repeat(101), content: '正文' })).status).toBe(422)
    expect((await request(path, 'POST', { title: '标题', content: 'x'.repeat(1001) })).status).toBe(422)
    await beginAgentTurn(t.db, 'admin', session.id, '继续', 'cannot-bypass-lock')
    expect((await request(path, 'POST', { title: '标题', content: '正文', proposed: true })).status).toBe(409)
  })
  it('paginates retained history and keeps agreements when the source session is removed', async () => {
    const session = await setup()
    let memory = await manual(session)
    for (let i = 0; i < 51; i++) memory = await changeAgentMemory(t.db, 'admin', session, memory.id, { operation: 'edit', expectedRevision: memory.revision, title: `版本 ${i}`, content: '约定' })
    const firstPage = await listAgentMemories(t.db, 'admin', 'novel')
    expect(firstPage.memories).toHaveLength(50)
    expect(firstPage.hasMore).toBe(true)
    expect((await listAgentMemories(t.db, 'admin', 'novel', 50)).memories).toHaveLength(2)
    await t.db.query('DELETE FROM ai_agent_sessions WHERE id=$1', [session.id])
    expect((await activeAgentMemories(t.db, 'admin', 'novel'))[0]).toMatchObject({ id: memory.id, sessionId: '' })
  })
  it('summarizes the full omitted prefix and keeps raw events without repeated compaction', async () => {
    const session = await setup()
    await longHistory(session)
    fetchMock.mockImplementation(async () => completion(JSON.stringify(summaryContent)))
    const result = await context(session)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const input = JSON.parse(body.messages[1].content)
    const raw = await all<{ id: number }>(t.db, 'SELECT id FROM ai_agent_events WHERE session_id=$1 ORDER BY id', [session.id])
    expect(input.events.map((event: { id: number }) => Number(event.id))).toEqual(raw.slice(0, 45).map((event) => Number(event.id)))
    expect(result.history.events).toHaveLength(20)
    expect(result.summary?.throughEventId).toBe(Number(raw[44]!.id))
    expect(raw).toHaveLength(65)
    await appendAgentEvent(t.db, session.id, 'user', '下一步')
    expect((await context(session)).history.events).toHaveLength(21)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('merges incrementally with no gaps, session leakage or repeated source coverage', async () => {
    const session = await setup()
    await longHistory(session)
    fetchMock.mockImplementation(async () => completion(JSON.stringify(summaryContent)))
    const initial = await context(session)
    await longHistory(session, 45)
    const next = await context(session)
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    const input = JSON.parse(body.messages[1].content)
    expect(input.previousSummary).toEqual(summaryContent)
    const unread = await all<{ id: number }>(t.db, 'SELECT id FROM ai_agent_events WHERE session_id=$1 AND id>$2 AND id<=$3 ORDER BY id', [session.id, initial.summary!.throughEventId, next.summary!.throughEventId])
    expect(input.events.map((event: { id: number }) => Number(event.id))).toEqual(unread.map((event) => Number(event.id)))
    expect(await getAgentSummary(t.db, (await setup()).id)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not skip unread records in multi-batch historical catch-up', async () => {
    const session = await setup()
    await longHistory(session, 150)
    fetchMock.mockImplementation(async () => completion(JSON.stringify(summaryContent)))
    const result = await context(session)
    const sentIDs = fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(JSON.parse(String(init?.body)).messages[1].content).events.map((event: { id: number }) => Number(event.id)))
    const raw = await all<{ id: number }>(t.db, 'SELECT id FROM ai_agent_events WHERE session_id=$1 ORDER BY id', [session.id])
    expect([...sentIDs, ...result.history.events.map((event) => event.id)]).toEqual(raw.map((event) => Number(event.id)))
    expect(result.summary?.revision).toBe(3)
  })
  it('preserves the summary cursor on malformed responses and retries the same prefix explicitly', async () => {
    const session = await setup()
    await longHistory(session)
    fetchMock.mockResolvedValueOnce(completion('这不是结构化摘要'))
    await expect(context(session)).rejects.toMatchObject({ status: 422 })
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify(summaryContent)))
    await context(session)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages).toEqual(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).messages)
  })
  it('leaves cursor unchanged when cancelled after receiving the summary', async () => {
    const session = await setup()
    await longHistory(session)
    let cancelled = false
    fetchMock.mockImplementation(async () => { cancelled = true; return completion(JSON.stringify(summaryContent)) })
    await expect(context(session, async () => { if (cancelled) throw new AiError('cancelled', '已停止', 409) })).rejects.toMatchObject({ code: 'cancelled' })
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
  })
  it('diagnoses an oversized history record without sending or discarding it', async () => {
    const session = await setup()
    await appendAgentEvent(t.db, session.id, 'user', '密'.repeat(90001))
    await longHistory(session)
    await expect(context(session)).rejects.toMatchObject({ diagnostic: { stage: 'prepare', reason: 'input_too_long', eventCount: 1, limit: 90000, usageRecorded: false } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
    expect((await readAgentEvents(t.db, session.id, 0, 200)).events[0]?.content.length).toBe(90001)
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '继续', 'oversized_history')
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    const detail = await (await request(`/api/ai/agent/sessions/${session.id}`)).json() as AgentSessionDetail
    expect(detail.recovery).toMatchObject({ phase: 'summary', canResume: false })
    expect((await request(`/api/ai/agent/sessions/${session.id}/tasks/${turn.taskId}/resume`, 'POST', { confirmModelCall: true })).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['usage', 'persist'] as const)('diagnoses %s storage failure and preserves raw history', async (stage) => {
    const session = await setup()
    await longHistory(session)
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify(summaryContent)))
    const failingDb: typeof t.db = {
      ...t.db,
      query: async <T>(sql: string, params?: unknown[]) => {
        if (sql.includes(`INSERT INTO ${stage === 'usage' ? 'ai_usage ' : 'ai_agent_summaries('}`)) throw new Error('私密数据库连接错误')
        return t.db.query<T>(sql, params)
      },
    }
    let failure: unknown
    try { await loadAgentContext(failingDb, session, 'admin', new AbortController().signal, async () => {}) } catch (error) { failure = error }
    expect(failure).toMatchObject({ diagnostic: { stage, reason: `${stage}_failed`, usageRecorded: stage === 'persist', previousThroughEventId: 0 } })
    expect(JSON.stringify(failure)).not.toContain('私密')
    expect((failure as Error).message).not.toContain('私密')
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
    expect((await readAgentEvents(t.db, session.id, 0, 200)).events).toHaveLength(65)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['invalid_json', '私密原文不是JSON', undefined, undefined, undefined],
    ['invalid_structure', '[]', undefined, undefined, undefined],
    ['invalid_goal', JSON.stringify({ ...summaryContent, goal: '密'.repeat(801) }), 'goal', 801, 800],
    ['invalid_items', JSON.stringify({ ...summaryContent, decisions: undefined }), 'decisions', undefined, undefined],
    ['invalid_items', JSON.stringify({ ...summaryContent, decisions: Array(17).fill('私密决定') }), 'decisions', 17, 16],
    ['invalid_items', JSON.stringify({ ...summaryContent, rejected: ['密'.repeat(601)] }), 'rejected', 601, 600],
    ['output_too_long', '密'.repeat(14001), undefined, 14001, 14000],
  ] as const)('persists safe summary diagnostics for %s without advancing the cursor', async (reason, output, field, observed, limit) => {
    const session = await setup()
    await longHistory(session)
    const originalEvents = (await readAgentEvents(t.db, session.id, 0, 200)).events
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '继续', `diagnostic-${reason}`)
    fetchMock.mockResolvedValueOnce(completion(output))
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('failed')
    const failure = (await readAgentEvents(t.db, session.id)).events.at(-1)!
    expect(failure.content).toContain('再次发送“继续”')
    expect(failure.metadata.summaryDiagnostic).toMatchObject({ stage: 'validate', reason, previousThroughEventId: 0, eventCount: 46, usageRecorded: true, finishReason: 'stop', responseCharacters: output.length })
    expect(failure.metadata.summaryDiagnostic?.field).toBe(field)
    expect(failure.metadata.summaryDiagnostic?.observed).toBe(observed)
    expect(failure.metadata.summaryDiagnostic?.limit).toBe(limit)
    expect(JSON.stringify(failure)).not.toContain('私密')
    expect(JSON.stringify(failure)).not.toContain('密密')
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
    expect((await readAgentEvents(t.db, session.id, 0, 200)).events.filter(event => event.id <= originalEvents.at(-1)!.id)).toEqual(originalEvents)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await all(t.db, 'SELECT generation_type FROM ai_usage'))).toEqual([{ generation_type: 'agent_summary' }])
    const detail = await (await request(`/api/ai/agent/sessions/${session.id}`)).json() as AgentSessionDetail
    expect(detail.events.at(-1)?.metadata.summaryDiagnostic).toEqual(failure.metadata.summaryDiagnostic)
    expect(detail.recovery).toMatchObject({ taskId: turn.taskId, phase: 'summary', canResume: true })
  })
  it.each(['length', 'refusal', 'tool_calls'] as const)('diagnoses incomplete summary %s instead of saving partial content', async (kind) => {
    const session = await setup()
    await longHistory(session)
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '继续', `incomplete-${kind}`)
    fetchMock.mockResolvedValueOnce(Response.json({
      model: 'mock-agent',
      choices: [{ message: { content: JSON.stringify(summaryContent), ...(kind === 'refusal' ? { refusal: '私密上游拒绝详情' } : {}), ...(kind === 'tool_calls' ? { tool_calls: [call('read_overview')] } : {}) }, finish_reason: kind === 'refusal' ? 'content_filter' : kind }],
      usage: { prompt_tokens: 100, completion_tokens: 20 }, cost: 0.0001,
    }))
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    const failure = (await readAgentEvents(t.db, session.id)).events.at(-1)!
    expect(failure.metadata.summaryDiagnostic).toMatchObject({ stage: 'validate', reason: kind === 'length' ? 'incomplete' : kind === 'refusal' ? 'refusal' : 'unexpected_tools' })
    expect(JSON.stringify(failure)).not.toContain('私密')
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('accounts interrupted summary usage once without misclassifying it as chat', async () => {
    const session = await setup()
    await longHistory(session)
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '继续', 'partial-summary-usage')
    const frame = { model: 'mock-agent', choices: [{ delta: { content: '{"goal":' } }], usage: { prompt_tokens: 100, completion_tokens: 2 }, cost: 0.0001 }
    fetchMock.mockResolvedValueOnce(new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('failed')
    expect(await getAgentSummary(t.db, session.id)).toBeNull()
    expect(await all(t.db, 'SELECT generation_type,completion_tokens FROM ai_usage')).toEqual([{ generation_type: 'agent_summary', completion_tokens: 2 }])
    expect((await readAgentEvents(t.db, session.id)).events.at(-1)?.metadata.summaryDiagnostic).toMatchObject({ stage: 'request', reason: 'request_failed', usageRecorded: true, finishReason: 'missing' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('never overwrites a newer persisted summary with a stale checkpoint', async () => {
    const session = await setup()
    const newer = await saveAgentSummary(t.db, session, 20, summaryContent)
    expect(await saveAgentSummary(t.db, session, 10, { ...summaryContent, goal: '过时' })).toEqual(newer)
  })
  it('rejects missing categories and oversized summary items', () => {
    expect(() => parseAgentSummary('{"goal":"不完整"}')).toThrow()
    expect(() => parseAgentSummary(JSON.stringify({ ...summaryContent, decisions: ['x'.repeat(601)] }))).toThrow()
    expect(parseAgentSummary('```json\n' + JSON.stringify(summaryContent) + '\n```')).toEqual(summaryContent)
  })
})

describe('novel-scoped creative agent', () => {
  it('streams a preview, waits for complete tool arguments, executes once and isolates task recovery', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '生成雨夜封面', 'streamed-turn')
    let output!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const frame = (value: unknown) => output.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { output = c } }), { headers: { 'Content-Type': 'text/event-stream' } })).mockResolvedValueOnce(completion('封面任务已提交。'))
    const api = vi.fn().mockResolvedValue({ taskId: 'stream-cover-task' })
    const changes: string[] = []
    const unsubscribe = subscribeAiTask(turn.taskId, (patch) => { if (patch.result) changes.push(patch.result) })
    const running = runAgentTurn(t.db, session, turn.taskId, 'admin', api)
    frame({ choices: [{ delta: { content: '正在准备封面。', tool_calls: [{ index: 0, id: 'tool-stream', type: 'function', function: { name: 'generate_cover', arguments: '{"instruction":' } }] } }] })
    await vi.waitFor(() => expect(changes.some((value) => value.includes('正在准备封面'))).toBe(true))
    expect(api).not.toHaveBeenCalled()
    expect((await readAgentEvents(t.db, session.id)).events.some((event) => event.role === 'assistant')).toBe(false)
    expect((await request(`/api/ai/tasks/${turn.taskId}/stream`, 'GET', undefined, otherToken)).status).toBe(404)
    expect((await request(`/api/ai/tasks/${turn.taskId}`, 'GET', undefined, otherToken)).status).toBe(404)
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"雨夜"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 20 } })
    output.enqueue(encoder.encode('data: [DONE]\n\n'))
    output.close()
    await running
    unsubscribe()
    expect(api).toHaveBeenCalledTimes(1)
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('completed')
    const events = (await readAgentEvents(t.db, session.id)).events
    expect(events.filter((event) => event.content === '正在准备封面。')).toHaveLength(1)
    expect(events.at(-1)?.metadata.round).toBe(1)
  })
  it('requires an administrator and isolates conversations by account and book', async () => {
    expect((await request('/api/ai/agent/sessions?novelId=novel', 'GET', undefined, '')).status).toBe(401)
    expect((await request('/api/ai/agent/sessions?novelId=novel', 'GET', undefined, readerToken)).status).toBe(403)
    const created = await request('/api/ai/agent/sessions', 'POST', { novelId: 'novel', afterChapterId: 'chapter' })
    expect(created.status).toBe(201)
    const { session } = (await created.json()) as { session: AgentSession }
    expect((await request(`/api/ai/agent/sessions/${session.id}`, 'GET', undefined, otherToken)).status).toBe(404)
    expect((await request('/api/ai/agent/sessions', 'POST', { novelId: 'novel', afterChapterId: 'foreign' })).status).toBe(422)
    const detail = (await (await request(`/api/ai/agent/sessions/${session.id}`)).json()) as AgentSessionDetail
    expect(detail.session.afterChapterId).toBe('chapter')
    expect(detail.events).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('replays the same message receipt, rejects changed payloads and serializes turns', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const firstTurn = await beginAgentTurn(t.db, 'admin', session.id, '先讨论方向', 'request_123456')
    expect(await beginAgentTurn(t.db, 'admin', session.id, '先讨论方向', 'request_123456')).toEqual({ taskId: firstTurn.taskId, created: false })
    await expect(beginAgentTurn(t.db, 'admin', session.id, '不同的消息', 'request_123456')).rejects.toMatchObject({ status: 409 })
    await expect(beginAgentTurn(t.db, 'admin', session.id, '另一条消息', 'request_123457')).rejects.toMatchObject({ status: 409 })
    expect((await readAgentEvents(t.db, session.id)).events).toHaveLength(1)
  })
  it('uses the selected preset for the coordinator and its generated draft without changing the default', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'empty-novel' })
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (!body.tools) return completion(`标题：晨雨\n\n${'清晨的雨落在窗沿，屋里的人终于收起了信。'.repeat(50)}`)
      return completion(
        '已开始准备。',
        body.messages.some((message: { role: string }) => message.role === 'tool') ? undefined : [call('generate_draft', { instruction: '写一个雨夜开场' })],
      )
    })
    const response = await request(`/api/ai/agent/sessions/${session.id}/messages`, 'POST', {
      content: '写一个雨夜开场',
      requestId: 'selected_request',
      providerPresetId: 'text-preset',
    })
    expect(response.status).toBe(202)
    const receipt = (await response.json()) as { taskId: string }
    expect((await waitTask(receipt.taskId)).status).toBe('completed')
    const child = await first<{ task_id: string }>(t.db, 'SELECT task_id FROM ai_agent_artifacts WHERE session_id=$1', [session.id])
    expect(child).toBeDefined()
    expect((await waitTask(child!.task_id)).status).toBe('completed')
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toContain('https://selected.test/v1/')
      expect(JSON.parse(String(init?.body)).model).toBe('selected-model')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer selected-key')
    }
    expect(process.env.AI_TEXT_MODEL).toBe('mock-agent')
    expect(process.env.AI_TEXT_BASE_URL).toBe('https://agent.test/v1')
    const history = await readAgentEvents(t.db, session.id)
    expect(history.events[0]?.metadata).toEqual({ providerPresetId: 'text-preset', model: 'selected-model' })
    expect(JSON.stringify(history)).not.toContain('selected-key')
    const repeat = await request(`/api/ai/agent/sessions/${session.id}/messages`, 'POST', {
      content: '写一个雨夜开场',
      requestId: 'selected_request',
      providerPresetId: 'text-preset',
    })
    expect(await repeat.json()).toEqual({ taskId: receipt.taskId, created: false })
    expect((await request(`/api/ai/agent/sessions/${session.id}/messages`, 'POST', { content: '写一个雨夜开场', requestId: 'selected_request' })).status).toBe(
      409,
    )
  })
  it('rejects missing, malformed or image presets before creating a turn', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    for (const [providerPresetId, status] of [
      ['missing', 404],
      ['image-preset', 422],
      [42, 422],
    ] as const) {
      const response = await request(`/api/ai/agent/sessions/${session.id}/messages`, 'POST', {
        content: '讨论一下',
        requestId: 'invalid_preset_request',
        providerPresetId,
      })
      expect(response.status).toBe(status)
    }
    expect((await readAgentEvents(t.db, session.id)).events).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects cross-book/future sources and unregistered or malformed tool calls', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel', afterChapterId: 'chapter' })
    const api = vi.fn()
    for (const chapterId of ['foreign', 'future'])
      await expect(executeAgentTool(t.db, session, 'read_chapter', { chapterId }, 'op', api)).rejects.toMatchObject({ status: 404 })
    await draft('foreign-draft', 'other-novel')
    await expect(executeAgentTool(t.db, session, 'read_draft', { draftId: 'foreign-draft' }, 'op', api)).rejects.toMatchObject({ status: 404 })
    expect(() => validateAgentCall(call('exec_sql', { sql: 'DELETE FROM novels' }))).toThrow('未开放')
    expect(() => validateAgentCall(call('read_chapter', { chapterId: 'chapter', novelId: 'other-novel' }))).toThrow('不接受')
    expect(() => validateAgentCall({ ...call('read_overview'), function: { name: 'read_overview', arguments: '{"__proto__":{}}' } })).toThrow('不接受')
    const result = await executeAgentTool(t.db, session, 'search_chapters', { query: '离开' }, 'op', api)
    expect(result.matches).toHaveLength(1)
    const emptySession = await createAgentSession(t.db, 'admin', { novelId: 'empty-novel' })
    await expect(executeAgentTool(t.db, emptySession, 'refresh_memory', { kind: 'plot' }, 'op', api)).rejects.toMatchObject({ status: 422 })
    expect(api).not.toHaveBeenCalled()
  })
  it('submits agreed cover instructions through the real route without regenerating the prompt', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const instruction = '竖版封面，右下方一只手托着冰蓝色玻璃球，球内有一朵金色莲花；冷蓝背景，左上留白，不出现文字。'
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    fetchMock.mockResolvedValueOnce(Response.json({ model: 'mock-image', data: [{ b64_json: pngB64 }] }))

    const receipt = await executeAgentTool(t.db, session, 'generate_cover', { instruction }, 'cover_prompt_request', internalApi())
    expect(receipt.status).toBe('submitted')
    const taskId = String(receipt.taskId)
    const task = await waitTask(taskId)
    expect(task.status).toBe('completed')
    expect(JSON.parse(task.params)).toMatchObject({ prompt: instruction, promptMode: 'exact' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://image.test/v1/images/generations')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).prompt).toBe(instruction)
    expect(await first(t.db, 'SELECT novel_id,prompt FROM ai_cover_candidates WHERE task_id=$1', [taskId])).toEqual({ novel_id: 'novel', prompt: instruction })
    expect(await first(t.db, 'SELECT task_id FROM ai_agent_artifacts WHERE session_id=$1 AND task_id=$2', [session.id, taskId])).toEqual({ task_id: taskId })
  })
  it('reuses one submitted task for identical generation calls with different model call IDs', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '生成雨夜封面', 'dedup_generation')
    fetchMock
      .mockResolvedValueOnce(completion('', [call('generate_cover', { instruction: '雨夜窗边' }, 'first')]))
      .mockResolvedValueOnce(completion('', [call('generate_cover', { instruction: '雨夜窗边' }, 'repeated')]))
      .mockResolvedValueOnce(completion('已提交封面任务，可以在产出区查看。'))
    const api = vi.fn().mockResolvedValue({ taskId: 'one-cover-task' })
    await runAgentTurn(t.db, session, turn.taskId, 'admin', api)
    expect(api).toHaveBeenCalledTimes(1)
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('completed')
    expect((await readAgentEvents(t.db, session.id)).events.filter((event) => event.metadata.artifactTaskId === 'one-cover-task')).toHaveLength(2)
  })
  it('keeps child operation IDs independent of the original request headers', async () => {
    const dispatch = vi.fn(async (_request: Request) => Response.json({ ok: true }))
    const adapter = agentApiAdapter(
      new Request('http://localhost/api/ai/agent/sessions', { headers: { 'X-Operation-Id': 'parent', 'Idempotency-Key': 'parent' } }),
      dispatch,
    )
    await adapter('/api/ai/cover/generate', 'POST', { operationId: 'child' })
    const forwarded = dispatch.mock.calls[0]![0]
    expect(forwarded.headers.has('X-Operation-Id')).toBe(false)
    expect(forwarded.headers.has('Idempotency-Key')).toBe(false)
    expect(await forwarded.json()).toEqual({ operationId: 'child' })
  })
  it('executes a real tool roundtrip, retains messages, and records each upstream call once', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel', afterChapterId: 'chapter' })
    for (let i = 0; i < 25; i++) await appendAgentEvent(t.db, session.id, 'assistant', '此前的讨论。'.repeat(1600))
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '了解故事后给我建议', 'roundtrip_request')
    let chatCalls = 0
    fetchMock.mockImplementation(async (_, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.messages[0].content.startsWith('整理当前创作对话')) return completion(JSON.stringify(summaryContent))
      return ++chatCalls === 1 ? completion('', [call('read_overview')]) : completion('依据第一章，可以先让冲突继续。')
    })
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('completed')
    const sent = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(sent.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'tool_1' }))
    expect(sent.parallel_tool_calls).toBe(false)
    expect(JSON.stringify(sent.messages).length).toBeLessThan(180000)
    expect(sent.messages[1].content).toContain('"hasEarlier":true')
    expect(sent.messages).toContainEqual({ role: 'user', content: '了解故事后给我建议' })
    expect((await readAgentEvents(t.db, session.id)).events.at(-1)?.content).toContain('依据第一章')
    const evidence = (await readAgentEvents(t.db, session.id)).events.find(event => event.metadata.tool === 'read_overview')?.metadata.sources
    expect(evidence).toEqual([expect.objectContaining({ kind: 'chapter', origin: 'published', excerpt: original })])
    const restored = await (await request(`/api/ai/agent/sessions/${session.id}`)).json() as AgentSessionDetail
    expect(restored.events.find(event => event.metadata.tool === 'read_overview')?.metadata.sources).toEqual(evidence)
    const usage = await first<{ calls: number; cost: string }>(
      t.db,
      "SELECT COUNT(*)::int AS calls,SUM(cost_millicents) AS cost FROM ai_usage WHERE generation_type='agent_chat'",
    )
    expect(usage?.calls).toBe(2)
    expect(Number(usage?.cost)).toBe(20)
    expect(await getAgentSummary(t.db, session.id)).not.toBeNull()
    const summaryUsage = await first<{ calls: number }>(t.db, "SELECT COUNT(*)::int AS calls FROM ai_usage WHERE generation_type='agent_summary'")
    expect(Number(summaryUsage?.calls)).toBeGreaterThan(0)
  })
  it('continues beyond eight tool rounds with full context until the model answers', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel', afterChapterId: 'chapter' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '了解故事后给我建议', 'extended_reading')
    expect(await getAiTask(t.db, turn.taskId)).toMatchObject({ status: 'queued', current: 0, total: 1 })
    for (let round = 0; round < 12; round++)
      fetchMock.mockResolvedValueOnce(completion('', [call('read_chapter', { chapterId: 'chapter' }, `read_${round}`)], `取材推理 ${round}`))
    const answer = '根据 chapter 中他转身离开、她没有开口的片段，可以让下一次合作先打破沉默。目前只读取了这一章，尚不能判断全书走向。'
    let beforeReply: Awaited<ReturnType<typeof getAiTask>>
    fetchMock.mockImplementationOnce(async () => {
      beforeReply = await getAiTask(t.db, turn.taskId)
      return completion(answer)
    })
    const api = vi.fn()
    await runAgentTurn(t.db, session, turn.taskId, 'admin', api)

    expect(fetchMock).toHaveBeenCalledTimes(13)
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(requests.every((body) => body.tools?.length > 0 && body.tool_choice === 'auto')).toBe(true)
    const finalRequest = requests.at(-1)
    expect(finalRequest.messages).toContainEqual({ role: 'user', content: '了解故事后给我建议' })
    for (let round = 0; round < 12; round++) {
      expect(finalRequest.messages).toContainEqual({
        role: 'assistant',
        content: '',
        tool_calls: [call('read_chapter', { chapterId: 'chapter' }, `read_${round}`)],
        reasoning_content: `取材推理 ${round}`,
      })
      expect(finalRequest.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: `read_${round}`, content: expect.stringContaining(original) }))
    }
    expect(api).not.toHaveBeenCalled()
    expect(await first(t.db, 'SELECT task_id FROM ai_agent_artifacts WHERE session_id=$1', [session.id])).toBeUndefined()
    expect(beforeReply!).toMatchObject({ status: 'running', current: 12, total: 13 })
    expect(await getAiTask(t.db, turn.taskId)).toMatchObject({ status: 'completed', current: 13, total: 13, result: '' })
    const replies = (await readAgentEvents(t.db, session.id)).events.filter((event) => event.role === 'assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ content: answer, metadata: { round: 12 } })
    const usage = await first<{ calls: number; cost: string }>(
      t.db,
      "SELECT COUNT(*)::int AS calls,SUM(cost_millicents) AS cost FROM ai_usage WHERE generation_type='agent_chat'",
    )
    expect(usage?.calls).toBe(13)
    expect(Number(usage?.cost)).toBe(130)
  })
  it.each([
    { name: 'empty text', response: () => completion('') },
    {
      name: 'truncated text',
      response: () => Response.json({ choices: [{ message: { content: '尚未整理完的答复' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
    },
    {
      name: 'refusal',
      response: () => Response.json({ choices: [{ message: { content: '', refusal: '无法完成本轮答复' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
    },
  ])('retains prior work without claiming success when an extended turn returns $name', async ({ response }) => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '先了解一下故事', 'unfinished_extended_turn')
    for (let round = 0; round < 10; round++)
      fetchMock.mockResolvedValueOnce(completion('', [call('read_overview', {}, `read_${round}`)]))
    fetchMock.mockResolvedValueOnce(response())
    const api = vi.fn()
    await runAgentTurn(t.db, session, turn.taskId, 'admin', api)

    expect(fetchMock).toHaveBeenCalledTimes(11)
    expect(api).not.toHaveBeenCalled()
    expect(await getAiTask(t.db, turn.taskId)).toMatchObject({ status: 'failed', step: '本轮处理未完成' })
    const events = (await readAgentEvents(t.db, session.id)).events
    expect(events.filter((event) => event.role === 'assistant')).toHaveLength(0)
    expect(events.filter((event) => event.metadata.tool === 'read_overview')).toHaveLength(10)
    expect(events.at(-1)?.metadata.error).toBe(true)
    expect(events.at(-1)?.metadata.failurePhase).toBe('model')
    expect(await first(t.db, "SELECT COUNT(*)::int AS calls FROM ai_usage WHERE generation_type='agent_chat'")).toEqual({ calls: 11 })
  })
  it('submits a chapter through existing middleware and exposes a saved draft without publishing', async () => {
    fetchMock.mockImplementation(async () => completion(`标题：晨雨\n\n${'清晨的雨落在窗沿，屋里的人终于收起了信。'.repeat(50)}`))
    const session = await createAgentSession(t.db, 'admin', { novelId: 'empty-novel' })
    const result = await executeAgentTool(t.db, session, 'generate_draft', { instruction: '写一个雨夜开场' }, 'agent_generation_request', internalApi())
    const task = await waitTask(String(result.taskId))
    expect(task.status).toBe('completed')
    const artifact = await readAgentArtifact(t.db, session, task.id)
    expect(artifact.drafts).toHaveLength(1)
    expect(artifact.drafts[0]?.status).toBe('draft')
    expect(await first(t.db, "SELECT id FROM chapters WHERE novel_id='empty-novel'")).toBeUndefined()
  })
  it('keeps rewrite proposals immutable until confirmed, applies once and restores the previous version', async () => {
    await draft()
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const taskId = await finishedRewrite(session.id)
    const action = await prepareAgentAction(t.db, session, 'apply_rewrite', taskId)
    expect((await first<{ result: string }>(t.db, "SELECT result FROM ai_generations WHERE id='draft'"))?.result).toBe(original)
    expect((await confirmAgentAction(t.db, session, action.id, internalApi())).status).toBe('completed')
    expect((await confirmAgentAction(t.db, session, action.id, internalApi())).status).toBe('completed')
    expect((await first<{ result: string }>(t.db, "SELECT result FROM ai_generations WHERE id='draft'"))?.result).toBe('他在门边停住了。她没有开口。')
    const restore = await prepareAgentAction(t.db, session, 'restore_draft', action.id)
    await confirmAgentAction(t.db, session, restore.id, internalApi())
    expect((await confirmAgentAction(t.db, session, restore.id, internalApi())).status).toBe('completed')
    expect((await first<{ result: string }>(t.db, "SELECT result FROM ai_generations WHERE id='draft'"))?.result).toBe(original)
    const reapplied = await prepareAgentAction(t.db, session, 'apply_rewrite', taskId)
    expect(reapplied.id).not.toBe(action.id)
    expect(reapplied.status).toBe('pending')
    await confirmAgentAction(t.db, session, reapplied.id, internalApi())
    expect((await first<{ result: string }>(t.db, "SELECT result FROM ai_generations WHERE id='draft'"))?.result).toBe('他在门边停住了。她没有开口。')
  })
  it('refines an unadopted suggestion and preserves the original apply revision', async () => {
    await draft()
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const taskId = await finishedRewrite(session.id)
    fetchMock.mockImplementation(async () => completion('他停了片刻。'))
    const result = await executeAgentTool(t.db, session, 'refine_rewrite', { taskId, instruction: '再克制一些' }, 'agent_refine_request', internalApi())
    expect((await waitTask(String(result.taskId))).status).toBe('completed')
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(sent.messages[1].content).toContain('他在门边停住了。')
    const artifact = await readAgentArtifact(t.db, session, String(result.taskId))
    expect(artifact.rewrite?.baseRevision).toBe(generationContentRevision(original))
    expect(artifact.rewrite?.after).toBe('他停了片刻。')
    expect((await first<{ result: string }>(t.db, "SELECT result FROM ai_generations WHERE id='draft'"))?.result).toBe(original)
  })
  it('rejects a stale publish preview and publishes the reviewed version only once', async () => {
    await draft()
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const stale = await prepareAgentAction(t.db, session, 'publish_draft', 'draft', '雨后')
    await t.db.query("UPDATE ai_generations SET result='已经人工修订的正文。' WHERE id='draft'")
    await expect(confirmAgentAction(t.db, session, stale.id, internalApi())).rejects.toMatchObject({ status: 409 })
    const valid = await prepareAgentAction(t.db, session, 'publish_draft', 'draft', '雨后')
    await confirmAgentAction(t.db, session, valid.id, internalApi())
    await confirmAgentAction(t.db, session, valid.id, internalApi())
    expect((await first<{ count: number }>(t.db, "SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id='novel' AND title='雨后'"))?.count).toBe(1)
  })
  it.each([0, 10])('cancels after %i tool rounds before a returned generation tool can execute', async (rounds) => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '帮我构思封面', 'cancel_request_1')
    for (let round = 0; round < rounds; round++)
      fetchMock.mockResolvedValueOnce(completion('', [call('read_overview', {}, `read_${round}`)]))
    let deliver!: (response: Response) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    fetchMock.mockImplementationOnce(async () => {
      entered()
      return new Promise<Response>((resolve) => {
        deliver = resolve
      })
    })
    const api = vi.fn()
    const running = runAgentTurn(t.db, session, turn.taskId, 'admin', api)
    await started
    await cancelAiTask(t.db, turn.taskId)
    deliver(completion('', [call('generate_cover', { instruction: '雨夜' })]))
    await running
    expect(fetchMock).toHaveBeenCalledTimes(rounds + 1)
    expect(api).not.toHaveBeenCalled()
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('cancelled')
  })
  it('checks cover ownership and version, then adopts a confirmed candidate only once', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    await t.db.query(
      "INSERT INTO ai_cover_candidates(id,novel_id,data,content_type,prompt,created_at) VALUES('cover-agent','novel',$1,'image/png','雨夜的窗',1),('foreign-cover','other-novel',$1,'image/png','另一作品',1)",
      [png],
    )
    await expect(prepareAgentAction(t.db, session, 'adopt_cover', 'foreign-cover')).rejects.toMatchObject({ status: 404 })
    const action = await prepareAgentAction(t.db, session, 'adopt_cover', 'cover-agent')
    expect((await request(`/api/ai/agent/sessions/${session.id}/covers/cover-agent`)).status).toBe(200)
    expect((await request(`/api/ai/agent/sessions/${session.id}/covers/cover-agent`, 'GET', undefined, otherToken)).status).toBe(404)
    await replaceCoverForAdmin(t.db, { novelId: 'novel', actorId: 'admin', data: png, contentType: 'image/png', source: 'upload', reason: 'upload' })
    await expect(confirmAgentAction(t.db, session, action.id, internalApi())).rejects.toMatchObject({ status: 409 })
    const next = await prepareAgentAction(t.db, session, 'adopt_cover', 'cover-agent')
    const confirmed = await request(`/api/ai/agent/sessions/${session.id}/actions/${next.id}/confirm`, 'POST', {
      novelId: 'other-novel',
      candidateId: 'foreign-cover',
    })
    expect(confirmed.status).toBe(200)
    // Simulate losing the coordinator receipt after the existing adoption route committed.
    await t.db.query("UPDATE ai_agent_actions SET status='executing',lease_until=1 WHERE id=$1", [next.id])
    const refreshed = (await (await request(`/api/ai/agent/sessions/${session.id}`)).json()) as AgentSessionDetail
    expect(refreshed.actions.find((item) => item.id === next.id)?.canResume).toBe(true)
    expect((await confirmAgentAction(t.db, session, next.id, internalApi())).status).toBe('completed')
    expect(await first(t.db, "SELECT id FROM ai_cover_candidates WHERE id='cover-agent'")).toBeUndefined()
    expect(await first(t.db, "SELECT id FROM ai_cover_candidates WHERE id='foreign-cover'")).toBeDefined()
  })
  it('does not automatically replay uncertain upstream failures', async () => {
    const session = await createAgentSession(t.db, 'admin', { novelId: 'novel' })
    const turn = await beginAgentTurn(t.db, 'admin', session.id, '讨论一下', 'failure_request')
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('connection lost')
    })
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('failed')
  })
})
