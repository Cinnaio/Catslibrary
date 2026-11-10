import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb
let token: string
const automatic = '角色正在调查旧案，线索仍未解开。😀'.repeat(400)

function request(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.AI_TEXT_BASE_URL = 'https://ai.test/v1'
  process.env.AI_TEXT_API_KEY = 'test-key'
  process.env.AI_TEXT_MODEL = 'test-model'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    model: 'test-model', choices: [{ message: { content: automatic }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 100 },
  }), { headers: { 'Content-Type': 'application/json' } })))
  const boot = await app.request('/api/auth/bootstrap-admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
  })
  expect(boot.status).toBe(201)
  token = (await boot.json() as { token: string }).token
})

afterAll(async () => {
  vi.unstubAllGlobals()
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.AI_TEXT_BASE_URL
  delete process.env.AI_TEXT_API_KEY
  delete process.env.AI_TEXT_MODEL
  await t.close()
})

it.each([
  ['style', 'style-profile'], ['plot', 'plot-state'], ['relationship', 'relationship-profile'],
] as const)('%s 档案读取与修改均退役，不再调用模型', async (kind, endpoint) => {
  for (const [method, path] of [
    ['GET', `/api/ai/writing/${endpoint}/book?summary=1`],
    ['POST', `/api/ai/writing/${endpoint}`],
    ['PUT', `/api/ai/writing/profiles/${kind}/book/override`],
    ['DELETE', `/api/ai/writing/profiles/${kind}/book/override`],
  ]) {
    expect((await app.request(path!, request(method!, method === 'GET' ? undefined : { novelId: 'book' }))).status).toBe(410)
    expect((await app.request(path!, { method })).status).toBe(401)
  }
  expect(fetch).not.toHaveBeenCalled()
  expect((await t.db.query('SELECT * FROM ai_tasks')).rows).toHaveLength(0)
})
