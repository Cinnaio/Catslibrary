import { ArrowRight, Sparkles, Undo2, GitFork, Plus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AdminFormField from '@/components/admin/AdminFormField'
import { PLOT_TIMEOUT_MIN_SECONDS, PLOT_TIMEOUT_MAX_SECONDS } from '@shared/ai-plot-timeout'
import { cn } from '@/lib/utils'

export interface PlotSuggestionItem {
  direction: string
  effect: string
}

const INSPIRATION_TAGS = [
  { label: '强敌对决', focus: '强敌压境与生死交锋的紧张对决' },
  { label: '独处羁绊', focus: '两人独处、心意相通与情感升温' },
  { label: '暗线破局', focus: '暗藏线索浮出水面与局势突变' },
  { label: '阵营博弈', focus: '阵营各方利益交换与权谋周旋' },
  { label: '日常修整', focus: '师门日常互动与修为稳步突破' },
]

function detectTheme(direction: string, effect: string): { label: string } {
  const text = `${direction} ${effect}`
  if (/战|敌|逼|杀|刺|怒|斗|破|斩|兵|攻|陷|死|血|剑|武/i.test(text)) {
    return { label: '冲突' }
  }
  if (/独处|吻|拥|抚|修|抱|恋|爱|喜|情|柔|寝|心意|伴/i.test(text)) {
    return { label: '情感' }
  }
  if (/真相|惊|疑|谋|暗|局|秘|谍|伏|伪|反转|阴谋|察觉/i.test(text)) {
    return { label: '反转' }
  }
  if (/宗门|皇室|权|盟|朝堂|殿|帝|王|官|宴|臣|商会|势力/i.test(text)) {
    return { label: '博弈' }
  }
  return { label: '推进' }
}

export default function PlotSuggestionsStudio({
  novelId,
  suggestions,
  suggestBusy,
  instruction,
  onSelectDirection,
  onAppendDirection,
  onDeriveOutline,
  onLoadSuggestions,
  suggestionFill,
  onUndoFill,
  suggestCollapsed,
  onToggleCollapse,
  focus,
  onChangeFocus,
  plotTimeoutSeconds,
  onChangeTimeout,
  onCommitTimeout,
  disabled,
  outlineBusy,
}: {
  novelId: string
  suggestions: PlotSuggestionItem[]
  suggestBusy: boolean
  instruction: string
  onSelectDirection: (direction: string) => void
  onAppendDirection: (direction: string) => void
  onDeriveOutline: (direction: string) => void
  onLoadSuggestions: () => void
  suggestionFill: { applied: string; previous: string } | null
  onUndoFill: () => void
  suggestCollapsed: boolean
  onToggleCollapse: () => void
  focus: string
  onChangeFocus: (val: string) => void
  plotTimeoutSeconds: string | number
  onChangeTimeout: (val: string) => void
  onCommitTimeout: () => void
  disabled: boolean
  outlineBusy: boolean
}) {
  return (
    <div className="ai-plot-suggestions-studio space-y-3">
      {/* 灵感引导与侧重点控制行：精致克制、无视觉噪音 */}
      <div className="rounded-lg border border-border/70 bg-muted/10 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">偏好线索</span>
            <span className="text-[11px] text-muted-foreground/70">点击标签快速填入侧重点</span>
          </div>

          <div className="flex items-center gap-1">
            {INSPIRATION_TAGS.map((tag) => (
              <button
                key={tag.label}
                type="button"
                disabled={disabled || suggestBusy}
                onClick={() => onChangeFocus(tag.focus)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors border',
                  focus === tag.focus
                    ? 'border-[#D97757] bg-[#D97757]/10 text-[#D97757]'
                    : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>

        {/* 侧重点输入与超时设置 */}
        <div className="grid gap-2 pt-0.5 sm:grid-cols-[1fr_auto]">
          <div className="ai-writing-assist flex items-center gap-2">
            <span className="ai-writing-assist__label text-xs text-muted-foreground whitespace-nowrap" aria-hidden="true">
              侧重点
            </span>
            <Input
              aria-label="推荐侧重点（可选）"
              value={focus}
              onChange={(e) => onChangeFocus(e.target.value)}
              placeholder="可留空，或选择上方线索，例如：感情升温的日常互动"
              className="h-8 text-xs bg-background/80"
              disabled={disabled || suggestBusy}
            />
          </div>
          <AdminFormField
            label="情节推荐与大纲超时（秒）"
            htmlFor="ai-plot-timeout"
            hint="默认 180 秒，可设为 30–600 秒；在当前浏览器记住。"
            className="flex items-center gap-2"
          >
            <div className="flex items-center gap-1.5">
              <Input
                id="ai-plot-timeout"
                type="number"
                min={PLOT_TIMEOUT_MIN_SECONDS}
                max={PLOT_TIMEOUT_MAX_SECONDS}
                value={plotTimeoutSeconds}
                onChange={(e) => onChangeTimeout(e.target.value)}
                onBlur={onCommitTimeout}
                disabled={suggestBusy || outlineBusy}
                className="h-8 w-18 text-center text-xs bg-background/80"
              />
              <span className="text-xs text-muted-foreground">秒</span>
            </div>
          </AdminFormField>
        </div>
      </div>

      {/* 推荐候选卡片展示区 */}
      {suggestions.length > 0 ? (
        <div className="ai-writing-suggest-block space-y-2">
          <div className="ai-writing-suggest-block__head flex items-center justify-between gap-2 px-0.5 text-xs text-muted-foreground">
            <span>
              {suggestCollapsed ? `已取回 ${suggestions.length} 组方向（已收起）` : `推荐情节方向 (${suggestions.length})`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={!suggestCollapsed}
              aria-controls="ai-writing-suggest-list"
              onClick={onToggleCollapse}
            >
              {suggestCollapsed ? '展开' : '收起'}
            </Button>
          </div>

          {!suggestCollapsed && (
            <div id="ai-writing-suggest-list" className="ai-writing-suggest grid gap-2">
              {suggestions.map((item, index) => {
                const theme = detectTheme(item.direction, item.effect)
                const isSelected = instruction === item.direction

                return (
                  <button
                    key={`${index}-${item.direction.slice(0, 16)}`}
                    type="button"
                    className={cn(
                      'ai-writing-suggest__item group relative text-left transition-all duration-150',
                      'rounded-lg border p-3 bg-card',
                      isSelected
                        ? 'border-[#D97757] bg-[#D97757]/[0.03] border-l-4 border-l-[#D97757]'
                        : 'border-border/80 hover:border-border hover:bg-muted/15'
                    )}
                    aria-pressed={isSelected}
                    onClick={() => onSelectDirection(item.direction)}
                  >
                    {/* 卡片头部：序号、主题标签与快速动作 */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="ai-writing-suggest__index font-mono text-[11px] font-semibold text-muted-foreground">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.2 text-[10.5px] font-medium text-foreground/70">
                          {theme.label}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-[#D97757]">
                            <Check className="size-3" />
                            已选用
                          </span>
                        )}
                      </div>

                      {/* 辅助动作条 */}
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <span
                          role="button"
                          tabIndex={0}
                          className="px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground rounded transition-colors"
                          title="将本方向追加到现有情节末尾"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAppendDirection(item.direction)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation()
                              onAppendDirection(item.direction)
                            }
                          }}
                        >
                          + 追加
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="px-1.5 py-0.5 text-[11px] text-[#D97757] hover:underline rounded transition-colors"
                          title="以此情节为种子规划多章大纲"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeriveOutline(item.direction)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation()
                              onDeriveOutline(item.direction)
                            }
                          }}
                        >
                          以此定大纲
                        </span>
                      </div>
                    </div>

                    {/* 正文：情节方向 */}
                    <span className="ai-writing-suggest__body block space-y-1.5">
                      <span className="ai-writing-suggest__direction block text-xs sm:text-[13px] leading-relaxed text-foreground/90">
                        {item.direction}
                      </span>

                      {/* 预期推演走向 */}
                      {item.effect && (
                        <span className="ai-writing-suggest__effect flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                          <ArrowRight className="size-3 shrink-0 text-[#D97757]" aria-hidden="true" />
                          <span>走向预期：{item.effect}</span>
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* 撤销填入提示行 */}
          {!suggestCollapsed && suggestionFill && instruction === suggestionFill.applied && (
            <div className="ai-writing-suggest-undo flex items-center justify-between gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
              <span>已填入该条方向，原内容已被替换。</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-2 text-xs font-medium text-foreground hover:text-[#D97757]"
                onClick={onUndoFill}
              >
                撤销填入
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* 尚未获取候选时的占位说明 */
        <p className="ai-writing-suggest-placeholder flex items-start gap-2 rounded-lg border border-dashed border-border/80 bg-muted/5 p-3 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0 text-[#D97757] mt-0.5" aria-hidden="true" />
          <span>
            点左侧「推荐情节」，将基于本书最新章节与人物设定，梳理出贴合前文的续写分支。
          </span>
        </p>
      )}
    </div>
  )
}
