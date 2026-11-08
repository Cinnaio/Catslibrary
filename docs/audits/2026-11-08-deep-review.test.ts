/** Historical audit probes: assert the observed defects, NOT fixed behavior.
 * F1/F2 are superseded by api/src/routes/reader-reliability.test.ts and disabled
 * here after the first repair batch. F3/F5/F6 remain open audit findings.
 * All database data is synthetic PGlite data; AI responses are mocked.
 * Run: node node_modules/vitest/vitest.mjs run --config docs/audits/2026-11-08.vitest.config.ts
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('../../api/src/services/ai/client', async original => ({
  ...await original<typeof import('../../api/src/services/ai/client')>(),
  chat: mocks.chat,
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'fixture' }),
}))
import { app } from '../../api/src/app'
import { setDbForTests, type Db } from '../../api/src/db/pool'
import { createTestDb, type TestDb } from '../../api/src/test/db'
import { loadConfig } from '../../api/src/config'
import { hashToken } from '../../api/src/services/auth'
import { saveAiSettings } from '../../api/src/services/ai/settings'
import { runFollowupTick } from '../../api/src/services/novel-followup'
import { withIdempotency } from '../../api/src/services/idempotency'

let t: TestDb
const token = 'a'.repeat(64)
const expiredToken = 'b'.repeat(64)
function request(path: string, method: string, body?: unknown, bearer = token) {
  return app.request('/api' + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://fixture/fixture'
  process.env.COVER_FETCH_ENABLED = '0'
  const now = Date.now()
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('audit-reader','audit-reader','reader','unused','unused',$1,$1)", [now])
  await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,$2,$3,$4,$4)',
    [await hashToken(token, loadConfig().sessionHashSalt), 'audit-reader', now + 86400000, now])
  await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,$2,$3,$4,$4)',
    [await hashToken(expiredToken, loadConfig().sessionHashSalt), 'audit-reader', now - 1000, now - 86400000])
  await t.db.query("INSERT INTO novels(id,title,content_rating,status,created_at,updated_at) VALUES('audit-book','Audit book','general','ongoing',$1,$1)", [now])
  for (const [index, id] of ['audit-ch1', 'audit-ch2'].entries()) {
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$1,$3,$4,$5)',
      [id, 'audit-book', '山村少年走进安静的书院，借了一本旧书，开始阅读古人的故事。'.repeat(30), index + 1, now])
  }
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

it.skip('F1: expired Bearer gets HTTP 200 without saving progress or returning authoritative state', async () => {
  const response = await request('/progress', 'POST', {
    novelId: 'audit-book', chapterId: 'audit-ch1', scrollPercent: 0.7, clientUpdatedAt: Date.now(),
  }, expiredToken)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ success: true })
  expect((await t.db.query("SELECT * FROM reading_progress WHERE user_id='audit-reader'")).rows).toHaveLength(0)
  await t.db.query("INSERT INTO reading_progress(id,user_id,novel_id,chapter_id,scroll_percent,updated_at,deleted_at) VALUES('audit-progress','audit-reader','audit-book','audit-ch1',0.2,1,0)")
  const deletion = await request('/progress?novelId=audit-book', 'DELETE', undefined, expiredToken)
  expect(deletion.status).toBe(200)
  expect(await deletion.json()).toEqual({ success: true })
  expect((await t.db.query("SELECT scroll_percent,deleted_at FROM reading_progress WHERE id='audit-progress'")).rows[0])
    .toMatchObject({ scroll_percent: 0.2, deleted_at: 0 })
})

it.skip('F2: a daily quota of one admits two simultaneous chapter recap calls', async () => {
  await saveAiSettings(t.db, { dailyQuota: 1, recapEnabled: true })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  mocks.chat.mockImplementation(async () => {
    await held
    return { text: '少年到书院借书，开始新的生活。', model: 'fixture', promptTokens: 20, completionTokens: 10, cost: 0 }
  })
  const first = request('/ai/recap', 'POST', { chapterId: 'audit-ch1' })
  const second = request('/ai/recap', 'POST', { chapterId: 'audit-ch2' })
  try { await vi.waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(2), { timeout: 5000 }) }
  finally { release() }
  expect((await Promise.all([first, second])).map(response => response.status)).toEqual([200, 200])
  const usage = await t.db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM ai_usage WHERE user_id='audit-reader'")
  expect(usage.rows[0]?.count).toBe(2)
})

it('F3: three orphan manual jobs survive reclamation and block scheduled followups', async () => {
  await t.db.query("INSERT INTO scrape_configs(novel_id,source_url,selectors,encoding,updated_at) VALUES('audit-book','https://fixture.invalid/book',$1,'utf-8',1)",
    [JSON.stringify({ chapterList: 'a', chapterContent: '.body' })])
  await t.db.query("INSERT INTO novel_followups(novel_id,enabled,user_configured,next_check_at) VALUES('audit-book',TRUE,TRUE,1)")
  for (let i = 0; i < 3; i++) {
    await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$1,1,1)", [`orphan-book-${i}`])
    await t.db.query("INSERT INTO scrape_jobs(id,novel_id,status,started_at,updated_at) VALUES($1,$2,'fetching_chapters',1,1)", [`orphan-job-${i}`, `orphan-book-${i}`])
  }
  const started: string[] = []
  await runFollowupTick(t.db, id => started.push(id))
  expect(started).toEqual([])
  const jobs = await t.db.query<{ status: string }>("SELECT status FROM scrape_jobs WHERE id LIKE 'orphan-job-%'")
  expect(jobs.rows.map(row => row.status)).toEqual(['fetching_chapters', 'fetching_chapters', 'fetching_chapters'])
})

it('F5: a future client timestamp prevents subsequent ordinary settings writes', async () => {
  const future = Date.now() + 365 * 86400000
  const first = await request('/auth/reader-settings', 'PUT', { device: 'ios', settings: { fontSize: '5' }, updatedAt: { fontSize: future } })
  expect(first.status).toBe(200)
  const second = await request('/auth/reader-settings', 'PUT', { device: 'ios', settings: { fontSize: '1' }, updatedAt: { fontSize: Date.now() } })
  expect(second.status).toBe(200)
  expect(await second.json()).toMatchObject({ settings: { fontSize: '5' }, updatedAt: { fontSize: future } })
})

it('F6: replay-ledger failure after business commit deletes the key and repeats the operation', async () => {
  let failLedger = true
  const faultDb: Db = {
    ...t.db,
    query: async (sql, params) => {
      if (failLedger && /UPDATE api_idempotency\s+SET status = 'completed'/.test(sql)) {
        failLedger = false
        throw new Error('synthetic acknowledgement failure')
      }
      return t.db.query(sql, params)
    },
  }
  let executions = 0
  const handler = async () => {
    executions++
    await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$1,1,1)', [`committed-side-effect-${executions}`])
    return Response.json({ ok: true, executions })
  }
  const options = { scope: 'audit.commit', operationKey: 'same-operation', payload: { fixture: true } }
  await expect(withIdempotency(faultDb, options, handler)).rejects.toThrow('synthetic acknowledgement failure')
  expect((await t.db.query("SELECT id FROM api_idempotency WHERE scope='audit.commit'")).rows).toHaveLength(0)
  const replay = await withIdempotency(faultDb, options, handler)
  expect(replay.headers.get('X-Idempotent-Replay')).toBeNull()
  expect(executions).toBe(2)
  expect((await t.db.query("SELECT id FROM novels WHERE id LIKE 'committed-side-effect-%'")).rows).toHaveLength(2)
})
