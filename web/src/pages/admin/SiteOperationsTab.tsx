import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartNoAxesCombined, ChevronDown, Download, Globe2, Monitor, RefreshCw } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { trafficCsv, type SiteTraffic, type TrafficDays, type TrafficPeriod } from '@/lib/site-traffic'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import EmptyState from '@/components/shared/EmptyState'
import { PanelHeading } from '@/components/shared/PanelHeading'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import styles from './site-traffic.module.css'

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾', JP: '日本', KR: '韩国', SG: '新加坡',
  US: '美国', CA: '加拿大', GB: '英国', DE: '德国', AU: '澳大利亚', ZZ: '未识别地区', other: '其他已识别地区',
}
const DEVICE_NAMES: Record<string, string> = { mobile: '移动端', desktop: '桌面端', tablet: '平板', bot: '自动访问', other: '其他' }
const SOURCE_NAMES: Record<string, string> = { direct: '直接访问', search: '搜索引擎', external: '外部链接', internal: '站内跳转' }
const DEFINITIONS = {
  地区: '依据访问携带的地区代码归类；未取得地区代码的访问单独列为未识别地区。',
  设备: '依据浏览器提供的设备信息归类，自动访问也包含在总浏览量中。',
  来源: '依据访问来源归类。站内跳转、直接访问、搜索引擎与外部链接互斥统计；来源并非新访客获客渠道。',
}
const number = (value: number) => value.toLocaleString('zh-CN')
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const time = (value: number) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const periodLabel = (period: TrafficPeriod) => `${period.dailyTrend[0]?.date || '—'} — ${period.dailyTrend.at(-1)?.date || '—'}`
function change(current: number, previous: number) {
  return previous ? `${current >= previous ? '+' : ''}${(((current - previous) / previous) * 100).toFixed(1)}%` : current ? '上期无访问' : '持平'
}
type Metric = 'both' | 'pageViews' | 'visitors'
type Dimension = { title: string; visits: number; definition: string; total: number; range: string; generatedAt: number }

export default function SiteOperationsTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedDays = Number(searchParams.get('days') || 7)
  const days: TrafficDays = requestedDays === 30 || requestedDays === 90 ? requestedDays : 7
  const [data, setData] = useState<SiteTraffic | null>(null)
  const [fetching, setLoading] = useState(true)
  const [fetchDays, setFetchDays] = useState<TrafficDays>(days)
  const [error, setError] = useState('')
  const [compare, setCompare] = useState(false)
  const [metric, setMetric] = useState<Metric>('both')
  const [dimension, setDimension] = useState<Dimension | null>(null)
  const requestId = useRef(0)
  const compareId = useId()

  useEffect(() => {
    if (searchParams.get('view') !== 'traffic') {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('view', 'traffic')
        return next
      }, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    const id = ++requestId.current
    setFetchDays(days)
    setLoading(true)
    setError('')
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
    void load()
    return () => { requestId.current++ }
  }, [load])

  const loading = fetching || fetchDays !== days
  const active = data?.days === days ? data : null
  const current = active?.current
  const peak = current?.dailyTrend.reduce((best, day) => day.pageViews > best.pageViews ? day : best, current.dailyTrend[0]!)
  const chartData = current?.dailyTrend.map((day, index) => ({
    ...day,
    previousDate: active?.previous.dailyTrend[index]?.date,
    previousPageViews: active?.previous.dailyTrend[index]?.pageViews,
    previousVisitors: active?.previous.dailyTrend[index]?.visitors,
  })) || []
  const hasChartData = !!current && (current.pageViews > 0 || (compare && !!active?.previous.pageViews))
  const columns: AdminColumn[] = [
    { key: 'date', label: '日期', width: compare ? '32%' : '40%', primary: true },
    { key: 'pageViews', label: '浏览量 PV' },
    { key: 'visitors', label: '访客 UV' },
    ...(compare ? [{ key: 'previousPageViews', label: '上期 PV' }, { key: 'previousVisitors', label: '上期 UV' }] : []),
  ]
  const selectDays = (value: string) => {
    setDimension(null)
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('days', value)
      return next
    })
  }
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
  const rows = (kind: keyof typeof DEFINITIONS, items: Array<{ key: string; visits: number }>, names: Record<string, string>) => {
    const visible = items.filter((item) => item.visits > 0)
    return visible.length ? (
      <ul className={styles.shares} key={days}>
        {visible.map((item, index) => (
          <li key={item.key} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, visible.length)}ms` }}>
            <Button
              type="button"
              variant="ghost"
              className={styles.share}
              onClick={() => active && setDimension({
                title: names[item.key] || item.key, visits: item.visits, definition: DEFINITIONS[kind],
                total: active.current.pageViews, range: periodLabel(active.current), generatedAt: active.generatedAt,
              })}
            >
              <span className={styles.shareName}>{names[item.key] || item.key}</span>
              <span className={styles.shareValue}>{number(item.visits)} <small>{percent(current?.pageViews ? item.visits / current.pageViews : 0)}</small></span>
              <span className={styles.shareTrack} aria-hidden="true"><span style={{ width: percent(current?.pageViews ? item.visits / current.pageViews : 0) }} /></span>
            </Button>
          </li>
        ))}
      </ul>
    ) : <EmptyState icon={kind === '地区' ? <Globe2 /> : kind === '设备' ? <Monitor /> : <ChartNoAxesCombined />} message={current?.pageViews ? '暂无分类数据' : '暂无访问数据'} hint={current?.pageViews ? '当前汇总未返回这一维度的分类记录。' : '产生访问后，这里会显示对应的分布。'} />
  }

  return (
    <AdminPage title="流量分析" description="查看匿名访问总量、每日变化与访问分布。">
      <Tabs value={String(days)} onValueChange={selectDays} className={styles.workspace}>
        <div className={styles.toolbar}>
          <div className={styles.rangeTools}>
            <div className={styles.tabScroll}>
              <TabsList aria-label="时间范围">
                {([7, 30, 90] as const).map((value) => <TabsTrigger key={value} value={String(value)}>近 {value} 日</TabsTrigger>)}
              </TabsList>
            </div>
            <label htmlFor={compareId} className={styles.compare}>
              <Checkbox id={compareId} checked={compare} onCheckedChange={(checked) => setCompare(checked === true)} />
              对比上一周期
            </label>
          </div>
          <div className={styles.actions}>
            <Button type="button" variant="outline" onClick={exportCsv} disabled={!current?.pageViews || loading}><Download aria-hidden="true" />导出 CSV</Button>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? styles.spinning : undefined} aria-hidden="true" />{loading ? '刷新中…' : '刷新'}
            </Button>
          </div>
        </div>
        <TabsContent value={String(days)} forceMount className={styles.content} aria-busy={loading}>
          <div className={styles.window} role="status" aria-live="polite">
            <span>{current ? `${periodLabel(current)} · 北京时间` : `近 ${days} 日 · 含今日 · 北京时间`}</span>
            <span>{loading ? (current ? '正在刷新，当前保留上次统计…' : '正在汇总访问数据…') : active ? `更新于 ${time(active.generatedAt)}` : '尚未取得本期统计'}</span>
          </div>
          {error && active && !loading && <InlineError message={`${error}；当前保留上次成功加载的数据。`} onRetry={() => void load()} />}
          {!current || !active ? (
            <Card role="region" aria-label="访问概览">
              <PanelHeading title="访问概览" />
              <CardContent>{loading ? <LoadingState label="正在汇总访问数据" rows={3} /> : <ErrorState message={error || '流量数据暂不可用'} onRetry={() => void load()} />}</CardContent>
            </Card>
          ) : (
            <>
              <Card role="region" aria-label="访问概览">
                <PanelHeading title="访问概览" description="同一时间范围内的浏览次数与去重访客。" />
                <CardContent>
                  <dl className={styles.metrics}>
                    <div><dt>浏览量 <span>PV</span></dt><dd><span className={styles.metricValue}>{number(current.pageViews)}</span><span className={styles.metricHint}>{compare ? `较上期 ${change(current.pageViews, active.previous.pageViews)}` : '所有访问事件，包含自动访问'}</span></dd></div>
                    <div><dt>访客数 <span>UV</span></dt><dd><span className={styles.metricValue}>{number(current.visitors)}</span><span className={styles.metricHint}>{compare ? `较上期 ${change(current.visitors, active.previous.visitors)}` : '按整个周期去重，非每日相加'}</span></dd></div>
                    <div><dt>日均浏览 <span>PV / 日</span></dt><dd><span className={styles.metricValue}>{(current.pageViews / days).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</span><span className={styles.metricHint}>按 {days} 个自然日平均，含尚未结束的今日</span></dd></div>
                  </dl>
                </CardContent>
              </Card>

              <Tabs value={metric} onValueChange={(value) => setMetric(value as Metric)} className={styles.trendTabs}>
                <Card>
                  <PanelHeading title="访问趋势" description="按日观察浏览量与去重访客的变化。" actions={
                    <div className={styles.tabScroll}><TabsList aria-label="趋势指标">
                      <TabsTrigger value="both">全部</TabsTrigger><TabsTrigger value="pageViews">浏览量 PV</TabsTrigger><TabsTrigger value="visitors">访客 UV</TabsTrigger>
                    </TabsList></div>
                  } />
                  <CardContent>
                    <TabsContent value={metric} forceMount>
                      {hasChartData ? (
                        <>
                          <div className={styles.legend}>
                            {metric !== 'visitors' && <span><i />浏览量 PV</span>}
                            {metric !== 'pageViews' && <span><i className={styles.uvLine} />访客 UV</span>}
                            {compare && <span><i className={styles.previousLine} />上期（虚线）</span>}
                          </div>
                          <div className={styles.chart} role="group" aria-label={`近 ${days} 日访问趋势${compare ? '，含上一周期对比' : ''}；完整数值见下方每日明细`}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart accessibilityLayer data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={52} />
                                <Tooltip content={({ active: visible, payload }) => {
                                  const row = payload?.[0]?.payload as (typeof chartData)[number] | undefined
                                  return visible && row ? <div className={styles.tooltip}>
                                    <strong>{row.date}</strong>
                                    {metric !== 'visitors' && <p>浏览量 PV：{number(row.pageViews)}</p>}
                                    {metric !== 'pageViews' && <p>访客 UV：{number(row.visitors)}</p>}
                                    {compare && <><strong>上期 {row.previousDate || '日期未回传'}</strong>
                                      {metric !== 'visitors' && <p>浏览量 PV：{row.previousPageViews === undefined ? '未回传' : number(row.previousPageViews)}</p>}
                                      {metric !== 'pageViews' && <p>访客 UV：{row.previousVisitors === undefined ? '未回传' : number(row.previousVisitors)}</p>}
                                    </>}
                                  </div> : null
                                }} />
                                {metric !== 'visitors' && <Line name="浏览量 PV" dataKey="pageViews" stroke="var(--accent)" strokeWidth={2.5} dot={chartData.length === 1} isAnimationActive={false} />}
                                {metric !== 'pageViews' && <Line name="访客 UV" dataKey="visitors" stroke="var(--text-secondary)" strokeWidth={2} dot={chartData.length === 1} isAnimationActive={false} />}
                                {compare && metric !== 'visitors' && <Line name="上期 PV" dataKey="previousPageViews" stroke="var(--accent)" strokeDasharray="5 5" strokeOpacity={0.6} dot={chartData.length === 1} isAnimationActive={false} />}
                                {compare && metric !== 'pageViews' && <Line name="上期 UV" dataKey="previousVisitors" stroke="var(--text-secondary)" strokeDasharray="5 5" strokeOpacity={0.6} dot={chartData.length === 1} isAnimationActive={false} />}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </>
                      ) : <EmptyState icon={<ChartNoAxesCombined />} message="这段时间还没有访问记录" hint="可以切换其他时间范围，或稍后刷新查看。" />}
                    </TabsContent>
                    <div className={styles.trendNote}>
                      <span>{peak?.pageViews ? `浏览量峰值 ${peak.date} · ${number(peak.pageViews)} PV` : '本期暂无浏览量峰值'}</span>
                      <span>{compare ? `上期 ${periodLabel(active.previous)} · 截至对应时刻` : '今日数据截至本次刷新时刻'}</span>
                    </div>
                  </CardContent>
                </Card>
              </Tabs>

              <details className={styles.details}>
                <summary><span>每日明细 <small>{days} 日 · UV 按日去重</small></span><ChevronDown aria-hidden="true" /></summary>
                <p className={styles.detailHint}>周期 UV 独立去重，不等于每日 UV 相加。{compare && '上期按相同顺序的日期对齐，最后一天截至对应时刻。'}</p>
                <AdminDataPanel ariaLabel="每日访问明细" columns={columns} responsive="scroll">
                  <Table className="admin-data-table admin-data-table--animated">
                    <TableCaption className="sr-only">每日浏览量与当日去重访客；统计时区为北京时间</TableCaption>
                    <TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key} scope="col">{column.label}</TableHead>)}</TableRow></TableHeader>
                    <TableBody key={days}>{chartData.map((day, index) => (
                      <TableRow key={day.date} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, chartData.length)}ms` }}>
                        <TableCell>{day.date}{compare && <small className={styles.previousDate}>上期 {day.previousDate || '日期未回传'}</small>}</TableCell>
                        <TableCell>{number(day.pageViews)}</TableCell><TableCell>{number(day.visitors)}</TableCell>
                        {compare && <><TableCell>{day.previousPageViews === undefined ? '未回传' : number(day.previousPageViews)}</TableCell><TableCell>{day.previousVisitors === undefined ? '未回传' : number(day.previousVisitors)}</TableCell></>}
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </AdminDataPanel>
              </details>

              <section aria-labelledby="traffic-distribution-heading" className={styles.distribution}>
                <div className={styles.sectionIntro}><h2 id="traffic-distribution-heading">访问分布</h2><p>按访问事件分类，所有占比均以本期全部 PV 为分母。点击分类查看统计口径。</p></div>
                <div className={styles.dimensions}>
                  <Card className={styles.dimensionCard}>
                    <PanelHeading className={styles.dimensionHeading} title="访问地区" description={current.pageViews > 0 && !active.region.knownVisits ? '地区未识别' : '包含未识别访问。'} status={<span className={styles.coverage}>{current.pageViews ? `识别率 ${percent(active.region.coverage)}` : '暂无地区样本'}</span>} />
                    <CardContent className={styles.dimensionBody}>
                      <div className={styles.dimensionScroll} role="region" aria-label="地区分布列表" tabIndex={0}>
                        {rows('地区', [...active.countries, { key: 'other', visits: active.region.otherVisits }, { key: 'ZZ', visits: active.region.unknownVisits }], COUNTRY_NAMES)}
                      </div>
                      {current.pageViews > 0 && !active.region.knownVisits && <p className={styles.regionNote}><Globe2 aria-hidden="true" /><span>浏览量已计入，访问事件暂未提供地区信息。</span></p>}
                    </CardContent>
                  </Card>
                  <Card className={styles.dimensionCard}><PanelHeading className={styles.dimensionHeading} title="设备构成" description="包含浏览器识别到的自动访问。" /><CardContent className={styles.dimensionBody}><div className={styles.dimensionScroll} role="region" aria-label="设备分布列表" tabIndex={0}>{rows('设备', active.devices, DEVICE_NAMES)}</div></CardContent></Card>
                  <Card className={styles.dimensionCard}><PanelHeading className={styles.dimensionHeading} title="访问来源" description="按访问事件归类，并非获客渠道。" /><CardContent className={styles.dimensionBody}><div className={styles.dimensionScroll} role="region" aria-label="来源分布列表" tabIndex={0}>{rows('来源', active.sources, SOURCE_NAMES)}</div></CardContent></Card>
                </div>
              </section>

              <details className={styles.privacy}>
                <summary><span>统计口径与隐私说明</span><ChevronDown aria-hidden="true" /></summary>
                <div>
                  <p>时间范围按北京时间划分，包含今日截至刷新时刻的访问。PV 为访问次数；UV 使用浏览器随机标识，经服务端哈希后按周期去重，同一访客跨设备可能重复统计。上一周期与本期时长一致，截止到对应时刻。</p>
                  <p>日均浏览量为本期 PV 除以所选自然日数，包含尚未结束的今日。地区识别率仅表示访问事件中的地区信息覆盖，未识别地区仍计入全部浏览量；没有访问时不计算识别率。</p>
                  <p>不记录 IP、完整 User-Agent 或完整来源地址。地区、设备与来源仅保存分类结果；来源按访问事件归类，并非新访客获客渠道。</p>
                </div>
              </details>
            </>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={!!dimension} onOpenChange={(open) => { if (!open) setDimension(null) }}>
        <ReadingDialog title={dimension?.title} description={dimension ? `${dimension.range} · 北京时间` : undefined} bodyLabel="分类统计详情">
          {dimension && <div className={styles.dimensionDetail}>
            <strong>{number(dimension.visits)} <small>PV</small></strong>
            <span>占全部浏览量 {percent(dimension.total ? dimension.visits / dimension.total : 0)}</span>
            <p>{dimension.definition}</p>
            <small>统计快照：{time(dimension.generatedAt)}（北京时间）</small>
          </div>}
        </ReadingDialog>
      </Dialog>
    </AdminPage>
  )
}
