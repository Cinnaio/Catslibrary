import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  READING_DAY_MS,
  READING_OFFSET_MS,
  parseReadingDate,
  readingDate,
  readingMidnight,
  readingRange,
  type ReadingPeriod,
  type ReadingStats,
} from '@shared/reading-stats'
import { readingStatsApi } from '../lib/api'
import { useContentPolicy } from '../context/ContentPolicyContext'

const periods: { id: ReadingPeriod; label: string }[] = [
  { id: 'today', label: '今日' },
  { id: 'week', label: '本周' },
  { id: 'month', label: '本月' },
  { id: 'year', label: '今年' },
  { id: '7', label: '最近 7 天' },
  { id: '30', label: '最近 30 天' },
  { id: '90', label: '最近 90 天' },
  { id: 'all', label: '全部' },
  { id: 'custom', label: '自定义' },
]
function readingDuration(ms: number): string {
  if (ms === 0) return '0 分钟'
  const minutes = Math.floor(ms / 60000)
  if (minutes === 0) return '不足 1 分钟'
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`
}
export function ReadingStatsPanel() {
  const { mode } = useContentPolicy()
  const panelRef = useRef<HTMLElement>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(media?.matches ?? false)
    media?.addEventListener('change', changed)
    return () => media?.removeEventListener('change', changed)
  }, [])
  function preserveViewport() {
    const panel = panelRef.current
    if (!panel || window.scrollY <= 0) return
    // Keep only the space needed to retain the current viewport, including when
    // a shorter empty result replaces a chart. Release it when this tab unmounts.
    const spareHeight = Math.max(0, document.documentElement.scrollHeight - window.innerHeight - window.scrollY)
    const minimum = Math.ceil(panel.getBoundingClientRect().height - spareHeight)
    panel.style.minHeight = `${Math.max(parseFloat(panel.style.minHeight) || 0, minimum)}px`
  }
  const [params, setParams] = useSearchParams()
  const [now, setNow] = useState(Date.now)
  const period = periods.find((p) => p.id === params.get('period'))?.id || 'week'
  const minimumOffset = period === 'year' ? Math.max(-120, 1970 - new Date(now + READING_OFFSET_MS).getUTCFullYear()) : -120
  const offset = Math.max(minimumOffset, Math.min(0, Math.trunc(Number(params.get('offset')) || 0)))
  const [data, setData] = useState<ReadingStats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [metric, setMetric] = useState<'milliseconds' | 'sessions'>('milliseconds')
  const [expanded, setExpanded] = useState(false)
  const range = useMemo(() => {
    if (period !== 'custom') return readingRange(period, now, offset)
    const start = parseReadingDate(params.get('from') || readingDate(now))
    const last = parseReadingDate(params.get('to') || readingDate(now))
    if (start === null || last === null || start < 0 || start > last || start > now) return null
    return { start, end: Math.min(last + READING_DAY_MS, now) }
  }, [period, now, offset, params])
  function update(values: Record<string, string | null>) {
    preserveViewport()
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(values)) {
          if (value === null) next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { preventScrollReset: true },
    )
    setExpanded(false)
  }
  useLayoutEffect(() => {
    preserveViewport()
  }, [range])
  useEffect(() => {
    if (!range) {
      setLoading(false)
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    void readingStatsApi
      .get(range.start, range.end, mode)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || '阅读统计加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, mode, retry])
  const trend = useMemo(() => {
    if (!data) return []
    const rows = new Map(data.trend.map((row) => [row.date, row]))
    const first = readingMidnight(data.start),
      last = readingMidnight(Math.max(data.start, data.end - 1))
    const result = []
    const hourly = data.end - data.start <= READING_DAY_MS
    const monthly = data.end - data.start > 90 * READING_DAY_MS
    let cursor = monthly
      ? Date.UTC(new Date(data.start + READING_OFFSET_MS).getUTCFullYear(), new Date(data.start + READING_OFFSET_MS).getUTCMonth(), 1) - READING_OFFSET_MS
      : first
    const boundary = hourly ? data.end : last + READING_DAY_MS
    while (cursor < boundary) {
      const local = new Date(cursor + READING_OFFSET_MS)
      const date = hourly ? local.toISOString().slice(0, 13) : monthly ? readingDate(cursor).slice(0, 7) : readingDate(cursor)
      const row = rows.get(date)
      result.push({
        date,
        label: hourly ? `${date.slice(-2)}时` : monthly ? date : date.slice(5),
        milliseconds: row?.milliseconds || 0,
        sessions: row?.sessions || 0,
        minutes: Math.round((row?.milliseconds || 0) / 6000) / 10,
      })
      cursor = monthly ? Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - READING_OFFSET_MS : cursor + (hourly ? 3600000 : READING_DAY_MS)
    }
    return result
  }, [data])
  return (
    <section ref={panelRef} className="reading-stats" aria-label="阅读统计" aria-busy={loading} data-updating={loading && !!data}>
      <div className="reading-stats__heading">
        <div>
          <h2 className="profile-section-heading">阅读统计</h2>
          <p>看看你的阅读节奏。</p>
        </div>
        <div className="reading-stats__ranges" aria-label="统计时间范围">
          {periods.slice(0, 3).map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => update({ period: p.id, offset: null })}>
              {p.label}
            </button>
          ))}
          <select
            aria-label="更多时间范围"
            value={periods.slice(3).some((p) => p.id === period) ? period : ''}
            onChange={(e) => update({ period: e.target.value, offset: null })}
          >
            <option value="" disabled>
              更多
            </option>
            {periods.slice(3).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {period === 'custom' ? (
        <div className="reading-stats__dates">
          <label>
            开始日期
            <input
              className="form-input"
              type="date"
              min="1970-01-01"
              value={params.get('from') || readingDate(now)}
              max={readingDate(now)}
              onChange={(e) => update({ from: e.target.value })}
            />
          </label>
          <label>
            结束日期
            <input
              className="form-input"
              type="date"
              min="1970-01-01"
              value={params.get('to') || readingDate(now)}
              max={readingDate(now)}
              onChange={(e) => update({ to: e.target.value })}
            />
          </label>
        </div>
      ) : (
        period !== 'all' &&
        range && (
          <div className="reading-stats__period">
            <button type="button" aria-label="上一周期" disabled={offset <= minimumOffset} onClick={() => update({ offset: String(offset - 1) })}>
              <ChevronLeft size={16} />
            </button>
            <span>
              {readingDate(range.start)} — {readingDate(Math.max(range.start, range.end - 1))}
            </span>
            <button type="button" aria-label="下一周期" disabled={offset >= 0} onClick={() => update({ offset: String(offset + 1) })}>
              <ChevronRight size={16} />
            </button>
            {offset < 0 && (
              <button type="button" onClick={() => update({ offset: null })}>
                回到当前
              </button>
            )}
          </div>
        )
      )}
      {!range && <p role="alert">请选择有效的起止日期。</p>}
      <p className="reading-stats__status" role="status">
        {loading ? (data ? '正在更新，暂时显示上次统计…' : '正在加载阅读统计…') : error && data ? '更新失败，暂时显示上次统计。' : ''}
      </p>
      {error && (
        <div className="reading-stats__notice" role="alert">
          <p>{error}</p>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => {
              setNow(Date.now())
              setRetry((v) => v + 1)
            }}
          >
            重试
          </button>
        </div>
      )}
      {range && data && (
        <div className="reading-stats__content" key={`${data.start}:${data.end}`}>
          <dl className="reading-stats__metrics">
            {[
              [readingDuration(data.milliseconds), '阅读时长'],
              [`${data.sessions} 次`, '阅读次数'],
              [`${data.chapters} 章`, '阅读章节'],
              [`${data.days} 天`, '阅读天数'],
            ].map(([value, label]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={label === '阅读时长' ? 'reading-stats__duration' : undefined}>
                  {label === '阅读时长' ? value.split(/ (?=\d+ 分钟$)/).map((part) => <span key={part}>{part}</span>) : value}
                </dd>
              </div>
            ))}
          </dl>
          {data.milliseconds === 0 ? (
            <div className="reading-stats__empty">
              <p>{data.recordedSince ? '这个时间范围还没有阅读记录。' : '开始阅读后，你的统计会出现在这里。'}</p>
              <Link className="btn btn--secondary btn--sm" to="/bookshelf">
                去书架看看
              </Link>
            </div>
          ) : (
            <>
              <div className="reading-stats__chart-head">
                <h3>阅读趋势</h3>
                <div>
                  <button type="button" aria-pressed={metric === 'milliseconds'} onClick={() => setMetric('milliseconds')}>
                    时长
                  </button>
                  <button type="button" aria-pressed={metric === 'sessions'} onClick={() => setMetric('sessions')}>
                    次数
                  </button>
                </div>
              </div>
              <div className="reading-stats__chart" aria-label={metric === 'milliseconds' ? '阅读时长趋势，单位分钟' : '阅读次数趋势'}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trend} accessibilityLayer margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border-light)" strokeDasharray="3 4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={metric === 'milliseconds'} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: 'var(--bg-secondary)' }}
                      contentStyle={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                      }}
                      labelFormatter={(_, items) => items[0]?.payload?.date || ''}
                    />
                    <Bar
                      dataKey={metric === 'milliseconds' ? 'minutes' : 'sessions'}
                      name={metric === 'milliseconds' ? '阅读分钟' : '阅读次数'}
                      fill="var(--accent)"
                      fillOpacity={0.85}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                      isAnimationActive={!reducedMotion}
                      animationDuration={320}
                      animationEasing="ease-out"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="reading-stats__table">
                <summary>查看趋势数据</summary>
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>阅读时长</th>
                      <th>阅读次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{readingDuration(row.milliseconds)}</td>
                        <td>{row.sessions} 次</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <h3 className="reading-stats__books-title">阅读作品</h3>
              <ul className="reading-stats__books">
                {data.novels.slice(0, expanded ? undefined : 5).map((book) => (
                  <li key={book.id}>
                    <div>
                      {book.available !== false ? <Link to={`/novel/${encodeURIComponent(book.id)}`}>{book.title}</Link> : <span>{book.title}</span>}
                      <p>
                        {book.chapters} 章 · 最近阅读 {readingDate(book.lastReadAt)}
                      </p>
                    </div>
                    <span>{readingDuration(book.milliseconds)}</span>
                  </li>
                ))}
              </ul>
              {!expanded && data.novels.length > 5 && (
                <button className="btn btn--secondary btn--sm" onClick={() => setExpanded(true)}>
                  查看全部 {data.novels.length} 本
                </button>
              )}
            </>
          )}
          <details className="reading-stats__help">
            <summary>统计说明{data.recordedSince ? ` · 从 ${readingDate(data.recordedSince)} 开始记录` : ''}</summary>
            <p>当前统计来自 Web 阅读器，按北京时间划分日期，周一为每周起点，仅包含当前模式可访问的作品。</p>
            <p>正文在前台、窗口获得焦点时计时。后台、遮挡正文的面板、休眠或 5 分钟无操作时暂停。计时是阅读活动的近似统计。</p>
            <p>连续阅读满 30 秒计一次，切章不增加次数，离开超过 5 分钟再回来算新的一次。多设备重叠时长合并，独立会话分别计次。</p>
            <p>
              阅读章节按所选范围内阅读满 30 秒的不同章节去重，不等于读完；阅读天数按当天有效阅读满 30
              秒计算。趋势次数在各时间段分别计入，同一次跨时段阅读可能出现在多个时段。
            </p>
            <p>旧进度无法补算阅读时间。离线记录会在联网后同步，最新数据可能延迟约 30 秒显示。</p>
          </details>
        </div>
      )}
    </section>
  )
}
