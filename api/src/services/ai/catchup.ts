/**
 * 回来接着读 —— 为「隔了很久才回来」的读者合成一段连贯回顾。
 * 原料全部复用已缓存的单章提要，绝不触发生成；合成只需一次短上下文调用，边际成本接近零。
 * 结果按 (进度章, 参与章节摘要版本列表) 缓存，摘要重生成后缓存自然失效。
 */
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { chat, isTextAiConfigured, providerLabel, textProvider, AiError } from './client'
import { findPublished, saveGeneration, type Generation } from './generations'
import { recapParams } from './summary'
import { recordUsage } from './usage'

/** 提示词版本：改动下方 prompt 时 +1，历史缓存自动失效重算。 */
export const CATCHUP_PROMPT_VERSION = 1
export const CATCHUP_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** 参与合成的单章提要最少条数：太少拼不出连贯回顾，直接给 null，前端不渲染。 */
const MIN_SUMMARIES = 2
/** 往前取多少章候选（含进度章），过滤出已有发布提要的。 */
const CANDIDATE_COUNT = 5

type CatchupReason = 'no_progress' | 'not_stale' | 'insufficient_summaries'

const SYSTEM_PROMPT = [
  '你是中文网络小说的阅读助手，为「隔了很久才回来的读者」写一段连贯回顾。',
  '要求：',
  '1. 用 150 字以内概括最近几章发生过的事，按时间顺序连贯成一段；',
  '2. 只写已发生的剧情，不推测后续、不补充设定、不做评价；',
  '3. 用第三人称陈述，不要出现「本章」「作者」等元叙述词；',
  '4. 直接输出回顾正文，不要标题、不要前后缀、不要 Markdown。',
].join('\n')

interface ProgressRow {
  chapter_id: string
  updated_at: number
}

interface CatchupChapter {
  id: string
  title: string
  sort_order: number
  summary: string
  generationId: string
}

export interface CatchupSource {
  progress: ProgressRow
  chapters: CatchupChapter[]
  paramsJson: string
}

export interface CatchupInspection {
  reason?: CatchupReason
  source?: CatchupSource
}

export interface CatchupResult {
  generation: Generation | null
  cached: boolean
  /** 参与合成的章节 id 列表（已过滤掉没有提要的章） */
  chapterIds: string[]
  usage: { model: string; promptTokens: number; completionTokens: number } | null
}

async function loadProgress(db: Db, userId: string, novelId: string): Promise<ProgressRow | undefined> {
  return first<ProgressRow>(
    db,
    `SELECT chapter_id, updated_at FROM reading_progress
     WHERE user_id = $1 AND novel_id = $2 AND COALESCE(deleted_at, 0) = 0`,
    [userId, novelId],
  )
}

/** 取进度章往前（含）最多 CANDIDATE_COUNT 章，只保留已有发布提要的版本。 */
async function loadCatchupChapters(db: Db, novelId: string, chapterId: string, model: string): Promise<CatchupChapter[]> {
  const progressChapter = await first<{ sort_order: number }>(db, 'SELECT sort_order FROM chapters WHERE id = $1', [chapterId])
  if (!progressChapter) return []
  const candidates = await all<{ id: string; title: string; sort_order: number }>(
    db,
    `SELECT id, title, sort_order FROM chapters
     WHERE novel_id = $1 AND sort_order <= $2
     ORDER BY sort_order DESC LIMIT $3`,
    [novelId, progressChapter.sort_order, CANDIDATE_COUNT],
  )
  const withSummary: CatchupChapter[] = []
  // 缓存键带提示词指纹：管理员自定义过系统提示词时，旧的 summary 缓存不再命中
  const summaryKey = await recapParams(db, model)
  for (const ch of candidates.reverse()) {
    const g = await findPublished(db, 'summary', ch.id, summaryKey)
    if (g) withSummary.push({ id: ch.id, title: ch.title, sort_order: ch.sort_order, summary: g.result, generationId: g.id })
  }
  return withSummary
}

/** 缓存键绑定摘要 generation ID；单章摘要重生成后即使章节 ID 不变也会失效。 */
export function catchupParams(model: string, chapters: Array<{ id: string; generationId: string }>): string {
  return JSON.stringify({
    version: CATCHUP_PROMPT_VERSION,
    model: model || '',
    summaries: chapters.map((c) => ({ chapterId: c.id, generationId: c.generationId })),
  })
}

/**
 * 只读检查 Catch-up 是否允许生成：后端规则的唯一来源。
 * 顺序上先挡无进度/未过 7 天，再检查已发布摘要数量，调用方可据此在配额检查前返回。
 */
export async function inspectCatchup(db: Db, userId: string, novelId: string, model: string, now = Date.now()): Promise<CatchupInspection> {
  const progress = await loadProgress(db, userId, novelId)
  if (!progress) return { reason: 'no_progress' }
  if (now - Number(progress.updated_at) < CATCHUP_STALE_AFTER_MS) return { reason: 'not_stale' }

  const chapters = await loadCatchupChapters(db, novelId, progress.chapter_id, model)
  if (chapters.length < MIN_SUMMARIES) return { reason: 'insufficient_summaries' }
  return { source: { progress, chapters, paramsJson: catchupParams(model, chapters) } }
}

/** 只查缓存，不触发生成、不计配额。可传 inspection 结果避免重复查询。 */
export async function getCachedCatchup(
  db: Db,
  userId: string,
  novelId: string,
  model: string,
  inspection?: CatchupInspection,
): Promise<Generation | undefined> {
  const checked = inspection || (await inspectCatchup(db, userId, novelId, model))
  if (!checked.source) return undefined
  return findPublished(db, 'catchup', checked.source.progress.chapter_id, checked.source.paramsJson)
}

/** 进程内 in-flight 去重：同一用户同本书并发时只有一个真实上游调用。 */
const inflight = new Map<string, Promise<CatchupResult>>()

export async function generateCatchup(
  db: Db,
  opts: { userId: string; novelId: string; source?: CatchupSource; ipAddress?: string; userAgent?: string },
): Promise<CatchupResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)

  const key = `${opts.userId}:${opts.novelId}`
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = runGenerateCatchup(db, opts)
  inflight.set(key, promise)
  // 清理用 then(cleanup, cleanup)：失败时不留未处理的派生 promise
  promise.then(cleanup, cleanup)
  return promise

  function cleanup() {
    if (inflight.get(key) === promise) inflight.delete(key)
  }
}

async function runGenerateCatchup(db: Db, opts: { userId: string; novelId: string; source?: CatchupSource; ipAddress?: string; userAgent?: string }): Promise<CatchupResult> {
  const provider = textProvider()
  const source = opts.source || (await inspectCatchup(db, opts.userId, opts.novelId, provider.model)).source
  if (!source) return { generation: null, cached: false, chapterIds: [], usage: null }

  const chapters = source.chapters
  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [opts.novelId])
  const userPrompt = buildUserPrompt(novel?.title || '', chapters)

  const res = await chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    maxTokens: 1200,
  })

  const generation = await saveGeneration(db, {
    novelId: opts.novelId,
    chapterId: source.progress.chapter_id,
    kind: 'catchup',
    model: res.model,
    paramsJson: source.paramsJson,
    prompt: userPrompt,
    result: res.text,
    status: 'published',
    createdBy: opts.userId || '',
  })

  await recordUsage(db, {
    userId: opts.userId || '',
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    costMillicents: Math.round(res.cost * 100_000),
    novelId: opts.novelId,
    chapterId: chapters[0]?.id || '', // 使用第一章作为代表
    generationType: 'catchup',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })

  return {
    generation,
    cached: false,
    chapterIds: chapters.map((c) => c.id),
    usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens },
  }
}

function buildUserPrompt(novelTitle: string, chapters: CatchupChapter[]): string {
  const lines = chapters.map((c) => {
    const label = c.sort_order ? `第 ${c.sort_order} 章` : '章节'
    return `${label} ${c.title || ''}\n${c.summary}`
  })
  return [`小说：《${novelTitle || '未命名'}》`, '以下按时间顺序列出最近几章的内容提要：', ...lines].join('\n')
}
