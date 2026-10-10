/** 参数调优：前情提要 / 回顾总结 / AI 创作参数与审计配置。 */
import AdminFormField from '@/components/admin/AdminFormField'
import { useEffect, useRef, useState } from 'react'
import { aiApi, type AiSettings } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { LoadingState } from '@/components/admin/AsyncStates'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PARAM_GROUPS = [
  { id: 'recap', label: '前情提要', keys: ['recapTemperature', 'recapMaxTokens', 'recapSystemPrompt'] },
  { id: 'catchup', label: '回顾总结', keys: ['catchupStaleDays', 'catchupMaxChapters', 'catchupTemperature', 'catchupMaxTokens', 'catchupEnabled'] },
  {
    id: 'writing',
    label: 'AI 创作',
    keys: [
      'writingTemperature',
      'writingMaxTokens',
      'styleProfileMaxTokens',
      'plotStateMaxTokens',
      'relationshipProfileMaxTokens',
      'titleMaxTokens',
      'writingSystemPrompt',
    ],
  },
  { id: 'image', label: '生图与封面', keys: ['imageSize', 'imageQuality', 'imageResponseFormat', 'coverPromptMaxChars'] },
  {
    id: 'import',
    label: '导入复核',
    keys: ['importAiReviewEnabled', 'importAiMaxCandidates', 'importAiMaxTokens', 'importAiSystemPrompt'],
  },
  { id: 'tasks', label: '任务与运维', keys: ['maxConcurrentWritingTasks', 'taskRetentionDays'] },
  { id: 'audit', label: '审计配置', keys: ['logIpAddress', 'logUserAgent'] },
] as const satisfies readonly { id: string; label: string; keys: readonly (keyof AiSettings)[] }[]
type ParamGroupId = (typeof PARAM_GROUPS)[number]['id']

export default function AiParamsPanel(props: { settings: AiSettings | null; loading: boolean; onReload: () => void }) {
  const { toast } = useToast()
  const [localSettings, setLocalSettings] = useState<AiSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeGroup, setActiveGroup] = useState<ParamGroupId>('recap')
  const pendingInvalid = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setLocalSettings(props.settings)
  }, [props.settings])

  const formRef = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(localSettings) !== JSON.stringify(props.settings)

  useEffect(() => {
    const invalid = pendingInvalid.current
    if (!invalid) return
    pendingInvalid.current = null
    invalid.closest('details')?.setAttribute('open', '')
    invalid.reportValidity()
    invalid.focus()
  }, [activeGroup])

  const groupChanges = PARAM_GROUPS.map((group) => group.keys.filter((key) => localSettings?.[key] !== props.settings?.[key]).length)
  const changeCount = groupChanges.reduce((total, count) => total + count, 0)

  async function save() {
    if (!localSettings || saving || props.loading || !dirty || !formRef.current) return
    const invalid = Array.from(formRef.current.querySelectorAll<HTMLInputElement>('input[type="number"]')).find((input) => !input.checkValidity())
    if (invalid) {
      const group = invalid.closest('[role="tabpanel"]')?.id.replace('ai-params-', '') as ParamGroupId
      if (group !== activeGroup) {
        pendingInvalid.current = invalid
        setActiveGroup(group)
      } else {
        invalid.reportValidity()
        invalid.focus()
      }
      return
    }
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
    return (
      <div className="admin-panel-card rounded-xl border border-border bg-card p-6">
        <LoadingState label="正在加载参数设置" />
      </div>
    )
  }

  return (
    <form
      ref={formRef}
      noValidate
      className="ai-params-panel"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="ai-parameter-tabs" role="tablist" aria-label="参数分类">
        {PARAM_GROUPS.map((group, index) => (
          <button
            key={group.id}
            id={`ai-param-tab-${group.id}`}
            type="button"
            role="tab"
            aria-selected={activeGroup === group.id}
            aria-controls={`ai-params-${group.id}`}
            tabIndex={activeGroup === group.id ? 0 : -1}
            onClick={() => setActiveGroup(group.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % PARAM_GROUPS.length
                  : event.key === 'ArrowLeft'
                    ? (index + PARAM_GROUPS.length - 1) % PARAM_GROUPS.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? PARAM_GROUPS.length - 1
                        : null
              if (next === null) return
              event.preventDefault()
              const targetGroup = PARAM_GROUPS[next]
              if (!targetGroup) return
              setActiveGroup(targetGroup.id)
              document.getElementById(`ai-param-tab-${targetGroup.id}`)?.focus()
            }}
          >
            {group.label}
            {(groupChanges[index] ?? 0) > 0 && <span className="ai-parameter-tab-dot" role="img" aria-label={`${groupChanges[index]} 项待保存`} />}
          </button>
        ))}
      </div>
      <div className="ai-params-sections">
        {/* 前情提要参数 */}
        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-recap"
          hidden={activeGroup !== 'recap'}
          id="ai-params-recap"
          className="admin-panel-card ai-params-card ai-params-card--recap"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>前情提要参数</h3>
              <p>简短回顾当前章节之前的主要信息。</p>
            </div>
            <span className="ai-parameter-count">2 项参数</span>
          </div>
          <CardContent className="grid gap-4">
            <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
              <AdminFormField label="创意度（Temperature）" className="ai-temperature-field" htmlFor="recap-temp">
                <Input
                  id="recap-temp"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={localSettings.recapTemperature}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, recapTemperature: Number(e.target.value) })}
                />
                <output htmlFor="recap-temp">{localSettings.recapTemperature}</output>
                <div className="ai-parameter-range-guide" aria-hidden="true">
                  <span>更稳定 · 0</span>
                  <span>更灵活 · 1</span>
                </div>
              </AdminFormField>
              <AdminFormField label="最大输出 Token" htmlFor="recap-tokens" hint="限制生成长度，防止过长。推荐 500">
                <Input
                  id="recap-tokens"
                  required
                  type="number"
                  min={100}
                  max={2000}
                  value={localSettings.recapMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, recapMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <details className="ai-prompt-details">
              <summary>
                系统提示词 <span>按需展开编辑</span>
              </summary>
              <AdminFormField label="系统提示词" htmlFor="recap-prompt" hint="定义 AI 的角色和输出风格">
                <Textarea
                  id="recap-prompt"
                  className="field-sizing-fixed min-h-[160px] shadow-none text-sm"
                  value={localSettings.recapSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, recapSystemPrompt: e.target.value })}
                />
              </AdminFormField>
            </details>
          </CardContent>
        </Card>

        {/* 回顾总结参数 */}
        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-catchup"
          hidden={activeGroup !== 'catchup'}
          id="ai-params-catchup"
          className="admin-panel-card ai-params-card"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>回顾总结参数</h3>
              <p>为一段时间未阅读的读者恢复故事上下文。</p>
            </div>
            <span className="ai-parameter-count">4 项参数</span>
          </div>
          <CardContent className="grid gap-4">
            <div className="ai-form-grid grid gap-3 sm:grid-cols-3">
              <AdminFormField label="隔多少天算「很久没读」" htmlFor="catchup-stale-days" hint="距上次阅读超过该天数才显示回顾入口，1-90 天">
                <Input
                  id="catchup-stale-days"
                  required
                  type="number"
                  min={1}
                  max={90}
                  value={localSettings.catchupStaleDays}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, catchupStaleDays: Number(e.target.value) })}
                />
              </AdminFormField>
              <AdminFormField label="最多回顾章节数" htmlFor="catchup-chapters" hint="1-10 章">
                <Input
                  id="catchup-chapters"
                  required
                  type="number"
                  min={1}
                  max={10}
                  value={localSettings.catchupMaxChapters}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, catchupMaxChapters: Number(e.target.value) })}
                />
              </AdminFormField>
              <AdminFormField label="创意度" className="ai-temperature-field" htmlFor="catchup-temp">
                <Input
                  id="catchup-temp"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={localSettings.catchupTemperature}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, catchupTemperature: Number(e.target.value) })}
                />
                <output htmlFor="catchup-temp">{localSettings.catchupTemperature}</output>
                <div className="ai-parameter-range-guide" aria-hidden="true">
                  <span>更稳定 · 0</span>
                  <span>更灵活 · 1</span>
                </div>
              </AdminFormField>
              <AdminFormField label="最大输出 Token" htmlFor="catchup-tokens" hint="推荐 800">
                <Input
                  id="catchup-tokens"
                  required
                  type="number"
                  min={100}
                  max={3000}
                  value={localSettings.catchupMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, catchupMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">回来接着读功能</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">为久未阅读的读者合成连贯回顾</span>
              </span>
              <Switch
                checked={localSettings.catchupEnabled}
                disabled={props.loading || saving}
                onCheckedChange={(v) => setLocalSettings({ ...localSettings, catchupEnabled: v })}
              />
            </label>{' '}
          </CardContent>
        </Card>

        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-writing"
          hidden={activeGroup !== 'writing'}
          id="ai-params-writing"
          className="admin-panel-card ai-params-card ai-params-card--writing"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>AI 创作参数</h3>
              <p>控制大纲、章节与续写的生成长度和变化程度。</p>
            </div>
            <span className="ai-parameter-count">6 项参数</span>
          </div>
          <CardContent className="grid gap-4">
            <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
              <AdminFormField label="创意度（Temperature）" className="ai-temperature-field" htmlFor="writing-temp">
                <Input
                  id="writing-temp"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={localSettings.writingTemperature}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, writingTemperature: Number(e.target.value) })}
                />
                <output htmlFor="writing-temp">{localSettings.writingTemperature}</output>
                <div className="ai-parameter-range-guide" aria-hidden="true">
                  <span>更稳定 · 0</span>
                  <span>更灵活 · 1</span>
                </div>
              </AdminFormField>
              <AdminFormField label="最大输出 Token" htmlFor="writing-tokens" hint="控制大纲、章节和续写的最大长度，最高 1,000,000 Token">
                <Input
                  id="writing-tokens"
                  required
                  type="number"
                  min={300}
                  max={1000000}
                  value={localSettings.writingMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, writingMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <h4 className="ai-parameter-subtitle">分析与辅助生成</h4>
            <div className="ai-form-grid ai-parameter-analysis grid gap-3 sm:grid-cols-2">
              <AdminFormField label="风格画像 Token" htmlFor="style-tokens" hint="风格画像提取的最大输出，推理模型需留足思考余量，推荐 1500">
                <Input
                  id="style-tokens"
                  required
                  type="number"
                  min={200}
                  max={1000000}
                  value={localSettings.styleProfileMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, styleProfileMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
              <AdminFormField label="情节状态 Token" htmlFor="plot-tokens" hint="情节状态提取的最大输出，结构化四块天然较长，推荐 3000">
                <Input
                  id="plot-tokens"
                  required
                  type="number"
                  min={300}
                  max={1000000}
                  value={localSettings.plotStateMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, plotStateMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
              <AdminFormField label="关系画像 Token" htmlFor="relationship-tokens" hint="关系画像提取的最大输出，角色关系动态/心理边界，推荐 1200">
                <Input
                  id="relationship-tokens"
                  required
                  type="number"
                  min={200}
                  max={1000000}
                  value={localSettings.relationshipProfileMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, relationshipProfileMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
              <AdminFormField label="章节标题 Token" htmlFor="title-tokens" hint="章节标题生成的最大输出，推荐 200">
                <Input
                  id="title-tokens"
                  required
                  type="number"
                  min={50}
                  max={2000}
                  value={localSettings.titleMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, titleMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <details className="ai-prompt-details">
              <summary>
                创作系统提示词 <span>按需展开编辑</span>
              </summary>
              <AdminFormField label="创作系统提示词" htmlFor="writing-prompt" hint="定义 AI 创作的角色、文风和输出约束">
                <Textarea
                  id="writing-prompt"
                  className="field-sizing-fixed min-h-[160px] shadow-none text-sm"
                  value={localSettings.writingSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, writingSystemPrompt: e.target.value })}
                />
              </AdminFormField>
            </details>
          </CardContent>
        </Card>

        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-image"
          hidden={activeGroup !== 'image'}
          id="ai-params-image"
          className="admin-panel-card ai-params-card"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>AI 生图与封面参数</h3>
              <p>为封面工作台提供默认图像设置。</p>
            </div>
            <span className="ai-parameter-count">4 项参数</span>
          </div>
          <CardContent className="ai-form-grid grid gap-4 sm:grid-cols-3">
            <AdminFormField label="图像尺寸" htmlFor="image-size">
              <Select
                value={localSettings.imageSize}
                disabled={props.loading || saving}
                onValueChange={(value) => setLocalSettings({ ...localSettings, imageSize: value })}
              >
                <SelectTrigger id="image-size" className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="1024x1024">1024 × 1024</SelectItem>
                  <SelectItem value="1792x1024">1792 × 1024（横向）</SelectItem>
                  <SelectItem value="1024x1792">1024 × 1792（纵向）</SelectItem>
                  <SelectItem value="512x512">512 × 512</SelectItem>
                </SelectContent>
              </Select>
            </AdminFormField>
            <AdminFormField label="图像质量" htmlFor="image-quality">
              <Select
                value={localSettings.imageQuality}
                disabled={props.loading || saving}
                onValueChange={(value) => setLocalSettings({ ...localSettings, imageQuality: value })}
              >
                <SelectTrigger id="image-quality" className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="standard">标准</SelectItem>
                  <SelectItem value="hd">高清（HD）</SelectItem>
                </SelectContent>
              </Select>
            </AdminFormField>
            <AdminFormField label="返回格式" htmlFor="image-response-format">
              <Select
                value={localSettings.imageResponseFormat}
                disabled={props.loading || saving}
                onValueChange={(value) => setLocalSettings({ ...localSettings, imageResponseFormat: value })}
              >
                <SelectTrigger id="image-response-format" className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="b64_json">Base64</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                </SelectContent>
              </Select>
            </AdminFormField>
            <AdminFormField
              label="封面描述词上限"
              htmlFor="cover-prompt-max-chars"
              className="sm:col-span-2"
              hint="封面生成页可编辑的描述词最大字符数，默认 2000，允许 100–10000。"
            >
              <Input
                id="cover-prompt-max-chars"
                required
                type="number"
                min={100}
                max={10000}
                value={localSettings.coverPromptMaxChars}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, coverPromptMaxChars: Number(e.target.value) })}
              />
            </AdminFormField>
          </CardContent>
        </Card>

        {/* 导入复核 */}
        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-import"
          hidden={activeGroup !== 'import'}
          id="ai-params-import"
          className="admin-panel-card ai-params-card"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>导入复核</h3>
              <p>用模型裁决章节边界的少数疑难行，减少手工修规则。</p>
            </div>
            <span className="ai-parameter-count">4 项参数</span>
          </div>
          <CardContent className="grid gap-4">
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">启用导入 AI 复核</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  确定性解析仍是主链路；开启后可在导入预览页对证据不足的行运行复核
                </span>
              </span>
              <Switch
                checked={localSettings.importAiReviewEnabled}
                disabled={props.loading || saving}
                onCheckedChange={(v) => setLocalSettings({ ...localSettings, importAiReviewEnabled: v })}
              />
            </label>
            <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
              <AdminFormField label="单次复核候选行上限" htmlFor="import-ai-candidates" hint="只送证据不足的行，超出部分不送模型，10-300 行">
                <Input
                  id="import-ai-candidates"
                  required
                  type="number"
                  min={10}
                  max={300}
                  value={localSettings.importAiMaxCandidates}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, importAiMaxCandidates: Number(e.target.value) })}
                />
              </AdminFormField>
              <AdminFormField label="复核输出 Token 上限" htmlFor="import-ai-tokens" hint="只需返回行号数组，200-8000">
                <Input
                  id="import-ai-tokens"
                  required
                  type="number"
                  min={200}
                  max={8000}
                  value={localSettings.importAiMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, importAiMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <details className="ai-prompt-details">
              <summary>
                复核提示词 <span>按需展开编辑</span>
              </summary>
              <AdminFormField
                label="系统提示词"
                htmlFor="import-ai-prompt"
                hint="必须保留「只输出 JSON 行号数组」的约定，模型回结构化长文会让解析变成新的失败点"
              >
                <Textarea
                  id="import-ai-prompt"
                  className="field-sizing-fixed min-h-[200px] shadow-none text-sm"
                  value={localSettings.importAiSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, importAiSystemPrompt: e.target.value })}
                />
              </AdminFormField>
            </details>
          </CardContent>
        </Card>

        {/* 任务与运维 */}
        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-tasks"
          hidden={activeGroup !== 'tasks'}
          id="ai-params-tasks"
          className="admin-panel-card ai-params-card"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>任务与运维</h3>
              <p>管理任务运行数量与操作性记录保留时间。</p>
            </div>
            <span className="ai-parameter-count">2 项参数</span>
          </div>
          <CardContent className="ai-form-grid grid gap-3 sm:grid-cols-2">
            <AdminFormField label="创作任务并发上限" htmlFor="max-concurrent-tasks" hint="同时运行的大纲/章节/续写任务数上限，超出时新任务被拒绝，1-10 个">
              <Input
                id="max-concurrent-tasks"
                required
                type="number"
                min={1}
                max={10}
                value={localSettings.maxConcurrentWritingTasks}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, maxConcurrentWritingTasks: Number(e.target.value) })}
              />
            </AdminFormField>
            <AdminFormField
              label="已结束任务保留天数"
              htmlFor="task-retention-days"
              hint="服务启动时清理更早的已完成/失败/取消任务，用量审计不受影响，7-365 天"
            >
              <Input
                id="task-retention-days"
                required
                type="number"
                min={7}
                max={365}
                value={localSettings.taskRetentionDays}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, taskRetentionDays: Number(e.target.value) })}
              />
            </AdminFormField>
          </CardContent>
        </Card>

        {/* 审计配置 */}
        <Card
          role="tabpanel"
          aria-labelledby="ai-param-tab-audit"
          hidden={activeGroup !== 'audit'}
          id="ai-params-audit"
          className="admin-panel-card ai-params-card ai-params-card--audit"
        >
          <div className="admin-panel-heading ai-parameter-heading">
            <div className="admin-panel-heading__copy">
              <h3>审计配置</h3>
              <p>决定调用审计记录的内容范围。</p>
            </div>
            <span className="ai-parameter-count">2 项开关</span>
          </div>
          <CardContent className="grid gap-3">
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
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
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
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
      </div>
      <div className="ai-params-save">
        <span className="text-sm text-muted-foreground" role="status">
          {changeCount ? `${changeCount} 项参数待保存 · 切换分类保留修改` : '参数与当前生效值一致'}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={props.loading || saving || !dirty} onClick={() => setLocalSettings(props.settings)}>
            撤销修改
          </Button>
          <Button type="submit" disabled={props.loading || saving || !dirty}>
            {saving ? '保存中…' : '保存所有参数'}
          </Button>
        </div>
      </div>
    </form>
  )
}
