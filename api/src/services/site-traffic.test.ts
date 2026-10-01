import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { siteTraffic } from './site-traffic'

describe('流量统计 SQL', () => {
  let testDb: TestDb
  const now = Date.parse('2026-10-01T04:00:00Z') // Shanghai noon
  beforeAll(async () => {
    testDb = await createTestDb()
    await testDb.db.query('CREATE TABLE site_visits (id text, visitor_hash text, visited_at bigint, country_code text, device_type text, referrer_type text)')
  })
  afterAll(async () => {
    await testDb.close()
  })
  it('跨日 UV 独立去重，上海零点边界与等时长上期正确，补齐零访问日期', async () => {
    await testDb.db.query('DELETE FROM site_visits')
    const visits = [
      ['a', 'same', '2026-09-24T16:00:00Z', 'CN'], // first current day
      ['b', 'same', '2026-09-30T16:00:00Z', 'ZZ'], // Shanghai Oct 1
      ['c', 'prior', '2026-09-24T03:59:59Z', 'US'], // previous final day, before noon
      ['d', 'excluded', '2026-09-24T04:00:00Z', 'US'], // after previous cutoff
      ['e', 'future', '2026-10-01T04:00:00Z', 'US'], // current cutoff
    ]
    for (const [id, visitor, time, country] of visits)
      await testDb.db.query('INSERT INTO site_visits VALUES ($1, $2, $3, $4, $5, $6)', [id, visitor, Date.parse(time!), country, 'desktop', 'direct'])
    const result = await siteTraffic(testDb.db, 7, now)
    expect(result.current.pageViews).toBe(2)
    expect(result.current.visitors).toBe(1)
    expect(result.current.dailyTrend).toHaveLength(7)
    expect(result.current.dailyTrend[0]).toEqual({ date: '2026-09-25', pageViews: 1, visitors: 1 })
    expect(result.current.dailyTrend[1]!.pageViews).toBe(0)
    expect(result.current.dailyTrend[6]!.date).toBe('2026-10-01')
    expect(result.previous.pageViews).toBe(1)
    expect(result.current.end - result.current.start).toBe(result.previous.end - result.previous.start)
    expect(result.region).toEqual({ knownVisits: 1, unknownVisits: 1, otherVisits: 0, coverage: 0.5 })
  })
  it('地区排行超出七项仍完整覆盖全部访问，空周期不会除零', async () => {
    await testDb.db.query('DELETE FROM site_visits')
    for (let i = 0; i < 10; i++)
      await testDb.db.query('INSERT INTO site_visits VALUES ($1, $2, $3, $4, $5, $6)', [
        String(i),
        String(i),
        now - 1000,
        i === 9 ? 'ZZ' : `A${String.fromCharCode(65 + i)}`,
        'mobile',
        'search',
      ])
    const result = await siteTraffic(testDb.db, 30, now)
    expect(result.countries).toHaveLength(7)
    expect(result.region.otherVisits).toBe(2)
    expect(result.region.unknownVisits).toBe(1)
    expect(result.countries.reduce((sum, row) => sum + row.visits, 0) + result.region.otherVisits + result.region.unknownVisits).toBe(result.current.pageViews)
    await testDb.db.query('DELETE FROM site_visits')
    const empty = await siteTraffic(testDb.db, 90, now)
    expect(empty.current.dailyTrend).toHaveLength(90)
    expect(empty.region.coverage).toBe(0)
  })
})
