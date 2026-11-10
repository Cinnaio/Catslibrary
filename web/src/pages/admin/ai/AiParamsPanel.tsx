import { MotionView } from '@/components/ui/motion'
import { Panel } from '@/components/ui/panel'
/** 创作参数：按用途分组编辑，跨分类保留草稿并确认保存。 */
import FormField from "@/components/shared/FormField"
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { aiApi, type AiSettings } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { LoadingState } from "@/components/shared/AsyncStates"
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import styles from './ai-params.module.css'

function ParameterSection({ title, description, wide = false, children }: { title: string; description: string; wide?: boolean; children: ReactNode }) {
  return <Panel asChild>
    <section className={styles.section} data-wide={wide || undefined}>
      <header className={styles.heading}><h3>{title}</h3><p>{description}</p></header>
      {children}
    </section>
  </Panel>
}

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
      'storyGraphMaxTokens',
      'storyGraphReasoningMode',
      'storyMemoryTimeoutSeconds',
      'storyMemoryEngine',
      'storyMemoryAutoUpdate',
      'storyMemoryChapterMaxTokens',
      'writingReasoningMode',
      'storyMemoryReasoningMode',
      'writingStreamEnabled',
      'storyMemoryStreamEnabled',
      'titleMaxTokens',
      'reviewMaxTokens',
      'writingSystemPrompt',
    ],
  },
  { id: 'image', label: '生图与封面', keys: ['imageSize', 'imageQuality', 'imageResponseFormat', 'coverPromptMaxChars'] },
  {
    id: 'import',
    label: '导入复核',
    keys: ['importAiReviewEnabled', 'importAiMaxCandidates', 'importAiMaxTokens', 'importAiSystemPrompt'],
  },
  {
    id: 'contentRating',
    label: '内容分级',
    keys: ['contentRatingMaxTokens', 'contentRatingReasoningMode'],
  },
  { id: 'tasks', label: '任务与运维', keys: ['maxConcurrentWritingTasks', 'taskRetentionDays'] },
  { id: 'audit', label: '审计配置', keys: ['logIpAddress', 'logUserAgent'] },
] as const satisfies readonly { id: string; label: string; keys: readonly (keyof AiSettings)[] }[]
type ParamGroupId = (typeof PARAM_GROUPS)[number]['id']

export default function AiParamsPanel(props: { settings: AiSettings | null; loading: boolean; onReload: () => void; group?: string | null; onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { toast } = useToast()
  const [localSettings, setLocalSettings] = useState<AiSettings | null>(props.settings)
  const [saving, setSaving] = useState(false)
  const [activeGroup, setActiveGroup] = useState<ParamGroupId>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('group') as ParamGroupId
      if (param && PARAM_GROUPS.some((g) => g.id === param)) return param
    }
    return 'recap'
  })
  const pendingInvalid = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const group = props.group
    if (group && PARAM_GROUPS.some(item => item.id === group)) setActiveGroup(group as ParamGroupId)
  }, [props.group])

  useEffect(() => {
    setLocalSettings(props.settings)
  }, [props.settings])

  const formRef = useRef<HTMLFormElement>(null)
  const dirty = localSettings !== null && JSON.stringify(localSettings) !== JSON.stringify(props.settings)
  useEffect(() => props.onBusyChange?.(saving), [props.onBusyChange, saving])
  useEffect(() => props.onDirtyChange?.(dirty), [props.onDirtyChange, dirty])

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
      const changed = PARAM_GROUPS.flatMap(group => group.keys).filter(key => localSettings[key] !== props.settings?.[key])
      await aiApi.saveSettings(Object.fromEntries(changed.map(key => [key, localSettings[key]])))
      toast('已保存参数设置', 'success')
      props.onReload()
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!localSettings) {
    return <Panel><LoadingState label="正在加载参数设置" /></Panel>
  }

  const draft = localSettings
  function toggle(key: 'catchupEnabled' | 'writingStreamEnabled' | 'storyMemoryStreamEnabled' | 'storyMemoryAutoUpdate' | 'importAiReviewEnabled' | 'logIpAddress' | 'logUserAgent', label: string, hint: string) {
    const id = `ai-param-${key}`
    return <label className={styles.toggleRow} htmlFor={id}>
      <span><span id={`${id}-label`} className={styles.toggleTitle}>{label}</span><span id={`${id}-hint`} className={styles.hint}>{hint}</span></span>
      <Switch id={id} aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} checked={draft[key] ?? false} onCheckedChange={value => setLocalSettings({ ...draft, [key]: value })} disabled={props.loading || saving} />
    </label>
  }
  function reasoning(key: 'writingReasoningMode' | 'storyMemoryReasoningMode', label: string, hint: string) {
    return <FormField label={label} htmlFor={key} hint={hint}>
      <Select value={draft[key] ?? 'inherit'} onValueChange={value => setLocalSettings({ ...draft, [key]: value as 'inherit' | 'disabled' | 'low' | 'high' })} disabled={props.loading || saving}>
        <SelectTrigger id={key}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="inherit">跟随供应商</SelectItem><SelectItem value="disabled">关闭思考</SelectItem><SelectItem value="low">低强度思考</SelectItem><SelectItem value="high">高强度思考</SelectItem></SelectContent>
      </Select>
    </FormField>
  }

  return (
    <form ref={formRef} noValidate className={styles.form} onSubmit={event => { event.preventDefault(); void save() }}>
      <Tabs value={activeGroup} onValueChange={value => setActiveGroup(value as ParamGroupId)} className={styles.workspace}>
        <div className={styles.toolbar}>
          <div className={styles.navigation}>
            <TabsList aria-label="参数分类">
              {PARAM_GROUPS.map((group, index) => <TabsTrigger key={group.id} id={`ai-param-tab-${group.id}`} value={group.id} aria-controls={`ai-params-${group.id}`}>
                {group.label}
                {(groupChanges[index] ?? 0) > 0 && <span className={styles.dirtyDot} role="img" aria-label={`${groupChanges[index]} 项待保存`} />}
              </TabsTrigger>)}
            </TabsList>
          </div>
          <Button type="button" variant="secondary" size="sm" disabled={props.loading || saving || dirty} onClick={props.onReload} aria-label="刷新生成参数">{props.loading ? '刷新中…' : '刷新'}</Button>
        </div>
        <div className={styles.sections}>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-recap" hidden={activeGroup !== 'recap'} id="ai-params-recap" tabIndex={0} className={styles.group}>
            <ParameterSection title="生成设置" description="调整提要的表达变化与输出长度。">
              <div className={styles.fields}>
                <FormField label="创意度（Temperature）" className={styles.temperature} htmlFor="recap-temp">
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
                  <div className={styles.rangeGuide} aria-hidden="true">
                    <span>更稳定 · 0</span>
                    <span>更灵活 · 1</span>
                  </div>
                </FormField>
                <FormField label="最大输出 Token" htmlFor="recap-tokens" hint="限制生成长度，防止过长。推荐 500">
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
                </FormField>
              </div>
            </ParameterSection>
            <ParameterSection title="输出约定" description="设置角色、语气与提要结构。">
              <FormField label="系统提示词" htmlFor="recap-prompt" hint="定义 AI 的角色和输出风格">
                <Textarea
                  id="recap-prompt"
                  className={styles.promptEditor}
                  value={localSettings.recapSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, recapSystemPrompt: e.target.value })}
                />
              </FormField>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-catchup" hidden={activeGroup !== 'catchup'} id="ai-params-catchup" tabIndex={0} className={styles.group}>
            <ParameterSection title="启用与触发" description="决定何时向久未阅读的读者提供回顾。">
              {toggle("catchupEnabled", "回来接着读功能", "为久未阅读的读者合成连贯回顾。")}
              <div className={styles.fields}>
                <FormField label="隔多少天算「很久没读」" htmlFor="catchup-stale-days" hint="距上次阅读超过该天数才显示回顾入口，1-90 天">
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
                </FormField>
                <FormField label="最多回顾章节数" htmlFor="catchup-chapters" hint="1-10 章">
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
                </FormField>
              </div>
            </ParameterSection>
            <ParameterSection title="回顾生成" description="控制恢复上下文时的表达与篇幅。">
              <div className={styles.fields}>
                <FormField label="创意度" className={styles.temperature} htmlFor="catchup-temp">
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
                  <div className={styles.rangeGuide} aria-hidden="true">
                    <span>更稳定 · 0</span>
                    <span>更灵活 · 1</span>
                  </div>
                </FormField>
                <FormField label="最大输出 Token" htmlFor="catchup-tokens" hint="推荐 800">
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
                </FormField>
              </div>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-writing" hidden={activeGroup !== 'writing'} id="ai-params-writing" tabIndex={0} className={styles.group}>
            <ParameterSection title="正文与大纲" description="统一设置正文续写、推荐情节与大纲规划。">
              <div className={styles.fields}>
                <FormField label="创意度（Temperature）" className={styles.temperature} htmlFor="writing-temp">
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
                  <div className={styles.rangeGuide} aria-hidden="true">
                    <span>更稳定 · 0</span>
                    <span>更灵活 · 1</span>
                  </div>
                </FormField>
                <FormField label="最大输出 Token" htmlFor="writing-tokens" hint="控制大纲、章节和续写的最大长度，最高 1,000,000 Token">
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
                </FormField>
                {reasoning("writingReasoningMode", "正文、推荐情节与大纲思考模式", "跟随供应商保持原行为；关闭、低强度和高强度适用于 DeepSeek 兼容模型。")}
              </div>{toggle("writingStreamEnabled", "正文与大纲实时预览", "启用流式请求，显示思考阶段与部分正文。完整返回后才保存；供应商可能仍以非流式返回。")}
            </ParameterSection>
            <ParameterSection title="文风与约束" description="为后续创作提供角色、文风和输出要求。">
              <FormField label="创作系统提示词" htmlFor="writing-prompt" hint="定义 AI 创作的角色、文风和输出约束">
                <Textarea
                  id="writing-prompt"
                  className={styles.promptEditor}
                  value={localSettings.writingSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, writingSystemPrompt: e.target.value })}
                />
              </FormField>
            </ParameterSection>
            <ParameterSection title="小说分析" description="分析报告按选择的章节范围生成，供阅读、核对和创作参考。" wide>
              <div className={styles.fields}>
                <FormField label="小说分析超时（秒）" htmlFor="memory-timeout" hint="小说分析每次模型请求的等待上限，默认 300 秒，范围 30–600 秒；超时后停止自动重试，保留检查点供手动继续。">
                  <Input
                    id="memory-timeout"
                    required
                    type="number"
                    min={30}
                    max={600}
                    value={Number.isFinite(localSettings.storyMemoryTimeoutSeconds ?? 300) ? localSettings.storyMemoryTimeoutSeconds ?? 300 : ''}
                    disabled={props.loading || saving}
                    onChange={(e) => setLocalSettings({ ...localSettings, storyMemoryTimeoutSeconds: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                  />
                </FormField>
                {reasoning("storyMemoryReasoningMode", "小说分析思考模式", "跟随供应商保持原行为。关闭、低强度和高强度适用于 DeepSeek 兼容模型；更换其他模型前请改回跟随供应商。")}
              </div>
            </ParameterSection>
            <ParameterSection title="故事图谱" description="为结构化图谱保留独立的输出与思考预算。">
              <div className={styles.fields}>
                <FormField label="故事图谱 Token" htmlFor="story-graph-tokens" hint="图谱的独立输出预算，默认 16,000；包含思考与最终结果。截断后可提高，实际用量取决于模型。">
                  <Input
                    id="story-graph-tokens"
                    required
                    type="number"
                    min={1000}
                    max={1000000}
                    value={Number.isFinite(localSettings.storyGraphMaxTokens ?? 16000) ? localSettings.storyGraphMaxTokens ?? 16000 : ''}
                    disabled={props.loading || saving}
                    onChange={(e) => setLocalSettings({ ...localSettings, storyGraphMaxTokens: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                  />
                </FormField>
                <FormField label="故事图谱思考模式" htmlFor="storyGraphReasoningMode" hint="默认关闭 DeepSeek 思考，让预算用于完整图谱；其他模型在此选项下跟随供应商。低、高强度仅支持 DeepSeek 兼容模型。">
                  <Select value={localSettings.storyGraphReasoningMode ?? 'disabled'} onValueChange={(value) => setLocalSettings({ ...localSettings, storyGraphReasoningMode: value as 'inherit' | 'disabled' | 'low' | 'high' })} disabled={props.loading || saving}>
                    <SelectTrigger id="storyGraphReasoningMode"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="inherit">跟随供应商</SelectItem><SelectItem value="disabled">关闭思考</SelectItem><SelectItem value="low">低强度思考</SelectItem><SelectItem value="high">高强度思考</SelectItem></SelectContent>
                  </Select>
                </FormField>
              </div>
            </ParameterSection>
            <ParameterSection title="分析与辅助生成" description="控制草稿检查和章节标题的输出。">
              <div className={styles.fields}>
                <FormField label="质量检查 Token" htmlFor="review-tokens" hint="单次草稿质量检查的输出预算；被截断时可提高后重试。">
                  <Input
                    id="review-tokens"
                    required
                    type="number"
                    min={300}
                    max={1000000}
                    value={localSettings.reviewMaxTokens ?? 8000}
                    disabled={props.loading || saving}
                    onChange={(e) => setLocalSettings({ ...localSettings, reviewMaxTokens: Number(e.target.value) })}
                  />
                </FormField>
                <FormField label="章节标题 Token" htmlFor="title-tokens" hint="章节标题生成的最大输出，推荐 200">
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
                </FormField>
              </div>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-image" hidden={activeGroup !== 'image'} id="ai-params-image" tabIndex={0} className={styles.group}>
            <ParameterSection title="图像输出" description="设置默认尺寸、质量及返回格式。">
              <div className={styles.fields}>
                <FormField label="图像尺寸" htmlFor="image-size">
                  <Select
                    value={localSettings.imageSize}
                    disabled={props.loading || saving}
                    onValueChange={(value) => setLocalSettings({ ...localSettings, imageSize: value })}
                  >
                    <SelectTrigger id="image-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="1024x1024">1024 × 1024</SelectItem>
                      <SelectItem value="1792x1024">1792 × 1024（横向）</SelectItem>
                      <SelectItem value="1024x1792">1024 × 1792（纵向）</SelectItem>
                      <SelectItem value="512x512">512 × 512</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="图像质量" htmlFor="image-quality">
                  <Select
                    value={localSettings.imageQuality}
                    disabled={props.loading || saving}
                    onValueChange={(value) => setLocalSettings({ ...localSettings, imageQuality: value })}
                  >
                    <SelectTrigger id="image-quality">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="standard">标准</SelectItem>
                      <SelectItem value="hd">高清（HD）</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="返回格式" htmlFor="image-response-format">
                  <Select
                    value={localSettings.imageResponseFormat}
                    disabled={props.loading || saving}
                    onValueChange={(value) => setLocalSettings({ ...localSettings, imageResponseFormat: value })}
                  >
                    <SelectTrigger id="image-response-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="b64_json">Base64</SelectItem>
                      <SelectItem value="url">URL</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </ParameterSection>
            <ParameterSection title="封面描述" description="管理封面工作台的描述词编辑范围。">
              <FormField
                label="封面描述词上限"
                htmlFor="cover-prompt-max-chars"
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
              </FormField>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-import" hidden={activeGroup !== 'import'} id="ai-params-import" tabIndex={0} className={styles.group}>
            <ParameterSection title="复核范围" description="用模型辅助判断章节边界的疑难行。">
              {toggle("importAiReviewEnabled", "启用导入 AI 复核", "确定性解析仍是主链路；开启后可在导入预览页对证据不足的行运行复核。")}
              <div className={styles.fields}>
                <FormField label="单次复核候选行上限" htmlFor="import-ai-candidates" hint="只送证据不足的行，超出部分不送模型，10-300 行">
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
                </FormField>
                <FormField label="复核输出 Token 上限" htmlFor="import-ai-tokens" hint="只需返回行号数组，200-8000">
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
                </FormField>
              </div>
            </ParameterSection>
            <ParameterSection title="复核指令" description="保留结构化输出约定，便于导入流程解析。">
              <FormField
                label="系统提示词"
                htmlFor="import-ai-prompt"
                hint="必须保留「只输出 JSON 行号数组」的约定，模型回结构化长文会让解析变成新的失败点"
              >
                <Textarea
                  id="import-ai-prompt"
                  className={styles.promptEditor}
                  value={localSettings.importAiSystemPrompt}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, importAiSystemPrompt: e.target.value })}
                />
              </FormField>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-contentRating" hidden={activeGroup !== 'contentRating'} id="ai-params-contentRating" tabIndex={0} className={styles.group}>
            <ParameterSection title="输出预算" description="为单本作品的内容分级建议分配输出长度。">
              <FormField
                label="分级输出 Token 上限"
                htmlFor="content-rating-tokens"
                hint="单本分级分析的最大输出 Token。包含模型思考过程与 JSON 判定结果；面对 DeepSeek 等推理模型，建议保持在 2000 以上避免截断。"
              >
                <Input
                  id="content-rating-tokens"
                  required
                  type="number"
                  min={500}
                  max={1000000}
                  value={Number.isFinite(localSettings.contentRatingMaxTokens ?? 4096) ? localSettings.contentRatingMaxTokens ?? 4096 : ''}
                  disabled={props.loading || saving}
                  onChange={(e) => setLocalSettings({ ...localSettings, contentRatingMaxTokens: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                />
              </FormField>
            </ParameterSection>
            <ParameterSection title="分析思考" description="按模型能力调整分级判定的推理强度。">
              <FormField
                label="分级分析思考模式"
                htmlFor="contentRatingReasoningMode"
                hint="控制内容分级分析的思考推理强度。分级判定以结构化规则输出为主，若上游推理模型频繁超时或产生截断，可选择关闭思考或降低强度。"
              >
                <Select
                  value={localSettings.contentRatingReasoningMode ?? 'inherit'}
                  onValueChange={(value) => setLocalSettings({ ...localSettings, contentRatingReasoningMode: value as 'inherit' | 'disabled' | 'low' | 'high' })}
                  disabled={props.loading || saving}
                >
                  <SelectTrigger id="contentRatingReasoningMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">跟随供应商</SelectItem>
                    <SelectItem value="disabled">关闭思考</SelectItem>
                    <SelectItem value="low">低强度思考</SelectItem>
                    <SelectItem value="high">高强度思考</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-tasks" hidden={activeGroup !== 'tasks'} id="ai-params-tasks" tabIndex={0} className={styles.group}>
            <ParameterSection title="运行并发" description="限制同时运行的创作任务数量。">
              <FormField label="创作任务并发上限" htmlFor="max-concurrent-tasks" hint="同时运行的大纲/章节/续写任务数上限，超出时新任务被拒绝，1-10 个">
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
              </FormField>
            </ParameterSection>
            <ParameterSection title="任务保留" description="管理已结束任务的历史保留时间。">
              <FormField
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
              </FormField>
            </ParameterSection>
          </div></MotionView>
          <MotionView asChild><div role="tabpanel" aria-labelledby="ai-param-tab-audit" hidden={activeGroup !== 'audit'} id="ai-params-audit" tabIndex={0} className={styles.group}>
            <ParameterSection title="请求来源" description="决定调用审计是否保留来源地址。">
              {toggle("logIpAddress", "记录 IP 地址", "在审计记录中保存用户 IP。")}
            </ParameterSection>
            <ParameterSection title="浏览器信息" description="决定调用审计是否保留客户端信息。">
              {toggle("logUserAgent", "记录 User-Agent", "在审计记录中保存浏览器信息。")}
            </ParameterSection>
          </div></MotionView>
        </div>
        {!dirty && <p className={styles.savedStatus} role="status">参数与当前生效值一致</p>}
        <AdminFloatingDock open={dirty} reserveSpace role="region" aria-label="参数保存操作" data-state="open">
          <span className="admin-floating-dock__status" data-dirty role="status">{changeCount} 项参数待保存 · 切换分类保留修改</span>
          <div className="admin-floating-dock__actions">
            <Button type="button" variant="outline" disabled={props.loading || saving} onClick={() => setLocalSettings(props.settings)}>撤销修改</Button>
            <Button type="submit" disabled={props.loading || saving}>{saving ? '保存中…' : '保存所有参数'}</Button>
          </div>
        </AdminFloatingDock>
      </Tabs>
    </form>
  )
}
