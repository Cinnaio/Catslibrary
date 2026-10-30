import { useMemo, useState } from 'react'
import { Sparkles, Layers, FileText, Plus, Trash2, CheckCircle2, AlertCircle, Wand2 } from 'lucide-react'
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

const TENSION_CYCLE: Array<'起' | '承' | '转' | '合' | '高潮'> = ['起', '承', '转', '合', '高潮']

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

  if (beats.length === 0 && outline.trim()) {
    beats.push({
      id: 'beat-1',
      num: '1',
      title: '本章节拍',
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

  function cycleTension(index: number) {
    const current = beats[index]?.tension || '起'
    const curIdx = TENSION_CYCLE.indexOf(current)
    const nextTension = TENSION_CYCLE[(curIdx + 1) % TENSION_CYCLE.length]!
    handleUpdateBeat(index, { tension: nextTension })
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
        body: '承接上章线索展开，推进核心事件与角色互动。',
        tension: defaultTensionForIndex(currentCount + i, chapterCount),
      })
    }
    onChangeOutline(serializeBeatsToOutline([...beats, ...additions]))
  }

  const labelText = mode === 'new' ? '大纲（生成章节时使用）' : isMultiChapter ? '多章续写大纲' : '本章大纲（可选）'
  const isMatched = outlineChaptersCount >= chapterCount
  const isShort = isMultiChapter && outlineChaptersCount > 0 && outlineChaptersCount < chapterCount

  return (
    <div className="ai-outline-story-studio rounded-lg border border-border/80 bg-card p-3.5 space-y-3">
      {/* 头部：标题、视图模式切换与生成按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-writing-outline" className="text-xs font-semibold text-foreground">
            {labelText}
          </Label>

          {/* 模式切换药丸 */}
          <div className="inline-flex rounded-md border border-border/70 bg-muted/30 p-0.5 text-[11px]">
            <button
              type="button"
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors',
                viewMode === 'beats'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setViewMode('beats')}
            >
              章回节拍 {beats.length > 0 && `(${beats.length})`}
            </button>
            <button
              type="button"
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors',
                viewMode === 'markdown'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setViewMode('markdown')}
            >
              纯文本
            </button>
          </div>

          {/* 章节对齐状态微标 */}
          {isMultiChapter && outline.trim() && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] font-mono font-medium border',
                isMatched
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
              )}
            >
              {outlineChaptersCount} / {chapterCount} 章{isMatched ? ' · 已对齐' : ' · 待补足'}
            </span>
          )}
        </div>

        {/* 生成大纲按钮 */}
        {mode === 'continue' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || outlineBusy || !novelId}
            onClick={onGenerateOutline}
            className="h-7 px-3 rounded-full text-xs font-medium border-border hover:border-[#D97757]/40 hover:text-[#D97757] transition-colors"
          >
            {outlineBusy ? (
              <>
                <Sparkles className="size-3 mr-1 animate-spin" />
                生成中…
              </>
            ) : (
              <>
                <Sparkles className="size-3 mr-1 text-[#D97757]" />
                {isMultiChapter ? '按情节推荐生成大纲（多章）' : '按情节推荐生成大纲（单章）'}
              </>
            )}
          </Button>
        )}
      </div>

      {/* 视图 1：章回节拍画卷（Claude 极简卡片流） */}
      {viewMode === 'beats' && (
        <div className="space-y-2">
          {beats.length > 0 ? (
            <div className="space-y-2">
              {beats.map((beat, index) => (
                <div
                  key={beat.id || index}
                  className="rounded-lg border border-border/70 bg-muted/5 p-2.5 transition-colors hover:border-border space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-mono text-xs font-bold text-[#D97757] whitespace-nowrap">
                        第 {beat.num} 章
                      </span>
                      <Input
                        value={beat.title}
                        onChange={(e) => handleUpdateBeat(index, { title: e.target.value })}
                        placeholder="章节命题（例如：重返皇城）"
                        className="h-6 text-xs bg-transparent border-transparent hover:border-border focus:border-[#D97757] px-1.5"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => cycleTension(index)}
                        title="点击轮换叙事节拍节奏（起 / 承 / 转 / 合 / 高潮）"
                        className="rounded border border-border/60 bg-background/80 px-1.5 py-0.2 text-[10.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {beat.tension}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBeat(index)}
                        className="text-muted-foreground/60 hover:text-destructive px-1 text-xs transition-colors"
                        title="删除本章"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <Textarea
                    value={beat.body}
                    onChange={(e) => handleUpdateBeat(index, { body: e.target.value })}
                    placeholder="简述本章戏剧行动与冲突推进…"
                    rows={2}
                    className="min-h-[46px] resize-y text-xs leading-relaxed bg-background/60 border-border/40 focus:border-[#D97757]"
                  />
                </div>
              ))}

              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleAddBeat}
                  className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="size-3" />
                  <span>添加下一章</span>
                </button>

                {isShort && (
                  <button
                    type="button"
                    onClick={handleFillRemaining}
                    className="text-[11.5px] text-[#D97757] hover:underline"
                  >
                    一键补齐缺失 {chapterCount - outlineChaptersCount} 章
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 p-4 text-center space-y-1.5">
              <p className="text-xs text-muted-foreground">尚未编排大纲章节</p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddBeat}
                  className="h-7 text-xs"
                >
                  <Plus className="size-3 mr-1" />
                  建立第 1 章节拍
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 视图 2：纯文本 Markdown 模式 */}
      <div className={cn(viewMode === 'beats' ? 'sr-only' : 'block space-y-1.5')}>
        <Textarea
          id="ai-writing-outline"
          className="field-sizing-fixed min-h-[140px] shadow-none text-xs leading-relaxed font-mono bg-background"
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
        {isMultiChapter && outline.trim() && (
          <div className={cn('ai-writing-outline-status text-xs text-muted-foreground', isMatched ? 'is-ok' : 'is-short')}>
            <span className="ai-writing-outline-status__figure font-mono font-medium">
              {outlineChaptersCount} / {chapterCount} 章
            </span>
            <span className="ai-writing-outline-status__text ml-2">
              {isMatched
                ? `已识别 ${outlineChaptersCount} 个章节段落，满足本次续写计划。`
                : `已识别 ${outlineChaptersCount} 个章节段落，不足 ${chapterCount} 章。`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
