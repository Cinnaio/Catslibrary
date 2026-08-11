/**
 * AI 服务 tab —— 配置、审计、参数调优的完整控制面板
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, type AiSettings, type AiUsageSummary } from '../../lib/api'
import { useToast } from '../../components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AdminPage from '@/components/admin/AdminPage'

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
    <AdminPage title="AI 服务" description="管理 AI 功能配置、查看用量统计与调用审计">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="config">配置</TabsTrigger>
          <TabsTrigger value="usage">用量统计</TabsTrigger>
          <TabsTrigger value="audit">调用审计</TabsTrigger>
          <TabsTrigger value="params">参数调优</TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <AiConfigPanel settings={settings} provider={provider} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="usage">
          <AiUsagePanel />
        </TabsContent>

        <TabsContent value="audit">
          <AiAuditPanel />
        </TabsContent>

        <TabsContent value="params">
          <AiParamsPanel settings={settings} loading={loading} onReload={load} />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
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
      <Card>
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
  const [trend, setTrend] = useState<Array<{ date: string; calls: number; costMillicents: number }>>([])
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
  const avgCost = totalCalls > 0 ? totalCost / totalCalls : 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">成本趋势</CardTitle>
            <p className="text-sm text-muted-foreground">AI 调用成本与次数的时间趋势</p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
                {d} 天
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">暂无数据</div>
          ) : (
            <div>
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border mb-4">
                <UsageCell label="总调用" value={totalCalls} />
                <UsageCell label="总成本" value={formatCost(totalCost)} />
                <UsageCell label="平均单次" value={formatCost(avgCost)} />
              </div>
              <div className="text-sm text-muted-foreground">
                趋势图表功能将在后续版本中提供（需 recharts 库）
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
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
      costMillicents: number
      createdAt: number
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [limit] = useState(50)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    async function loadCalls() {
      setLoading(true)
      try {
        const res = await aiApi.audit.calls({ limit, offset })
        setCalls(res.calls)
        setTotal(res.total)
      } catch (err) {
        toast((err as Error).message || '加载调用记录失败', 'error')
      } finally {
        setLoading(false)
      }
    }
    void loadCalls()
  }, [limit, offset, toast])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">调用记录</CardTitle>
          <p className="text-sm text-muted-foreground">详细的 AI 调用审计日志</p>
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
                        <th className="px-4 py-3 text-left font-medium">内容</th>
                        <th className="px-4 py-3 text-left font-medium">模型</th>
                        <th className="px-4 py-3 text-right font-medium">成本</th>
                        <th className="px-4 py-3 text-left font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((call) => (
                        <tr key={call.id} className="border-b last:border-0">
                          <td className="px-4 py-3">{call.displayName || call.username}</td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary">{call.type === 'summary' ? '前情提要' : '回顾总结'}</Badge>
                          </td>
                          <td className="px-4 py-3 max-w-xs truncate">{call.novelTitle || '—'}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{call.model}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatCost(call.costMillicents)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(call.createdAt).toLocaleString('zh-CN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  共 {total} 条记录，显示 {offset + 1}-{Math.min(offset + limit, total)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                    上一页
                  </Button>
                  <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AiParamsPanel(props: { settings: AiSettings | null; loading: boolean; onReload: () => void }) {
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
