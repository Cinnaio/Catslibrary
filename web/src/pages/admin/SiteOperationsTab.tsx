import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Globe2, Megaphone, MonitorSmartphone, Route, ShieldAlert } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="site-operations__metrics">
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
  const [tab, setTab] = useState<OperationTab>('overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
    ['收录作品', data?.contentHealth.novels || 0, '本'], ['收录章节', data?.contentHealth.chapters || 0, '章'],
    ['近 7 日评论', data?.contentHealth.newComments || 0, '条'], ['待处理举报', data?.contentHealth.openReports || 0, '项'],
  ]

  return (
    <AdminPage
      className="site-operations"
      title="站点运营"
      description="从匿名聚合数据观察流量、读者与内容健康度。"
      actions={<Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading || saving}>{loading ? '刷新中…' : '刷新'}</Button>}
    >
      <div className="grid gap-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as OperationTab)}>
          <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
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
              <PopularNovels novels={data?.popularNovels || []} loading={loading} />
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
    </AdminPage>
  )
}

function PopularNovels({ novels, loading }: { novels: Overview['popularNovels']; loading: boolean }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" aria-hidden="true" />近 7 日热门作品</CardTitle></CardHeader><CardContent>{novels.length ? novels.map((novel, index) => <div key={novel.novelId} className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"><span className="min-w-0 truncate text-sm text-foreground">{index + 1}. {novel.title}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{novel.views.toLocaleString()} PV</span></div>) : <p className="py-8 text-center text-sm text-muted-foreground">{loading ? '正在汇总访问数据…' : '暂无访问数据'}</p>}</CardContent></Card>
}

function TrafficChart({ data }: { data: Overview['traffic']['dailyTrend'] }) {
  return <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><defs><linearGradient id="siteVisits" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={24} /><YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} /><Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }} formatter={(value, name) => [Number(value).toLocaleString(), name === 'pageViews' ? '浏览量' : '访客']} /><Area type="monotone" dataKey="pageViews" stroke="var(--accent)" strokeWidth={2} fill="url(#siteVisits)" /><Area type="monotone" dataKey="visitors" stroke="var(--color-success)" strokeWidth={2} fill="none" /></AreaChart></ResponsiveContainer></div>
}
