/**
 * AI 服务卡（后台 · 账户与注册 tab）——
 * 供应商密钥走 .env / 安装向导，这里只管运营开关：开不开、每人每天几次、送多少正文。
 * consumers: pages/admin/SettingsTab.tsx
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, type AiSettings, type AiUsageSummary } from '../../lib/api'
import { useToast } from '../feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface Provider {
  configured: boolean
  host: string
  model: string
  hasKey: boolean
}

export default function AiSettingsCard() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [usage, setUsage] = useState<{ today: AiUsageSummary; last30d: AiUsageSummary } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  const load = useCallback(async () => {
    try {
      const [conf, use] = await Promise.all([aiApi.settings(), aiApi.usage()])
      setSettings(conf.settings)
      setProvider(conf.provider)
      setUsage(use)
    } catch (err) {
      toast((err as Error).message || '读取 AI 设置失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function save(patch: Partial<AiSettings>) {
    if (!settings) return
    setSaving(true)
    try {
      const res = await aiApi.saveSettings(patch)
      setSettings(res.settings)
      toast('已保存 AI 设置', 'success')
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
      void load()
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base">AI 服务</CardTitle>
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

        <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ai-daily-quota">每人每日生成上限</Label>
            <Input
              id="ai-daily-quota"
              type="number"
              min={0}
              max={1000}
              value={settings?.dailyQuota ?? ''}
              disabled={!settings}
              onChange={(e) => setSettings((p) => (p ? { ...p, dailyQuota: Number(e.target.value) } : p))}
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
              disabled={!settings}
              onChange={(e) => setSettings((p) => (p ? { ...p, maxChapterChars: Number(e.target.value) } : p))}
            />
            <p className="text-xs text-muted-foreground">超出部分截断，直接决定单次调用成本</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!settings || saving}
            onClick={() => void save({ dailyQuota: settings?.dailyQuota, maxChapterChars: settings?.maxChapterChars })}
          >
            保存设置
          </Button>
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

/** cost_millicents → 货币单位，保留 4 位小数。不假设币种，不加货币符号。 */
function formatCost(millicents: number): string {
  return (Number(millicents) / 100_000).toFixed(4)
}
