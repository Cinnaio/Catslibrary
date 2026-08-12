/**
 * AI 服务 tab —— 配置、审计、参数调优的完整控制面板
 */
import { type ReactNode, Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { aiApi, novelsApi, type AiSettings, type AiUsageSummary } from '../../lib/api'
import { useToast, useConfirm } from '../../components/feedback'
import Pagination from '../../components/admin/Pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AdminPage from '@/components/admin/AdminPage'
import CustomSelect from '@/components/admin/CustomSelect'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Provider {
  configured: boolean
  host: string
  model: string
  hasKey: boolean
}

export default function AiTab() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState('config')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.settings()
      setSettings(res.settings)
      setProvider(res.provider)
    } catch (err) {
      toast((err as Error).message || '加载 AI 设置失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AdminPage title="AI 服务" description="管理 AI 功能配置、查看用量统计与调用审计" className="ai-admin-page">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="ai-service-tabs min-w-0">
        <TabsList className="ai-service-tabs__list w-full max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="config">配置</TabsTrigger>
          <TabsTrigger value="content">已生成内容</TabsTrigger>
          <TabsTrigger value="usage">用量统计</TabsTrigger>
          <TabsTrigger value="audit">调用审计</TabsTrigger>
          <TabsTrigger value="params">参数调优</TabsTrigger>
          <TabsTrigger value="writing">AI 创作</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="min-w-0">
          <AiConfigPanel settings={settings} provider={provider} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="content" className="min-w-0">
          <AiGenerationsPanel scope="all" status="all" />
        </TabsContent>

        <TabsContent value="usage" className="min-w-0">
          <AiUsagePanel />
        </TabsContent>

        <TabsContent value="audit" className="min-w-0">
          <AiAuditPanel />
        </TabsContent>

        <TabsContent value="params" className="min-w-0">
          <AiParamsPanel settings={settings} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="writing" className="min-w-0">
          <AiWritingPanel />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}

export function AiWritingPanel() {
  const { toast } = useToast()
  const [mode, setMode] = useState<'new' | 'continue'>('new')
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([])
  const [novelId, setNovelId] = useState('')
  const [title, setTitle] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [outline, setOutline] = useState('')
  const [targetWords, setTargetWords] = useState(2000)
  const [chapterCount, setChapterCount] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void novelsApi.list({ limit: 100, page: 1 }).then((data) => setNovels(data.novels.map((novel) => ({ id: novel.id, title: novel.title })))).catch((err) => toast((err as Error).message, 'error'))
  }, [toast])

  async function generateOutline() {
    if (!title.trim()) return toast('请填写作品标题', 'error')
    setBusy(true)
    try {
      await aiApi.writing.outline({ novelId, title, instruction, targetWords, chapterCount })
      toast('大纲已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function generateChapter() {
    if (!novelId || !chapterTitle.trim()) return toast('请选择小说并填写章节标题', 'error')
    setBusy(true)
    try {
      await aiApi.writing.chapter({ novelId, title, outline, instruction, targetWords, chapterCount })
      toast('章节已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function continueNovel() {
    if (!novelId) return toast('请选择小说', 'error')
    setBusy(true)
    try {
      await aiApi.writing.continue({ novelId, title: chapterTitle, instruction, targetWords, chapterCount })
      toast('续写已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  return <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle className="text-base">AI 创作工作台</CardTitle><p className="text-sm text-muted-foreground">生成结果先保存为草稿，编辑确认后再发布为正式章节。</p></CardHeader>
      <CardContent className="grid gap-4">
        <Tabs value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
          <TabsList><TabsTrigger value="new">新写</TabsTrigger><TabsTrigger value="continue">续写</TabsTrigger></TabsList>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>目标小说</Label>
            <CustomSelect
              options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
              value={novelId}
              onChange={setNovelId}
              placeholder="选择小说"
              searchable
              searchPlaceholder="搜索小说名称…"
              dropdownSide="bottom"
            />
          </div>
          <div className="grid gap-1.5"><Label>{mode === 'new' ? '作品标题' : '章节标题（可选）'}</Label><Input value={mode === 'new' ? title : chapterTitle} onChange={(event) => mode === 'new' ? setTitle(event.target.value) : setChapterTitle(event.target.value)} placeholder={mode === 'new' ? '例如：雾城来信' : '例如：第十二章 暴雨前夜'} /></div>
        </div>
        {mode === 'new' && <div className="grid gap-1.5"><Label>章节标题</Label><Input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="例如：第一章 雾中来客" /></div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5"><Label>目标字数</Label><Input type="number" min={300} max={30000} step={100} value={targetWords} onChange={(event) => setTargetWords(Number(event.target.value) || 300)} /></div>
          {mode === 'continue' && (
            <div className="grid gap-1.5">
              <Label>续写章节数</Label>
              <Input type="number" min={1} max={5} value={chapterCount} onChange={(event) => setChapterCount(Math.max(1, Math.min(5, Number(event.target.value) || 1)))} />
            </div>
          )}
        </div>
        <div className="grid gap-1.5"><Label>创作要求</Label><textarea className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="人物、风格、冲突、节奏或本次剧情目标" /></div>
        {mode === 'new' && <div className="grid gap-1.5"><Label>大纲（生成章节时使用）</Label><textarea className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={outline} onChange={(event) => setOutline(event.target.value)} placeholder="先生成大纲，或直接粘贴已有大纲" /></div>}
        <div className="flex flex-wrap gap-2">
          {mode === 'new' ? <><Button variant="secondary" disabled={busy} onClick={() => void generateOutline()}>生成大纲</Button><Button disabled={busy} onClick={() => void generateChapter()}>生成章节</Button></> : <Button disabled={busy} onClick={() => void continueNovel()}>生成续写</Button>}
        </div>
      </CardContent>
    </Card>
  </div>
}

// 配置面板：供应商信息、开关、配额
function AiConfigPanel(props: {
  settings: AiSettings | null
  provider: Provider | null
  loading: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [usage, setUsage] = useState<{ today: AiUsageSummary; last30d: AiUsageSummary } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  useEffect(() => {
    async function loadUsage() {
      try {
        const use = await aiApi.usage()
        setUsage(use)
      } catch (err) {
        toast((err as Error).message || '读取用量失败', 'error')
      }
    }
    void loadUsage()
  }, [toast])

  async function save(patch: Partial<AiSettings>) {
    if (!props.settings) return
    setSaving(true)
    try {
      await aiApi.saveSettings(patch)
      toast('已保存 AI 设置', 'success')
      props.onReload()
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    setTesting(true)
    setTestResult('')
    try {
      const res = await aiApi.test()
      setTestResult(res.ok ? `连通正常 · ${res.model || ''} · ${res.elapsedMs}ms` : `失败：${res.error || '未知错误'}`)
      if (res.ok) toast('AI 服务连通正常', 'success')
      else toast(res.error || 'AI 服务不可用', 'error')
    } catch (err) {
      setTestResult(`失败：${(err as Error).message}`)
      toast((err as Error).message || '测试失败', 'error')
    } finally {
      setTesting(false)
      props.onReload()
    }
  }

  const settings = props.settings
  const provider = props.provider

  return (
    <div className="space-y-4">
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">供应商配置</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {provider?.configured ? (
                <>
                  {provider.host} · {provider.model}
                </>
              ) : (
                '未配置 AI_TEXT_BASE_URL / AI_TEXT_API_KEY，读者端不会出现 AI 入口'
              )}
            </p>
          </div>
          <Badge className={provider?.configured ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
            {provider?.configured ? '已配置' : '未配置'}
          </Badge>
        </CardHeader>

        <CardContent className="grid gap-4">
          <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">阅读器前情提要</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                读者进入章节时可回顾上一章，结果按章缓存，全站共用一份
              </span>
            </span>
            <Switch
              checked={!!settings?.recapEnabled}
              disabled={!settings || saving}
              onCheckedChange={(v) => void save({ recapEnabled: v })}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-daily-quota">每人每日生成上限</Label>
              <Input
                id="ai-daily-quota"
                type="number"
                min={0}
                max={1000}
                value={settings?.dailyQuota ?? ''}
                disabled={!settings || props.loading}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  if (settings) void save({ dailyQuota: value })
                }}
              />
              <p className="text-xs text-muted-foreground">命中缓存不计数；管理员不受限；0 表示禁止读者触发</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-max-chars">送入模型的正文字数</Label>
              <Input
                id="ai-max-chars"
                type="number"
                min={500}
                max={20000}
                value={settings?.maxChapterChars ?? ''}
                disabled={!settings || props.loading}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  if (settings) void save({ maxChapterChars: value })
                }}
              />
              <p className="text-xs text-muted-foreground">超出部分截断，直接决定单次调用成本</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={testing || !provider?.configured} onClick={() => void runTest()}>
              {testing ? '测试中…' : '连通性测试'}
            </Button>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {testResult}
            </span>
          </div>

          {usage && (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-5">
              <UsageCell label="今日调用" value={usage.today.calls} />
              <UsageCell label="今日 token" value={usage.today.promptTokens + usage.today.completionTokens} />
              <UsageCell label="今日成本" value={formatCost(usage.today.costMillicents)} />
              <UsageCell label="30 天调用" value={usage.last30d.calls} />
              <UsageCell label="30 天 token" value={usage.last30d.promptTokens + usage.last30d.completionTokens} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function UsageCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-tight tabular-nums tracking-tight text-foreground">
        {typeof value === 'string' ? value : value.toLocaleString()}
      </div>
    </div>
  )
}

function formatCost(millicents: number): string {
  return (Number(millicents) / 100_000).toFixed(4)
}

function AiUsagePanel() {
  const { toast } = useToast()
  const [trend, setTrend] = useState<
    Array<{ date: string; calls: number; promptTokens: number; completionTokens: number; costMillicents: number }>
  >([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadTrend() {
      setLoading(true)
      try {
        const res = await aiApi.audit.trend(days)
        setTrend(res.trend)
      } catch (err) {
        toast((err as Error).message || '加载趋势失败', 'error')
      } finally {
        setLoading(false)
      }
    }
    void loadTrend()
  }, [days, toast])

  const totalCalls = trend.reduce((sum, d) => sum + d.calls, 0)
  const totalCost = trend.reduce((sum, d) => sum + d.costMillicents, 0)
  const totalTokens = trend.reduce((sum, d) => sum + d.promptTokens + d.completionTokens, 0)
  const avgCost = totalCalls > 0 ? totalCost / totalCalls : 0

  // 图表数据：补齐缺失日期，让曲线连续
  const chartData = buildChartSeries(trend, days)

  return (
    <div className="space-y-4">
      {/* 总览统计卡片 */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
        <UsageCell label="总调用次数" value={totalCalls} />
        <UsageCell label="总成本" value={formatCost(totalCost)} />
        <UsageCell label="总 Token" value={totalTokens} />
        <UsageCell label="平均单次成本" value={formatCost(avgCost)} />
      </div>

      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <CardTitle className="text-base">成本与调用趋势</CardTitle>
            <p className="text-sm text-muted-foreground">每日 AI 调用次数与成本消耗</p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
                {d} 天
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {loading ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">暂无数据</div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="calls"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <YAxis
                    yAxisId="cost"
                    orientation="right"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tickFormatter={(v: number) => formatCost(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                    }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                    formatter={(value, name) => {
                      if (name === '成本') return [formatCost(Number(value)), name as string]
                      return [Number(value).toLocaleString(), name as string]
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                    iconType="circle"
                  />
                  <Bar
                    yAxisId="calls"
                    dataKey="calls"
                    name="调用次数"
                    fill="var(--color-success)"
                    radius={[3, 3, 0, 0]}
                    opacity={0.7}
                  />
                  <Area
                    yAxisId="cost"
                    type="monotone"
                    dataKey="costMillicents"
                    name="成本"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#costGradient)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Token 消耗趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token 消耗趋势</CardTitle>
          <p className="text-sm text-muted-foreground">每日输入/输出 Token 用量</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">暂无数据</div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="promptGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="completionGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                    }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                    formatter={(value, name) => [Number(value).toLocaleString(), name as string]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} iconType="circle" />
                  <Area
                    type="monotone"
                    dataKey="promptTokens"
                    name="输入 Token"
                    stroke="var(--color-success)"
                    strokeWidth={2}
                    fill="url(#promptGradient)"
                    stackId="tokens"
                  />
                  <Area
                    type="monotone"
                    dataKey="completionTokens"
                    name="输出 Token"
                    stroke="var(--color-info)"
                    strokeWidth={2}
                    fill="url(#completionGradient)"
                    stackId="tokens"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** 补齐缺失日期，让趋势曲线连续；按 days 范围生成完整日期序列。 */
function buildChartSeries(
  trend: Array<{ date: string; calls: number; promptTokens: number; completionTokens: number; costMillicents: number }>,
  days: number,
): Array<{ date: string; calls: number; promptTokens: number; completionTokens: number; costMillicents: number }> {
  const map = new Map(trend.map((d) => [d.date, d]))
  const result: Array<{ date: string; calls: number; promptTokens: number; completionTokens: number; costMillicents: number }> = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const existing = map.get(dateStr)
    result.push({
      date: dateStr,
      calls: existing?.calls || 0,
      promptTokens: existing?.promptTokens || 0,
      completionTokens: existing?.completionTokens || 0,
      costMillicents: existing?.costMillicents || 0,
    })
  }
  return result
}

const aiCallTypeLabels: Record<string, string> = {
  summary: '前情提要',
  catchup: '回顾总结',
  continue: '续写',
  write_outline: '创作大纲',
  write_chapter: '创作章节',
  writing_title: '标题生成',
  test: '连通性测试',
}

function aiCallTypeLabel(type: string): string {
  return aiCallTypeLabels[type] || '其他'
}

function AiAuditPanel() {
  const { toast } = useToast()
  const [calls, setCalls] = useState<
    Array<{
      id: string
      type: string
      model: string
      username: string
      displayName: string
      novelTitle: string
      chapterTitle: string
      novelId: string
      chapterId: string
      promptTokens: number
      completionTokens: number
      costMillicents: number
      createdAt: number
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [filterType, setFilterType] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    async function loadCalls() {
      setLoading(true)
      try {
        const res = await aiApi.audit.calls({ limit, offset, type: filterType === 'all' ? undefined : filterType })
        setCalls(res.calls)
        setTotal(res.total)
      } catch (err) {
        toast((err as Error).message || '加载调用记录失败', 'error')
      } finally {
        setLoading(false)
      }
    }
    void loadCalls()
  }, [limit, offset, filterType, toast])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">调用记录</CardTitle>
            <p className="text-sm text-muted-foreground">详细的 AI 调用审计日志，点击行可展开详情</p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="audit-filter-type" className="text-xs text-muted-foreground">类型</Label>
            <Select
              value={filterType}
              onValueChange={(v) => {
                setFilterType(v)
                setOffset(0)
              }}
            >
              <SelectTrigger size="sm" id="audit-filter-type" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" sideOffset={4}>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="summary">前情提要</SelectItem>
                <SelectItem value="catchup">回顾总结</SelectItem>
                <SelectItem value="continue">续写</SelectItem>
                <SelectItem value="write_outline">创作大纲</SelectItem>
                <SelectItem value="write_chapter">创作章节</SelectItem>
                <SelectItem value="writing_title">标题生成</SelectItem>
                <SelectItem value="test">连通性测试</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && calls.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">加载中…</div>
          ) : calls.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">暂无调用记录</div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">用户</th>
                        <th className="px-4 py-3 text-left font-medium">类型</th>
                        <th className="px-4 py-3 text-left font-medium">关联内容</th>
                        <th className="px-4 py-3 text-right font-medium">Token</th>
                        <th className="px-4 py-3 text-right font-medium">成本</th>
                        <th className="px-4 py-3 text-left font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((call) => {
                        const expanded = expandedId === call.id
                        return (
                          <Fragment key={call.id}>
                            <tr
                              className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                              onClick={() => setExpandedId(expanded ? null : call.id)}
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium">{call.displayName || call.username || '—'}</div>
                                {call.username && call.displayName && (
                                  <div className="text-xs text-muted-foreground">@{call.username}</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="secondary">
                                  {aiCallTypeLabel(call.type)}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                <div className="max-w-[280px]">
                                  <div className="truncate font-medium text-foreground">
                                    {call.novelTitle || <span className="text-muted-foreground">—</span>}
                                  </div>
                                  {call.chapterTitle && (
                                    <div className="truncate text-xs text-muted-foreground">
                                      📖 {call.chapterTitle}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                <div className="text-xs">
                                  <span className="text-muted-foreground">入</span>{' '}
                                  <span className="font-medium">{call.promptTokens.toLocaleString()}</span>
                                </div>
                                <div className="text-xs">
                                  <span className="text-muted-foreground">出</span>{' '}
                                  <span className="font-medium">{call.completionTokens.toLocaleString()}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums font-medium">
                                {formatCost(call.costMillicents)}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                <div>{new Date(call.createdAt).toLocaleDateString('zh-CN')}</div>
                                <div className="text-xs">{new Date(call.createdAt).toLocaleTimeString('zh-CN')}</div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b last:border-0 bg-muted/20">
                                <td colSpan={6} className="px-4 py-4">
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <DetailItem label="调用 ID" value={<code className="text-xs">{call.id}</code>} />
                                    <DetailItem label="模型" value={<code className="text-xs">{call.model || '—'}</code>} />
                                    <DetailItem
                                      label="小说 ID"
                                      value={<code className="text-xs">{call.novelId || '—'}</code>}
                                    />
                                    <DetailItem
                                      label="章节 ID"
                                      value={<code className="text-xs">{call.chapterId || '—'}</code>}
                                    />
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                                    <span>
                                      输入 Token：<strong className="text-foreground">{call.promptTokens.toLocaleString()}</strong>
                                    </span>
                                    <span>
                                      输出 Token：<strong className="text-foreground">{call.completionTokens.toLocaleString()}</strong>
                                    </span>
                                    <span>
                                      合计：
                                      <strong className="text-foreground">
                                        {(call.promptTokens + call.completionTokens).toLocaleString()}
                                      </strong>
                                    </span>
                                    <span>
                                      成本：<strong className="text-foreground">{formatCost(call.costMillicents)}</strong>
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="ai-list-footer mt-4 flex items-center gap-4">
                <span className="ai-list-total shrink-0 text-sm text-muted-foreground">
                  共 {total} 条记录，显示 {offset + 1}-{Math.min(offset + limit, total)}
                </span>
                <div className="ai-list-pagination-controls ml-auto flex shrink-0 items-center gap-3">
                  <div className="ai-list-page-size flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <Label htmlFor="audit-page-size">每页</Label>
                    <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setOffset(0) }}>
                      <SelectTrigger size="sm" id="audit-page-size" className="w-[88px]" aria-label="每页显示数量"><SelectValue /></SelectTrigger>
                      <SelectContent position="popper" align="end" sideOffset={4}>
                        <SelectItem value="10">10 条</SelectItem>
                        <SelectItem value="20">20 条</SelectItem>
                        <SelectItem value="50">50 条</SelectItem>
                        <SelectItem value="100">100 条</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Pagination className="ai-list-pagination" page={Math.floor(offset / limit) + 1} totalPages={Math.max(1, Math.ceil(total / limit))} onPage={(page) => setOffset((page - 1) * limit)} />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function kindLabel(kind: string): string {
  return kind === 'summary' ? '前情提要'
    : kind === 'catchup' ? '回顾总结'
      : kind === 'write_outline' ? '创作大纲'
        : kind === 'write_chapter' ? '创作章节'
          : kind === 'continue' ? '续写'
            : kind
}

/** 已生成内容管理：列出 AI 产物，支持按类型筛选与单条删除。 */
export function AiGenerationsPanel(props: { scope: 'all' | 'reader' | 'writing'; status?: 'all' | 'published' | 'draft' | 'rejected' }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [items, setItems] = useState<
    Array<{
      id: string
      kind: string
      model: string
      novelId: string
      chapterId: string
      novelTitle: string
      chapterTitle: string
      result: string
      status: string
      createdAt: number
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [filterKind, setFilterKind] = useState<'all' | 'summary' | 'catchup' | 'write_outline' | 'write_chapter' | 'continue'>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<(typeof items)[number] | null>(null)
  const [publishTitle, setPublishTitle] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [titleCandidates, setTitleCandidates] = useState<string[]>([])
  const [generatingTitles, setGeneratingTitles] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.generations({ kind: filterKind === 'all' ? undefined : filterKind, scope: props.scope, status: props.status, limit, offset })
      const allowedKinds = props.scope === 'writing'
        ? new Set(['continue', 'write_outline', 'write_chapter'])
        : props.scope === 'reader'
          ? new Set(['summary', 'catchup'])
          : new Set(['summary', 'catchup', 'continue', 'write_outline', 'write_chapter'])
      setItems(res.items.filter((item) => allowedKinds.has(item.kind)))
      setTotal(res.total)
    } catch (err) {
      toast((err as Error).message || '加载已生成内容失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [filterKind, limit, offset, props.scope, props.status, toast])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(item: { id: string; kind: string; novelTitle: string; chapterTitle: string }) {
    const ok = await confirm({
      title: '删除这条已生成内容？',
      message: `「${item.novelTitle || '未知小说'}」${item.chapterTitle ? ` · ${item.chapterTitle}` : ''}的${kindLabel(item.kind)}会被删除，读者下次访问该内容时会重新生成并计入配额。`,
      okText: '删除',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setDeletingId(item.id)
    try {
      await aiApi.deleteGeneration(item.id)
      toast('已删除', 'success')
      // 当前页删空时回退一页，避免停在空页
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - limit))
      else void load()
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function publish(item: (typeof items)[number]) {
    const title = publishTitle.trim()
    if (!title || !item.novelId) return toast('请填写章节标题并确认关联小说', 'error')
    setPublishing(true)
    try {
      await aiApi.writing.publishDraft(item.id, { novelId: item.novelId, title })
      toast('已发布为正式章节', 'success')
      setViewing(null)
      setPublishTitle('')
      void load()
    } catch (err) {
      toast((err as Error).message || '发布失败', 'error')
    } finally {
      setPublishing(false)
    }
  }

  async function generateTitles(item: (typeof items)[number]) {
    setGeneratingTitles(true)
    setTitleCandidates([])
    try {
      const result = await aiApi.writing.titles({ content: item.result, novelId: item.novelId, contextTitle: item.chapterTitle })
      setTitleCandidates(result.titles)
      toast(`已生成 ${result.titles.length} 个标题候选`, 'success')
    } catch (err) {
      toast((err as Error).message || '标题生成失败', 'error')
    } finally {
      setGeneratingTitles(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">已生成内容</CardTitle>
            <p className="text-sm text-muted-foreground">AI 生成的内容记录，可删除后重新生成</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Label htmlFor="gen-filter-kind" className="text-xs text-muted-foreground">类型</Label>
            <Select
              value={filterKind}
              onValueChange={(v) => {
                setFilterKind(v as 'all' | 'summary' | 'catchup' | 'write_outline' | 'write_chapter' | 'continue')
                setOffset(0)
              }}
            >
              <SelectTrigger size="sm" id="gen-filter-kind" className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" sideOffset={4}>
                <SelectItem value="all">全部</SelectItem>
                {props.scope !== 'writing' && <>
                  <SelectItem value="summary">前情提要</SelectItem>
                  <SelectItem value="catchup">回顾总结</SelectItem>
                </>}
                {props.scope !== 'reader' && <>
                  <SelectItem value="write_outline">创作大纲</SelectItem>
                  <SelectItem value="write_chapter">创作章节</SelectItem>
                  <SelectItem value="continue">续写</SelectItem>
                </>}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && items.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">加载中…</div>
          ) : items.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">暂无已生成内容</div>
          ) : (
            <>
              <div className="ai-generations-table overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">类型</th>
                        <th className="px-4 py-3 text-left font-medium">关联内容</th>
                        <th className="px-4 py-3 text-left font-medium">内容预览</th>
                        <th className="px-4 py-3 text-left font-medium">模型</th>
                        <th className="px-4 py-3 text-left font-medium">生成时间</th>
                        <th className="px-4 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <Badge variant="secondary">{kindLabel(item.kind)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="max-w-[220px]">
                              {item.novelId ? (
                                <Link
                                  to={`/novel/${encodeURIComponent(item.novelId)}`}
                                  className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                                  title={`打开《${item.novelTitle || '未知小说'}》详情`}
                                >
                                  {item.novelTitle || <span className="text-muted-foreground">—</span>}
                                </Link>
                              ) : (
                                <div className="truncate font-medium text-foreground">
                                  {item.novelTitle || <span className="text-muted-foreground">—</span>}
                                </div>
                              )}
                              {item.chapterTitle ? (
                                item.novelId && item.chapterId ? (
                                  <Link
                                    to={`/read/${encodeURIComponent(item.novelId)}/${encodeURIComponent(item.chapterId)}`}
                                    className="block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
                                    title="阅读该章节"
                                  >
                                    📖 {item.chapterTitle}
                                  </Link>
                                ) : (
                                  <div className="truncate text-xs text-muted-foreground">📖 {item.chapterTitle}</div>
                                )
                              ) : null}
                            </div>
                          </td>
                          <td className="max-w-[340px] px-4 py-3">
                            <p className="line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                              {item.result || '—'}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{item.model || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <div>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</div>
                            <div className="text-xs">{new Date(item.createdAt).toLocaleTimeString('zh-CN')}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => { setViewing(item); setPublishTitle(item.chapterTitle || ''); setTitleCandidates([]) }}>查看</Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={deletingId === item.id}
                                onClick={() => void remove(item)}
                              >
                                {deletingId === item.id ? '删除中…' : '删除'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="ai-list-footer mt-4 flex items-center gap-4">
                <span className="ai-list-total shrink-0 text-sm text-muted-foreground">
                  共 {total} 条，显示 {offset + 1}-{Math.min(offset + limit, total)}
                </span>
                <div className="ai-list-pagination-controls ml-auto flex shrink-0 items-center gap-3">
                  <div className="ai-list-page-size flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                    <Label htmlFor="generation-page-size">每页</Label>
                    <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setOffset(0) }}>
                      <SelectTrigger size="sm" id="generation-page-size" className="w-[88px]" aria-label="每页显示数量"><SelectValue /></SelectTrigger>
                      <SelectContent position="popper" align="end" sideOffset={4}>
                        <SelectItem value="10">10 条</SelectItem>
                        <SelectItem value="20">20 条</SelectItem>
                        <SelectItem value="50">50 条</SelectItem>
                        <SelectItem value="100">100 条</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Pagination className="ai-list-pagination" page={Math.floor(offset / limit) + 1} totalPages={Math.max(1, Math.ceil(total / limit))} onPage={(page) => setOffset((page - 1) * limit)} />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!viewing} onOpenChange={(open) => { if (!open) { setViewing(null); setPublishTitle(''); setTitleCandidates([]); setGeneratingTitles(false) } }}>
        <DialogContent className="ai-generation-dialog flex h-[min(85svh,900px)] max-h-[calc(100svh-2rem)] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-3 overflow-hidden p-4 sm:gap-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{viewing ? `${kindLabel(viewing.kind)} · 完整内容` : '完整内容'}</DialogTitle>
            <DialogDescription>仅管理员可查看 AI 生成的完整内容。</DialogDescription>
          </DialogHeader>
          {viewing && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20 p-4 text-sm leading-7 whitespace-pre-wrap sm:p-5">{viewing.result || '暂无内容'}</div>
              {viewing.status === 'draft' && (viewing.kind === 'write_chapter' || viewing.kind === 'continue') && (
                <div className="ai-generation-publish shrink-0 border-t pt-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="ai-generation-publish__field grid min-w-0 flex-1 gap-1.5">
                    <Label htmlFor="generation-publish-title">发布章节标题</Label>
                    <Input id="generation-publish-title" className="h-11 focus-visible:border-ring focus-visible:ring-ring/50" value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} placeholder="例如：第十二章 暴雨前夜" />
                    <div className="ai-generation-title-options flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={generatingTitles} onClick={() => void generateTitles(viewing)}>
                        {generatingTitles ? '生成标题中…' : 'AI 生成标题'}
                      </Button>
                      {titleCandidates.map((candidate) => (
                        <Button key={candidate} type="button" variant="secondary" size="sm" className="ai-generation-title-candidate max-w-full" onClick={() => setPublishTitle(candidate)} title={`使用标题：${candidate}`}>
                          {candidate}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button className="h-11 w-full shrink-0 md:w-auto" disabled={publishing || !publishTitle.trim()} onClick={() => void publish(viewing)}>{publishing ? '发布中…' : '发布为章节'}</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  )
}

export function AiParamsPanel(props: { settings: AiSettings | null; loading: boolean; onReload: () => void }) {
  const { toast } = useToast()
  const [localSettings, setLocalSettings] = useState<AiSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLocalSettings(props.settings)
  }, [props.settings])

  async function save() {
    if (!localSettings) return
    setSaving(true)
    try {
      await aiApi.saveSettings(localSettings)
      toast('已保存参数设置', 'success')
      props.onReload()
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!localSettings) {
    return <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">加载中…</div>
  }

  return (
    <div className="space-y-4">
      {/* 前情提要参数 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">前情提要参数</CardTitle>
          <p className="text-sm text-muted-foreground">调整章节前情提要的生成参数</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="recap-temp">创意度（Temperature）</Label>
              <Input
                id="recap-temp"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={localSettings.recapTemperature}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, recapTemperature: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">0 = 最确定，1 = 最随机。推荐 0.7</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recap-tokens">最大输出 Token</Label>
              <Input
                id="recap-tokens"
                type="number"
                min={100}
                max={2000}
                value={localSettings.recapMaxTokens}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, recapMaxTokens: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">限制生成长度，防止过长。推荐 500</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recap-prompt">系统提示词</Label>
            <textarea
              id="recap-prompt"
              className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={localSettings.recapSystemPrompt}
              disabled={props.loading || saving}
              onChange={(e) => setLocalSettings({ ...localSettings, recapSystemPrompt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">定义 AI 的角色和输出风格</p>
          </div>
        </CardContent>
      </Card>

      {/* 回顾总结参数 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">回顾总结参数</CardTitle>
          <p className="text-sm text-muted-foreground">调整「回来接着读」功能的参数</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">回来接着读功能</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">为久未阅读的读者合成连贯回顾</span>
            </span>
            <Switch
              checked={localSettings.catchupEnabled}
              disabled={props.loading || saving}
              onCheckedChange={(v) => setLocalSettings({ ...localSettings, catchupEnabled: v })}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="catchup-chapters">最多回顾章节数</Label>
              <Input
                id="catchup-chapters"
                type="number"
                min={1}
                max={10}
                value={localSettings.catchupMaxChapters}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, catchupMaxChapters: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">1-10 章</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="catchup-temp">创意度</Label>
              <Input
                id="catchup-temp"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={localSettings.catchupTemperature}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, catchupTemperature: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">推荐 0.7</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="catchup-tokens">最大输出 Token</Label>
              <Input
                id="catchup-tokens"
                type="number"
                min={100}
                max={3000}
                value={localSettings.catchupMaxTokens}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, catchupMaxTokens: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">推荐 800</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 创作参数</CardTitle>
          <p className="text-sm text-muted-foreground">用于 AI 创作页的大纲、章节生成和续写</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="writing-temp">创意度（Temperature）</Label>
              <Input id="writing-temp" type="number" min={0} max={1} step={0.1} value={localSettings.writingTemperature} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, writingTemperature: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">数值越高，生成结果越有变化。推荐 0.8</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="writing-tokens">最大输出 Token</Label>
              <Input id="writing-tokens" type="number" min={300} max={1000000} value={localSettings.writingMaxTokens} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, writingMaxTokens: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">控制大纲、章节和续写的最大长度，最高 1,000,000 Token</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="writing-prompt">创作系统提示词</Label>
            <textarea id="writing-prompt" className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={localSettings.writingSystemPrompt} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, writingSystemPrompt: e.target.value })} />
            <p className="text-xs text-muted-foreground">定义 AI 创作的角色、文风和输出约束</p>
          </div>
        </CardContent>
      </Card>

      {/* 审计配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">审计配置</CardTitle>
          <p className="text-sm text-muted-foreground">控制 AI 调用的审计信息记录</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">记录 IP 地址</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">在审计记录中保存用户 IP</span>
            </span>
            <Switch
              checked={localSettings.logIpAddress}
              disabled={props.loading || saving}
              onCheckedChange={(v) => setLocalSettings({ ...localSettings, logIpAddress: v })}
            />
          </label>
          <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">记录 User-Agent</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">在审计记录中保存浏览器信息</span>
            </span>
            <Switch
              checked={localSettings.logUserAgent}
              disabled={props.loading || saving}
              onCheckedChange={(v) => setLocalSettings({ ...localSettings, logUserAgent: v })}
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={props.loading || saving}>
          {saving ? '保存中…' : '保存所有参数'}
        </Button>
      </div>
    </div>
  )
}
