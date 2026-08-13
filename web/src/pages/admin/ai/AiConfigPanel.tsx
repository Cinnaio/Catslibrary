/** 配置面板：供应商信息、开关、配额（数字输入防抖自动保存）。 */
import { useEffect, useState } from 'react'
import { aiApi, type AiSettings, type AiUsageSummary, type AiProviderConfig } from '@/lib/api'
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
  providerConfig: AiProviderConfig | null
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

  // 供应商配置编辑草稿：与 props.providerConfig 同步，单独保存
  const [providerDraft, setProviderDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const [savingProvider, setSavingProvider] = useState(false)
  // 图像供应商编辑草稿（封面生成用）
  const [imageProviderDraft, setImageProviderDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const [savingImageProvider, setSavingImageProvider] = useState(false)

  useEffect(() => {
    setDailyQuotaDraft(props.settings?.dailyQuota !== undefined ? String(props.settings.dailyQuota) : '')
    setMaxCharsDraft(props.settings?.maxChapterChars !== undefined ? String(props.settings.maxChapterChars) : '')
  }, [props.settings])

  useEffect(() => {
    setProviderDraft({
      baseUrl: props.providerConfig?.baseUrl || '',
      // 密钥不回显明文：已配置时留占位提示，保存时空字符串表示「不改动」
      apiKey: props.providerConfig?.hasApiKey ? '••••••••' : '',
      model: props.providerConfig?.model || '',
    })
  }, [props.providerConfig])

  // 图像供应商草稿：从 settings 接口回显（AiTab 需把 imageProvider/imageProviderConfig 透传下来，
  // 当前 AiConfigPanel 只接收文本三件套，这里改用一次 aiApi.settings 兜底取图像三件套，避免改父组件签名过多）
  const [imageProviderConfig, setImageProviderConfig] = useState<AiProviderConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    void aiApi.settings().then((res) => {
      if (cancelled) return
      setImageProviderConfig(res.imageProviderConfig)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [props.providerConfig])

  useEffect(() => {
    setImageProviderDraft({
      baseUrl: imageProviderConfig?.baseUrl || '',
      apiKey: imageProviderConfig?.hasApiKey ? '••••••••' : '',
      model: imageProviderConfig?.model || '',
    })
  }, [imageProviderConfig])

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

  /** 保存供应商配置：密钥占位符视为「不改动」，传 undefined 给后端。 */
  async function saveProvider() {
    setSavingProvider(true)
    try {
      const apiKeyTouched = providerDraft.apiKey !== '••••••••'
      await aiApi.saveProviderConfig({
        baseUrl: providerDraft.baseUrl.trim(),
        model: providerDraft.model.trim(),
        // 用户没动密钥框就不传该字段，避免用占位符覆盖已存密钥
        ...(apiKeyTouched ? { apiKey: providerDraft.apiKey.trim() } : {}),
      })
      toast('已保存供应商配置', 'success')
      props.onReload()
    } catch (err) {
      toast((err as Error).message || '保存供应商配置失败', 'error')
    } finally {
      setSavingProvider(false)
    }
  }

  /** 保存图像供应商配置：密钥占位符视为「不改动」，传 undefined 给后端；scope=image 走图像三件套。 */
  async function saveImageProvider() {
    setSavingImageProvider(true)
    try {
      const apiKeyTouched = imageProviderDraft.apiKey !== '••••••••'
      await aiApi.saveProviderConfig({
        baseUrl: imageProviderDraft.baseUrl.trim(),
        model: imageProviderDraft.model.trim(),
        scope: 'image',
        ...(apiKeyTouched ? { apiKey: imageProviderDraft.apiKey.trim() } : {}),
      })
      toast('已保存图像供应商配置', 'success')
      // 重新拉取图像三件套回显
      const res = await aiApi.settings()
      setImageProviderConfig(res.imageProviderConfig)
    } catch (err) {
      toast((err as Error).message || '保存图像供应商配置失败', 'error')
    } finally {
      setSavingImageProvider(false)
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
          {/* 供应商连接参数：可在后台直接修改，无需重启 */}
          <div className="grid gap-3 rounded-xl border border-border bg-card p-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ai-base-url">Base URL</Label>
                <Input
                  id="ai-base-url"
                  placeholder="https://api.deepseek.com/v1"
                  value={providerDraft.baseUrl}
                  disabled={savingProvider}
                  onChange={(e) => setProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">OpenAI 兼容端点，可写到 /v1 或 /chat/completions</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-model">模型</Label>
                <Input
                  id="ai-model"
                  placeholder="deepseek-v4-flash"
                  value={providerDraft.model}
                  disabled={savingProvider}
                  onChange={(e) => setProviderDraft((p) => ({ ...p, model: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  {provider?.hasKey && !props.providerConfig?.hasApiKey ? '密钥由环境变量设定，后台不显示' : '填入上游支持的模型名'}
                </p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-api-key">API Key</Label>
              <Input
                id="ai-api-key"
                type="password"
                autoComplete="off"
                placeholder={props.providerConfig?.hasApiKey ? '已设定，留空表示不改动' : '输入密钥后保存'}
                value={providerDraft.apiKey}
                disabled={savingProvider}
                onChange={(e) => setProviderDraft((p) => ({ ...p, apiKey: e.target.value }))}
                onFocus={(e) => {
                  // 密钥占位符在聚焦时清空，方便覆盖输入
                  if (providerDraft.apiKey === '••••••••') setProviderDraft((p) => ({ ...p, apiKey: '' }))
                  e.target.select()
                }}
              />
              <p className="text-xs text-muted-foreground">密钥以明文写入 data/runtime-config.json（已 gitignore）；留空不改动，清空填空格保存</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={savingProvider} onClick={() => void saveProvider()}>
                {savingProvider ? '保存中…' : '保存供应商配置'}
              </Button>
              <span className="text-xs text-muted-foreground">
                真实环境变量 / .env 设定的值优先，后台修改不覆盖显式设定
              </span>
            </div>
          </div>

          {/* 图像供应商连接参数：用于 AI 封面生成，与文本三件套对称 */}
          <div className="grid gap-3 rounded-xl border border-border bg-card p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium text-foreground">图像供应商</span>
                <span className="text-xs text-muted-foreground">
                  {imageProviderConfig?.hasApiKey
                    ? `已配置 · ${imageProviderConfig.model || '默认模型'}`
                    : '未配置，AI 封面生成不可用'}
                </span>
              </div>
              <Badge className={imageProviderConfig?.hasApiKey ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                {imageProviderConfig?.hasApiKey ? '已配置' : '未配置'}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ai-image-base-url">图像 Base URL</Label>
                <Input
                  id="ai-image-base-url"
                  placeholder="https://api.example.com/v1"
                  value={imageProviderDraft.baseUrl}
                  disabled={savingImageProvider}
                  onChange={(e) => setImageProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">OpenAI 兼容 /images/generations 端点</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-image-model">图像模型</Label>
                <Input
                  id="ai-image-model"
                  placeholder="mimo-v2.5"
                  value={imageProviderDraft.model}
                  disabled={savingImageProvider}
                  onChange={(e) => setImageProviderDraft((p) => ({ ...p, model: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">填入上游支持的图像模型名</p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-image-api-key">图像 API Key</Label>
              <Input
                id="ai-image-api-key"
                type="password"
                autoComplete="off"
                placeholder={imageProviderConfig?.hasApiKey ? '已设定，留空表示不改动' : '输入密钥后保存'}
                value={imageProviderDraft.apiKey}
                disabled={savingImageProvider}
                onChange={(e) => setImageProviderDraft((p) => ({ ...p, apiKey: e.target.value }))}
                onFocus={(e) => {
                  if (imageProviderDraft.apiKey === '••••••••') setImageProviderDraft((p) => ({ ...p, apiKey: '' }))
                  e.target.select()
                }}
              />
              <p className="text-xs text-muted-foreground">用于 AI 封面生成；留空不改动，清空填空格保存</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={savingImageProvider} onClick={() => void saveImageProvider()}>
                {savingImageProvider ? '保存中…' : '保存图像供应商配置'}
              </Button>
              <span className="text-xs text-muted-foreground">
                与文本供应商优先级一致：环境变量显式设定值不被覆盖
              </span>
            </div>
          </div>

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
