/** 配置面板：供应商信息、开关、配额（分组确认后保存）。 */
import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import { useEffect, useState } from 'react'
import { aiApi, type AiSettings, type AiUsageSummary, type AiProviderConfig } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatCost, type Provider } from './shared'

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
  const [imageRolesDraft, setImageRolesDraft] = useState<string[]>([])
  const [imageQuotaDraft, setImageQuotaDraft] = useState('10')

  // 供应商配置编辑草稿：与 props.providerConfig 同步，单独保存
  const [providerDraft, setProviderDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const savingProvider = saving
  // 图像供应商编辑草稿（封面生成用）
  const [imageProviderDraft, setImageProviderDraft] = useState({ baseUrl: '', apiKey: '', model: '' })
  const savingImageProvider = saving

  useEffect(() => {
    setRecapEnabledDraft(!!props.settings?.recapEnabled)
    setImageRolesDraft(props.settings?.selectionImageRoles ?? ['admin'])
    setImageQuotaDraft(String(props.settings?.selectionImageDailyQuota ?? 10))
    setDailyQuotaDraft(props.settings?.dailyQuota !== undefined ? String(props.settings.dailyQuota) : '')
    setMaxCharsDraft(props.settings?.maxChapterChars !== undefined ? String(props.settings.maxChapterChars) : '')
  }, [props.settings?.dailyQuota, props.settings?.maxChapterChars, props.settings?.recapEnabled, props.settings?.selectionImageRoles, props.settings?.selectionImageDailyQuota])

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
    setImageRolesDraft(props.settings?.selectionImageRoles ?? ['admin'])
    setImageQuotaDraft(String(props.settings?.selectionImageDailyQuota ?? 10))
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
      ['admin', 'reader'].some((role) => imageRolesDraft.includes(role) !== (props.settings?.selectionImageRoles ?? ['admin']).includes(role)) ||
      imageQuotaDraft !== String(props.settings.selectionImageDailyQuota ?? 10) ||
      dailyQuotaDraft !== String(props.settings.dailyQuota) ||
      maxCharsDraft !== String(props.settings.maxChapterChars))

  async function saveAll() {
    if (saving || props.loading || !(providerDirty || imageProviderDirty || readerDirty)) return
    const dailyQuota = Number(dailyQuotaDraft)
    const maxChapterChars = Number(maxCharsDraft)
    const selectionImageDailyQuota = Number(imageQuotaDraft)
    if (readerDirty && (!imageQuotaDraft.trim() || !Number.isInteger(selectionImageDailyQuota) || selectionImageDailyQuota < 0 || selectionImageDailyQuota > 100)) {
      toast('每日图片生成上限需为 0–100 的整数', 'error')
      return
    }
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
        await aiApi.saveSettings({ recapEnabled: recapEnabledDraft, dailyQuota, maxChapterChars, selectionImageRoles: imageRolesDraft, selectionImageDailyQuota })
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
  const dirty = providerDirty || imageProviderDirty || readerDirty

  return (
    <div className="ai-config-panel-wrap">
      <div className="admin-panel-card ai-config-desk">
        {/* 1. 文本模型服务 */}
        <section className="ai-config-section">
          <div className="ai-config-section__lead">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ai-config-section__title">文本供应商</h3>
              <AdminStatusBadge tone={provider?.configured ? 'success' : 'muted'}>
                <span className="ai-config-status-dot" aria-hidden="true" />
                {provider?.configured ? '已配置' : '未配置'}
              </AdminStatusBadge>
            </div>
            <p className="ai-config-section__desc">
              用于全站创作、小说深度分析、章节摘要与剧情回顾生成。支持标准 OpenAI 兼容协议。
            </p>
          </div>
          <div className="ai-config-section__content">
            <div className="grid gap-3 sm:grid-cols-2">
              <AdminFormField label="Base URL" htmlFor="ai-base-url" hint="OpenAI 兼容端点。">
                <Input
                  id="ai-base-url"
                  placeholder="https://api.deepseek.com/v1"
                  value={providerDraft.baseUrl}
                  disabled={savingProvider || props.loading}
                  onChange={(e) => setProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                />
              </AdminFormField>
              <AdminFormField label="模型" htmlFor="ai-model" hint="用于创作与推理的模型标识。">
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
                  if (providerDraft.apiKey === '••••••••') setProviderDraft((p) => ({ ...p, apiKey: '' }))
                  e.target.select()
                }}
              />
            </AdminFormField>
            <div className="ai-config-action-row">
              <span className="ai-config-action-status" aria-live="polite">
                {testResult || '尚未进行本次检查 · 使用已保存配置'}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 rounded-full"
                disabled={testing || !provider?.configured || saving}
                onClick={() => void runTest()}
              >
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
          </div>
        </section>

        {/* 2. 图像模型服务 */}
        <section className="ai-config-section">
          <div className="ai-config-section__lead">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ai-config-section__title">图像供应商</h3>
              <AdminStatusBadge tone={imageConfigured ? 'success' : 'muted'}>
                <span className="ai-config-status-dot" aria-hidden="true" />
                {imageConfigured ? '已配置' : '未配置'}
              </AdminStatusBadge>
            </div>
            <p className="ai-config-section__desc">
              用于封面候选图多画风绘制以及阅读器内划选插画生成。
            </p>
          </div>
          <div className="ai-config-section__content">
            <div className="grid gap-3 sm:grid-cols-2">
              <AdminFormField label="图像 Base URL" htmlFor="ai-image-base-url" hint="OpenAI 兼容图像接口。">
                <Input
                  id="ai-image-base-url"
                  placeholder="https://api.example.com/v1"
                  value={imageProviderDraft.baseUrl}
                  disabled={savingImageProvider || props.loading || !imageProviderConfig}
                  onChange={(e) => setImageProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                />
              </AdminFormField>
              <AdminFormField label="图像模型" htmlFor="ai-image-model" hint="用于绘制图像的模型标识。">
                <Input
                  id="ai-image-model"
                  placeholder="mimo-v2.5"
                  value={imageProviderDraft.model}
                  disabled={savingImageProvider || props.loading || !imageProviderConfig}
                  onChange={(e) => setImageProviderDraft((p) => ({ ...p, model: e.target.value }))}
                />
              </AdminFormField>
            </div>
            <AdminFormField label="图像 API Key" htmlFor="ai-image-api-key" hint="留空保留当前密钥；如需清空，填入一个空格后保存">
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
            <div className="ai-config-action-row">
              <span className="ai-config-action-status">图像连接由封面生成任务进行端到端验证</span>
              <Button variant="secondary" size="sm" className="shrink-0 rounded-full" asChild>
                <a href="/admin/ai?sub=cover">前往封面生成</a>
              </Button>
            </div>
          </div>
        </section>

        {/* 3. 读者生成策略 */}
        <section className="ai-config-section">
          <div className="ai-config-section__lead">
            <h3 className="ai-config-section__title">读者生成策略</h3>
            <p className="ai-config-section__desc">
              管理读者在前台阅读小说时触发前情提要、回顾与划选插画的权限与消耗限额。
            </p>
          </div>
          <div className="ai-config-section__content">
            <fieldset className="grid gap-2.5" disabled={!settings || saving || props.loading}>
              <legend className="text-xs font-medium text-foreground">划选生成图片：允许使用的角色</legend>
              <p className="text-xs text-muted-foreground leading-relaxed">
                在阅读器划选文字后生成插画，并自动发布为该段落的想法。取消所有角色可关闭功能。
              </p>
              <div className="flex flex-wrap gap-2.5 pt-0.5">
                {([['admin', '管理员'], ['reader', '读者']] as const).map(([role, label]) => {
                  const checked = imageRolesDraft.includes(role)
                  return (
                    <label key={role} className="ai-role-pill" data-active={checked || undefined}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        disabled={!settings || saving || props.loading}
                        onChange={(event) =>
                          setImageRolesDraft((roles) =>
                            event.target.checked ? [...roles, role] : roles.filter((item) => item !== role)
                          )
                        }
                      />
                      <span className="ai-role-pill__dot" aria-hidden="true" />
                      <span>{label}</span>
                    </label>
                  )
                })}
              </div>
              <div className="pt-1">
                <AdminFormField
                  label="每人每日图片生成上限"
                  htmlFor="ai-selection-image-quota"
                  hint="独立于文本配额；管理员和读者均受此限制，失败任务也计入。0 表示关闭。"
                >
                  <Input
                    id="ai-selection-image-quota"
                    type="number"
                    min={0}
                    max={100}
                    value={imageQuotaDraft}
                    disabled={!settings || saving || props.loading}
                    onChange={(event) => setImageQuotaDraft(event.target.value)}
                  />
                </AdminFormField>
              </div>
            </fieldset>

            <div className="ai-config-checkrow">
              <div className="min-w-0 pr-2">
                <span className="block text-sm font-medium text-foreground">允许读者生成前情提要</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">已有缓存优先复用，管理员不受读者配额限制。</span>
              </div>
              <Switch
                checked={recapEnabledDraft}
                disabled={!settings || saving || props.loading}
                onCheckedChange={setRecapEnabledDraft}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <AdminFormField label="每人每日生成上限" htmlFor="ai-daily-quota" hint="命中缓存不计数；0 表示禁止读者触发。">
                <Input
                  id="ai-daily-quota"
                  type="number"
                  min={0}
                  max={1000}
                  value={dailyQuotaDraft}
                  disabled={!settings || props.loading || saving}
                  onChange={(e) => setDailyQuotaDraft(e.target.value)}
                />
              </AdminFormField>
              <AdminFormField label="送入模型的正文字数" htmlFor="ai-max-chars" hint="超出部分截断，影响单次调用成本。">
                <Input
                  id="ai-max-chars"
                  type="number"
                  min={500}
                  max={20000}
                  value={maxCharsDraft}
                  disabled={!settings || props.loading || saving}
                  onChange={(e) => setMaxCharsDraft(e.target.value)}
                />
              </AdminFormField>
            </div>
          </div>
        </section>

        {/* 4. 服务检查与用量 */}
        <section className="ai-config-section">
          <div className="ai-config-section__lead">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ai-config-section__title">服务检查与用量</h3>
              <AdminStatusBadge tone={provider?.configured && imageConfigured ? 'success' : 'muted'}>
                <span className="ai-config-status-dot" aria-hidden="true" />
                {provider?.configured && imageConfigured
                  ? '服务就绪'
                  : provider?.configured
                    ? '仅文本就绪'
                    : imageConfigured
                      ? '仅图像就绪'
                      : '未配置'}
              </AdminStatusBadge>
            </div>
            <p className="ai-config-section__desc">
              监控模型后台连接就绪状态，统计今日与近 30 天实际 Token 消耗与成本。
            </p>
            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <a href="/admin/calls">查看调用明细 →</a>
              </Button>
            </div>
          </div>
          <div className="ai-config-section__content">
            {usage ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="ai-config-metric-tile">
                  <span className="ai-config-metric-tile__label">今日调用</span>
                  <span className="ai-config-metric-tile__value">
                    {usage.today.calls.toLocaleString()}
                    <small>次</small>
                  </span>
                </div>
                <div className="ai-config-metric-tile">
                  <span className="ai-config-metric-tile__label">今日 Token</span>
                  <span className="ai-config-metric-tile__value">
                    {(usage.today.promptTokens + usage.today.completionTokens).toLocaleString()}
                  </span>
                </div>
                <div className="ai-config-metric-tile">
                  <span className="ai-config-metric-tile__label">今日成本</span>
                  <span className="ai-config-metric-tile__value ai-config-metric-tile__value--cost">
                    {formatCost(usage.today.costMillicents)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">暂无用量统计数据</div>
            )}

            {usage && (
              <div className="ai-config-usage-period">
                <span className="font-medium">近 30 天消耗汇总</span>
                <span>
                  {usage.last30d.calls.toLocaleString()} 次调用 · 累计成本 {formatCost(usage.last30d.costMillicents)}
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Claude 标准悬浮保存操作坞 */}
      <AdminFloatingDock reserveSpace role="region" aria-label="AI 配置保存" data-state="open">
        <span className="admin-floating-dock__status" data-dirty={dirty || undefined} role="status">
          {dirty ? '有未保存的修改' : '配置与当前生效值一致'}
        </span>
        <div className="admin-floating-dock__actions">
          <Button
            type="button"
            variant="outline"
            disabled={saving || props.loading || !dirty}
            onClick={() => {
              setProviderDraft(providerValues(props.providerConfig))
              setImageProviderDraft(providerValues(imageProviderConfig))
              resetReaderPolicy()
            }}
          >
            撤销修改
          </Button>
          <Button
            type="button"
            disabled={saving || props.loading || !dirty}
            onClick={() => void saveAll()}
          >
            {saving ? '保存中…' : '保存配置'}
          </Button>
        </div>
      </AdminFloatingDock>
    </div>
  )
}

