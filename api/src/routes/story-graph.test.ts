import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import * as storyGraph from '../services/ai/story-graph'
import { AiError } from '../services/ai/client'

let t: TestDb
let adminToken = '',
  readerToken = ''
const json = (method: string, token?: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  const admin = await app.request('/api/auth/bootstrap-admin', json('POST', undefined, { username: 'graphadmin', password: 'graphpass123' }))
  adminToken = ((await admin.json()) as { token: string }).token
  await t.db.query("INSERT INTO invites (code, created_at) VALUES ('GRAPH-INVITE', 1)")
  const reader = await app.request('/api/auth/register', json('POST', undefined, { username: 'graphreader', password: 'graphpass123', invite: 'GRAPH-INVITE' }))
  readerToken = ((await reader.json()) as { token: string }).token
  await t.db.query("INSERT INTO novels (id, title, visibility, created_at, updated_at) VALUES ('private-book', '私密图谱', 'admin', 1, 1)")
}, 30000)
afterAll(async () => {
  setDbForTests(null)
  vi.unstubAllEnvs()
  await t.close()
})

describe('story graph administrator boundary', () => {
  it.each([
    ['truncated', 422, '图谱输出被截断，未保存'],
    ['invalid', 422, 'people[0].evidenceIds[0]：证据 ID 不属于本次有效档案，请重新生成'],
    ['upstream', 502, 'AI 服务连接失败'],
  ] as const)('returns an actionable %s error with the correct HTTP status', async (code, status, message) => {
    const generate = vi.spyOn(storyGraph, 'generateStoryGraph').mockRejectedValueOnce(new AiError(code, message, status))
    try {
      const response = await app.request('/api/ai/writing/story-graph/private-book', json('POST', adminToken))
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: message, code })
    } finally {
      generate.mockRestore()
    }
  })
  it.each(['GET', 'POST'])('%s refuses anonymous and reader access before revealing private novel data', async (method) => {
    expect((await app.request('/api/ai/writing/story-graph/private-book', json(method))).status).toBe(401)
    expect((await app.request('/api/ai/writing/story-graph/private-book', json(method, readerToken))).status).toBe(403)
  })
  it('lets the administrator inspect missing archives and rejects generation without sources', async () => {
    const read = await app.request('/api/ai/writing/story-graph/private-book', json('GET', adminToken))
    expect(read.status).toBe(200)
    expect(read.headers.get('Cache-Control')).toBe('no-store')
    expect(await read.json()).toMatchObject({ novel: { title: '私密图谱' }, graph: null, status: 'unavailable' })
    expect((await app.request('/api/ai/writing/story-graph/private-book', json('POST', adminToken))).status).toBe(422)
    expect((await app.request('/api/ai/writing/story-graph/no-book', json('GET', adminToken))).status).toBe(404)
  })
})
