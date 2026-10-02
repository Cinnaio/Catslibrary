/** 配置面板：供应商信息、开关、配额（分组确认后保存）。 */
import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useEffect, useState } from 'react'
import { Image, Sparkles } from 'lucide-react'
import { aiApi, type AiSettings, type AiUsageSummary, type AiProviderConfig } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { UsageCell, formatCost, type Provider } from './shared'

export default function AiConfigPanel(props: {
  settings: AiSettings | null
  provider: Provider | null
  providerConfig: AiProviderConfig | null
  imageProviderConfig: AiProviderConfig | null
  imageProvider?: Provider | null
  loading: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [usage, setUsage] = useState<{ today: AiUsageSummary; last30d: AiUsageSummary } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  // 编辑只更新本地草稿，各组确认后保存。
  const [dailyQuotaDraft, setDailyQuotaDraft] = useState('')
  const [maxCharsDraft, setMaxCharsDraft] = useState('')
  const [recapEnabledDraft, setRecapEnabledDraft] = useState(false)

  // 供应商配置编辑草稿：与 props.providerConfig 同步，单独保存
  const [providerDraft, setProviderDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const savingProvider = saving
  // 图像供应商编辑草稿（封面生成用）
  const [imageProviderDraft, setImageProviderDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const savingImageProvider = saving

  useEffect(() => {
    setRecapEnabledDraft(!!props.settings?.recapEnabled)
    setDailyQuotaDraft(props.settings?.dailyQuota !== undefined ? String(props.settings.dailyQuota) : '')
    setMaxCharsDraft(props.settings?.maxChapterChars !== undefined ? String(props.settings.maxChapterChars) : '')
  }, [props.settings?.dailyQuota, props.settings?.maxChapterChars, props.settings?.recapEnabled])

  useEffect(() => {
    setProviderDraft({
      baseUrl: props.providerConfig?.baseUrl || '',
      // 密钥不回显明文：已配置时留占位提示，保存时空字符串表示「不改动」
      apiKey: props.providerConfig?.hasApiKey ? '••••••••' : '',
      model: props.providerConfig?.model || '',
    })
  }, [props.providerConfig?.baseUrl, props.providerConfig?.model, props.providerConfig?.hasApiKey])

  const imageProviderConfig = props.imageProviderConfig
  useEffect(() => {
    setImageProviderDraft({
      baseUrl: imageProviderConfig?.baseUrl || '',
      apiKey: imageProviderConfig?.hasApiKey ? '••••••••' : '',
      model: imageProviderConfig?.model || '',
    })
  }, [imageProviderConfig?.baseUrl, imageProviderConfig?.model, imageProviderConfig?.hasApiKey])

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

  function resetReaderPolicy() {
    setRecapEnabledDraft(!!props.settings?.recapEnabled)
    setDailyQuotaDraft(String(props.settings?.dailyQuota ?? ''))
    setMaxCharsDraft(String(props.settings?.maxChapterChars ?? ''))
  }

  function providerValues(config: AiProviderConfig | null) {
    return { baseUrl: config?.baseUrl || '', model: config?.model || '', apiKey: config?.hasApiKey ? '••••••••' : '' }
  }
  function providerChanged(draft: typeof providerDraft, config: AiProviderConfig | null) {
    return draft.baseUrl !== (config?.baseUrl || '') || draft.model !== (config?.model || '') || (draft.apiKey !== '' && draft.apiKey !== '••••••••')
  }
  const providerDirty = providerChanged(providerDraft, props.providerConfig)
  const imageProviderDirty = providerChanged(imageProviderDraft, imageProviderConfig)
  const readerDirty =
    !!props.settings &&
    (recapEnabledDraft !== props.settings.recapEnabled ||
      dailyQuotaDraft !== String(props.settings.dailyQuota) ||
      maxCharsDraft !== String(props.settings.maxChapterChars))

  async function saveAll() {
    if (saving || props.loading || !(providerDirty || imageProviderDirty || readerDirty)) return
    const dailyQuota = Number(dailyQuotaDraft)
    const maxChapterChars = Number(maxCharsDraft)
    if (
      readerDirty &&
      (!dailyQuotaDraft.trim() ||
        !maxCharsDraft.trim() ||
        !Number.isInteger(dailyQuota) ||
        dailyQuota < 0 ||
        dailyQuota > 1000 ||
        !Number.isInteger(maxChapterChars) ||
        maxChapterChars < 500 ||
        maxChapterChars > 20000)
    ) {
      toast('每日生成上限需为 0–1000 的整数，正文字数需为 500–20000 的整数', 'error')
      return
    }
    setSaving(true)
    const completed: string[] = []
    function providerPatch(draft: typeof providerDraft) {
      return {
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey !== '' && draft.apiKey !== '••••••••' ? { apiKey: draft.apiKey.trim() } : {}),
      }
    }
    try {
      if (providerDirty) {
        await aiApi.saveProviderConfig(providerPatch(providerDraft))
        completed.push('文本供应商')
        setProviderDraft((draft) => ({ ...draft, apiKey: draft.apiKey.trim() ? '••••••••' : '' }))
      }
      if (imageProviderDirty && imageProviderConfig) {
        await aiApi.saveProviderConfig({ ...providerPatch(imageProviderDraft), scope: 'image' })
        completed.push('图像供应商')
        setImageProviderDraft((draft) => ({ ...draft, apiKey: draft.apiKey.trim() ? '••••••••' : '' }))
      }
      if (readerDirty) {
        await aiApi.saveSettings({ recapEnabled: recapEnabledDraft, dailyQuota, maxChapterChars })
        completed.push('读者策略')
      }
      toast('已保存 AI 配置', 'success')
    } catch (err) {
      toast(`${(err as Error).message || '保存失败'}${completed.length ? `；已保存${completed.join('、')}，其余修改保留，可重试` : ''}`, 'error')
    } finally {
      if (completed.length) props.onReload()
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
  const imageConfigured = props.imageProvider?.configured ?? !!imageProviderConfig?.hasApiKey

  return (
    <div className="ai-config-panel">
      {/* 供应商连接参数：可在后台直接修改，无需重启。 */}
      <Card className="admin-panel-card ai-config-providers-card min-w-0">
        <AdminPanelHeading title="模型供应商" />
        <CardContent className="ai-config-providers">
          <section className="ai-provider-section grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                  文本供应商
                </h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {provider?.configured ? `${provider.host} · ${provider.model}` : '未配置，AI 文本功能不可用'}
                </p>
              </div>
              <AdminStatusBadge tone={provider?.configured ? 'accent' : 'muted'}>{provider?.configured ? '已配置' : '未配置'}</AdminStatusBadge>
            </div>
            <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
              <AdminFormField label="Base URL" htmlFor="ai-base-url" hint="OpenAI 兼容端点，可写到 /v1 或 /chat/completions">
                <Input
                  id="ai-base-url"
                  placeholder="https://api.deepseek.com/v1"
                  value={providerDraft.baseUrl}
                  disabled={savingProvider || props.loading}
                  onChange={(e) => setProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                />
              </AdminFormField>
              <AdminFormField
                label="模型"
                htmlFor="ai-model"
                hint={provider?.hasKey && !props.providerConfig?.hasApiKey ? '密钥由环境变量设定，后台不显示' : '填入上游支持的模型名'}
              >
                <Input
                  id="ai-model"
                  placeholder="deepseek-v4-flash"
                  value={providerDraft.model}
                  disabled={savingProvider || props.loading}
                  onChange={(e) => setProviderDraft((p) => ({ ...p, model: e.target.value }))}
                />
              </AdminFormField>
            </div>
            <AdminFormField label="API Key" htmlFor="ai-api-key" hint="留空保留当前密钥；如需清空，填入一个空格后保存">
              <Input
                id="ai-api-key"
                type="password"
                autoComplete="off"
                placeholder={props.providerConfig?.hasApiKey ? '已设定，留空表示不改动' : '输入密钥后保存'}
                value={providerDraft.apiKey}
                disabled={savingProvider || props.loading}
                onChange={(e) => setProviderDraft((p) => ({ ...p, apiKey: e.target.value }))}
                onFocus={(e) => {
                  // 密钥占位符在聚焦时清空，方便覆盖输入
                  if (providerDraft.apiKey === '••••••••') setProviderDraft((p) => ({ ...p, apiKey: '' }))
                  e.target.select()
                }}
              />
            </AdminFormField>
            <div className="ai-provider-actions ai-provider-test">
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {testResult || '测试使用当前已保存的文本配置'}
              </span>
              <Button variant="secondary" disabled={testing || !provider?.configured || saving} onClick={() => void runTest()}>
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
          </section>

          {/* 图像供应商连接参数：用于 AI 封面生成。 */}
          <section className="ai-provider-section grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Image className="size-3.5 text-primary" aria-hidden="true" />
                  图像供应商
                </h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {imageConfigured
                    ? `${props.imageProvider?.host || '已配置'} · ${props.imageProvider?.model || imageProviderConfig?.model || '默认模型'}`
                    : '未配置，AI 封面生成不可用'}
                </p>
              </div>
              <AdminStatusBadge tone={imageConfigured ? 'accent' : 'muted'}>{imageConfigured ? '已配置' : '未配置'}</AdminStatusBadge>
            </div>
            <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
              <AdminFormField label="图像 Base URL" htmlFor="ai-image-base-url" hint="OpenAI 兼容 /images/generations 端点">
                <Input
                  id="ai-image-base-url"
                  placeholder="https://api.example.com/v1"
                  value={imageProviderDraft.baseUrl}
                  disabled={savingImageProvider || props.loading || !imageProviderConfig}
                  onChange={(e) => setImageProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                />
              </AdminFormField>
              <AdminFormField label="图像模型" htmlFor="ai-image-model" hint="填入上游支持的图像模型名">
                <Input
                  id="ai-image-model"
                  placeholder="mimo-v2.5"
                  value={imageProviderDraft.model}
                  disabled={savingImageProvider || props.loading || !imageProviderConfig}
                  onChange={(e) => setImageProviderDraft((p) => ({ ...p, model: e.target.value }))}
                />
              </AdminFormField>
            </div>
            <AdminFormField label="图像 API Key" htmlFor="ai-image-api-key" hint="用于 AI 封面生成；留空不改动，清空填空格保存">
              <Input
                id="ai-image-api-key"
                type="password"
                autoComplete="off"
                placeholder={imageProviderConfig?.hasApiKey ? '已设定，留空表示不改动' : '输入密钥后保存'}
                value={imageProviderDraft.apiKey}
                disabled={savingImageProvider || props.loading || !imageProviderConfig}
                onChange={(e) => setImageProviderDraft((p) => ({ ...p, apiKey: e.target.value }))}
                onFocus={(e) => {
                  if (imageProviderDraft.apiKey === '••••••••') setImageProviderDraft((p) => ({ ...p, apiKey: '' }))
                  e.target.select()
                }}
              />
            </AdminFormField>
            <div className="ai-provider-actions ai-provider-test">
              <span className="text-xs text-muted-foreground">用于封面候选生成，环境变量显式设定值优先。</span>
            </div>
          </section>
        </CardContent>
      </Card>

      <div className="ai-config-secondary">
        <Card className="admin-panel-card ai-config-card">
          <AdminPanelHeading title="读者生成策略" />
          <CardContent className="grid gap-4">
            <div className="ai-config-policy-grid">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">阅读器前情提要</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">读者进入章节时可回顾上一章，结果按章缓存，全站共用一份</span>
                </span>
                <Switch checked={recapEnabledDraft} disabled={!settings || saving || props.loading} onCheckedChange={setRecapEnabledDraft} />
              </label>

              <div className="ai-form-grid ai-config-limits grid gap-3 sm:grid-cols-2">
                <AdminFormField label="每人每日生成上限" htmlFor="ai-daily-quota" hint="命中缓存不计数；管理员不受限；0 表示禁止读者触发">
                  <Input
                    id="ai-daily-quota"
                    type="number"
                    min={0}
                    max={1000}
                    value={dailyQuotaDraft}
                    disabled={!settings || props.loading || saving}
                    onChange={(e) => {
                      setDailyQuotaDraft(e.target.value)
                    }}
                  />
                </AdminFormField>
                <AdminFormField label="送入模型的正文字数" htmlFor="ai-max-chars" hint="超出部分截断，直接决定单次调用成本">
                  <Input
                    id="ai-max-chars"
                    type="number"
                    min={500}
                    max={20000}
                    value={maxCharsDraft}
                    disabled={!settings || props.loading || saving}
                    onChange={(e) => {
                      setMaxCharsDraft(e.target.value)
                    }}
                  />
                </AdminFormField>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="admin-panel-card ai-config-card">
          <AdminPanelHeading title="服务检查与用量" />
          <CardContent className="grid gap-4">
            <p className="text-xs text-muted-foreground">
              连接检查使用已保存配置；详细任务记录与消耗可在{' '}
              <a className="text-primary" href="/admin/calls">
                调用与用量
              </a>{' '}
              查看。
            </p>

            {usage && (
              <div className="ai-config-usage">
                <div className="ai-config-usage-group">
                  <span className="ai-config-usage-group-label">今日</span>
                  <div className="ai-config-usage-grid">
                    <UsageCell label="调用" value={usage.today.calls} />
                    <UsageCell label="Token" value={usage.today.promptTokens + usage.today.completionTokens} />
                    <UsageCell label="成本" value={formatCost(usage.today.costMillicents)} />
                  </div>
                </div>
                <div className="ai-config-usage-group">
                  <span className="ai-config-usage-group-label">近 30 天</span>
                  <div className="ai-config-usage-grid ai-config-usage-grid--two">
                    <UsageCell label="调用" value={usage.last30d.calls} />
                    <UsageCell label="Token" value={usage.last30d.promptTokens + usage.last30d.completionTokens} />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="ai-config-save">
        <span role="status">{providerDirty || imageProviderDirty || readerDirty ? '有未保存的修改' : '当前配置已保存'}</span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={saving || props.loading || !(providerDirty || imageProviderDirty || readerDirty)}
            onClick={() => {
              setProviderDraft(providerValues(props.providerConfig))
              setImageProviderDraft(providerValues(imageProviderConfig))
              resetReaderPolicy()
            }}
          >
            撤销修改
          </Button>
          <Button disabled={saving || props.loading || !(providerDirty || imageProviderDirty || readerDirty)} onClick={() => void saveAll()}>
            {saving ? '保存中…' : '保存配置'}
          </Button>
        </div>
      </div>
    </div>
  )
}
