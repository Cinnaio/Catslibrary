/** 情节档案：从全部历史正文分批初始化，后续校验来源并增量更新。
 * 中间检查点与正式档案分离；仅完整覆盖目标后供续写使用。
 */
import type { Db } from '../../db/pool'
import { advanceStoryMemory, cleanStoryText, type StoryMemoryOptions, type StoryMemoryResult } from './story-memory'
import { first } from '../../db/query'
import { evaluateProfileSource, type ProfileEligibility, type ProfileSource } from './profile-source'

/** 默认每批章节上限；不限制历史覆盖范围。 */
export const DEFAULT_PLOT_SAMPLE_CHAPTERS = 8

/** 取样失败（小说无章节）时的兜底：返回空，续写时跳过注入不阻断。 */
export const FALLBACK_PLOT_STATE = ''

const PLOT_EXTRACT_SYSTEM = `你是中文网络小说情节分析师。请只根据给定的章节正文，提取当前的故事状态，不要复述剧情经过。
严格按以下四块输出，每块用列表罗列，条目简洁具体（人名、关键设定、状态），不要空泛；每条标注它属于“已确认事实”“人物认知”“未解线索”或“可选方向”：

1. 角色状态：每个主要角色当前的处境、情绪、下一步目标。
2. 在场物品/地点：当前剧情里出现的重要地点和道具及其用途。
3. 已埋伏笔：尚未回收的悬念或暗示；把正文已有线索与可选回收方向分开，后者不能写成已经发生的事实。
4. 待解决冲突：当前悬而未决的矛盾或威胁。

重要约束：
- 所有状态必须来自正文，正文未提到的不要臆造。
- 人设以原文为准：角色的性格、说话方式、与他人的关系以正文表现为准，不要美化或改变；旧状态不是永久设定。
- 只输出分析结果，不要解释，不要重复正文，不要 Markdown 标题，用「1.」「2.」「3.」「4.」标记四块即可。`

/**
 * 是否可以把上一版状态作为增量基底。
 *
 * 只允许「向前推进」：新起点严格晚于上一版覆盖到的章节。侧向重提同一章或
 * 向更早的章节重提时不回带——那些场景要么是同一时点重新推导，要么是在补
 * 较早的状态，把后来的剧情写进去就是时序污染。
 */
export function shouldCarryForward(previous: { state: string; chaptersThrough: number } | undefined, nextChaptersThrough: number): boolean {
  if (!previous || !previous.state.trim()) return false
  if (!Number.isFinite(previous.chaptersThrough) || previous.chaptersThrough <= 0) return false
  return nextChaptersThrough > previous.chaptersThrough
}

export interface PlotStateResult extends Omit<StoryMemoryResult, 'content'> {
  state: string
  chaptersThrough: number
}

/** Advance one resumable batch over the complete chapter prefix. */
export async function extractPlotState(db: Db, opts: StoryMemoryOptions): Promise<PlotStateResult> {
  const { content, ...result } = await advanceStoryMemory(db, 'plot', PLOT_EXTRACT_SYSTEM, opts)
  return { ...result, state: content, chaptersThrough: result.processedChapters }
}

/** 读取已存的情节状态；未提取过返回空对象，调用方决定是否兜底。 */
export async function getPlotState(db: Db, novelId: string): Promise<{ state: string; chaptersThrough: number }> {
  const row = await first<{ state: string; chapters_through: number }>(db, 'SELECT state, chapters_through FROM novel_plot_states WHERE novel_id = $1', [
    novelId,
  ])
  return { state: row?.state || '', chaptersThrough: Number(row?.chapters_through) || 0 }
}

export async function getPlotStateForAnchor(
  db: Db,
  novelId: string,
  afterChapterId?: string,
): Promise<{
  state: string
  source?: ProfileSource
  updatedAt: number
  eligibility: ProfileEligibility
  isOlderThanAnchor: boolean
}> {
  const result = await evaluateProfileSource(db, { kind: 'plot', novelId, afterChapterId, clean: cleanForSample })
  return {
    state: result.profile,
    source: result.source,
    updatedAt: result.updatedAt,
    eligibility: result.eligibility,
    isOlderThanAnchor: result.isOlderThanAnchor,
  }
}

/** Full normalized text is also used when checking archive invalidation. */
const cleanForSample = cleanStoryText
