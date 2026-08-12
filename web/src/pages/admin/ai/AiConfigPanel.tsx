/** 配置面板：供应商信息、开关、配额（数字输入防抖自动保存）。 */
import { useEffect, useState } from 'react'
import { aiApi, type AiSettings, type AiUsageSummary } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { UsageCell, formatCost, type Provider } from './shared'

export default function AiConfigPanel(props: {
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
  // 数字输入本地草稿：击键即时回显，保存走防抖
  const [dailyQuotaDraft, setDailyQuotaDraft] = useState('')
  const [maxCharsDraft, setMaxCharsDraft] = useState('')

  useEffect(() => {
    setDailyQuotaDraft(props.settings?.dailyQuota !== undefined ? String(props.settings.dailyQuota) : '')
    setMaxCharsDraft(props.settings?.maxChapterChars !== undefined ? String(props.settings.maxChapterChars) : '')
  }, [props.settings])

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

  // 防抖保存：原实现每次击键都发一次 PUT
  const saveDebounced = useDebouncedCallback((patch: Partial<AiSettings>) => void save(patch), 800)

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
                value={dailyQuotaDraft}
                disabled={!settings || props.loading}
                onChange={(e) => {
                  setDailyQuotaDraft(e.target.value)
                  const value = Number(e.target.value)
                  if (settings && e.target.value !== '' && Number.isFinite(value)) saveDebounced({ dailyQuota: value })
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
                value={maxCharsDraft}
                disabled={!settings || props.loading}
                onChange={(e) => {
                  setMaxCharsDraft(e.target.value)
                  const value = Number(e.target.value)
                  if (settings && e.target.value !== '' && Number.isFinite(value)) saveDebounced({ maxChapterChars: value })
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
