/** 参数调优：前情提要 / 回顾总结 / AI 创作参数与审计配置。 */
import { useEffect, useState } from 'react'
import { ClipboardList, Image, ShieldCheck, SlidersHorizontal, Sparkles, Wrench } from 'lucide-react'
import { aiApi, type AiSettings } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { LoadingState } from '@/components/admin/AsyncStates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function AiParamsPanel(props: { settings: AiSettings | null; loading: boolean; onReload: () => void }) {
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
    return <div className="rounded-xl border border-border bg-card p-6"><LoadingState label="正在加载参数设置" /></div>
  }

  return (
    <div className="space-y-4">
      {/* 前情提要参数 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />前情提要参数</CardTitle>
          <p className="text-sm text-muted-foreground">调整章节前情提要的生成参数</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
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
            <textarea data-slot="textarea"
              id="recap-prompt"
              className="min-h-[100px] w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
          <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="size-4 text-primary" aria-hidden="true" />回顾总结参数</CardTitle>
          <p className="text-sm text-muted-foreground">调整「回来接着读」功能的参数</p>
        </CardHeader>
        <CardContent className="grid gap-4">
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
          </label>

          <div className="ai-form-grid grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="catchup-stale-days">隔多少天算「很久没读」</Label>
              <Input
                id="catchup-stale-days"
                type="number"
                min={1}
                max={90}
                value={localSettings.catchupStaleDays}
                disabled={props.loading || saving}
                onChange={(e) => setLocalSettings({ ...localSettings, catchupStaleDays: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">距上次阅读超过该天数才显示回顾入口，1-90 天</p>
            </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" aria-hidden="true" />AI 创作参数</CardTitle>
          <p className="text-sm text-muted-foreground">用于 AI 创作页的大纲、章节生成和续写</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="ai-form-grid grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="writing-temp">创意度（Temperature）</Label>
              <Input id="writing-temp" type="number" min={0} max={1} step={0.1} value={localSettings.writingTemperature} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, writingTemperature: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">数值越高，生成结果越有变化。推荐 0.8</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="writing-tokens">最大输出 Token</Label>
              <Input id="writing-tokens" type="number" min={300} max={1000000} value={localSettings.writingMaxTokens} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, writingMaxTokens: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">控制大纲、章节和续写的最大长度，最高 1,000,000 Token</p>
            </div>
          </div>
          <div className="ai-form-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="style-tokens">风格画像 Token</Label>
              <Input id="style-tokens" type="number" min={200} max={1000000} value={localSettings.styleProfileMaxTokens} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, styleProfileMaxTokens: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">风格画像提取的最大输出，推理模型需留足思考余量，推荐 1500</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plot-tokens">情节状态 Token</Label>
              <Input id="plot-tokens" type="number" min={300} max={1000000} value={localSettings.plotStateMaxTokens} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, plotStateMaxTokens: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">情节状态提取的最大输出，结构化四块天然较长，推荐 3000</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="relationship-tokens">关系画像 Token</Label>
              <Input id="relationship-tokens" type="number" min={200} max={1000000} value={localSettings.relationshipProfileMaxTokens} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, relationshipProfileMaxTokens: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">关系画像提取的最大输出，角色关系动态/心理边界，推荐 1200</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="title-tokens">章节标题 Token</Label>
              <Input id="title-tokens" type="number" min={50} max={2000} value={localSettings.titleMaxTokens} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, titleMaxTokens: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">章节标题生成的最大输出，推荐 200</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="writing-prompt">创作系统提示词</Label>
            <textarea data-slot="textarea" id="writing-prompt" className="min-h-[120px] w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={localSettings.writingSystemPrompt} disabled={props.loading || saving} onChange={(e) => setLocalSettings({ ...localSettings, writingSystemPrompt: e.target.value })} />
            <p className="text-xs text-muted-foreground">定义 AI 创作的角色、文风和输出约束</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Image className="size-4 text-primary" aria-hidden="true" />AI 生图参数</CardTitle>
          <p className="text-sm text-muted-foreground">用于小说封面生成的图像尺寸、质量与返回格式</p>
        </CardHeader>
        <CardContent className="ai-form-grid grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label htmlFor="image-size">图像尺寸</Label><Select value={localSettings.imageSize} disabled={props.loading || saving} onValueChange={(value) => setLocalSettings({ ...localSettings, imageSize: value })}><SelectTrigger id="image-size" className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent position="popper" align="start"><SelectItem value="1024x1024">1024 × 1024</SelectItem><SelectItem value="1792x1024">1792 × 1024（横向）</SelectItem><SelectItem value="1024x1792">1024 × 1792（纵向）</SelectItem><SelectItem value="512x512">512 × 512</SelectItem></SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="image-quality">图像质量</Label><Select value={localSettings.imageQuality} disabled={props.loading || saving} onValueChange={(value) => setLocalSettings({ ...localSettings, imageQuality: value })}><SelectTrigger id="image-quality" className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent position="popper" align="start"><SelectItem value="standard">标准</SelectItem><SelectItem value="hd">高清（HD）</SelectItem></SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="image-response-format">返回格式</Label><Select value={localSettings.imageResponseFormat} disabled={props.loading || saving} onValueChange={(value) => setLocalSettings({ ...localSettings, imageResponseFormat: value })}><SelectTrigger id="image-response-format" className="h-9 bg-background"><SelectValue /></SelectTrigger><SelectContent position="popper" align="start"><SelectItem value="b64_json">Base64</SelectItem><SelectItem value="url">URL</SelectItem></SelectContent></Select></div>
        </CardContent>
      </Card>

      {/* 任务与运维 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Wrench className="size-4 text-primary" aria-hidden="true" />任务与运维</CardTitle>
          <p className="text-sm text-muted-foreground">创作任务的并发控制与历史记录清理</p>
        </CardHeader>
        <CardContent className="ai-form-grid grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="max-concurrent-tasks">创作任务并发上限</Label>
            <Input
              id="max-concurrent-tasks"
              type="number"
              min={1}
              max={10}
              value={localSettings.maxConcurrentWritingTasks}
              disabled={props.loading || saving}
              onChange={(e) => setLocalSettings({ ...localSettings, maxConcurrentWritingTasks: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">同时运行的大纲/章节/续写任务数上限，超出时新任务被拒绝，1-10 个</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="task-retention-days">已结束任务保留天数</Label>
            <Input
              id="task-retention-days"
              type="number"
              min={7}
              max={365}
              value={localSettings.taskRetentionDays}
              disabled={props.loading || saving}
              onChange={(e) => setLocalSettings({ ...localSettings, taskRetentionDays: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">服务启动时清理更早的已完成/失败/取消任务，用量审计不受影响，7-365 天</p>
          </div>
        </CardContent>
      </Card>

      {/* 审计配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" aria-hidden="true" />审计配置</CardTitle>
          <p className="text-sm text-muted-foreground">控制 AI 调用的审计信息记录</p>
        </CardHeader>
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

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={props.loading || saving}>
          {saving ? '保存中…' : '保存所有参数'}
        </Button>
      </div>
    </div>
  )
}
