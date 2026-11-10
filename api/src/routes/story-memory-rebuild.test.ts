import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { runStoryMemoryTask } from '../services/ai/story-memory-tasks'
vi.mock('../services/ai/client', async (original) => ({ ...(await original<typeof import('../services/ai/client')>()), isTextAiConfigured: () => true }))
vi.mock('../services/ai/story-memory-tasks', async (original) => ({
  ...(await original<typeof import('../services/ai/story-memory-tasks')>()),
  runStoryMemoryTask: vi.fn().mockResolvedValue(undefined),
}))
let t: TestDb
let adminToken = '',
  readerToken = ''
const json = (method: string, token?: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})
const body = { range: 'single', kinds: ['relationship'], startChapterId: 'c1', followThrough: true, sampleChapters: 2 }
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  const admin = await app.request('/api/auth/bootstrap-admin', json('POST', undefined, { username: 'resetadmin', password: 'resetpass123' }))
  adminToken = ((await admin.json()) as { token: string }).token
  await t.db.query("INSERT INTO invites(code,created_at) VALUES('RESET-INVITE',1)")
  const reader = await app.request('/api/auth/register', json('POST', undefined, { username: 'resetreader', password: 'resetpass123', invite: 'RESET-INVITE' }))
  readerToken = ((await reader.json()) as { token: string }).token
  await t.db.query("INSERT INTO novels(id,title,visibility,created_at,updated_at) VALUES('book','私密档案','admin',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c1','book','第一章','正文',1,1)")
})
afterAll(async () => {
  setDbForTests(null)
  vi.unstubAllEnvs()
  await t.close()
})
describe('range rebuild administrator boundary', () => {
  it.each([
    ['POST', '/api/ai/writing/memory/book/rebuild/preview'],
    ['POST', '/api/ai/writing/memory/book/rebuild'],
    ['GET', '/api/ai/writing/memory/relationship/book/history'],
  ])('%s %s rejects anonymous and ordinary readers', async (method, path) => {
    expect((await app.request(path, json(method!, undefined, method === 'GET' ? undefined : body))).status).toBe(401)
    expect((await app.request(path, json(method!, readerToken, method === 'GET' ? undefined : body))).status).toBe(403)
    expect(runStoryMemoryTask).not.toHaveBeenCalled()
  })
  it('管理员旧预览、重建与历史请求明确返回退役，重复请求不创建任务', async () => {
    for (const path of ['/api/ai/writing/memory/book/rebuild/preview', '/api/ai/writing/memory/book/rebuild']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect((await app.request(path, json('POST', adminToken, body))).status).toBe(410)
      }
    }
    expect((await app.request('/api/ai/writing/memory/relationship/book/history', json('GET', adminToken))).status).toBe(410)
    expect(runStoryMemoryTask).not.toHaveBeenCalled()
    expect((await t.db.query('SELECT * FROM ai_tasks')).rows).toHaveLength(0)
  })
})
