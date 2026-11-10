import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { chat } from '../services/ai/client'
import { saveAiSettings } from '../services/ai/settings'
import { generationContentRevision } from '../services/ai/generations'
import { REVIEW_ASPECTS } from '../services/ai/story-ledger-review'

vi.mock('../services/ai/client', async (original) => ({
  ...(await original<typeof import('../services/ai/client')>()),
  chat: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }),
}))
const reply = (text: string) => ({ text, model: 'test', promptTokens: 12, completionTokens: 10, cost: 0.01, finishReason: 'stop' })
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

describe('incremental memory HTTP integration', () => {
  it('requires preparation before writing and keeps the administrator boundary', async () => {
    expect((await app.request('/api/ai/writing/materials', json(body, ''))).status).toBe(401)
    const missing = await app.request('/api/ai/writing/materials', json(body))
    expect(missing.status).toBe(422)
    expect(chat).not.toHaveBeenCalled()
  })
  it('shares extraction, previews selected material and validates quality review against the full archive', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      reply(
        JSON.stringify({
          complete: true,
          needs: [],
          entities: [{ name: '沈砚', kind: 'person', aliases: [] }],
          facts: [
            {
              memoryType: 'state',
              kind: 'state',
              subjects: ['沈砚'],
              label: '持有钥匙',
              summary: '沈砚持有铜钥匙。',
              certainty: 'fact',
              scope: 'local',
              status: 'active',
              replaces: [],
              quote: '沈砚持有铜钥匙。',
            },
          ],
        }),
      ),
    )
    vi.mocked(chat).mockImplementationOnce(async (request) => {
      const context = JSON.parse(request.messages[1]!.content)
      return reply(JSON.stringify({
        checks: context.targets.map((fact: { id: string }) => ({ id: fact.id, verdict: 'supported', reason: '正文明确沈砚持有钥匙。' })),
        goalChecks: [],
        coverage: REVIEW_ASPECTS.map((aspect) => ({ aspect, verdict: aspect === 'ownership' ? 'covered' : 'none', reason: '归属已记录，其他维度无变化。' })),
      }))
    })
    const extracted = await app.request('/api/ai/writing/plot-state', json({ novelId: 'book' }))
    expect(extracted.status).toBe(200)
    const preview = await app.request('/api/ai/writing/materials', json(body))
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ memorySelection: { retrievedFacts: 1, totalFacts: 1 } })
    expect(chat).toHaveBeenCalledTimes(2)
    await t.db.query(
      "INSERT INTO ai_generations(id,novel_id,kind,result,status,created_at) VALUES('ledger-draft','book','continue','沈砚检查铜钥匙。','draft',1)",
    )
    vi.mocked(chat).mockResolvedValueOnce(reply('{"findings":[]}'))
    const review = await app.request('/api/ai/writing/drafts/ledger-draft/review', json({ expectedRevision: generationContentRevision('沈砚检查铜钥匙。') }))
    expect(review.status).toBe(200)
    const saved = await app.request('/api/ai/writing/drafts/ledger-draft/review', { headers: { Authorization: `Bearer ${adminToken}` } })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ report: { stale: false } })
  })
  it('rejects source edits before continuing and performs no additional model call', async () => {
    const count = vi.mocked(chat).mock.calls.length
    await t.db.query("UPDATE chapters SET content='沈砚已经交还铜钥匙。' WHERE id='c1'")
    expect((await app.request('/api/ai/writing/materials', json(body))).status).toBe(422)
    expect(chat).toHaveBeenCalledTimes(count)
  })
})
