import type { Db } from '../db/pool'

const DAY = 86_400_000
const OFFSET = 8 * 3_600_000
const date = (time: number) => new Date(time + OFFSET).toISOString().slice(0, 10)

/** Shanghai calendar days; both periods end at the same elapsed time of day. */
export async function siteTraffic(db: Db, days: 7 | 30 | 90, now = Date.now()) {
  const start = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET - (days - 1) * DAY
  const previousStart = start - days * DAY
  const previousEnd = now - days * DAY
  const client = await db.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const periods = []
    for (const [from, to] of [
      [start, now],
      [previousStart, previousEnd],
    ] as const) {
      const totals = await client.query<{ pageViews: number; visitors: number }>(
        'SELECT COUNT(*)::int AS "pageViews", COUNT(DISTINCT visitor_hash)::int AS visitors FROM site_visits WHERE visited_at >= $1 AND visited_at < $2',
        [from, to],
      )
      const daily = await client.query<{ date: string; pageViews: number; visitors: number }>(
        `SELECT to_char(to_timestamp(visited_at / 1000.0) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS "pageViews", COUNT(DISTINCT visitor_hash)::int AS visitors
         FROM site_visits WHERE visited_at >= $1 AND visited_at < $2 GROUP BY date ORDER BY date`,
        [from, to],
      )
      const byDate = new Map(daily.rows.map((row) => [row.date, row]))
      periods.push({
        start: from,
        end: to,
        ...(totals.rows[0] || { pageViews: 0, visitors: 0 }),
        dailyTrend: Array.from({ length: days }, (_, i) => {
          const key = date(from + i * DAY)
          return byDate.get(key) || { date: key, pageViews: 0, visitors: 0 }
        }),
      })
    }
    const dimensions: Record<string, Array<{ key: string; visits: number }>> = {}
    // Fixed column whitelist, never derived from request input.
    for (const [name, column, fallback] of [
      ['countries', 'country_code', 'ZZ'],
      ['devices', 'device_type', 'other'],
      ['sources', 'referrer_type', 'direct'],
    ] as const) {
      const result = await client.query<{ key: string; visits: number }>(
        `SELECT COALESCE(NULLIF(${column}, ''), $3) AS key, COUNT(*)::int AS visits FROM site_visits
         WHERE visited_at >= $1 AND visited_at < $2 GROUP BY key ORDER BY visits DESC, key ASC`,
        [start, now, fallback],
      )
      dimensions[name] = result.rows
    }
    await client.query('COMMIT')
    const countries = (dimensions.countries || []).filter((row) => row.key !== 'ZZ')
    const unknownVisits = dimensions.countries?.find((row) => row.key === 'ZZ')?.visits || 0
    const current = periods[0]!
    const knownVisits = current.pageViews - unknownVisits
    return {
      days,
      timezone: 'Asia/Shanghai',
      generatedAt: now,
      current,
      previous: periods[1]!,
      countries: countries.slice(0, 7),
      devices: dimensions.devices || [],
      sources: dimensions.sources || [],
      region: {
        unknownVisits,
        knownVisits,
        otherVisits: countries.slice(7).reduce((sum, row) => sum + row.visits, 0),
        coverage: current.pageViews ? knownVisits / current.pageViews : 0,
      },
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
