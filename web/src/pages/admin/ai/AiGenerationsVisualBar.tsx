import { useMemo, useState } from 'react'
import { Sparkles, BarChart3, BookOpen, Layers, CheckCircle2, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface GenerationItemLike {
  id: string
  kind: string
  status: string
  result?: string
  chapterTitle?: string
  novelTitle?: string
  createdAt?: number
  groupItems?: GenerationItemLike[]
}

export default function AiGenerationsVisualBar({ items }: { items: GenerationItemLike[] }) {
  const [collapsed, setCollapsed] = useState(false)

  const stats = useMemo(() => {
    let totalWords = 0
    let draftCount = 0
    let publishedCount = 0
    const kindCounts: Record<string, number> = { continue: 0, write_chapter: 0, write_outline: 0, summary: 0 }
    const recentBars: Array<{ label: string; words: number; kind: string; status: string }> = []

    const processItem = (item: GenerationItemLike) => {
      const words = item.result ? Array.from(item.result).length : 0
      totalWords += words
      if (item.status === 'draft') draftCount++
      else if (item.status === 'published') publishedCount++
      kindCounts[item.kind] = (kindCounts[item.kind] || 0) + 1

      if (recentBars.length < 16 && words > 0) {
        recentBars.push({
          label: item.chapterTitle || item.novelTitle || item.kind,
          words,
          kind: item.kind,
          status: item.status,
        })
      }
    }

    for (const item of items) {
      if (item.groupItems && item.groupItems.length > 0) {
        for (const child of item.groupItems) processItem(child)
      } else {
        processItem(item)
      }
    }

    const maxWords = Math.max(100, ...recentBars.map((b) => b.words))

    return {
      totalWords,
      draftCount,
      publishedCount,
      totalCount: draftCount + publishedCount,
      kindCounts,
      recentBars,
      maxWords,
    }
  }, [items])

  if (items.length === 0) return null

  const draftRatio = stats.totalCount > 0 ? Math.round((stats.publishedCount / stats.totalCount) * 100) : 0

  return (
    <div className="ai-generations-visual-bar rounded-xl border border-border/80 bg-card p-3.5 mb-4 shadow-2xs space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[#D97757]" />
          <span className="text-xs font-semibold text-foreground">AI 创作产出全景仪表</span>
          <span className="rounded-full bg-[#D97757]/10 px-2 py-0.5 text-[11px] font-mono font-medium text-[#D97757]">
            累计沉淀 {stats.totalWords.toLocaleString()} 字符
          </span>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <>
              <span>展开图表</span>
              <ChevronDown className="size-3 ml-1" />
            </>
          ) : (
            <>
              <span>收起</span>
              <ChevronUp className="size-3 ml-1" />
            </>
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className="grid gap-3 pt-1 sm:grid-cols-[1fr_1.4fr]">
          {/* 左侧：产出概览指标与状态条 */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">草稿审阅进度</span>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{stats.publishedCount} 已发布</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-[#D97757] font-semibold">{stats.draftCount} 待审</span>
                <span className="text-muted-foreground ml-1">({draftRatio}%)</span>
              </div>
            </div>

            {/* 进度条 */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 flex">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${draftRatio}%` }}
                title={`已发布 ${stats.publishedCount} 条`}
              />
              <div
                className="h-full bg-[#D97757] transition-all duration-300"
                style={{ width: `${100 - draftRatio}%` }}
                title={`待审草稿 ${stats.draftCount} 条`}
              />
            </div>

            {/* 类型标签胶囊 */}
            <div className="flex flex-wrap gap-1.5 text-[11px] pt-1">
              {(stats.kindCounts.continue ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 border text-foreground/80">
                  <span className="size-1.5 rounded-full bg-[#D97757]" />
                  续写 {stats.kindCounts.continue} 篇
                </span>
              )}
              {(stats.kindCounts.write_chapter ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 border text-foreground/80">
                  <span className="size-1.5 rounded-full bg-blue-500" />
                  新章 {stats.kindCounts.write_chapter} 篇
                </span>
              )}
              {(stats.kindCounts.write_outline ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 border text-foreground/80">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  大纲 {stats.kindCounts.write_outline} 份
                </span>
              )}
            </div>
          </div>

          {/* 右侧：篇章字数分布迷你律动图柱 */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">生成篇章篇幅分布 (最近批次)</span>
              <span className="text-[11px]">峰值 ~{stats.maxWords.toLocaleString()} 字</span>
            </div>

            {stats.recentBars.length > 0 ? (
              <div className="flex items-end gap-1.5 h-12 pt-1 px-1">
                {stats.recentBars.map((bar, i) => {
                  const barHeight = Math.max(12, Math.round((bar.words / stats.maxWords) * 100))
                  return (
                    <div
                      key={i}
                      className="group relative flex-1 flex flex-col items-center justify-end h-full"
                    >
                      <div
                        className={cn(
                          'w-full rounded-t transition-all duration-200 group-hover:brightness-110',
                          bar.status === 'published' ? 'bg-emerald-500/80' : 'bg-[#D97757]/80'
                        )}
                        style={{ height: `${barHeight}%` }}
                      />
                      {/* Hover Tooltip */}
                      <div className="pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-10">
                        <div className="rounded-md bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-md border whitespace-nowrap">
                          <p className="font-semibold">{bar.label}</p>
                          <p>{bar.words.toLocaleString()} 字 · {bar.status === 'published' ? '已发布' : '草稿'}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2 text-center">暂无篇章字数数据</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
