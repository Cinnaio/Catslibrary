import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb
let token: string
const automatic = '角色正在调查旧案，线索仍未解开。😀'.repeat(400)
const manual = '人工确认：线索尚未得到证实。😀'.repeat(300)

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
  ['style', 'style-profile', 'profile'],
  ['plot', 'plot-state', 'state'],
  ['relationship', 'relationship-profile', 'profile'],
] as const)('%s 精简读取保留使用资格与版本，全文及人工层仍可按需读取', async (kind, endpoint, contentKey) => {
  const novelId = `read-${kind}`
  const chapterId = `${novelId}-c1`
  await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$2,1,1)', [novelId, '画像阅读'])
  await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,1,1)',
    [chapterId, novelId, '第一章', '雨落在青石板上，少年攥紧了那柄断剑。'.repeat(30)])
  const path = `/api/ai/writing/${endpoint}/${novelId}?afterChapterId=${chapterId}`
  const empty = await app.request(`${path}&summary=1`, request('GET'))
  expect(await empty.json()).toMatchObject({ hasContent: false, hasEffectiveContent: false, effectiveOrigin: 'none' })
  expect((await app.request(`${path}&summary=1`)).status).toBe(401)
  expect((await app.request(`/api/ai/writing/${endpoint}`, request('POST', { novelId, afterChapterId: chapterId }))).status).toBe(200)

  const fullResponse = await app.request(path, request('GET'))
  expect(fullResponse.status).toBe(200)
  const full = await fullResponse.json() as Record<string, any>
  expect(full[contentKey]).toBe(automatic)
  expect(full.effectiveContent).toBe(automatic)
  const saved = await app.request(`/api/ai/writing/profiles/${kind}/${novelId}/override`, request('PUT', {
    content: manual, expectedRevision: 0, baseProfileRevision: full.baseProfileRevision,
    afterChapterId: chapterId, operationId: `read-manual-${kind}`,
  }))
  expect(saved.status).toBe(200)

  const response = await app.request(`${path}&summary=1`, request('GET'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const summaryText = await response.text()
  const summary = JSON.parse(summaryText)
  expect(summary).toMatchObject({
    hasContent: true, hasEffectiveContent: true, effectiveOrigin: 'manual',
    eligibility: full.eligibility, source: full.source, baseProfileRevision: full.baseProfileRevision,
    manualOverride: { revision: 1 },
  })
  expect(summary[contentKey]).toBeUndefined()
  expect(summary.effectiveContent).toBeUndefined()
  expect(summary.manualOverride.content).toBeUndefined()
  expect(summaryText).not.toContain(manual)
  if (kind !== 'style') {
    expect(summary.progress).toMatchObject({ processedChapters: 1, totalChapters: 1, complete: true })
    expect(Array.from(summary.progress.previewContent)).toHaveLength(601)
    expect(summary.progress.previewContent).toBe(`${Array.from(automatic).slice(0, 600).join('')}…`)
  }
  const reread = await app.request(path, request('GET'))
  const document = await reread.json() as Record<string, any>
  expect(document[contentKey]).toBe(automatic)
  expect(document.effectiveContent).toBe(manual)
  expect(document.manualOverride.content).toBe(manual)
  if (kind !== 'style') expect(document.progress.previewContent).toBe(automatic)
  expect(JSON.stringify(document).length).toBeGreaterThan(summaryText.length * 3)
})
