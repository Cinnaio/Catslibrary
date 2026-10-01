export type TrafficDays = 7 | 30 | 90
export interface TrafficPeriod {
  start: number
  end: number
  pageViews: number
  visitors: number
  dailyTrend: Array<{ date: string; pageViews: number; visitors: number }>
}
export interface SiteTraffic {
  days: TrafficDays
  timezone: string
  generatedAt: number
  current: TrafficPeriod
  previous: TrafficPeriod
  countries: Array<{ key: string; visits: number }>
  devices: Array<{ key: string; visits: number }>
  sources: Array<{ key: string; visits: number }>
  region: { unknownVisits: number; knownVisits: number; otherVisits: number; coverage: number }
}
export function trafficCsv(data: SiteTraffic) {
  const rows: Array<Array<string | number>> = [
    ['统计时区', data.timezone],
    ['统计截止', new Date(data.generatedAt).toISOString()],
    ['周期', '起始', '截止', 'PV', 'UV（周期去重）'],
  ]
  for (const [label, period] of [
    ['本期', data.current],
    ['上期', data.previous],
  ] as const) {
    rows.push([label, new Date(period.start).toISOString(), new Date(period.end).toISOString(), period.pageViews, period.visitors])
  }
  rows.push([], ['周期', '日期', 'PV', 'UV（日去重）'])
  for (const [label, period] of [
    ['本期', data.current],
    ['上期', data.previous],
  ] as const) {
    period.dailyTrend.forEach((day) => rows.push([label, day.date, day.pageViews, day.visitors]))
  }
  rows.push([], ['维度', '分类', 'PV', '占全部 PV 比例'])
  const countries = [...data.countries, { key: '其他已识别地区', visits: data.region.otherVisits }, { key: '未识别地区', visits: data.region.unknownVisits }]
  for (const [label, items] of [
    ['地区', countries],
    ['设备', data.devices],
    ['来源', data.sources],
  ] as const) {
    items.forEach((item) =>
      rows.push([label, item.key, item.visits, data.current.pageViews ? `${((item.visits / data.current.pageViews) * 100).toFixed(1)}%` : '0%']),
    )
  }
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(value)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""')}"`,
          )
          .join(','),
      )
      .join('\r\n')
  )
}
