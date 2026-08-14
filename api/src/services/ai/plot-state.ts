/**
 * 小说情节状态 —— novel-continuation-ai skill 的「plot_state」落地。
 *
 * 多章续写时只靠「把上一章追加回 context」会在 10+ 章后因上下文截断而丢人设、忘伏笔、
 * 产生前后矛盾。这里取最近若干章已发布正文，让文本模型提炼成结构化的情节状态
 * （角色处境/情绪/目标、在场物品地点、已埋伏笔、待解决冲突），存进 novel_plot_states，
 * 续写时拼进 user 消息。一次提取长期复用，管理员手动触发刷新。
 *
 * 对应 skill 的 Step 3「情节状态追踪」+ Step 5「更新情节状态」。落成持久化数据，
 * skill 的踩坑铁律（设定以原文为准、人设不偏离）固化进提取时的 system prompt。
 */
import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'

/** 默认取样章节数：剧情线比风格画像需要更长，8 章覆盖一条完整剧情弧。 */
export const DEFAULT_PLOT_SAMPLE_CHAPTERS = 8
/** 单章取样字符上限。 */
const PLOT_SAMPLE_CHARS = 4000
const MAX_SAMPLE_CHAPTERS = 30
const MIN_SAMPLE_CHAPTERS = 1

/** 取样失败（小说无章节）时的兜底：返回空，续写时跳过注入不阻断。 */
export const FALLBACK_PLOT_STATE = ''

const PLOT_EXTRACT_SYSTEM = `你是中文网络小说情节分析师。请只根据给定的章节正文，提取当前的故事状态，不要复述剧情经过。
严格按以下四块输出，每块用列表罗列，条目简洁具体（人名、关键设定、状态），不要空泛：

1. 角色状态：每个主要角色当前的处境、情绪、下一步目标。
2. 在场物品/地点：当前剧情里出现的重要地点和道具及其用途。
3. 已埋伏笔：尚未回收的悬念或暗示，标注后续可能的回收方向。
4. 待解决冲突：当前悬而未决的矛盾或威胁。

重要约束：
- 所有状态必须来自正文，正文未提到的不要臆造。
- 人设以原文为准：角色的性格、说话方式、与他人的权力关系以正文表现为准，不要美化或改变。
- 只输出分析结果，不要解释，不要重复正文，不要 Markdown 标题，用「1.」「2.」「3.」「4.」标记四块即可。`

export interface PlotStateResult {
  state: string
  chaptersThrough: number
  model: string
  usage: { promptTokens: number; completionTokens: number }
}

/** 取样章节数夹到安全区间。 */
function clampSampleCount(value: unknown): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_PLOT_SAMPLE_CHAPTERS
  return Math.min(MAX_SAMPLE_CHAPTERS, Math.max(MIN_SAMPLE_CHAPTERS, n))
}

/**
 * 为小说提取情节状态。取样最近 N 章已发布正文（N 可配，默认 8），调文本模型产出结构化状态，
 * 落 novel_plot_states。已有状态则覆盖刷新。无章节时写空状态并返回，不抛错——续写仍可进行。
 */
export async function extractPlotState(db: Db, opts: {
  userId: string
  novelId: string
  /** 取样最近多少章正文，默认 8，范围 1-30。 */
  sampleChapters?: number
  ipAddress?: string
  userAgent?: string
}): Promise<PlotStateResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const { novelId } = opts
  const sampleChapters = clampSampleCount(opts.sampleChapters)

  const rows = await all<{ title: string; content: string }>(
    db,
    'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT $2',
    [novelId, sampleChapters],
  )
  const now = Date.now()
  const settings = await getAiSettings(db)
  // 无章节：写空状态，让续写跳过注入
  if (!rows.length) {
    await run(
      db,
      `INSERT INTO novel_plot_states (novel_id, state, chapters_through, model, created_at, updated_at)
       VALUES ($1, $2, 0, $3, $4, $4)
       ON CONFLICT (novel_id) DO UPDATE SET state = EXCLUDED.state, chapters_through = EXCLUDED.chapters_through, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at`,
      [novelId, FALLBACK_PLOT_STATE, '', now],
    )
    return { state: FALLBACK_PLOT_STATE, chaptersThrough: 0, model: '', usage: { promptTokens: 0, completionTokens: 0 } }
  }

  const sample = rows.reverse().map((row) => `【${row.title}】\n${cleanForSample(row.content)}`).join('\n\n')
  const res = await chat({
    messages: [
      { role: 'system', content: PLOT_EXTRACT_SYSTEM },
      { role: 'user', content: `作品正文样例（最近 ${rows.length} 章）：\n${sample}` },
    ],
    temperature: 0.3,
    maxTokens: settings.plotStateMaxTokens,
    timeoutMs: 120_000,
  })
  const state = res.text.trim() || FALLBACK_PLOT_STATE
  await run(
    db,
    `INSERT INTO novel_plot_states (novel_id, state, chapters_through, model, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (novel_id) DO UPDATE SET state = EXCLUDED.state, chapters_through = EXCLUDED.chapters_through, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at`,
    [novelId, state, rows.length, res.model, now],
  )
  await recordUsage(db, {
    userId: opts.userId,
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    costMillicents: Math.round(res.cost * 100000),
    novelId,
    generationType: 'plot_state',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
  return { state, chaptersThrough: rows.length, model: res.model, usage: { promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

/** 读取已存的情节状态；未提取过返回空对象，调用方决定是否兜底。 */
export async function getPlotState(db: Db, novelId: string): Promise<{ state: string; chaptersThrough: number }> {
  const row = await first<{ state: string; chapters_through: number }>(
    db,
    'SELECT state, chapters_through FROM novel_plot_states WHERE novel_id = $1',
    [novelId],
  )
  return { state: row?.state || '', chaptersThrough: Number(row?.chapters_through) || 0 }
}

/** 清洗取样正文：去 HTML/多余空白，单章截断。 */
function cleanForSample(raw: string): string {
  return String(raw || '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, PLOT_SAMPLE_CHARS)
}
