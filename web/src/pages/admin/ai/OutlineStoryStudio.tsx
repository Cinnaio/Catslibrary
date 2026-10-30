import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Layers, FileText, Plus, Trash2, ArrowRight, CheckCircle2, AlertCircle, Wand2, Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface ParsedBeat {
  id: string
  num: string
  title: string
  body: string
  tension: '起' | '承' | '转' | '合' | '高潮'
}

const TENSION_OPTIONS: Array<'起' | '承' | '转' | '合' | '高潮'> = ['起', '承', '转', '合', '高潮']

const TENSION_STYLES: Record<string, string> = {
  起: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  承: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  转: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  合: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  高潮: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
}

const CHAPTER_HEADER_REGEX = /^\s*(?:#{1,6}\s*)?(?:第\s*([0-9一二三四五六七八九十百零两]+)\s*[章节回]|([0-9]+)\s*[.、：:])\s*(.*)$/

function defaultTensionForIndex(index: number, total: number): '起' | '承' | '转' | '合' | '高潮' {
  if (total <= 1) return '起'
  if (index === 0) return '起'
  if (index === total - 1) return '合'
  if (index === Math.floor(total * 0.6)) return '高潮'
  if (index > Math.floor(total * 0.5)) return '转'
  return '承'
}

export function parseOutlineToBeats(outline: string): ParsedBeat[] {
  if (!outline.trim()) return []
  const lines = outline.replace(/\r\n?/g, '\n').split('\n')
  const beats: ParsedBeat[] = []
  let current: { num: string; title: string; bodyLines: string[] } | null = null

  for (const line of lines) {
    const match = CHAPTER_HEADER_REGEX.exec(line)
    if (match) {
      if (current) {
        beats.push({
          id: `beat-${beats.length + 1}`,
          num: current.num,
          title: current.title,
          body: current.bodyLines.join('\n').trim(),
          tension: defaultTensionForIndex(beats.length, 4),
        })
      }
      current = {
        num: match[1] || match[2] || String(beats.length + 1),
        title: (match[3] || '').trim(),
        bodyLines: [],
      }
    } else if (current) {
      current.bodyLines.push(line)
    }
  }

  if (current) {
    beats.push({
      id: `beat-${beats.length + 1}`,
      num: current.num,
      title: current.title,
      body: current.bodyLines.join('\n').trim(),
      tension: defaultTensionForIndex(beats.length, beats.length + 1),
    })
  }

  // 若存在文本但未匹配到「第N章」模式，兜底作为一个节拍卡片
  if (beats.length === 0 && outline.trim()) {
    beats.push({
      id: 'beat-1',
      num: '1',
      title: '主线节拍',
      body: outline.trim(),
      tension: '起',
    })
  }

  return beats
}

export function serializeBeatsToOutline(beats: ParsedBeat[]): string {
  return beats
    .map((b) => {
      const header = `第${b.num}章${b.title ? ` ${b.title}` : ''}`
      return b.body ? `${header}\n${b.body}` : header
    })
    .join('\n\n')
}

export default function OutlineStoryStudio({
  mode,
  isMultiChapter,
  chapterCount,
  outline,
  onChangeOutline,
  onGenerateOutline,
  outlineBusy,
  disabled,
  novelId,
}: {
  mode: 'new' | 'continue'
  isMultiChapter: boolean
  chapterCount: number
  outline: string
  onChangeOutline: (val: string) => void
  onGenerateOutline: () => void
  outlineBusy: boolean
  disabled: boolean
  novelId: string
}) {
  const [viewMode, setViewMode] = useState<'beats' | 'markdown'>('beats')
  const beats = useMemo(() => parseOutlineToBeats(outline), [outline])
  const outlineChaptersCount = beats.length

  // 当外部大纲变化或者编辑节拍时同步
  function handleUpdateBeat(index: number, updates: Partial<ParsedBeat>) {
    const next = beats.map((b, i) => (i === index ? { ...b, ...updates } : b))
    onChangeOutline(serializeBeatsToOutline(next))
  }

  function handleAddBeat() {
    const nextNum = String(beats.length + 1)
    const newBeat: ParsedBeat = {
      id: `beat-${Date.now()}`,
      num: nextNum,
      title: '',
      body: '',
      tension: defaultTensionForIndex(beats.length, beats.length + 1),
    }
    const next = [...beats, newBeat]
    onChangeOutline(serializeBeatsToOutline(next))
  }

  function handleRemoveBeat(index: number) {
    const next = beats.filter((_, i) => i !== index).map((b, i) => ({ ...b, num: String(i + 1) }))
    onChangeOutline(serializeBeatsToOutline(next))
  }

  function handleFillRemaining() {
    const currentCount = beats.length
    const diff = chapterCount - currentCount
    if (diff <= 0) return
    const additions: ParsedBeat[] = []
    for (let i = 0; i < diff; i++) {
      const num = String(currentCount + i + 1)
      additions.push({
        id: `beat-fill-${i}-${Date.now()}`,
        num,
        title: `第${num}章承接推进`,
        body: '承接上章剧情线索展开，深化核心矛盾。',
        tension: defaultTensionForIndex(currentCount + i, chapterCount),
      })
    }
    onChangeOutline(serializeBeatsToOutline([...beats, ...additions]))
  }

  const labelText = mode === 'new' ? '大纲（生成章节时使用）' : isMultiChapter ? '多章续写大纲' : '本章大纲（可选）'

  const isMatched = outlineChaptersCount >= chapterCount
  const isShort = isMultiChapter && outlineChaptersCount > 0 && outlineChaptersCount < chapterCount

  return (
    <div className="ai-outline-story-studio rounded-xl border border-border/80 bg-card p-4 space-y-4 shadow-2xs">
      {/* 头部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-writing-outline" className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Layers className="size-4 text-[#D97757]" />
            <span>{labelText}</span>
          </Label>

          {/* 模式切换：节拍流 vs Markdown 源码 */}
          <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-all',
                viewMode === 'beats'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setViewMode('beats')}
            >
              <Compass className="size-3 text-[#D97757]" />
              <span>章回节拍画卷</span>
              {beats.length > 0 && (
                <span className="ml-0.5 rounded-full bg-[#D97757]/15 px-1.5 text-[10px] text-[#D97757] font-semibold">
                  {beats.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-all',
                viewMode === 'markdown'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setViewMode('markdown')}
            >
              <FileText className="size-3" />
              <span>Markdown 源码</span>
            </button>
          </div>
        </div>

        {/* 生成大纲主按钮 */}
        {mode === 'continue' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || outlineBusy || !novelId}
            onClick={onGenerateOutline}
            className="h-8 px-3.5 rounded-full text-xs font-medium border-[#D97757]/30 text-[#D97757] hover:bg-[#D97757]/10 transition-all shadow-2xs"
          >
            {outlineBusy ? (
              <>
                <Sparkles className="size-3.5 mr-1.5 animate-spin" />
                生成中…
              </>
            ) : (
              <>
                <Wand2 className="size-3.5 mr-1.5" />
                {isMultiChapter ? '按情节推荐生成大纲（多章）' : '按情节推荐生成大纲（单章）'}
              </>
            )}
          </Button>
        )}
      </div>

      {/* 叙事篇幅与章节对齐指示仪 */}
      {isMultiChapter && outline.trim() && (
        <div
          className={cn(
            'ai-writing-outline-status flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-xs',
            isMatched
              ? 'is-ok border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200'
              : 'is-short border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200'
          )}
        >
          <div className="flex items-center gap-2">
            {isMatched ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <span className="ai-writing-outline-status__figure font-mono font-semibold">
              {outlineChaptersCount}
              <span aria-hidden="true"> / </span>
              {chapterCount} 章
            </span>
            <span className="ai-writing-outline-status__text">
              {isMatched
                ? `已识别 ${outlineChaptersCount} 个章节段落，完美覆盖这 ${chapterCount} 章目标，续写将逐章独立推进。`
                : `已识别 ${outlineChaptersCount} 个章节段落，不足 ${chapterCount} 章：多出的续写章会按创作要求自由推演，建议补齐。`}
            </span>
          </div>

          {isShort && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFillRemaining}
              className="h-6 px-2.5 text-[11px] font-medium border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10"
            >
              + 一键补足缺失 {chapterCount - outlineChaptersCount} 章
            </Button>
          )}
        </div>
      )}

      {/* 视图分支 1：章回节拍时间轴卡片流 */}
      {viewMode === 'beats' && (
        <div className="space-y-3">
          {beats.length > 0 ? (
            <div className="relative pl-6 space-y-3 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border/80">
              {beats.map((beat, index) => (
                <div
                  key={beat.id || index}
                  className="relative rounded-xl border border-border/80 bg-background/90 p-3.5 shadow-2xs hover:border-[#D97757]/40 transition-all space-y-2.5"
                >
                  {/* 时间轴连线节点 */}
                  <div className="absolute -left-6 top-4 flex size-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-background bg-[#D97757] text-white font-mono text-[10px] font-bold shadow-xs">
                    {beat.num}
                  </div>

                  {/* 节拍标题与张力标签 */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <span className="font-mono text-xs font-bold text-[#D97757] whitespace-nowrap">
                        第 {beat.num} 章
                      </span>
                      <Input
                        value={beat.title}
                        onChange={(e) => handleUpdateBeat(index, { title: e.target.value })}
                        placeholder="输入章节命题（如：重返皇城）"
                        className="h-7 text-xs font-medium bg-muted/20 border-transparent hover:border-border/60 focus:border-[#D97757]"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* 叙事张力选择器 */}
                      <div className="flex items-center gap-1">
                        {TENSION_OPTIONS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => handleUpdateBeat(index, { tension: t })}
                            className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all border',
                              beat.tension === t
                                ? TENSION_STYLES[t]
                                : 'text-muted-foreground/60 border-transparent hover:text-foreground'
                            )}
                          >
                            {t}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveBeat(index)}
                        className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                        title="删除该章节拍"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 核心戏剧行动简述 */}
                  <Textarea
                    value={beat.body}
                    onChange={(e) => handleUpdateBeat(index, { body: e.target.value })}
                    placeholder="输入本章核心情节、出场人物互动与推进事件…"
                    rows={2}
                    className="min-h-[50px] resize-y text-xs leading-relaxed bg-muted/10 border-border/50 focus:border-[#D97757]"
                  />
                </div>
              ))}

              {/* 尾部操作：增加新章节拍 */}
              <div className="pt-1 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddBeat}
                  className="h-7 px-3 text-xs border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/40"
                >
                  <Plus className="size-3 mr-1" />
                  增加下一章节拍
                </Button>

                {isShort && (
                  <span className="text-[11.5px] text-amber-600 dark:text-amber-400">
                    尚余 {chapterCount - outlineChaptersCount} 章待规划
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/15 p-6 text-center space-y-3">
              <Compass className="size-8 text-[#D97757]/60 mx-auto" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">暂无章回规划节拍</p>
                <p className="text-[11.5px] text-muted-foreground">
                  点击上方「按情节推荐生成大纲」由 AI 自动编排，或直接添加自定义章节卡片。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddBeat}
                className="h-8 px-4 text-xs font-medium rounded-full"
              >
                <Plus className="size-3.5 mr-1.5" />
                手动建立第 1 章节拍
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Markdown 源码与双向同步源：始终保持在 DOM 中确保完全透明与双向交互 */}
      <div className={cn('grid gap-2 pt-2 border-t border-border/50', viewMode === 'beats' ? 'opacity-90' : 'opacity-100')}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {viewMode === 'beats' ? 'Markdown 实时同步源（双向联动）' : 'Markdown 源码（每章以「第N章 标题」开头）'}
          </span>
          <span className="font-mono text-[11px]">{outline.length} 字符</span>
        </div>
        <Textarea
          id="ai-writing-outline"
          className="field-sizing-fixed min-h-[120px] shadow-none text-xs sm:text-[13px] font-mono leading-relaxed bg-background"
          value={outline}
          onChange={(event) => onChangeOutline(event.target.value)}
          placeholder={
            mode === 'new'
              ? '先生成大纲，或直接粘贴已有大纲'
              : isMultiChapter
                ? '每章一行、以「第N章」开头，例如：\n第1章 重返皇城\n苏越带夭夜入城面见加刑天。\n第2章 婚夜\n两人在寝宫独处，约定共进退。'
                : '可留空。单章建议优先写清本次情节；需要更细致安排时，可在此补一段本章提纲。'
          }
        />
      </div>
    </div>
  )
}
