import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { chat } from '../services/ai/client'
import { saveAiSettings } from '../services/ai/settings'

vi.mock('../services/ai/client', async (original) => ({
  ...(await original<typeof import('../services/ai/client')>()),
  chat: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }),
}))
let t: TestDb,
  adminToken = ''
const json = (body: unknown, token = adminToken): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})
const body = {
  novelId: 'book',
  afterChapterId: 'c1',
  instruction: '沈砚继续调查铜钥匙',
  writingBrief: { version: 1, characters: ['沈砚'], objective: '查明来源', chapterGoals: [] },
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  const admin = await app.request('/api/auth/bootstrap-admin', json({ username: 'ledgeradmin', password: 'ledgerpass123' }, ''))
  adminToken = ((await admin.json()) as { token: string }).token
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','隔离故事',1,1)")
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('c1','book','起点','沈砚持有铜钥匙。',1,1)")
  await saveAiSettings(t.db, { storyMemoryEngine: 'incremental', storyMemoryAutoUpdate: false, storyMemoryStreamEnabled: false })
}, 120000)
afterAll(async () => {
  setDbForTests(null)
  vi.unstubAllEnvs()
  await t.close()
})

describe('旧增量档案配置与创作解耦', () => {
  it('无需旧档案准备即可预览，并保持管理员边界', async () => {
    expect((await app.request('/api/ai/writing/materials', json(body, ''))).status).toBe(401)
    const preview = await app.request('/api/ai/writing/materials', json(body))
    expect(preview.status).toBe(200)
    const result = await preview.json() as any
    expect(result.analysisReferences).toEqual([])
    expect(JSON.stringify(result.plan)).toContain('沈砚持有铜钥匙')
    expect(result.memorySelection).toBeUndefined()
    expect(chat).not.toHaveBeenCalled()
  })
  it('修改正文后直接使用当前正文，不触发旧档案提取或重建', async () => {
    await t.db.query("UPDATE chapters SET content='沈砚已经交还铜钥匙。' WHERE id='c1'")
    const preview = await app.request('/api/ai/writing/materials', json(body))
    expect(preview.status).toBe(200)
    expect(JSON.stringify(await preview.json())).toContain('沈砚已经交还铜钥匙')
    expect(chat).not.toHaveBeenCalled()
    expect((await t.db.query('SELECT * FROM ai_tasks')).rows).toHaveLength(0)
  })
})
