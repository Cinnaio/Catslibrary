/** 参数调优：前情提要 / 回顾总结 / AI 创作参数与审计配置。 */
import AdminFormField from '@/components/admin/AdminFormField'
import { useEffect, useRef, useState } from 'react'
import { aiApi, type AiSettings } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { LoadingState } from '@/components/admin/AsyncStates'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function AiParamsPanel(props: { settings: AiSettings | null; loading: boolean; onReload: () => void }) {
  const { toast } = useToast()
  const [localSettings, setLocalSettings] = useState<AiSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLocalSettings(props.settings)
  }, [props.settings])

  const formRef = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(localSettings) !== JSON.stringify(props.settings)

  async function save() {
    if (!localSettings || saving || props.loading || !dirty || !formRef.current?.reportValidity()) return
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
      className="ai-params-panel"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <nav className="ai-params-nav" aria-label="参数分组">
        <span className="text-xs text-muted-foreground">参数分组</span>
        {[
          ['recap', '前情提要'],
          ['catchup', '回顾总结'],
          ['writing', 'AI 创作'],
          ['image', '生图与封面'],
          ['tasks', '任务与运维'],
          ['audit', '审计配置'],
        ].map(([id, label]) => (
          <a key={id} href={`#ai-params-${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <div className="ai-params-sections">
        {/* 前情提要参数 */}
        <Card id="ai-params-recap" className="admin-panel-card ai-params-card ai-params-card--recap">
          <AdminPanelHeading title="前情提要参数" />
          <CardContent className="grid gap-4">
            <p className="ai-params-description">简短回顾当前章节之前的主要信息。</p>
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
              </AdminFormField>
              <AdminFormField label="最大输出 Token" htmlFor="recap-tokens" hint="限制生成长度，防止过长。推荐 500">
                <Input
                  id="recap-tokens"
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
                系统提示词 <span>展开编辑</span>
              </summary>
              <AdminFormField label="系统提示词" htmlFor="recap-prompt" hint="定义 AI 的角色和输出风格">
                {/* 迁移到共享 Textarea 组件：此前手写一长串工具类，与组件内已有一份
                逐字重复。组件自带 field-sizing-content、min-h-16、shadow-xs 与
                text-base(移动端)，与迁移前的计算值不同，故显式中和为
                field-sizing-fixed / min-h-[100px] / shadow-none / text-sm，
                使视觉与行为逐项保持原状。 */}
                <Textarea
                  id="recap-prompt"
                  className="field-sizing-fixed min-h-[100px] shadow-none text-sm"
                  value={localSettings.recapSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, recapSystemPrompt: e.target.value })}
                />
              </AdminFormField>
            </details>
          </CardContent>
        </Card>

        {/* 回顾总结参数 */}
        <Card id="ai-params-catchup" className="admin-panel-card ai-params-card">
          <AdminPanelHeading title="回顾总结参数" />
          <CardContent className="grid gap-4">
            <p className="ai-params-description">为一段时间未阅读的读者恢复故事上下文。</p>
            <div className="ai-form-grid grid gap-3 sm:grid-cols-3">
              <AdminFormField label="隔多少天算「很久没读」" htmlFor="catchup-stale-days" hint="距上次阅读超过该天数才显示回顾入口，1-90 天">
                <Input
                  id="catchup-stale-days"
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
              </AdminFormField>
              <AdminFormField label="最大输出 Token" htmlFor="catchup-tokens" hint="推荐 800">
                <Input
                  id="catchup-tokens"
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

        <Card id="ai-params-writing" className="admin-panel-card ai-params-card ai-params-card--writing">
          <AdminPanelHeading title="AI 创作参数" />
          <CardContent className="grid gap-4">
            <p className="ai-params-description">控制大纲、章节与续写的生成长度和变化程度。</p>
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
              </AdminFormField>
              <AdminFormField label="最大输出 Token" htmlFor="writing-tokens" hint="控制大纲、章节和续写的最大长度，最高 1,000,000 Token">
                <Input
                  id="writing-tokens"
                  type="number"
                  min={300}
                  max={1000000}
                  value={localSettings.writingMaxTokens}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, writingMaxTokens: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <div className="ai-form-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AdminFormField label="风格画像 Token" htmlFor="style-tokens" hint="风格画像提取的最大输出，推理模型需留足思考余量，推荐 1500">
                <Input
                  id="style-tokens"
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
                创作系统提示词 <span>展开编辑</span>
              </summary>
              <AdminFormField label="创作系统提示词" htmlFor="writing-prompt" hint="定义 AI 创作的角色、文风和输出约束">
                {/* 同上：中和组件自带的 field-sizing-content / min-h-16 / shadow-xs，
                保持迁移前的 120px 固定高度与无阴影。 */}
                <Textarea
                  id="writing-prompt"
                  className="field-sizing-fixed min-h-[120px] shadow-none text-sm"
                  value={localSettings.writingSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, writingSystemPrompt: e.target.value })}
                />
              </AdminFormField>
            </details>
          </CardContent>
        </Card>

        <Card id="ai-params-image" className="admin-panel-card ai-params-card">
          <AdminPanelHeading title="AI 生图与封面参数" />
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

        {/* 任务与运维 */}
        <Card id="ai-params-tasks" className="admin-panel-card ai-params-card">
          <AdminPanelHeading title="任务与运维" />
          <CardContent className="ai-form-grid grid gap-3 sm:grid-cols-2">
            <AdminFormField label="创作任务并发上限" htmlFor="max-concurrent-tasks" hint="同时运行的大纲/章节/续写任务数上限，超出时新任务被拒绝，1-10 个">
              <Input
                id="max-concurrent-tasks"
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
        <Card id="ai-params-audit" className="admin-panel-card ai-params-card ai-params-card--audit">
          <AdminPanelHeading title="审计配置" />
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
          {dirty ? '有未保存的参数修改' : '参数与生效值一致'}
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
