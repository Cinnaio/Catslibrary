import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { loadConfig } from '../config'
import { setDbForTests, type Db } from '../db/pool'
import { first } from '../db/query'
import { createTestDb, type TestDb } from '../test/db'
import { createSession } from '../services/sessions'
import { createAgentSession, trackAgentArtifact, deleteAgentSession } from '../services/ai/agent-store'
import { createAiTask, getAiTask, updateAiTask } from '../services/ai/tasks'
import { confirmAgentAction, prepareAgentAction, readAgentArtifact } from '../services/ai/agent-actions'
import { buildChapterEditParams, chapterEditHistory, chapterEditSource, scopedEditableChapter } from '../services/ai/chapter-edit'
import { executeAgentTool } from '../services/ai/agent-tools'
import type { AgentSession } from '@shared/ai-agent'

vi.mock('../services/ai/provider-presets', () => ({ getProviderPreset: (id: string) => ({
  id, scope: 'text', baseUrl: 'https://chosen-model.test/v1', apiKey: 'chosen-key', model: 'chosen-model',
}) }))

let t: TestDb
let session: AgentSession
let token = ''
let otherToken = ''
let readerToken = ''
const original = '<p>雨落🙂。她推开门。远处传来钟声。</p>'
const selected = '她推开门。'
const proposed = '她在门前停了片刻，才推开门。'
const fetchMock = vi.fn<typeof fetch>()
const neverCall = vi.fn().mockRejectedValue(new Error('unexpected dispatch'))
const keys = ['DATABASE_URL', 'AI_TEXT_BASE_URL', 'AI_TEXT_API_KEY', 'AI_TEXT_MODEL']
const env = new Map(keys.map(key => [key, process.env[key]]))
const root = '/api/ai/writing/chapter-edits'
function request(path: string, method = 'GET', body?: unknown, auth = token) {
  return app.request(path, { method, headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function input() {
  const source = await chapterEditSource(t.db, session, 'chapter')
  const start = original.indexOf(selected)
  return { sessionId: session.id, chapterId: 'chapter', baseRevision: source.revision, selectedText: selected,
    startUTF16: start, endUTF16: start + selected.length, instruction: '补充开门前的犹豫，保持后文不变', clientRequestId: 'chapter-edit-request' }
}
async function finished() {
  const params = buildChapterEditParams(session, await scopedEditableChapter(t.db, session, 'chapter'), await input())
  const task = await createAiTask(t.db, { userId: 'admin', novelId: 'book', kind: 'chapter_edit', params: JSON.stringify(params) })
  await updateAiTask(t.db, task.id, { status: 'completed', result: JSON.stringify({ version: 1, suggestion: proposed }) })
  await trackAgentArtifact(t.db, session.id, task.id)
  return task.id
}
async function waitTask(id: string) {
  for (let i = 0; i < 150; i++) {
    const task = await getAiTask(t.db, id)
    if (task && !['queued', 'running'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('mock generation timed out')
}
const content = async () => (await first<{ content: string }>(t.db, "SELECT content FROM chapters WHERE id='chapter'"))!.content
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.AI_TEXT_BASE_URL = 'https://chapter-edit.test/v1'
  process.env.AI_TEXT_API_KEY = 'test-key'
  process.env.AI_TEXT_MODEL = 'test-model'
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  for (const [id, role] of [['admin', 'super_admin'], ['other', 'admin'], ['reader', 'reader']])
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,$2,'test','test',1,1)", [id, role])
  token = await createSession(t.db, 'admin', 'test', loadConfig().sessionHashSalt)
  otherToken = await createSession(t.db, 'other', 'test', loadConfig().sessionHashSalt)
  readerToken = await createSession(t.db, 'reader', 'test', loadConfig().sessionHashSalt)
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','测试作品',1,1),('foreign','另一本',1,1)")
  for (const [id, book, order] of [['chapter', 'book', 1], ['future', 'book', 2], ['foreign-chapter', 'foreign', 1]])
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at,source_url) VALUES($1,$2,$1,$3,$4,1,$5)', [id, book, original, order, 'https://source.test/' + id])
  vi.stubGlobal('fetch', fetchMock)
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_agent_sessions')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_chapter_edit_history')
  await t.db.query('DELETE FROM ai_generations')
  await t.db.query('DELETE FROM api_idempotency')
  await t.db.query("UPDATE chapters SET content=$1,title='chapter',sort_order=1 WHERE id='chapter'", [original])
  session = await createAgentSession(t.db, 'admin', { novelId: 'book', afterChapterId: 'chapter' })
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(Response.json({ model: 'test-model', choices: [{ message: { content: proposed }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 15 } }))
})
afterAll(async () => {
  vi.unstubAllGlobals()
  setDbForTests(null)
  for (const [key, value] of env) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await t.close()
})

describe('published chapter editing', () => {
  it('generates once per request and never writes the original before confirmation', async () => {
    const body = await input()
    const response = await request(root, 'POST', body)
    expect(response.status).toBe(202)
    const receipt = await response.json() as { taskId: string }
    expect((await waitTask(receipt.taskId)).status).toBe('completed')
    expect(await content()).toBe(original)
    const replay = await request(root, 'POST', body)
    expect(await replay.json()).toMatchObject({ taskId: receipt.taskId })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await readAgentArtifact(t.db, session, receipt.taskId)).toMatchObject({ chapterEdit: { chapterId: 'chapter', before: selected, after: proposed } })
    const actionRoot = '/api/ai/agent/sessions/' + session.id + '/actions'
    const previewResponse = await request(actionRoot, 'POST', { kind: 'apply_chapter_edit', targetId: receipt.taskId })
    expect(previewResponse.status).toBe(201)
    const { action } = await previewResponse.json() as { action: { id: string } }
    const confirmation = await request(actionRoot + '/' + action.id + '/confirm', 'POST', { after: 'client-injected replacement' })
    expect(confirmation.status).toBe(200)
    expect(await content()).toBe(original.replace(selected, proposed))
  })
  it('uses the explicitly selected model and refines the previous suggestion without changing its base', async () => {
    const previousTaskId = await finished()
    const body = { ...await input(), previousTaskId, instruction: '保留上一版停顿，补充听到钟声的反应', providerPresetId: 'chosen-model' }
    const response = await request(root, 'POST', body)
    expect(response.status).toBe(202)
    const { taskId } = await response.json() as { taskId: string }
    const task = await waitTask(taskId)
    expect(task.status).toBe('completed')
    expect(JSON.parse(task.params!)).toMatchObject({ previousTaskId, previousSuggestion: proposed, baseContent: original, baseRevision: body.baseRevision })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://chosen-model.test/v1/chat/completions')
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).model).toBe('chosen-model')
    expect(await content()).toBe(original)
  })
  it('refuses mismatched refinement ranges and reused request IDs with different instructions', async () => {
    const previousTaskId = await finished()
    const body = await input()
    expect((await request(root, 'POST', { ...body, previousTaskId, startUTF16: 0, endUTF16: original.length, selectedText: original })).status).toBe(409)
    const response = await request(root, 'POST', body)
    const { taskId } = await response.json() as { taskId: string }
    await waitTask(taskId)
    expect((await request(root, 'POST', { ...body, instruction: '完全不同的要求' })).status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('enforces account, role, novel and frozen chapter boundaries without model calls', async () => {
    const body = await input()
    expect((await request(root, 'POST', body, readerToken)).status).toBe(403)
    expect((await request(root, 'POST', body, otherToken)).status).toBe(404)
    for (const chapterId of ['future', 'foreign-chapter']) {
      expect((await request(root, 'POST', { ...body, chapterId })).status).toBe(404)
      expect((await request('/api/ai/agent/sessions/' + session.id + '/chapters/' + chapterId)).status).toBe(404)
    }
    expect((await request('/api/ai/agent/sessions/' + session.id + '/chapters/chapter/history', 'GET', undefined, otherToken)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects stale revisions, mismatching ranges and split Unicode surrogate pairs', async () => {
    const body = await input()
    expect((await request(root, 'POST', { ...body, baseRevision: 'old' })).status).toBe(409)
    expect((await request(root, 'POST', { ...body, selectedText: '不属于原文' })).status).toBe(422)
    const start = original.indexOf('🙂') + 1
    expect((await request(root, 'POST', { ...body, startUTF16: start, endUTF16: start + 1, selectedText: original.slice(start, start + 1) })).status).toBe(422)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('saves exactly the previewed range, preserves chapter identity and invalidates summaries', async () => {
    const taskId = await finished()
    const preview = await prepareAgentAction(t.db, session, 'apply_chapter_edit', taskId)
    expect(preview.preview).toMatchObject({ chapterId: 'chapter', before: selected, after: proposed })
    expect(await content()).toBe(original)
    await t.db.query("INSERT INTO ai_generations(id,novel_id,chapter_id,kind,model,prompt,result,status,created_by,created_at) VALUES('summary','book','chapter','summary','mock','','旧摘要','published','admin',1)")
    expect((await confirmAgentAction(t.db, session, preview.id, neverCall)).status).toBe('completed')
    expect((await confirmAgentAction(t.db, session, preview.id, neverCall)).status).toBe('completed')
    expect(await content()).toBe(original.replace(selected, proposed))
    const row = await first(t.db, "SELECT id,sort_order,source_url,word_count FROM chapters WHERE id='chapter'")
    expect(row).toMatchObject({ id: 'chapter', sort_order: 1, source_url: 'https://source.test/chapter', word_count: original.replace(selected, proposed).replace(/<[^>]*>/g, '').length })
    expect(await first(t.db, "SELECT status FROM ai_generations WHERE id='summary'")).toMatchObject({ status: 'rejected' })
    expect((await chapterEditHistory(t.db, session, 'chapter')).history).toHaveLength(1)
  })
  it('rejects a stale confirmation and does not create a history record', async () => {
    const taskId = await finished()
    const preview = await prepareAgentAction(t.db, session, 'apply_chapter_edit', taskId)
    await t.db.query("UPDATE chapters SET content='作者刚保存的新正文' WHERE id='chapter'")
    await expect(confirmAgentAction(t.db, session, preview.id, neverCall)).rejects.toMatchObject({ status: 409 })
    expect(await content()).toBe('作者刚保存的新正文')
    expect((await chapterEditHistory(t.db, session, 'chapter')).history).toHaveLength(0)
    await expect(prepareAgentAction(t.db, session, 'apply_chapter_edit', taskId)).rejects.toMatchObject({ status: 409 })
  })
  it('keeps history after conversation deletion and supports reviewed undo and redo', async () => {
    const action = await prepareAgentAction(t.db, session, 'apply_chapter_edit', await finished())
    await confirmAgentAction(t.db, session, action.id, neverCall)
    const historyId = (await chapterEditHistory(t.db, session, 'chapter')).history[0]!.id
    await deleteAgentSession(t.db, 'admin', session.id)
    session = await createAgentSession(t.db, 'admin', { novelId: 'book', afterChapterId: 'chapter' })
    const undo = await prepareAgentAction(t.db, session, 'restore_chapter', historyId)
    expect(await content()).toBe(original.replace(selected, proposed))
    await confirmAgentAction(t.db, session, undo.id, neverCall)
    expect(await content()).toBe(original)
    const redo = await prepareAgentAction(t.db, session, 'restore_chapter', undo.id)
    await confirmAgentAction(t.db, session, redo.id, neverCall)
    expect(await content()).toBe(original.replace(selected, proposed))
  })
  it('will not undo over an intervening manual edit', async () => {
    const action = await prepareAgentAction(t.db, session, 'apply_chapter_edit', await finished())
    await confirmAgentAction(t.db, session, action.id, neverCall)
    const undo = await prepareAgentAction(t.db, session, 'restore_chapter', action.id)
    await t.db.query("UPDATE chapters SET title='人工修订标题' WHERE id='chapter'")
    await expect(confirmAgentAction(t.db, session, undo.id, neverCall)).rejects.toMatchObject({ status: 409 })
    expect((await chapterEditHistory(t.db, session, 'chapter')).history.every(item => !item.canRestore)).toBe(true)
  })
  it('rolls back chapter and history together if recording completion fails', async () => {
    const action = await prepareAgentAction(t.db, session, 'apply_chapter_edit', await finished())
    const failing: Db = { ...t.db, connect: async () => {
      const client = await t.db.connect()
      return { ...client, query: async (sql, args) => {
        if (sql.includes('INSERT INTO ai_agent_events') && String(args?.[2]).startsWith('已完成')) throw new Error('simulated event failure')
        return client.query(sql, args)
      } }
    } }
    await expect(confirmAgentAction(failing, session, action.id, neverCall)).rejects.toThrow('simulated event failure')
    expect(await content()).toBe(original)
    expect((await chapterEditHistory(t.db, session, 'chapter')).history).toHaveLength(0)
  })
  it('requires the suggestion to belong to this conversation and be completed', async () => {
    const taskId = await finished()
    const another = await createAgentSession(t.db, 'admin', { novelId: 'book', afterChapterId: 'chapter' })
    await expect(prepareAgentAction(t.db, another, 'apply_chapter_edit', taskId)).rejects.toMatchObject({ status: 404 })
    await t.db.query("UPDATE ai_tasks SET status='cancelled' WHERE id=$1", [taskId])
    await expect(prepareAgentAction(t.db, session, 'apply_chapter_edit', taskId)).rejects.toMatchObject({ status: 409 })
  })
  it('routes chapter editing through the fixed API and preserves explicit repeated-text offsets', async () => {
    await t.db.query("UPDATE chapters SET content='开门。开门。' WHERE id='chapter'")
    const source = await chapterEditSource(t.db, session, 'chapter')
    const dispatch = vi.fn().mockResolvedValue({ taskId: 'tool-task' })
    await expect(executeAgentTool(t.db, session, 'rewrite_chapter', { chapterId: 'chapter', baseRevision: source.revision, selectedText: '开门。', instruction: '补充动作' }, 'op', dispatch, 'admin', '')).rejects.toMatchObject({ status: 422 })
    await executeAgentTool(t.db, session, 'rewrite_chapter', { chapterId: 'chapter', baseRevision: source.revision, selectedText: '开门。', startUTF16: 3, instruction: '补充动作' }, 'op', dispatch, 'admin', '')
    expect(dispatch).toHaveBeenCalledWith(root, 'POST', expect.objectContaining({ chapterId: 'chapter', startUTF16: 3, endUTF16: 6, selectedText: '开门。' }))
  })
})
