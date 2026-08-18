import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Globe2, Megaphone, MonitorSmartphone, Route, ShieldAlert } from 'lucide-react'
import { adminApi, novelsApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { usePersistentState } from '@/hooks/usePersistentState'
import AdminPage from '@/components/admin/AdminPage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type Overview = Awaited<ReturnType<typeof adminApi.site.overview>>
type OperationTab = 'overview' | 'traffic' | 'content'
type Metric = readonly [label: string, value: number, unit: string]

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾', JP: '日本', KR: '韩国',
  SG: '新加坡', US: '美国', CA: '加拿大', GB: '英国', DE: '德国', AU: '澳大利亚',
}
const DEVICE_NAMES: Record<string, string> = { mobile: '移动端', desktop: '桌面端', tablet: '平板', bot: '自动访问', other: '其他' }
const SOURCE_NAMES: Record<string, string> = { direct: '直接访问', search: '搜索引擎', external: '外部链接', internal: '站内跳转' }

function dimensionLabel(key: string, names: Record<string, string>) {
  return names[key] || key || '其他'
}

function MetricStrip({ items }: { items: readonly Metric[] }) {
  return (
    <div className={`site-operations__metrics${items.length === 5 ? ' site-operations__metrics--five' : ''}`}>
      {items.map(([label, value, unit]) => (
        <div key={label} className="site-operations__metric">
          <span>{label}</span>
          <strong>{value.toLocaleString()} <small>{unit}</small></strong>
        </div>
      ))}
    </div>
  )
}

function ShareRows({ items, names }: { items: Array<{ key: string; visits: number }>; names: Record<string, string> }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.visits, 0))
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">暂无访问数据</p>
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.key}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-foreground">{dimensionLabel(item.key, names)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{item.visits.toLocaleString()} · {Math.round(item.visits / total * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.visits / total * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

export default function SiteOperationsTab() {
  const { toast } = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [tab, setTab] = usePersistentState<OperationTab>('site_operations_active_tab', 'overview', (value) => value === 'overview' || value === 'traffic' || value === 'content')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedListTitle, setSelectedListTitle] = useState('')
  const [selectedListParams, setSelectedListParams] = useState<Record<string, string | number>>({})
  const [selectedListPage, setSelectedListPage] = useState(1)
  const [selectedListTotal, setSelectedListTotal] = useState(0)
  const [categoryBooks, setCategoryBooks] = useState<Awaited<ReturnType<typeof novelsApi.list>>['novels']>([])
  const [categoryBooksLoading, setCategoryBooksLoading] = useState(false)
  const [trendRange, setTrendRange] = useState<30 | 90>(30)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const overview = await adminApi.site.overview()
      setData(overview)
      setAnnouncement(overview.announcement)
    } catch (err) {
      toast((err as Error).message || '站点运营数据加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  async function saveAnnouncement() {
    setSaving(true)
    try {
      const result = await adminApi.site.update(announcement)
      setAnnouncement(result.announcement)
      setData((current) => current ? { ...current, announcement: result.announcement } : current)
      toast(result.announcement ? '站点公告已发布' : '站点公告已清除', 'success')
    } catch (err) {
      toast((err as Error).message || '公告保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function openNovelList(params: Record<string, string | number>, title: string, page = 1) {
    setSelectedListTitle(title)
    setSelectedListParams(params)
    setSelectedListPage(page)
    setCategoryBooks([])
    setCategoryBooksLoading(true)
    try {
      const result = await novelsApi.list({ page, limit: 20, sort: 'title', order: 'asc', ...params })
      setCategoryBooks(result.novels || [])
      setSelectedListTotal(result.total || 0)
    } catch (err) {
      toast((err as Error).message || '分类作品加载失败', 'error')
      setSelectedListTitle('')
      setSelectedListTotal(0)
    } finally {
      setCategoryBooksLoading(false)
    }
  }

  function exportContentReport() {
    if (!data) return
    const rows = [['分类', '作品数'], ...data.contentHealth.categories.map((item) => [item.category, String(item.novels)])]
    rows.push([], ['状态', '作品数'], ...Object.entries(data.contentHealth.statuses).map(([status, count]) => [status, String(count)]))
    rows.push([], ['内容健康度', '数量'],
      ['未分类作品', String(data.contentHealth.quality.uncategorized)],
      ['缺少封面', String(data.contentHealth.quality.missingCover)],
      ['缺少简介', String(data.contentHealth.quality.missingDescription)],
      ['连载超 30 天未更', String(data.contentHealth.quality.staleOngoing)],
    )
    rows.push([], ['完整度最低作品', '完整度得分'])
    data.contentHealth.completeness.forEach((item) => rows.push([item.title, `${item.score}/6`]))
    rows.push([], ['更新日期', '更新作品数'])
    data.contentHealth.updateTrend.forEach((item) => rows.push([item.date, String(item.novels)]))
    rows.push([], ['采集任务（近 30 日）', '数量'],
      ['进行中', String(data.contentHealth.scrapeHealth.active)],
      ['失败', String(data.contentHealth.scrapeHealth.failed)],
      ['已完成', String(data.contentHealth.scrapeHealth.completed)],
    )
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `zhizhou-content-analysis-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const metrics = data?.metrics
  const traffic = data?.traffic
  const chartData = useMemo(() => traffic?.dailyTrend || [], [traffic])
  const countries = useMemo(() => (traffic?.countries || []).filter((country) => country.countryCode !== 'ZZ'), [traffic])
  const unclassifiedVisits = traffic?.countries.find((country) => country.countryCode === 'ZZ')?.visits || 0
  const mobileVisits = traffic?.devices.find((item) => item.key === 'mobile')?.visits || 0
  const maxCountryVisits = Math.max(1, ...countries.map((item) => item.visits))

  const overviewMetrics: Metric[] = [
    ['今日浏览', metrics?.todayPageViews || 0, 'PV'], ['今日访客', metrics?.todayVisitors || 0, 'UV'],
    ['近 7 日浏览', metrics?.weekPageViews || 0, 'PV'], ['近 7 日访客', metrics?.weekVisitors || 0, 'UV'], ['活跃读者', metrics?.activeReaders || 0, '人'],
  ]
  const trafficMetrics: Metric[] = [
    ['近 7 日浏览', metrics?.weekPageViews || 0, 'PV'], ['近 7 日访客', metrics?.weekVisitors || 0, 'UV'],
    ['已识别地区', countries.length, '个'], ['移动端访问', mobileVisits, 'PV'],
  ]
  const contentMetrics: Metric[] = [
    ['收录作品', data?.contentHealth.novels || 0, '本'], ['分类数量', data?.contentHealth.categories.length || 0, '个'],
    ['连载中', data?.contentHealth.statuses.ongoing || 0, '本'], ['已完结', data?.contentHealth.statuses.completed || 0, '本'],
    ['近 30 日更新', data?.contentHealth.recentUpdates.last30Days || 0, '本'],
  ]

  return (
    <AdminPage
      className="site-operations"
      title="站点运营"
      description="从匿名聚合数据观察流量、读者与内容健康度。"
      actions={<div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading || saving}>{loading ? '刷新中…' : '刷新'}</Button>{tab === 'content' && <Button variant="outline" size="sm" onClick={exportContentReport} disabled={!data}>导出 CSV</Button>}</div>}
    >
      <div className="grid gap-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as OperationTab)}>
          <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden sm:w-fit">
            <TabsTrigger value="overview">运营概览</TabsTrigger>
            <TabsTrigger value="traffic">流量分析</TabsTrigger>
            <TabsTrigger value="content">内容分析</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="site-operations__panel">
          {tab === 'overview' && <>
            <MetricStrip items={overviewMetrics} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="size-4 text-primary" aria-hidden="true" />站点公告</CardTitle>
                  <p className="text-sm text-muted-foreground">公告会显示在读者端页面顶部，留空即可撤下。</p>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Textarea value={announcement} maxLength={240} rows={4} placeholder="例如：今晚 23:00 将进行例行维护，阅读服务可能短暂波动。" onChange={(event) => setAnnouncement(event.target.value)} />
                  <div className="flex items-center justify-between gap-3"><span className="text-xs tabular-nums text-muted-foreground">{announcement.length}/240</span><Button size="sm" onClick={() => void saveAnnouncement()} disabled={loading || saving}>{saving ? '保存中…' : '保存公告'}</Button></div>
                </CardContent>
              </Card>
              <OperationPulse
                activeReaders={metrics?.activeReaders || 0}
                newComments={data?.contentHealth.newComments || 0}
                openReports={data?.contentHealth.openReports || 0}
                recognizedCountries={countries.length}
              />
            </div>
          </>}

          {tab === 'traffic' && <>
            <MetricStrip items={trafficMetrics} />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Route className="size-4 text-primary" aria-hidden="true" />近 7 日访问趋势</CardTitle>
                <p className="text-sm text-muted-foreground">PV 与去重后的访客数，按站点服务器日期聚合。</p>
              </CardHeader>
              <CardContent>
                {chartData.length ? <TrafficChart data={chartData} /> : <p className="py-20 text-center text-sm text-muted-foreground">{loading ? '正在汇总访问数据…' : '暂无访问数据'}</p>}
              </CardContent>
            </Card>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="size-4 text-primary" aria-hidden="true" />访问地区</CardTitle>
                  <p className="text-sm text-muted-foreground">只显示可识别的地区；本地访问或未接入代理地理信息不会被误标为某个地区。</p>
                </CardHeader>
                <CardContent>
                  {countries.length ? <div className="grid gap-3">{countries.map((country) => <div key={country.countryCode} className="site-operations__country"><span>{COUNTRY_NAMES[country.countryCode] || country.countryCode}</span><strong>{country.visits.toLocaleString()} <small>PV</small></strong><div><i style={{ width: `${country.visits / maxCountryVisits * 100}%` }} /></div></div>)}</div> : <div className="site-operations__geo-empty"><Globe2 className="size-5" aria-hidden="true" /><div><strong>暂未取得地区信息</strong><p>当前访问没有携带 Cloudflare 或 Vercel 的地区代码，常见于本地开发或未使用这些代理的部署。</p></div></div>}
                  {unclassifiedVisits > 0 && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">另有 {unclassifiedVisits.toLocaleString()} PV 未携带地区代码，未计入上方地区排行。</p>}
                </CardContent>
              </Card>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="size-4 text-primary" aria-hidden="true" />设备构成</CardTitle></CardHeader><CardContent><ShareRows items={traffic?.devices || []} names={DEVICE_NAMES} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Route className="size-4 text-primary" aria-hidden="true" />访问来源</CardTitle></CardHeader><CardContent><ShareRows items={traffic?.sources || []} names={SOURCE_NAMES} /></CardContent></Card>
              </div>
            </div>
          </>}

          {tab === 'content' && <>
            <MetricStrip items={contentMetrics} />
            <div className="grid gap-4 lg:grid-cols-2">
              <CategoryDistribution categories={data?.contentHealth.categories || []} loading={loading} onSelect={(category) => void openNovelList({ category }, `分类：${category}`)} />
              <div className="grid content-start gap-4">
                <ContentQuality health={data?.contentHealth} onSelect={(quality, title) => void openNovelList({ quality }, title)} />
                <UpdateActivity health={data?.contentHealth} onSelect={() => void openNovelList({ sort: 'updated_at' }, '最近更新作品')} />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <UpdateTrend trend={data?.contentHealth.updateTrend || []} range={trendRange} onRangeChange={setTrendRange} />
              <CompletenessAndScrape health={data?.contentHealth} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <PopularNovels novels={data?.popularNovels || []} loading={loading} />
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-primary" aria-hidden="true" />内容风险提示</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"><div><div className="text-sm font-medium text-foreground">待处理举报</div><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">及时处理举报，避免读者端持续展示风险内容。</p></div><Badge variant={(data?.contentHealth.openReports || 0) > 0 ? 'destructive' : 'secondary'}>{data?.contentHealth.openReports || 0} 项</Badge></div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">阅读转化漏斗需要新增阅读会话事件，不能依赖访问日志推断。</div>
                </CardContent>
              </Card>
            </div>
          </>}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">访问统计使用浏览器本地随机标识，经服务端哈希后保存；不记录 IP、完整 User-Agent 或完整来源地址。地区、设备与来源仅保存不可识别的分类结果。</p>
      </div>
      <Dialog open={!!selectedListTitle} onOpenChange={(open) => { if (!open) setSelectedListTitle('') }}>
        <DialogContent className="max-h-[min(78vh,680px)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
          <DialogTitle>{selectedListTitle} <span className="text-sm font-normal text-muted-foreground">· {selectedListTotal.toLocaleString()} 本</span></DialogTitle>
          </DialogHeader>
          <div className="max-h-[56vh] overflow-y-auto rounded-lg border border-border">
            {categoryBooksLoading ? <p className="p-8 text-center text-sm text-muted-foreground">正在加载作品…</p> : categoryBooks.length ? <div className="divide-y divide-border">{categoryBooks.map((novel) => <div key={novel.id} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
              <Link to={`/novel/${encodeURIComponent(novel.id)}`} className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{novel.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{novel.author || '作者未知'} · {novel.status === 'completed' ? '已完结' : '连载中'} · {novel.chapterCount || 0} 章</span></Link>
              <button type="button" className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { sessionStorage.setItem('adminEditNovel', JSON.stringify({ id: novel.id })); window.location.href = '/admin' }}>管理</button>
            </div>)}</div> : <p className="p-8 text-center text-sm text-muted-foreground">该列表暂无作品</p>}
          </div>
          {selectedListTotal > 20 && <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>第 {selectedListPage} / {Math.ceil(selectedListTotal / 20)} 页</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={selectedListPage <= 1 || categoryBooksLoading} onClick={() => void openNovelList(selectedListParams, selectedListTitle, selectedListPage - 1)}>上一页</Button><Button variant="outline" size="sm" disabled={selectedListPage >= Math.ceil(selectedListTotal / 20) || categoryBooksLoading} onClick={() => void openNovelList(selectedListParams, selectedListTitle, selectedListPage + 1)}>下一页</Button></div></div>}
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}

function PopularNovels({ novels, loading }: { novels: Overview['popularNovels']; loading: boolean }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" aria-hidden="true" />近 7 日热门作品</CardTitle></CardHeader><CardContent>{novels.length ? novels.map((novel, index) => <div key={novel.novelId} className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"><span className="min-w-0 truncate text-sm text-foreground">{index + 1}. {novel.title}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{novel.views.toLocaleString()} PV</span></div>) : <p className="py-8 text-center text-sm text-muted-foreground">{loading ? '正在汇总访问数据…' : '暂无访问数据'}</p>}</CardContent></Card>
}

function CategoryDistribution({ categories, loading, onSelect }: { categories: Overview['contentHealth']['categories']; loading: boolean; onSelect: (category: string) => void }) {
  const max = Math.max(1, ...categories.map((item) => item.novels))
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" aria-hidden="true" />分类分布</CardTitle>
      <p className="text-sm text-muted-foreground">按作品标注的分类统计，单部作品可计入多个分类；点击分类查看作品。</p>
    </CardHeader>
    <CardContent>
      {categories.length ? <div className="space-y-3">{categories.slice(0, 10).map((item) => <button key={item.category} type="button" className="block w-full text-left" onClick={() => onSelect(item.category)} title={`查看${item.category}分类作品`}>
        <div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">{item.category}</span><span className="shrink-0 tabular-nums text-muted-foreground">{item.novels.toLocaleString()} 本</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.novels / max * 100}%` }} /></div>
      </button>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">{loading ? '正在汇总分类…' : '暂无分类数据'}</p>}
    </CardContent>
  </Card>
}

function UpdateTrend({ trend, range, onRangeChange }: { trend: Overview['contentHealth']['updateTrend']; range: 30 | 90; onRangeChange: (range: 30 | 90) => void }) {
  const visible = trend.slice(-range)
  const hasTrendData = visible.some((item) => Number(item.novels) > 0)
  const max = Math.max(1, ...visible.map((item) => item.novels))
  const tickIndexes = new Set([0, Math.floor((visible.length - 1) / 2), Math.max(0, visible.length - 1)])
  const formatTick = (date: string) => {
    const match = String(date).match(/^\d{4}-(\d{2})-(\d{2})$/)
    return match ? `${match[1]}/${match[2]}` : ''
  }
  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Route className="size-4 text-primary" aria-hidden="true" />更新趋势</CardTitle><p className="mt-1 text-sm text-muted-foreground">按作品最近更新时间统计。</p></div><div className="flex gap-1"><Button variant={range === 30 ? 'secondary' : 'ghost'} size="sm" onClick={() => onRangeChange(30)}>30 日</Button><Button variant={range === 90 ? 'secondary' : 'ghost'} size="sm" onClick={() => onRangeChange(90)}>90 日</Button></div></CardHeader>
    <CardContent>{hasTrendData ? <div className="space-y-2"><div className="flex h-40 items-end gap-1 overflow-hidden">{visible.map((item) => <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${item.date}：${item.novels} 本`}><div className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(4, item.novels / max * 100)}%` }} /><span className="sr-only">{item.date} {item.novels} 本</span></div>)}</div><div className="flex gap-1 text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">{visible.map((item, index) => <span key={item.date} className="min-w-0 flex-1 truncate text-center">{tickIndexes.has(index) ? formatTick(item.date) : ''}</span>)}</div></div> : <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">暂无更新记录</div>}</CardContent>
  </Card>
}

function CompletenessAndScrape({ health }: { health?: Overview['contentHealth'] }) {
  const scrape = health?.scrapeHealth
  return <div className="grid content-start gap-4">
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" aria-hidden="true" />作品资料完整度</CardTitle><p className="text-sm text-muted-foreground">按标题、作者、分类、简介、封面和章节六项计算。</p></CardHeader>
      <CardContent><div className="divide-y divide-border rounded-lg border border-border">{health?.completeness.length ? health.completeness.slice(0, 5).map((item) => <Link key={item.id} to={`/novel/${encodeURIComponent(item.id)}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/40"><span className="min-w-0 truncate text-sm text-foreground">{item.title}</span><Badge variant={item.score <= 3 ? 'destructive' : 'secondary'}>{item.score}/6</Badge></Link>) : <p className="p-4 text-center text-sm text-muted-foreground">暂无数据</p>}</div></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-primary" aria-hidden="true" />采集任务状态</CardTitle><p className="text-sm text-muted-foreground">近 {scrape?.windowDays || 30} 日任务汇总。</p></CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 text-center"><div className="rounded border border-border bg-muted/30 p-2"><strong className="block text-lg text-foreground">{scrape?.active || 0}</strong><span className="text-xs text-muted-foreground">进行中</span></div><div className="rounded border border-border bg-muted/30 p-2"><strong className="block text-lg text-foreground">{scrape?.failed || 0}</strong><span className="text-xs text-muted-foreground">失败</span></div><div className="rounded border border-border bg-muted/30 p-2"><strong className="block text-lg text-foreground">{scrape?.completed || 0}</strong><span className="text-xs text-muted-foreground">已完成</span></div></CardContent>
    </Card>
  </div>
}

function ContentQuality({ health, onSelect }: { health?: Overview['contentHealth']; onSelect: (quality: string, title: string) => void }) {
  const quality = health?.quality
  const items = [
    ['未分类作品', quality?.uncategorized || 0, '补充分类后更容易筛选和发现。'],
    ['缺少封面', quality?.missingCover || 0, '建议补齐封面，改善书架和列表识别度。'],
    ['缺少简介', quality?.missingDescription || 0, '简介为空会降低作品详情页的信息完整度。'],
    ['连载超 30 天未更', quality?.staleOngoing || 0, '可检查来源是否失效，或调整作品状态。'],
  ] as const
  const qualityKeys = ['uncategorized', 'missing_cover', 'missing_description', 'stale_ongoing'] as const
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-primary" aria-hidden="true" />内容健康度</CardTitle>
      <p className="text-sm text-muted-foreground">帮助定位需要补录或维护的作品。</p>
    </CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-2">{items.map(([label, value, hint], index) => <button key={label} type="button" className="rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/60" onClick={() => onSelect(qualityKeys[index]!, label)} title={`查看${label}作品`}>
      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-foreground">{label}</span><Badge variant={value > 0 ? 'secondary' : 'outline'}>{value.toLocaleString()}</Badge></div>
      <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </button>)}</CardContent>
  </Card>
}

function UpdateActivity({ health, onSelect }: { health?: Overview['contentHealth']; onSelect: () => void }) {
  const updates = health?.recentUpdates
  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-3">
      <div><CardTitle className="flex items-center gap-2 text-base"><Route className="size-4 text-primary" aria-hidden="true" />更新活跃度</CardTitle><p className="mt-1 text-sm text-muted-foreground">按作品最近更新时间统计，不代表章节阅读量。</p></div>
      <Button variant="ghost" size="sm" onClick={onSelect}>查看全部更新作品</Button>
    </CardHeader>
    <CardContent className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3"><span className="text-xs text-muted-foreground">近 7 日更新</span><strong className="mt-1 block text-xl tabular-nums text-foreground">{(updates?.last7Days || 0).toLocaleString()} <small className="text-xs font-normal text-muted-foreground">本</small></strong></div>
        <div className="rounded-lg border border-border bg-muted/30 p-3"><span className="text-xs text-muted-foreground">近 30 日更新</span><strong className="mt-1 block text-xl tabular-nums text-foreground">{(updates?.last30Days || 0).toLocaleString()} <small className="text-xs font-normal text-muted-foreground">本</small></strong></div>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">{updates?.novels.length ? updates.novels.slice(0, 5).map((novel) => <Link key={novel.id} to={`/novel/${encodeURIComponent(novel.id)}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40"><span className="min-w-0 truncate text-sm text-foreground">{novel.title}</span><span className="shrink-0 text-xs text-muted-foreground">{novel.status === 'completed' ? '已完结' : '连载中'}</span></Link>) : <p className="p-5 text-center text-sm text-muted-foreground">暂无更新记录</p>}</div>
    </CardContent>
  </Card>
}

function OperationPulse({ activeReaders, newComments, openReports, recognizedCountries }: { activeReaders: number; newComments: number; openReports: number; recognizedCountries: number }) {
  const items = [
    ['活跃读者', `${activeReaders.toLocaleString()} 人`],
    ['新增评论', `${newComments.toLocaleString()} 条`],
    ['待处理举报', `${openReports.toLocaleString()} 项`],
    ['地区覆盖', recognizedCountries ? `${recognizedCountries} 个地区` : '尚未识别'],
  ]
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Route className="size-4 text-primary" aria-hidden="true" />本周运营关注</CardTitle><p className="text-sm text-muted-foreground">优先处理需要人工跟进的站点信号。</p></CardHeader><CardContent className="pt-0"><dl className="grid grid-cols-2 gap-x-6 gap-y-4">{items.map(([label, value]) => <div key={label} className="border-t border-border pt-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</dd></div>)}</dl></CardContent></Card>
}

function TrafficChart({ data }: { data: Overview['traffic']['dailyTrend'] }) {
  return <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><defs><linearGradient id="siteVisits" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={24} /><YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} /><Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }} formatter={(value, name) => [Number(value).toLocaleString(), name === 'pageViews' ? '浏览量' : '访客']} /><Area type="monotone" dataKey="pageViews" stroke="var(--accent)" strokeWidth={2} fill="url(#siteVisits)" /><Area type="monotone" dataKey="visitors" stroke="var(--color-success)" strokeWidth={2} fill="none" /></AreaChart></ResponsiveContainer></div>
}
