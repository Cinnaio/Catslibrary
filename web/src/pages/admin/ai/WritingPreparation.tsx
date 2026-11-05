import { useState } from 'react'
import { aiApi, type AiWritingBrief, type AiWritingMaterials } from '@/lib/api'
import FormField from "@/components/shared/FormField"
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export default function WritingPreparation(props: {
  brief: AiWritingBrief
  onChange: (value: AiWritingBrief) => void
  request: Record<string, unknown>
  requestKey: string
  chapterCount: number
  disabled: boolean
  continuation: boolean
  onPreview: (revision: string, requestKey: string) => void
  /** 推荐情节超时秒数（可选），由调用方持有状态 */
  plotTimeout?: {
    value: string
    min: number
    max: number
    onChange: (value: string) => void
    onBlur: () => void
  }
}) {
  const [preview, setPreview] = useState<{ key: string; materials: AiWritingMaterials } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const brief = props.brief
  const [characterText, setCharacterText] = useState(brief.characters?.join('、') || '')
  const change = (field: keyof AiWritingBrief, value: unknown) => props.onChange({ ...brief, [field]: value })
  const visiblePreview = preview?.key === props.requestKey ? preview.materials : undefined
  async function inspect() {
    setBusy(true)
    setError('')
    const key = props.requestKey
    try {
      const materials = await aiApi.writing.materials(props.request)
      setPreview({ key, materials })
      props.onPreview(materials.revision, key)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="ai-writing-outline-details" aria-label="进阶约束与材料">
      <summary>
        进阶约束与材料
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {[
            brief.objective,
            brief.viewpoint,
            brief.pace,
            brief.requiredFacts,
            brief.forbiddenEvents,
            ...(brief.characters || []),
            ...brief.chapterGoals.map((goal) => goal.goal),
          ].some((value) => value.trim())
            ? '已填写 · 将用于推荐、大纲与正文'
            : '可选'}
        </span>
      </summary>
      <div className="grid gap-3 pt-3">
        <div>
          <h3 className="text-sm font-medium">补充目标与约束</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            本次情节写清发生什么；这里按需补充目标、视角、事实和禁区，无需重复填写。推荐情节、生成大纲和正文都会参考这些约束。预览只读取资料，不调用模型；历史检索限于本书续写起点之前的正式正文。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="本章目标" htmlFor="writing-objective">            <Textarea
              id="writing-objective"
              maxLength={1000}
              rows={2}
              value={brief.objective}
              disabled={props.disabled}
              onChange={(e) => change('objective', e.target.value)}
            />
          </FormField>
          <FormField label="出场人物" htmlFor="writing-characters" hint="用顿号、逗号或换行分隔；人物姓名用于检索相关历史。">
            <Textarea
              id="writing-characters"
              maxLength={1600}
              rows={2}
              value={characterText}
              disabled={props.disabled}
              onChange={(e) => {
                setCharacterText(e.target.value)
                change(
                  'characters',
                  e.target.value
                    .split(/[、,，\n]/)
                    .map((name) => name.trim())
                    .filter(Boolean),
                )
              }}
            />
          </FormField>
          <FormField label="叙事视角" htmlFor="writing-viewpoint">
            <Input
              id="writing-viewpoint"
              maxLength={200}
              value={brief.viewpoint}
              disabled={props.disabled}
              onChange={(e) => change('viewpoint', e.target.value)}
            />
          </FormField>
          <FormField label="叙事节奏" htmlFor="writing-pace">
            <Input id="writing-pace" maxLength={200} value={brief.pace} disabled={props.disabled} onChange={(e) => change('pace', e.target.value)} />
          </FormField>
          <FormField label="必须保留的事实" htmlFor="writing-required">
            <Textarea
              id="writing-required"
              maxLength={3000}
              rows={2}
              value={brief.requiredFacts}
              disabled={props.disabled}
              onChange={(e) => change('requiredFacts', e.target.value)}
            />
          </FormField>
          <FormField label="本次禁止发生的事件" htmlFor="writing-forbidden">
            <Textarea
              id="writing-forbidden"
              maxLength={3000}
              rows={2}
              value={brief.forbiddenEvents}
              disabled={props.disabled}
              onChange={(e) => change('forbiddenEvents', e.target.value)}
            />
          </FormField>
        </div>
        {props.plotTimeout && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <label htmlFor="writing-plot-timeout" className="text-xs text-muted-foreground whitespace-nowrap">
              推荐情节超时
            </label>
            <Input
              id="writing-plot-timeout"
              type="number"
              min={props.plotTimeout.min}
              max={props.plotTimeout.max}
              value={props.plotTimeout.value}
              disabled={props.disabled}
              onChange={(e) => props.plotTimeout!.onChange(e.target.value)}
              onBlur={props.plotTimeout.onBlur}
              className="h-7 w-16 px-1 text-center font-mono text-xs"
              title={`推荐情节的请求超时，默认 180 秒，范围 ${props.plotTimeout.min}–${props.plotTimeout.max} 秒`}
            />
            <span className="text-xs text-muted-foreground">秒</span>
          </div>
        )}
        {props.chapterCount > 1 && (
          <details>
            <summary className="cursor-pointer text-sm">分别指定 {props.chapterCount} 章的目标</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: props.chapterCount }, (_, i) => (
                <FormField key={i} label={`第 ${i + 1} 章目标`} htmlFor={`writing-goal-${i}`}>
                  <Textarea
                    id={`writing-goal-${i}`}
                    rows={2}
                    maxLength={1000}
                    disabled={props.disabled}
                    value={brief.chapterGoals.find((g) => g.index === i + 1)?.goal || ''}
                    onChange={(e) =>
                      change(
                        'chapterGoals',
                        [...brief.chapterGoals.filter((g) => g.index !== i + 1), { index: i + 1, goal: e.target.value }].sort((a, b) => a.index - b.index),
                      )
                    }
                  />
                </FormField>
              ))}
            </div>
          </details>
        )}
        {props.continuation && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" disabled={props.disabled || busy || !props.request.novelId} onClick={() => void inspect()}>
                {busy ? '正在准备材料…' : '预览本次上下文'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {preview && !visiblePreview ? '要求或起点已变化，请重新预览。' : '显示本次基础材料；多章生成会逐章追加目标和本批草稿。'}
              </span>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {visiblePreview && (
              <div className="grid min-w-0 gap-3" aria-label="本次上下文材料">
                <p className="text-xs leading-5 text-muted-foreground">
                  起点：{visiblePreview.anchor.title} · 材料约 {visiblePreview.characterCount.toLocaleString()} 字符（不是 Token 数）。
                  {visiblePreview.recentContextPolicy}
                  {visiblePreview.memorySelection && <span className="mt-1 block">增量记忆：本次关联 {visiblePreview.memorySelection.retrievedFacts} 条 / 已存 {visiblePreview.memorySelection.totalFacts} 条；完整历史仍可追溯。{visiblePreview.memorySelection.overBudget ? '关键约束较多，已完整保留，建议检查材料范围。' : ''}</span>}
                </p>
                {visiblePreview.excludedProfiles.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    未采用的档案：
                    {visiblePreview.excludedProfiles
                      .map(
                        (p) =>
                          `${({ style: '风格', plot: '情节', relationship: '关系' } as Record<string, string>)[p.kind] || p.kind}（${({ missing: '尚未建立', stale: '落后于起点', source_changed: '来源已变化', legacy_unknown: '待初始化', beyond_anchor: '晚于起点' } as Record<string, string>)[p.reason] || p.reason}）`,
                      )
                      .join('、')}
                  </p>
                )}
                {!visiblePreview.historicalPassages.length && (
                  <p className="text-xs text-muted-foreground">没有找到匹配的历史原文，可补充人物姓名或具体事实后重新预览。</p>
                )}
                {visiblePreview.historicalPassages.map((p) => (
                  <details key={p.chapterId} className="border-b border-border pb-2">
                    <summary className="cursor-pointer text-sm">
                      历史原文 · {p.title} · 匹配：{p.matchedTerms.join('、')}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{p.text}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      来源章节 {p.chapterId} · 正文片段 {p.start}–{p.end}
                    </p>
                  </details>
                ))}
                {[
                  ...visiblePreview.plan.facts.filter((block) => !block.id.startsWith('history-')),
                  ...visiblePreview.plan.currentState,
                  ...visiblePreview.plan.style,
                  ...visiblePreview.plan.chapterTask,
                ].map((block) => (
                  <details key={block.id} className="border-b border-border pb-2">
                    <summary className="cursor-pointer text-sm">
                      {(
                        {
                          'novel-title': '作品标题',
                          outline: '本次大纲',
                          'continuation-context': '近期正文尾部',
                          'plot-state': '完整情节档案',
                          'relationship-profile': '完整关系档案',
                          'style-profile': '风格画像',
                          'writing-brief': '章节目标与约束',
                          'author-instruction': '本次情节',
                          'content-preferences': '内容尺度',
                        } as Record<string, string>
                      )[block.id] || block.id}{' '}
                      · {block.text.length.toLocaleString()} 字符
                    </summary>
                    <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">{block.text}</p>
                  </details>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}
