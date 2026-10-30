import { ArrowRight, Sparkles, Wand2, Compass, Undo2, Plus, GitFork } from 'lucide-react'
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
  { label: '⚔️ 强敌对决', focus: '强敌压境与生死交锋的紧张对决' },
  { label: '❤️ 独处羁绊', focus: '两人独处、心意相通与情感升温' },
  { label: '🌀 绝地反转', focus: '暗藏线索浮出水面与局势突变' },
  { label: '⚖️ 朝堂周旋', focus: '阵营各方利益交换与权谋博弈' },
  { label: '🗝️ 秘境奇遇', focus: '探索未知秘境与收获意外机缘' },
  { label: '🍵 宗门日常', focus: '师门日常互动与修为稳步突破' },
]

function detectTheme(direction: string, effect: string): { label: string; toneClass: string; icon: string; tension: number } {
  const text = `${direction} ${effect}`
  if (/战|敌|逼|杀|刺|怒|斗|破|斩|兵|攻|陷|死|血|剑|武/i.test(text)) {
    return { label: '戏剧冲突', toneClass: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20', icon: '⚔️', tension: 5 }
  }
  if (/独处|吻|拥|抚|修|抱|恋|爱|喜|情|柔|寝|心意|伴/i.test(text)) {
    return { label: '情感羁绊', toneClass: 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20', icon: '❤️', tension: 3 }
  }
  if (/真相|惊|疑|谋|暗|局|秘|谍|伏|伪|反转|阴谋|察觉/i.test(text)) {
    return { label: '悬念破局', toneClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20', icon: '🌀', tension: 4 }
  }
  if (/宗门|皇室|权|盟|朝堂|殿|帝|王|官|宴|臣|商会|势力/i.test(text)) {
    return { label: '阵营博弈', toneClass: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20', icon: '⚖️', tension: 4 }
  }
  return { label: '叙事推进', toneClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20', icon: '🌿', tension: 2 }
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
    <div className="ai-plot-suggestions-studio space-y-4">
      {/* 灵感引导与侧重点控制栏 */}
      <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Compass className="size-3.5 text-[#D97757]" />
            <span>情节灵感微触标</span>
            <span className="text-[11px] text-muted-foreground font-normal">点击快速填充推荐偏好</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || suggestBusy || !novelId}
              onClick={onLoadSuggestions}
              className="h-8 px-3 rounded-full text-xs font-medium border-[#D97757]/30 text-[#D97757] hover:bg-[#D97757]/10 transition-all shadow-2xs"
            >
              {suggestBusy ? (
                <>
                  <Sparkles className="size-3.5 mr-1.5 animate-spin" />
                  推演中…
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5 mr-1.5" />
                  {suggestions.length > 0 ? '换一批方向' : '智能推演'}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 灵感药丸标签 */}
        <div className="flex flex-wrap gap-1.5">
          {INSPIRATION_TAGS.map((tag) => (
            <button
              key={tag.label}
              type="button"
              disabled={disabled || suggestBusy}
              onClick={() => onChangeFocus(tag.focus)}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all',
                focus === tag.focus
                  ? 'bg-[#D97757] text-white border-transparent shadow-xs'
                  : 'bg-background/80 text-foreground/80 border-border/70 hover:border-[#D97757]/40 hover:bg-[#D97757]/5'
              )}
            >
              {tag.label}
            </button>
          ))}
        </div>

        {/* 侧重点输入与超时设置 */}
        <div className="grid gap-2.5 pt-1 sm:grid-cols-[1fr_auto]">
          <div className="ai-writing-assist flex items-center gap-2">
            <span className="ai-writing-assist__label text-xs text-muted-foreground whitespace-nowrap" aria-hidden="true">
              侧重点
            </span>
            <Input
              aria-label="推荐侧重点（可选）"
              value={focus}
              onChange={(e) => onChangeFocus(e.target.value)}
              placeholder="可留空，或选择上方微触标，例如：感情升温的日常互动"
              className="h-8 text-xs"
              disabled={disabled || suggestBusy}
            />
          </div>
          <AdminFormField
            label="情节推荐与大纲超时（秒）"
            htmlFor="ai-plot-timeout"
            hint="默认 180 秒，可设为 30–600 秒，同时用于推荐情节和按情节生成大纲；在当前浏览器记住。模型超时后不自动重试。"
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
                className="h-8 w-20 text-center text-xs"
              />
              <span className="text-xs text-muted-foreground">秒</span>
            </div>
          </AdminFormField>
        </div>
      </div>

      {/* 推荐候选卡片展示区 */}
      {suggestions.length > 0 ? (
        <div className="ai-writing-suggest-block space-y-2.5">
          <div className="ai-writing-suggest-block__head flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex size-2 rounded-full bg-[#D97757]" />
              <span>
                {suggestCollapsed
                  ? `已取回 ${suggestions.length} 条情节罗盘方向（已收起）`
                  : `已解析 ${suggestions.length} 组叙事分支走向 · 点选卡片即可采纳为本章情节`}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={!suggestCollapsed}
              aria-controls="ai-writing-suggest-list"
              onClick={onToggleCollapse}
            >
              {suggestCollapsed ? '展开推荐卡片' : '收起'}
            </Button>
          </div>

          {!suggestCollapsed && (
            <div id="ai-writing-suggest-list" className="ai-writing-suggest grid gap-3">
              {suggestions.map((item, index) => {
                const theme = detectTheme(item.direction, item.effect)
                const isSelected = instruction === item.direction

                return (
                  <button
                    key={`${index}-${item.direction.slice(0, 16)}`}
                    type="button"
                    className={cn(
                      'ai-writing-suggest__item group relative text-left transition-all duration-200',
                      'rounded-xl border p-3.5 shadow-2xs hover:shadow-xs',
                      isSelected
                        ? 'border-[#D97757] bg-[#D97757]/5 ring-1 ring-[#D97757]/30'
                        : 'border-border/80 bg-card hover:border-[#D97757]/40 hover:bg-muted/15'
                    )}
                    aria-pressed={isSelected}
                    onClick={() => onSelectDirection(item.direction)}
                  >
                    {/* 卡片头部：序号、主题标签与张力指示 */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="ai-writing-suggest__index flex size-5 items-center justify-center rounded-full bg-muted/60 font-mono text-[11px] font-semibold text-foreground/80">
                          {index + 1}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium shadow-2xs',
                            theme.toneClass
                          )}
                        >
                          <span>{theme.icon}</span>
                          <span>{theme.label}</span>
                        </span>
                      </div>

                      {/* 戏剧张力指示条 */}
                      <div className="flex items-center gap-1" title={`推演戏剧张力估值: ${theme.tension}/5 阶`}>
                        <span className="text-[10px] text-muted-foreground">张力</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((lvl) => (
                            <span
                              key={lvl}
                              className={cn(
                                'h-1.5 w-1.5 rounded-full transition-colors',
                                lvl <= theme.tension ? 'bg-[#D97757]' : 'bg-muted-foreground/20'
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 正文：情节方向 */}
                    <span className="ai-writing-suggest__body block space-y-2">
                      <span className="ai-writing-suggest__direction block text-xs sm:text-[13px] font-normal leading-relaxed text-foreground/95">
                        {item.direction}
                      </span>

                      {/* 预期效果与连锁涟漪 */}
                      {item.effect && (
                        <span className="ai-writing-suggest__effect flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1 text-[11.5px] text-muted-foreground border border-border/40">
                          <ArrowRight className="size-3 shrink-0 text-[#D97757]" aria-hidden="true" />
                          <span className="font-medium text-foreground/75">推演涟漪：</span>
                          <span className="line-clamp-1">{item.effect}</span>
                        </span>
                      )}
                    </span>

                    {/* 辅助动作条：融入现有 / 以此衍生大纲 */}
                    <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-[11px]">
                      <span className="text-[11px] text-muted-foreground group-hover:text-foreground/80 transition-colors">
                        {isSelected ? '✓ 当前已采纳为本次情节' : '点击采纳为本次情节'}
                      </span>
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          title="将本方向追加到现有情节末尾，保留原有内容"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAppendDirection(item.direction)
                          }}
                        >
                          <Plus className="size-3 mr-0.5" />
                          融入
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-[#D97757] hover:bg-[#D97757]/10"
                          title="以这条情节方向为核心种子，生成多章连续大纲"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeriveOutline(item.direction)
                          }}
                        >
                          <GitFork className="size-3 mr-0.5" />
                          衍生大纲
                        </Button>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* 撤销填入提示条 */}
          {!suggestCollapsed && suggestionFill && instruction === suggestionFill.applied && (
            <div className="ai-writing-suggest-undo flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-900 dark:text-amber-200">
              <span className="flex items-center gap-1.5">
                <Undo2 className="size-3.5 text-amber-600" />
                <span>已将推荐情节填入本次要求，若有手写草案可一键恢复。</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2.5 text-xs font-medium text-amber-900 hover:bg-amber-500/20 dark:text-amber-100"
                onClick={onUndoFill}
              >
                撤销填入
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* 尚未获取候选时的占位说明 */
        <p className="ai-writing-suggest-placeholder flex items-start gap-2.5 rounded-xl border border-dashed border-border/90 bg-muted/10 p-3.5 text-xs text-muted-foreground">
          <Sparkles className="size-4 shrink-0 text-[#D97757] mt-0.5" aria-hidden="true" />
          <span>
            点选上方「推荐情节」或微触标，系统将基于本书最新章节与人物记忆档案，智能推演出具有不同戏剧张力的情节分支。
          </span>
        </p>
      )}
    </div>
  )
}
