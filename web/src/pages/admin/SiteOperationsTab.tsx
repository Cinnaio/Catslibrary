import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Megaphone } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type Overview = Awaited<ReturnType<typeof adminApi.site.overview>>

export default function SiteOperationsTab() {
  const { toast } = useToast()
  const [data, setData] = useState<Overview | null>(null)
  const [announcement, setAnnouncement] = useState('')
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

  useEffect(() => {
    void load()
  }, [load])

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
  const cards = [
    ['今日浏览', metrics?.todayPageViews || 0, 'PV'],
    ['今日访客', metrics?.todayVisitors || 0, 'UV'],
    ['近 7 日浏览', metrics?.weekPageViews || 0, 'PV'],
    ['近 7 日访客', metrics?.weekVisitors || 0, 'UV'],
    ['近 7 日活跃读者', metrics?.activeReaders || 0, '人'],
  ]

  return (
    <AdminPage title="站点运营" description="查看匿名访问趋势、活跃阅读情况，并管理前台公告。" actions={<Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading || saving}>刷新</Button>}>
      <div className="grid gap-4">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-5">
            {cards.map(([label, value, unit]) => (
              <div key={label} className="bg-card px-4 py-3.5">
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{Number(value).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{unit}</span></div>
              </div>
            ))}
          </div>
        </div>

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
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" aria-hidden="true" />近 7 日热门作品</CardTitle></CardHeader>
            <CardContent>
              {data?.popularNovels.length ? data.popularNovels.map((novel, index) => <div key={novel.novelId} className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0"><span className="min-w-0 truncate text-sm text-foreground">{index + 1}. {novel.title}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{novel.views} 次</span></div>) : <p className="py-8 text-center text-sm text-muted-foreground">{loading ? '正在汇总访问数据…' : '暂无访问数据'}</p>}
            </CardContent>
          </Card>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">访问统计使用浏览器本地随机标识，经服务端哈希后保存；不记录 IP、账号信息或完整来源地址。</p>
      </div>
    </AdminPage>
  )
}
