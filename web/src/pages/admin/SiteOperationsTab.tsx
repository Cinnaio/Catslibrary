import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, RefreshCw, Globe2, ChevronDown } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { trafficCsv, type SiteTraffic, type TrafficDays } from '@/lib/site-traffic'
import AdminPage from '@/components/admin/AdminPage'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国',
  HK: '中国香港',
  MO: '中国澳门',
  TW: '中国台湾',
  JP: '日本',
  KR: '韩国',
  SG: '新加坡',
  US: '美国',
  CA: '加拿大',
  GB: '英国',
  DE: '德国',
  AU: '澳大利亚',
  ZZ: '未识别地区',
  other: '其他已识别地区',
}
const DEVICE_NAMES: Record<string, string> = { mobile: '移动端', desktop: '桌面端', tablet: '平板', bot: '自动访问', other: '其他' }
const SOURCE_NAMES: Record<string, string> = { direct: '直接访问', search: '搜索引擎', external: '外部链接', internal: '站内跳转' }
const DEFINITIONS = {
  地区: '依据访问携带的地区代码归类；未取得地区代码的访问单独列为未识别地区。',
  设备: '依据浏览器提供的设备信息归类，自动访问也包含在总浏览量中。',
  来源: '依据访问来源归类。站内跳转、直接访问、搜索引擎与外部链接互斥统计。',
}
const number = (value: number) => value.toLocaleString()
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
function change(current: number, previous: number) {
  return previous ? `${current >= previous ? '+' : ''}${(((current - previous) / previous) * 100).toFixed(1)}%` : current ? '上期无访问' : '持平'
}
type Dimension = { title: string; visits: number; definition: string }

export default function SiteOperationsTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedDays = Number(searchParams.get('days') || 7)
  const days: TrafficDays = requestedDays === 30 || requestedDays === 90 ? requestedDays : 7
  const [data, setData] = useState<SiteTraffic | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [compare, setCompare] = useState(false)
  const [metric, setMetric] = useState<'both' | 'pageViews' | 'visitors'>('both')
  const [dimension, setDimension] = useState<Dimension | null>(null)
  const requestId = useRef(0)
  useEffect(() => {
    if (searchParams.get('view') !== 'traffic') {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.set('view', 'traffic')
          return next
        },
        { replace: true },
      )
    }
  }, [searchParams, setSearchParams])
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    setData((current) => (current?.days === days ? current : null))
    try {
      const result = await adminApi.site.traffic(days)
      if (id === requestId.current) setData(result)
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message || '流量数据加载失败，请重试。')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [days])
  useEffect(() => {
    const sequence = requestId
    void load()
    return () => {
      sequence.current++
    }
  }, [load])
  const active = data?.days === days ? data : null
  const current = active?.current
  const peak = current?.dailyTrend.reduce((best, day) => (day.pageViews > (best?.pageViews || 0) ? day : best), current.dailyTrend[0])
  const chartData =
    current?.dailyTrend.map((day, index) => ({
      ...day,
      previousDate: active?.previous.dailyTrend[index]?.date,
      previousPageViews: active?.previous.dailyTrend[index]?.pageViews,
      previousVisitors: active?.previous.dailyTrend[index]?.visitors,
    })) || []
  const exportCsv = () => {
    if (!active) return
    const url = URL.createObjectURL(new Blob([trafficCsv(active)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `traffic-${current?.dailyTrend[0]?.date}-${current?.dailyTrend.at(-1)?.date}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const rows = (kind: keyof typeof DEFINITIONS, items: Array<{ key: string; visits: number }>, names: Record<string, string>) => (
    <div className="traffic-shares">
      {items
        .filter((item) => item.visits > 0)
        .map((item) => (
          <button
            type="button"
            className="traffic-share"
            key={item.key}
            onClick={() => setDimension({ title: names[item.key] || item.key, visits: item.visits, definition: DEFINITIONS[kind] })}
          >
            <span>{names[item.key] || item.key}</span>
            <span>
              {number(item.visits)} <small>{percent(current?.pageViews ? item.visits / current.pageViews : 0)}</small>
            </span>
            <span className="traffic-share__track">
              <i style={{ width: percent(current?.pageViews ? item.visits / current.pageViews : 0) }} />
            </span>
          </button>
        ))}
      {!items.some((item) => item.visits) && <p className="traffic-empty">{!active ? (loading ? '正在汇总统计…' : '统计数据暂不可用') : '暂无访问数据'}</p>}
    </div>
  )
  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--site-operations site-operations"
      title="流量分析"
      description="从匿名聚合数据观察访问趋势、地区、设备与来源。"
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!current?.pageViews || loading}>
            <Download className="size-4" />
            导出 CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </>
      }
    >
      <div className="traffic-workspace">
        <div className="traffic-toolbar">
          <div className="traffic-segment" role="group" aria-label="时间范围">
            {([7, 30, 90] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() =>
                  setSearchParams((params) => {
                    const next = new URLSearchParams(params)
                    next.set('days', String(value))
                    return next
                  })
                }
              >
                近 {value} 日
              </button>
            ))}
          </div>
          <span className="traffic-window">{current ? `${current.dailyTrend[0]?.date} — ${current.dailyTrend.at(-1)?.date}` : '含今日 · 北京时间'}</span>
          <label className="traffic-compare">
            <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />
            对比上一周期
          </label>
        </div>
        {error && (
          <div className="traffic-error" role="alert">
            {error}
            {active && <span> 当前保留上次成功加载的数据。</span>}
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              重试
            </Button>
          </div>
        )}
        <Card className="traffic-panel" aria-busy={loading}>
          <AdminPanelHeading
            title="访问趋势"
            status={
              current && (
                <span className="admin-panel-status">
                  {number(current.pageViews)} PV · {number(current.visitors)} UV
                </span>
              )
            }
          />
          <CardContent>
            {current && (
              <div className="traffic-trend-tools">
                <div className="traffic-changes">
                  {compare ? (
                    <>
                      <small>较上期 {change(current.pageViews, active.previous.pageViews)} · PV</small>
                      <small>较上期 {change(current.visitors, active.previous.visitors)} · UV</small>
                    </>
                  ) : (
                    <span>按日统计浏览量与去重访客。</span>
                  )}
                </div>
                <div className="traffic-segment" role="group" aria-label="趋势指标">
                  {(
                    [
                      ['both', '全部'],
                      ['pageViews', '浏览量 PV'],
                      ['visitors', '访客 UV'],
                    ] as const
                  ).map(([key, label]) => (
                    <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!current ? (
              <p className="traffic-empty traffic-empty--chart" role="status">
                {loading ? '正在汇总访问数据…' : '流量数据暂不可用'}
              </p>
            ) : !current.pageViews ? (
              <p className="traffic-empty traffic-empty--chart">这段时间还没有访问记录，试试其他时间范围。</p>
            ) : (
              <>
                <div className="traffic-legend">
                  {metric !== 'visitors' && (
                    <span>
                      <i />
                      浏览量 PV
                    </span>
                  )}
                  {metric !== 'pageViews' && (
                    <span>
                      <i className="traffic-legend__uv" />
                      访客 UV
                    </span>
                  )}
                  {compare && (
                    <span>
                      <i className="traffic-legend__previous" />
                      上期（虚线）
                    </span>
                  )}
                </div>
                <div className="traffic-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value: string) => value.slice(5)}
                        tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={32}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={38} />
                      <Tooltip
                        content={({ active: visible, payload }) => {
                          const row = payload?.[0]?.payload as (typeof chartData)[number] | undefined
                          return visible && row ? (
                            <div className="traffic-tooltip">
                              <strong>{row.date}</strong>
                              {metric !== 'visitors' && <p>浏览量 PV：{number(row.pageViews)}</p>}
                              {metric !== 'pageViews' && <p>访客 UV：{number(row.visitors)}</p>}
                              {compare && (
                                <>
                                  <strong>上期 {row.previousDate}</strong>
                                  {metric !== 'visitors' && <p>浏览量 PV：{number(row.previousPageViews || 0)}</p>}
                                  {metric !== 'pageViews' && <p>访客 UV：{number(row.previousVisitors || 0)}</p>}
                                </>
                              )}
                            </div>
                          ) : null
                        }}
                      />
                      {metric !== 'visitors' && <Line dataKey="pageViews" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />}
                      {metric !== 'pageViews' && (
                        <Line dataKey="visitors" stroke="var(--color-success)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      )}
                      {compare && metric !== 'visitors' && (
                        <Line
                          dataKey="previousPageViews"
                          stroke="var(--accent)"
                          strokeDasharray="5 5"
                          strokeOpacity={0.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      )}
                      {compare && metric !== 'pageViews' && (
                        <Line
                          dataKey="previousVisitors"
                          stroke="var(--color-success)"
                          strokeDasharray="5 5"
                          strokeOpacity={0.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
            {current && (
              <>
                <div className="traffic-trend-note">
                  <span>{peak?.pageViews ? `访问峰值出现在 ${peak.date} · ${number(peak.pageViews)} PV` : '每日访问记录会随统计更新'}</span>
                  <span>周期 UV 独立去重，不等于每日 UV 相加。</span>
                </div>
                <details className="traffic-details">
                  <summary>
                    每日明细
                    <ChevronDown className="size-4" />
                  </summary>
                  <div className="traffic-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th>浏览量 PV</th>
                          <th>访客 UV</th>
                          {compare && (
                            <>
                              <th>上期 PV</th>
                              <th>上期 UV</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {chartData.map((day) => (
                          <tr key={day.date}>
                            <td>
                              {day.date}
                              {compare && <small>上期 {day.previousDate}</small>}
                            </td>
                            <td>{number(day.pageViews)}</td>
                            <td>{number(day.visitors)}</td>
                            {compare && (
                              <>
                                <td>{number(day.previousPageViews || 0)}</td>
                                <td>{number(day.previousVisitors || 0)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </CardContent>
        </Card>
        <div className="traffic-dimensions">
          <Card className="traffic-panel">
            <AdminPanelHeading title="访问地区" status={active && <span className="traffic-coverage">识别率 {percent(active.region.coverage)}</span>} />
            <CardContent>
              {active && !active.region.knownVisits && current?.pageViews ? (
                <div className="traffic-region-empty">
                  <Globe2 className="size-5" />
                  <strong>地区未识别</strong>
                  <p>访问已正常计入浏览量，暂未取得地区信息。</p>
                </div>
              ) : null}
              {rows(
                '地区',
                active ? [...active.countries, { key: 'other', visits: active.region.otherVisits }, { key: 'ZZ', visits: active.region.unknownVisits }] : [],
                COUNTRY_NAMES,
              )}
            </CardContent>
          </Card>
          <Card className="traffic-panel">
            <AdminPanelHeading title="设备构成" />
            <CardContent>{rows('设备', active?.devices || [], DEVICE_NAMES)}</CardContent>
          </Card>
          <Card className="traffic-panel">
            <AdminPanelHeading title="访问来源" />
            <CardContent>{rows('来源', active?.sources || [], SOURCE_NAMES)}</CardContent>
          </Card>
        </div>
        <details className="traffic-privacy">
          <summary>
            统计口径与隐私说明
            <ChevronDown className="size-4" />
          </summary>
          <p>
            时间范围按北京时间划分，包含今日截至刷新时刻的访问。PV 为访问次数；UV
            使用浏览器随机标识，经服务端哈希后按周期去重，同一访客跨设备可能重复统计。上一周期与本期时长一致。所有维度占比以本期全部 PV 为分母。
          </p>
          <p>不记录 IP、完整 User-Agent 或完整来源地址。地区、设备与来源仅保存分类结果。来源按访问事件归类，并非新访客获客渠道。</p>
          {active && <p>数据更新于 {new Date(active.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）。</p>}
        </details>
      </div>
      <Dialog
        open={!!dimension}
        onOpenChange={(open) => {
          if (!open) setDimension(null)
        }}
      >
        <AdminDialogContent>
          <DialogHeader>
            <DialogTitle>{dimension?.title}</DialogTitle>
            <DialogDescription>当前时间范围内的匿名聚合统计</DialogDescription>
          </DialogHeader>
          <AdminDialogBody>
            <div className="traffic-dialog-total">
              <strong>
                {number(dimension?.visits || 0)} <small>PV</small>
              </strong>
              <span>占全部浏览量 {percent(current?.pageViews ? (dimension?.visits || 0) / current.pageViews : 0)}</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{dimension?.definition}</p>
          </AdminDialogBody>
        </AdminDialogContent>
      </Dialog>
    </AdminPage>
  )
}
