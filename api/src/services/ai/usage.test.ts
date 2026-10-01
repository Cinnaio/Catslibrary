import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { recordUsage, summarizeUsage } from './usage'

let db: TestDb
beforeAll(async () => {
  db = await createTestDb()
  await db.applyMigrations()
})
afterAll(async () => {
  await db.close()
})

describe('upstream usage persistence', () => {
  it('retains fractional legacy units for six-decimal upstream amounts', async () => {
    await recordUsage(db.db, {
      userId: '',
      model: 'precision',
      provider: 'relay.test',
      promptTokens: 1,
      completionTokens: 1,
      costMillicents: 0.4,
      costReported: true,
    })
    const { rows } = await db.db.query<{ cost_millicents: string | number }>("SELECT cost_millicents FROM ai_usage WHERE model = 'precision'")
    expect(Number(rows[0]?.cost_millicents)).toBe(0.4)
    expect((await summarizeUsage(db.db, 0)).costMillicents).toBe(0.4)
    await db.db.query("DELETE FROM ai_usage WHERE model = 'precision'")
  })
  it('keeps unknown cache distinct from zero and excludes incomplete cost from aggregates', async () => {
    const base = { userId: '', model: 'test', provider: 'relay.test', promptTokens: 1000, completionTokens: 100 }
    await recordUsage(db.db, { ...base })
    await recordUsage(db.db, { ...base, costReported: true, costMillicents: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    await recordUsage(db.db, { ...base, costReported: true, costMillicents: 150, cacheReadTokens: 500, cacheWriteTokens: 30 })
    await recordUsage(db.db, { ...base, costReported: false, costMillicents: 123, cacheReadTokens: 100 })
    const { rows } = await db.db.query<{ cache_read_tokens: number | null; cost_reported: boolean }>(
      'SELECT cache_read_tokens, cost_reported FROM ai_usage ORDER BY created_at',
    )
    expect(rows.some((r) => r.cache_read_tokens === null && r.cost_reported === false)).toBe(true)
    expect(rows.some((r) => r.cache_read_tokens === 0 && r.cost_reported === true)).toBe(true)
    expect(await summarizeUsage(db.db, 0)).toMatchObject({
      calls: 4,
      promptTokens: 4000,
      completionTokens: 400,
      costMillicents: 150,
      costReportedCalls: 2,
      cacheReadTokens: 600,
      cacheWriteTokens: 30,
      cacheReadReportedCalls: 3,
      cacheWriteReportedCalls: 2,
    })
  })
})
