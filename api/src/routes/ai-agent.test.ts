import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { loadConfig } from '../config'
import { setDbForTests } from '../db/pool'
import { first } from '../db/query'
import { createTestDb, type TestDb } from '../test/db'
import { createSession } from '../services/sessions'
import { createAgentSession, beginAgentTurn, readAgentEvents, trackAgentArtifact, appendAgentEvent } from '../services/ai/agent-store'
import { agentApiAdapter } from './ai-agent'
import { confirmAgentAction, prepareAgentAction, readAgentArtifact } from '../services/ai/agent-actions'
import { executeAgentTool, validateAgentCall } from '../services/ai/agent-tools'
import { runAgentTurn } from '../services/ai/agent'
import { buildRewriteTaskParams } from '../services/ai/rewrite'
import { cancelAiTask, createAiTask, getAiTask, updateAiTask } from '../services/ai/tasks'
import { generationContentRevision } from '../services/ai/generations'
import { replaceCoverForAdmin } from '../services/covers'
import { AiError, type AiToolCall } from '../services/ai/client'
import type { AgentSession, AgentSessionDetail } from '@shared/ai-agent'
import { subscribeAiTask } from '../services/ai/task-events'

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
const original = '他转身离开。她没有开口。'
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
    fetchMock.mockResolvedValueOnce(completion('', [call('read_overview')])).mockResolvedValueOnce(completion('依据第一章，可以先让冲突继续。'))
    await runAgentTurn(t.db, session, turn.taskId, 'admin', internalApi())
    expect((await getAiTask(t.db, turn.taskId))?.status).toBe('completed')
    const sent = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(sent.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'tool_1' }))
    expect(sent.parallel_tool_calls).toBe(false)
    expect(JSON.stringify(sent.messages).length).toBeLessThan(180000)
    expect(sent.messages[1].content).toContain('"hasEarlier":true')
    expect(sent.messages).toContainEqual({ role: 'user', content: '了解故事后给我建议' })
    expect((await readAgentEvents(t.db, session.id)).events.at(-1)?.content).toContain('依据第一章')
    const usage = await first<{ calls: number; cost: string }>(
      t.db,
      "SELECT COUNT(*)::int AS calls,SUM(cost_millicents) AS cost FROM ai_usage WHERE generation_type='agent_chat'",
    )
    expect(usage?.calls).toBe(2)
    expect(Number(usage?.cost)).toBe(20)
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
