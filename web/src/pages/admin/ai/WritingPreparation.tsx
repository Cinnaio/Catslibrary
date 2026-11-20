import { MotionDetails } from '@/components/ui/motion'
import styles from './writing-workspace.module.css'
import type { useWritingPreparationState } from './writing-preparation-state'
import { aiApi, type AiWritingBrief } from '@/lib/api'
import FormField from "@/components/shared/FormField"
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export default function WritingPreparation(props: ReturnType<typeof useWritingPreparationState> & {
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
  const { preview, busy, error, characterText } = props.state
  const brief = props.brief
  const change = (field: keyof AiWritingBrief, value: unknown) => props.onChange({ ...brief, [field]: value })
  const visiblePreview = preview?.key === props.requestKey ? preview.materials : undefined
  async function inspect() {
    props.onStateChange({ busy: true, error: '' })
    const key = props.requestKey
    try {
      const materials = await aiApi.writing.materials(props.request)
      props.onStateChange({ preview: { key, materials } })
      props.onPreview(materials.revision, key)
    } catch (err) {
      props.onStateChange({ error: (err as Error).message })
    } finally {
      props.onStateChange({ busy: false })
    }
  }
  return (
    <section className={styles.preparation} aria-label="进阶约束与材料">
      <p className={styles.caption}>
        按需补充目标、人物、视角和禁区，灵感、大纲及正文都会采用这些约束。
      </p>
      <div className={styles.preparationFields}>
        <FormField label="本章目标" htmlFor="writing-objective">
          <Textarea
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
              props.onStateChange({ characterText: e.target.value })
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
        <FormField label="推荐情节超时" htmlFor="writing-plot-timeout">
          <div className="flex items-center gap-2">
            <Input
              id="writing-plot-timeout"
              type="number"
              min={props.plotTimeout.min}
              max={props.plotTimeout.max}
              value={props.plotTimeout.value}
              disabled={props.disabled}
              onChange={(e) => props.plotTimeout!.onChange(e.target.value)}
              onBlur={props.plotTimeout.onBlur}
              className="w-24 text-center tabular-nums"
              title={`推荐情节的请求超时，默认 180 秒，范围 ${props.plotTimeout.min}–${props.plotTimeout.max} 秒`}
            />
            <span className="text-xs text-muted-foreground">秒</span>
          </div>
        </FormField>
      )}
      {props.chapterCount > 1 && (
        <MotionDetails>
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
        </MotionDetails>
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

              </p>
              {!visiblePreview.historicalPassages.length && (
                <p className="text-xs text-muted-foreground">没有找到匹配的历史原文，可补充人物姓名或具体事实后重新预览。</p>
              )}
              {visiblePreview.historicalPassages.map((p) => (
                <MotionDetails key={p.chapterId} className="border-b border-border pb-2">
                  <summary className="cursor-pointer text-sm">
                    历史原文 · {p.title} · 匹配：{p.matchedTerms.join('、')}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{p.text}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    来源章节 {p.chapterId} · 正文片段 {p.start}–{p.end}
                  </p>
                </MotionDetails>
              ))}
              {[
                ...visiblePreview.plan.facts.filter((block) => !block.id.startsWith('history-')),
                ...visiblePreview.plan.currentState,
                ...visiblePreview.plan.style,
                ...visiblePreview.plan.chapterTask,
              ].map((block) => (
                <MotionDetails key={block.id} className="border-b border-border pb-2">
                  <summary className="cursor-pointer text-sm">
                    {(
                      {
                        'novel-title': '作品标题',
                        outline: '本次大纲',
                        'continuation-context': '近期正文尾部',
                        'novel-analysis': '本次小说分析参考',
                        'novel-style-analysis': '本次文风分析参考',
                        'writing-brief': '章节目标与约束',
                        'author-instruction': '本次情节',
                        'content-preferences': '内容尺度',
                      } as Record<string, string>
                    )[block.id] || block.id}{' '}
                    · {block.text.length.toLocaleString()} 字符
                  </summary>
                  <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">{block.text}</p>
                </MotionDetails>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
