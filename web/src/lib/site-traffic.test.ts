import { describe, expect, it } from 'vitest'
import { trafficCsv, type SiteTraffic } from './site-traffic'

describe('流量 CSV', () => {
  it('保留周期去重 UV，导出零访问日期与完整地区占比并防止公式注入', () => {
    const period = {
      start: 0,
      end: 1000,
      pageViews: 2,
      visitors: 1,
      dailyTrend: [
        { date: '2026-10-01', pageViews: 1, visitors: 1 },
        { date: '2026-10-02', pageViews: 1, visitors: 1 },
        { date: '2026-10-03', pageViews: 0, visitors: 0 },
      ],
    }
    const data: SiteTraffic = {
      days: 7,
      timezone: 'Asia/Shanghai',
      generatedAt: 1000,
      current: period,
      previous: period,
      countries: [{ key: 'CN', visits: 1 }],
      devices: [{ key: '=TEST,"', visits: 2 }],
      sources: [],
      region: { knownVisits: 1, unknownVisits: 1, otherVisits: 0, coverage: 0.5 },
    }
    const csv = trafficCsv(data)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"本期","1970-01-01T00:00:00.000Z","1970-01-01T00:00:01.000Z","2","1"')
    expect(csv).toContain('"2026-10-03","0","0"')
    expect(csv).toContain('"未识别地区","1","50.0%"')
    expect(csv).toContain('"\'=TEST,"""')
  })
})
