import '@/styles/input-fields.css'
/** 配置面板：供应商信息、开关、配额（分组确认后保存）。 */
import FormField from "@/components/shared/FormField"
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { aiApi, type AiSettings, type AiUsageSummary, type AiProviderConfig } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import EmptyState from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Panel } from '@/components/ui/panel'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCost, type Provider } from './shared'
import AiProviderPresets from './AiProviderPresets'
import styles from './ai-config.module.css'

const CONFIG_TABS = [
  { id: 'providers', label: '模型供应商' },
  { id: 'reader', label: '读者生成策略' },
  { id: 'service', label: '服务监控与用量' },
] as const
type ConfigTabId = (typeof CONFIG_TABS)[number]['id']

function usageCost(summary: AiUsageSummary) {
  if (!summary.calls) return '—'
  if (summary.costReportedCalls === 0) return '未回传'
  if (summary.costReportedCalls === undefined && !summary.costMillicents) return '—'
  return formatCost(summary.costMillicents)
}

function costCoverage(summary: AiUsageSummary) {
  if (!summary.calls) return '暂无调用'
  return summary.costReportedCalls === undefined
    ? '回传覆盖次数未知'
    : `${summary.costReportedCalls.toLocaleString()} / ${summary.calls.toLocaleString()} 次回传费用`
}

export default function AiConfigPanel(props: {
  settings: AiSettings | null
  provider: Provider | null
  providerConfig: AiProviderConfig | null
  imageProviderConfig: AiProviderConfig | null
  imageProvider?: Provider | null
  loading: boolean
  onReload: () => void
  onBusyChange?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<ConfigTabId>('providers')
  const [textEditorOpen, setTextEditorOpen] = useState(!props.providerConfig?.hasApiKey)
  const [imageEditorOpen, setImageEditorOpen] = useState(!props.imageProviderConfig?.hasApiKey)
  const [usage, setUsage] = useState<{ today: AiUsageSummary; last30d: AiUsageSummary } | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState('')
  const [usageRevision, setUsageRevision] = useState(0)
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
  const imageRolesKey = JSON.stringify(props.settings?.selectionImageRoles ?? ['admin'])

  useEffect(() => {
    setRecapEnabledDraft(!!props.settings?.recapEnabled)
    setImageRolesDraft(props.settings?.selectionImageRoles ?? ['admin'])
    setImageQuotaDraft(String(props.settings?.selectionImageDailyQuota ?? 10))
    setDailyQuotaDraft(props.settings?.dailyQuota !== undefined ? String(props.settings.dailyQuota) : '')
    setMaxCharsDraft(props.settings?.maxChapterChars !== undefined ? String(props.settings.maxChapterChars) : '')
  }, [props.settings?.dailyQuota, props.settings?.maxChapterChars, props.settings?.recapEnabled, imageRolesKey, props.settings?.selectionImageDailyQuota])

  useEffect(() => {
    setTestResult('')
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
    if (props.loading) return
    let alive = true
    setUsageLoading(true)
    setUsageError('')
    async function loadUsage() {
      try {
        const use = await aiApi.usage()
        if (alive) setUsage(use)
      } catch (err) {
        if (alive) setUsageError((err as Error).message || '读取用量失败')
      } finally {
        if (alive) setUsageLoading(false)
      }
    }
    void loadUsage()
    return () => { alive = false }
  }, [props.loading, usageRevision])

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
      setActiveTab('reader')
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
      setActiveTab('reader')
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
        setTestResult('')
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
  useEffect(() => props.onBusyChange?.(saving || testing), [props.onBusyChange, saving, testing])
  useEffect(() => props.onDirtyChange?.(dirty), [props.onDirtyChange, dirty])

  const dirtyCount = (providerDirty ? 1 : 0) + (imageProviderDirty ? 1 : 0) + (readerDirty ? 1 : 0)

  return (
    <Tabs value={activeTab} onValueChange={value => setActiveTab(value as ConfigTabId)} className={styles.workspace}>
      <div className={styles.toolbar}>
        <div className={styles.navigation}>
          <TabsList aria-label="配置分类">
            {CONFIG_TABS.map((tab) => {
              const tabDirty =
                tab.id === 'providers' ? providerDirty || imageProviderDirty : tab.id === 'reader' ? readerDirty : false
              return (
                <TabsTrigger
                  key={tab.id}
                  id={`ai-config-tab-${tab.id}`}
                  value={tab.id}
                  aria-controls={`ai-config-panel-${tab.id}`}
                >
                  {tab.label}
                  {tabDirty && <span className={styles.dirtyDot} role="img" aria-label="有待保存的修改" />}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>
        <Button variant="secondary" size="sm" disabled={props.loading || saving || testing || dirty} onClick={props.onReload} aria-label="刷新 AI 配置">
          {props.loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <div className={styles.sections}>
        {/* 1. 模型供应商面板 */}
        <div
          role="tabpanel"
          id="ai-config-panel-providers"
          aria-labelledby="ai-config-tab-providers"
          hidden={activeTab !== 'providers'}
          tabIndex={0}
          className={styles.providers}
        >
            {/* 文本供应商 */}
            <Panel asChild>
            <section className={styles.providerSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3>文本服务</h3>
                  <p>用于创作、小说分析、章节摘要与回顾生成。</p>
                </div>
                <AdminStatusBadge tone={provider?.configured ? 'success' : 'muted'}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  {provider?.configured ? '已配置' : '未配置'}
                </AdminStatusBadge>
              </div>
              <AiProviderPresets scope="text" config={props.providerConfig} draft={providerDraft} disabled={saving || props.loading || testing} dirty={providerDirty} onBusy={setSaving} onApplied={() => { setTestResult(''); props.onReload() }} />
              <details className={styles.connection} open={textEditorOpen} onToggle={event => setTextEditorOpen(event.currentTarget.open)}>
                <summary><span>连接设置</span><span>{providerDirty ? '有待保存的修改' : '地址、模型与密钥'}<ChevronDown aria-hidden="true" /></span></summary>
                <div className={styles.editor} role="group" aria-label="编辑当前文本配置">
                  <div className={styles.fieldGrid}>
                    <FormField label="Base URL" htmlFor="ai-base-url" hint="OpenAI 兼容端点。">
                      <Input
                        id="ai-base-url"
                        placeholder="https://api.deepseek.com/v1"
                        value={providerDraft.baseUrl}
                        disabled={savingProvider || props.loading}
                        onChange={(e) => setProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="模型" htmlFor="ai-model">
                      <Input
                        id="ai-model"
                        placeholder="deepseek-v4-flash"
                        value={providerDraft.model}
                        disabled={savingProvider || props.loading}
                        onChange={(e) => setProviderDraft((p) => ({ ...p, model: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="API Key" htmlFor="ai-api-key" hint="留空保留当前密钥；如需清空，填入一个空格后保存">
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
                  </FormField>
                </div>
              </details>
              <div className={styles.serviceActions}>
                <span aria-live="polite">{testResult || '尚未进行本次检查 · 使用已保存配置'}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={testing || !provider?.configured || saving}
                  onClick={() => void runTest()}
                >
                  {testing ? '测试中…' : '测试连接'}
                </Button>
              </div>
            </section>
            </Panel>

            {/* 图像供应商 */}
            <Panel asChild>
            <section className={styles.providerSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3>图像服务</h3>
                  <p>用于封面候选图与阅读器划选插画生成。</p>
                </div>
                <AdminStatusBadge tone={imageConfigured ? 'success' : 'muted'}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  {imageConfigured ? '已配置' : '未配置'}
                </AdminStatusBadge>
              </div>
              <AiProviderPresets scope="image" config={imageProviderConfig} draft={imageProviderDraft} disabled={saving || props.loading || testing} dirty={imageProviderDirty} onBusy={setSaving} onApplied={props.onReload} />
              <details className={styles.connection} open={imageEditorOpen} onToggle={event => setImageEditorOpen(event.currentTarget.open)}>
                <summary><span>连接设置</span><span>{imageProviderDirty ? '有待保存的修改' : '地址、模型与密钥'}<ChevronDown aria-hidden="true" /></span></summary>
                <div className={styles.editor} role="group" aria-label="编辑当前图像配置">
                  <div className={styles.fieldGrid}>
                    <FormField label="图像 Base URL" htmlFor="ai-image-base-url" hint="OpenAI 兼容图像接口。">
                      <Input
                        id="ai-image-base-url"
                        placeholder="https://api.example.com/v1"
                        value={imageProviderDraft.baseUrl}
                        disabled={savingImageProvider || props.loading || !imageProviderConfig}
                        onChange={(e) => setImageProviderDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="图像模型" htmlFor="ai-image-model">
                      <Input
                        id="ai-image-model"
                        placeholder="mimo-v2.5"
                        value={imageProviderDraft.model}
                        disabled={savingImageProvider || props.loading || !imageProviderConfig}
                        onChange={(e) => setImageProviderDraft((p) => ({ ...p, model: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="图像 API Key" htmlFor="ai-image-api-key" hint="留空保留当前密钥；如需清空，填入一个空格后保存">
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
                  </FormField>
                </div>
              </details>
              <div className={styles.serviceActions}>
                <span>图像连接由封面生成任务进行端到端验证</span>
                <Button variant="secondary" size="sm" asChild>
                  <a href="/admin/ai?sub=cover">前往封面生成</a>
                </Button>
              </div>
            </section>
            </Panel>
        </div>

        {/* 2. 读者生成策略：按实际功能分别设置权限和限额。 */}
        <div
          role="tabpanel"
          id="ai-config-panel-reader"
          aria-labelledby="ai-config-tab-reader"
          hidden={activeTab !== 'reader'}
          tabIndex={0}
          className={styles.policyGrid}
        >
          <Panel asChild>
            <section className={styles.policyCard} aria-labelledby="ai-recap-policy-title">
              <header className={styles.sectionHeading}>
                <div>
                  <h3 id="ai-recap-policy-title">文本生成</h3>
                  <p>管理前情提要入口，以及提要与回顾共用的读者额度。</p>
                </div>
              </header>
              <label className={styles.featureToggle} htmlFor="ai-reader-recap-enabled">
                <span>
                  <span className={styles.controlLabel}>允许读者生成前情提要</span>
                  <span className={styles.hint}>关闭后，读者不能发起新的提要生成。</span>
                </span>
                <Switch
                  id="ai-reader-recap-enabled"
                  checked={recapEnabledDraft}
                  disabled={!settings || saving || props.loading}
                  onCheckedChange={setRecapEnabledDraft}
                />
              </label>
              <div className={styles.limitFields}>
                <FormField className={styles.limitField} label="每人每日生成上限" htmlFor="ai-daily-quota" hint="次 / 人 / 天；缓存命中不计数，0 表示禁止。">
                  <Input
                    id="ai-daily-quota"
                    type="number"
                    min={0}
                    max={1000}
                    value={dailyQuotaDraft}
                    disabled={!settings || props.loading || saving}
                    onChange={(e) => setDailyQuotaDraft(e.target.value)}
                  />
                </FormField>
                <FormField className={styles.limitField} label="送入模型的正文字数" htmlFor="ai-max-chars" hint="500–20000 字；超出部分截断，影响单次成本。">
                  <Input
                    id="ai-max-chars"
                    type="number"
                    min={500}
                    max={20000}
                    value={maxCharsDraft}
                    disabled={!settings || props.loading || saving}
                    onChange={(e) => setMaxCharsDraft(e.target.value)}
                  />
                </FormField>
              </div>
              <p className={styles.policyFootnote}>管理员不受读者文本配额限制。</p>
            </section>
          </Panel>
          <Panel asChild>
            <section className={styles.policyCard} aria-labelledby="ai-image-policy-title">
              <header className={styles.sectionHeading}>
                <div>
                  <h3 id="ai-image-policy-title">划选插画</h3>
                  <p>为选中文字生成插画，结果发布为该段落的想法。</p>
                </div>
              </header>
              <fieldset className={styles.roleSettings} disabled={!settings || saving || props.loading}>
                <legend className={styles.controlLabel}>允许使用的角色</legend>
                <div className={styles.roleOptions}>
                  {([['admin', '管理员'], ['reader', '读者']] as const).map(([role, label]) => (
                    <label key={role} className={styles.roleOption} htmlFor={`ai-image-role-${role}`}>
                      <Checkbox
                        id={`ai-image-role-${role}`}
                        checked={imageRolesDraft.includes(role)}
                        disabled={!settings || saving || props.loading}
                        onCheckedChange={checked => setImageRolesDraft(roles => checked === true ? [...roles.filter(item => item !== role), role] : roles.filter(item => item !== role))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <p className={styles.hint}>取消全部角色可关闭划选插画。</p>
              </fieldset>
              <FormField className={styles.limitField} label="每人每日图片生成上限" htmlFor="ai-selection-image-quota" hint="张 / 人 / 天；0 表示关闭，最高 100。">
                <Input
                  id="ai-selection-image-quota"
                  type="number"
                  min={0}
                  max={100}
                  value={imageQuotaDraft}
                  disabled={!settings || saving || props.loading}
                  onChange={(event) => setImageQuotaDraft(event.target.value)}
                />
              </FormField>
              <p className={styles.policyFootnote}>图片配额独立计算，管理员和读者均受限，失败任务也计入。</p>
            </section>
          </Panel>
        </div>

        {/* 3. 服务与用量：统计纸面与连接状态各自独立。 */}
        <div
          role="tabpanel"
          id="ai-config-panel-service"
          aria-labelledby="ai-config-tab-service"
          hidden={activeTab !== 'service'}
          tabIndex={0}
          className={styles.monitorGrid}
        >
          <Panel asChild>
            <section className={styles.usageCard} aria-labelledby="ai-usage-title" aria-busy={usageLoading || props.loading}>
              <header className={styles.sectionHeading}>
                <div>
                  <h3 id="ai-usage-title">调用用量</h3>
                  <p>{usageLoading || props.loading ? '正在更新统计…' : '今日与近 30 天的实际调用记录。'}</p>
                </div>
                <Button variant="ghost" size="sm" asChild><a href="/admin/calls">调用明细 ↗</a></Button>
              </header>
              {usageError && usage && <InlineError message={`统计更新失败，保留上次结果：${usageError}`} onRetry={() => setUsageRevision(value => value + 1)} />}
              {!usage ? (
                usageLoading || props.loading ? <LoadingState label="正在读取调用用量…" rows={3} />
                  : usageError ? <ErrorState message={`用量读取失败：${usageError}`} onRetry={() => setUsageRevision(value => value + 1)} />
                    : <EmptyState message="暂无用量统计" hint="发起模型调用后，可在这里查看次数、Token 与回传费用。" />
              ) : (
                <>
                  <div className={styles.usageToday}>
                    <h4 className={styles.periodLabel}>今日</h4>
                    <dl className={styles.usageMetrics}>
                      <div className={styles.metric}>
                        <dt>调用次数</dt>
                        <dd className={styles.metricValue}>{usage.today.calls.toLocaleString()}<small>次</small></dd>
                      </div>
                      <div className={styles.metric}>
                        <dt>Token 消耗</dt>
                        <dd className={styles.metricValue}>{(usage.today.promptTokens + usage.today.completionTokens).toLocaleString()}</dd>
                      </div>
                      <div className={styles.metric}>
                        <dt>已回传费用</dt>
                        <dd className={styles.metricValue}>{usageCost(usage.today)}</dd>
                        <span className={styles.metricNote}>{costCoverage(usage.today)}</span>
                      </div>
                    </dl>
                  </div>
                  <div className={styles.usageHistory}>
                    <h4 className={styles.periodLabel}>近 30 天<span>含今天</span></h4>
                    <dl className={styles.usageMetrics}>
                      <div className={styles.metric}><dt>调用次数</dt><dd>{usage.last30d.calls.toLocaleString()}<small> 次</small></dd></div>
                      <div className={styles.metric}><dt>Token 消耗</dt><dd>{(usage.last30d.promptTokens + usage.last30d.completionTokens).toLocaleString()}</dd></div>
                      <div className={styles.metric}><dt>已回传费用</dt><dd>{usageCost(usage.last30d)}</dd><span className={styles.metricNote}>{costCoverage(usage.last30d)}</span></div>
                    </dl>
                  </div>
                  <p className={styles.hint}>费用仅汇总已回传记录，未统一币种；详细币种见调用明细。</p>
                </>
              )}
            </section>
          </Panel>
          <Panel asChild>
            <section className={styles.connectionCard} aria-labelledby="ai-connection-title">
              <header className={styles.sectionHeading}>
                <div><h3 id="ai-connection-title">连接状态</h3><p>查看当前生效的模型配置。</p></div>
              </header>
              <div className={styles.connectionRows}>
                {[
                  { name: '文本服务', configured: !!provider?.configured, model: props.providerConfig?.model, address: props.providerConfig?.baseUrl },
                  { name: '图像服务', configured: imageConfigured, model: imageProviderConfig?.model, address: imageProviderConfig?.baseUrl },
                ].map(service => (
                  <div key={service.name} className={styles.connectionRow}>
                    <div className={styles.connectionIdentity}>
                      <span className={styles.controlLabel}>{service.name}</span>
                      <AdminStatusBadge tone={service.configured ? 'success' : 'muted'}>{service.configured ? '已配置' : '未配置'}</AdminStatusBadge>
                    </div>
                    <p className={styles.connectionModel}>{service.model || '尚未设置模型'}</p>
                    <p className={styles.hint}>{service.address || '尚未设置接口地址'}</p>
                  </div>
                ))}
              </div>
              <p className={styles.hint}>已配置不代表连接正常。文本连接可在下方测试，图像连接通过封面生成确认。</p>
              {testResult && <p className={styles.hint} role="status">{testResult}</p>}
              <div className={styles.connectionActions}>
                <Button variant="secondary" size="sm" disabled={testing || !provider?.configured || saving || props.loading} onClick={() => void runTest()}>{testing ? '测试中…' : '测试文本连接'}</Button>
                <Button variant="ghost" size="sm" disabled={saving || testing} onClick={() => {
                  setActiveTab('providers')
                  document.getElementById('ai-config-tab-providers')?.focus()
                }}>管理模型连接</Button>
              </div>
            </section>
          </Panel>
        </div>
      </div>

      {!dirty && <p className={styles.savedStatus} role="status">配置与当前生效值一致</p>}
      {dirty && <AdminFloatingDock reserveSpace role="region" aria-label="AI 配置保存" data-state="open">
        <span className="admin-floating-dock__status" data-dirty={dirty || undefined} role="status">
          {dirtyCount} 项待保存 · 切换分类保留修改
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
      </AdminFloatingDock>}
    </Tabs>
  )
}

