import { removeAdPatterns } from '@shared/ad-cleaner'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { chat, isTextAiConfigured, providerLabel, textProvider, AiError } from './client'
import { saveGeneration, type Generation, type BatchDraft } from './generations'
import { recordUsage } from './usage'
import { getAiSettings } from './settings'
import { createAiTask, isAiTaskActive, startAiTaskHeartbeat, updateAiTask } from './tasks'
import { getStyleProfile } from './style-profile'
import { getPlotState } from './plot-state'
import { getRelationshipProfile } from './relationship-profile'
import { compileWritingPrompt, WRITING_PROMPT_PIPELINE_VERSION } from './writing-prompt'
import { DEFAULT_WRITING_CONTENT_PREFERENCES, formatWritingContentPreferences, validateWritingContentPreferences, type WritingContentPreferencesV1 } from './writing-preferences'

const MAX_CONTEXT_CHARS = 12000

export interface WritingResult {
  generation: Generation
  usage: { model: string; promptTokens: number; completionTokens: number }
}

export interface WritingBatchResult {
  generations: Generation[]
  usage: { model: string; promptTokens: number; completionTokens: number }
}

export interface WritingTitlesResult {
  titles: string[]
  usage: { model: string; promptTokens: number; completionTokens: number }
}

export interface WritingBriefGoalV1 {
  index: number
  goal: string
}

export interface WritingBriefV1 {
  version: 1
  viewpoint: string
  pace: string
  objective: string
  requiredFacts: string
  forbiddenEvents: string
  chapterGoals: WritingBriefGoalV1[]
}

const WRITING_BRIEF_LIMITS = {
  viewpoint: 200,
  pace: 200,
  objective: 1000,
  requiredFacts: 3000,
  forbiddenEvents: 3000,
  goal: 1000,
  total: 12000,
} as const

function scalarLength(value: string): number {
  return Array.from(value).length
}

/** 规范化并校验用户编辑的结构化创作要求；不接受客户端提供的上下文或画像。 */
export function validateWritingBrief(value: unknown, chapterCount = 1): { brief?: WritingBriefV1; error?: string } {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'writingBrief 必须是对象' }
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return { error: 'writingBrief.version 必须为 1' }
  const textFields = ['viewpoint', 'pace', 'objective', 'requiredFacts', 'forbiddenEvents'] as const
  const values = {} as Record<(typeof textFields)[number], string>
  for (const field of textFields) {
    const rawValue = raw[field]
    if (rawValue !== undefined && typeof rawValue !== 'string') return { error: `writingBrief.${field} 必须是字符串` }
    const valueText = String(rawValue ?? '').trim()
    values[field] = valueText
    if (scalarLength(valueText) > WRITING_BRIEF_LIMITS[field]) {
      return { error: `writingBrief.${field} 超过 ${WRITING_BRIEF_LIMITS[field]} 个 Unicode 标量` }
    }
  }
  const rawGoals = raw.chapterGoals
  if (rawGoals !== undefined && !Array.isArray(rawGoals)) return { error: 'writingBrief.chapterGoals 必须是数组' }
  const goals: WritingBriefGoalV1[] = []
  const seen = new Set<number>()
  for (const item of (rawGoals || []) as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: 'writingBrief.chapterGoals 项必须是对象' }
    const goal = item as Record<string, unknown>
    if (!Number.isInteger(goal.index) || Number(goal.index) < 1 || Number(goal.index) > Math.max(1, Math.trunc(chapterCount))) {
      return { error: 'writingBrief.chapterGoals.index 必须是本批范围内的正整数' }
    }
    if (typeof goal.goal !== 'string') return { error: 'writingBrief.chapterGoals.goal 必须是字符串' }
    const index = Number(goal.index)
    if (seen.has(index)) return { error: 'writingBrief.chapterGoals.index 不能重复' }
    const text = goal.goal.trim()
    if (scalarLength(text) > WRITING_BRIEF_LIMITS.goal) return { error: `writingBrief.chapterGoals.goal 超过 ${WRITING_BRIEF_LIMITS.goal} 个 Unicode 标量` }
    seen.add(index)
    goals.push({ index, goal: text })
  }
  goals.sort((a, b) => a.index - b.index)
  const total = textFields.reduce((sum, field) => sum + scalarLength(values[field]), 0) + goals.reduce((sum, item) => sum + scalarLength(item.goal), 0)
  if (total > WRITING_BRIEF_LIMITS.total) return { error: `writingBrief 总长度超过 ${WRITING_BRIEF_LIMITS.total} 个 Unicode 标量` }
  return {
    brief: {
      version: 1,
      ...values,
      chapterGoals: goals,
    },
  }
}

/** 以固定顺序生成用户可编辑要求；每章只注入对应的目标。 */
export function formatWritingBrief(brief: WritingBriefV1 | undefined, chapterIndex = 1): { structured: string; goal: string } {
  if (!brief) return { structured: '', goal: '' }
  const structured = [
    '结构化创作要求（用户编辑）：',
    `叙事视角：${brief.viewpoint || '未指定'}`,
    `节奏：${brief.pace || '未指定'}`,
    `本章目标：${brief.objective || '未指定'}`,
    `必须保留的事实：${brief.requiredFacts || '未指定'}`,
    `禁止发生的事件：${brief.forbiddenEvents || '未指定'}`,
  ].join('\n')
  const selectedGoal = brief.chapterGoals.find((item) => item.index === chapterIndex)?.goal || ''
  return { structured, goal: selectedGoal ? `本批第 ${chapterIndex} 章目标（用户编辑）：\n${selectedGoal}` : '' }
}

export interface ContinuationAnchor {
  chapterId: string
  title: string
  sortOrder: number
  chapterOrdinal: number
}

export interface ContinuationSnapshotV1 {
  version: 1
  contextPolicyVersion: 1
  anchor: { chapterId: string; title: string; sortOrder: number }
  context: string
  profiles: { style: string; relationship: string; plot: string }
  profileSources: Record<string, unknown>
  /** 每类画像当时绑定的人工 revision；没有人工层时为 0。 */
  profileRevisions: Record<string, number>
  /** 自动画像正文与来源的稳定基底 revision，用于审计快照而非重算。 */
  profileBaseRevisions: Record<string, string>
  /** 每类有效画像在快照时的来源层；旧快照缺失时按 legacy 兼容。 */
  profileOrigins?: Record<string, 'automatic' | 'manual' | 'legacy'>
  /** 任务创建时冻结的成人内容参数；旧快照缺失时按关闭兼容。 */
  contentPreferences?: WritingContentPreferencesV1
  excludedProfiles: Array<{ kind: 'style' | 'relationship' | 'plot'; reason: string }>
}

export function cleanWritingText(raw: string, maxChars = MAX_CONTEXT_CHARS): string {
  return removeAdPatterns(String(raw || ''))
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars)
}

/** 续写上下文只保留正文尾部；普通标题/摘要等调用继续使用 cleanWritingText 的前缀语义。 */
export function cleanWritingTail(raw: string, maxChars = MAX_CONTEXT_CHARS): string {
  const cleaned = removeAdPatterns(String(raw || ''))
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned.slice(-Math.max(0, Math.trunc(maxChars)))
}

export function parseWritingTitles(raw: string): string[] {
  const source = String(raw || '').trim()
  let candidates: unknown[] = []
  try {
    const parsed = JSON.parse(source) as unknown
    if (Array.isArray(parsed)) candidates = parsed
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { titles?: unknown }).titles)) candidates = (parsed as { titles: unknown[] }).titles
  } catch {
    candidates = source.split(/\r?\n/)
  }
  return candidates
    .map((item) => String(item || '').replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '').replace(/^['"“”「」]+|['"“”「」]+$/g, '').trim())
    .filter((title, index, list) => title.length >= 2 && title.length <= 40 && list.indexOf(title) === index)
    .slice(0, 3)
}

/** 清洗标题：剥掉引号/书名号/【】等包裹符号，保留包裹后跟随的 H 评级标记，截断到 40 字。 */
function cleanTitle(value: string): string {
  const text = String(value || '').trim()
  const wrapped = text.match(/^[【《「“]([^】》”」]*)[】》”」]\s*(.*)$/)
  const inner = wrapped
    ? [wrapped[1]?.trim(), /^[Hh]+$/.test(wrapped[2]?.trim() || '') ? wrapped[2]?.trim().toUpperCase() : wrapped[2]?.trim()]
        .map((part) => part || '')
        .filter(Boolean)
        .join(' ')
    : text
  return inner
    .replace(/^['"“”「」《》【】]+|['"“”「」《》【】]+$/g, '')
    .trim()
    .slice(0, 40)
}

/** 从单行提取标题：「标题：xxx」前缀 / 【】《》「」包裹 / # 前缀；不满足返回空。 */
function titleFromLine(line: string): string {
  const labeled = line.match(/^(?:章节标题|标题|title)\s*[:：]\s*(.+)$/i)
  if (labeled) return cleanTitle(labeled[1] || '')
  if (/^[#【《「“]/.test(line)) return cleanTitle(line.replace(/^#+\s*/, ''))
  return ''
}

/** 章节正文中再次出现的独立标题行，说明模型越界开始写下一章。 */
function isChapterBoundary(line: string): boolean {
  const text = line.trim()
  return /^(?:#+\s*)?第\s*[0-9一二三四五六七八九十百千零两]+\s*[章节回](?:\s+.+)?$/.test(text)
    || /^【[^】\r\n]{2,40}】\s*[Hh]*$/.test(text)
}

/** 保留当前章正文，丢弃从第二个独立章节标题开始的越界内容。 */
function firstChapterBody(body: string): string {
  const lines = body.split('\n')
  for (let index = 1; index < lines.length; index += 1) {
    if (!(lines[index - 1] || '').trim() && isChapterBoundary(lines[index] || '')) {
      return lines.slice(0, index).join('\n').trimEnd()
    }
  }
  return body
}

/**
 * 从续写输出中提取标题并返回剥离标题后的正文。兼容真实产出过的格式：
 * - 开头的章节号行（「## 第 6 章」「第 88 章」）：章节号不是标题；若同行带尾巴（「第 3 章 锁孔里的光」）则尾巴是标题，否则看下一行
 * - 「【标题】HH」/《标题》/「标题」等包裹形态：尾部可带 H 评级标记（自定义提示词要求 H 数量标注），保留进标题
 * - 「标题：xxx」/「章节标题: xxx」/「Title: xxx」前缀
 * - 裸首行标题：长度 2-30、不以句末标点结尾、且紧跟空行（提示词要求"标题后空一行再写正文"）
 * - 正文中再次出现独立章节标题时，只保留第一章，防止多章内容混入同一草稿
 * 未识别到标题时原样返回，不破坏既有行为。
 */
export function parseContinuationTitle(raw: string): { title: string; body: string } {
  const source = String(raw || '').replace(/\r\n/g, '\n').trimStart()
  const lines = source.split('\n')
  let index = 0
  let title = ''

  const numberLine = (lines[0] || '').trim().match(/^(?:#+\s*)?第\s*[0-9一二三四五六七八九十百千零两]+\s*[章节回]\s*(.*)$/)
  if (numberLine) {
    const tail = (numberLine[1] || '').trim()
    title = titleFromLine(tail) || cleanTitle(tail.replace(/^[\s:：、.．]+/, ''))
    index = 1
  }

  if (!title) {
    const line = (lines[index] || '').trim()
    if (!line) return { title: '', body: source.trim() }
    title = titleFromLine(line)
    if (!title && line.length >= 2 && line.length <= 30 && !/[。！？!?…]$/.test(line) && !(lines[index + 1] || '').trim()) {
      title = cleanTitle(line)
    }
    if (title) index += 1
  }

  if (!title) return { title: '', body: source.trim() }
  const rest = lines.slice(index).join('\n').replace(/^\n+/, '').trim()
  // 剥离标题后正文为空，说明整个输出只是一行（如短测试文本），不算标题行
  if (!rest) return { title: '', body: source.trim() }
  return { title, body: firstChapterBody(rest) }
}

export async function generateWritingTitles(db: Db, opts: {
  userId: string
  novelId?: string
  content: string
  contextTitle?: string
  ipAddress?: string
  userAgent?: string
  taskId?: string
}): Promise<WritingTitlesResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const settings = await getAiSettings(db)
  const prompt = [
    '请为下面的中文网络小说正文拟定 1-3 个章节标题。标题要贴合正文的核心事件、情绪或悬念，简洁自然，避免剧透，不要使用书名号。',
    '只返回 JSON 数组，例如：["标题一","标题二","标题三"]，不要解释。',
    opts.contextTitle ? `已有标题或上下文：${opts.contextTitle}` : '',
    `正文：\n${cleanWritingText(opts.content)}`,
  ].filter(Boolean).join('\n\n')
  const res = await chat({
    messages: [
      { role: 'system', content: '你是中文网络小说编辑，擅长根据正文提炼准确、有吸引力且不夸张的章节标题。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    maxTokens: settings.titleMaxTokens,
    timeoutMs: 120_000,
  })
  const titles = parseWritingTitles(res.text)
  if (!titles.length) throw new AiError('invalid', 'AI 未返回有效的标题候选')
  await recordUsage(db, {
    userId: opts.userId,
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    costMillicents: Math.round(res.cost * 100000),
    novelId: opts.novelId,
    generationType: 'writing_title',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
  return { titles, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

/**
 * 情节方向候选：给作者提供可直接用作续写指令的情节建议。
 * 与 write_outline 的区别是它不产出章节大纲，只产出若干条一句话的方向，
 * 作者选定一条后填进 instruction 即可——实测空指令会让模型自由发挥走向战斗线。
 */
export interface PlotSuggestion {
  /** 一句话的情节方向，可直接作为续写指令主体。 */
  direction: string
  /** 这条方向会推进什么（人物关系/势力冲突/伏笔回收），一句话。 */
  effect: string
}

/** 把模型输出解析成情节候选。容忍纯行列表与对象列表两种形态。 */
export function parsePlotSuggestions(text: string): PlotSuggestion[] {
  const source = cleanWritingText(text).trim()
  if (!source) return []
  // 优先按 JSON 解析：模型可能返回 [{direction, effect}]。
  const jsonStart = source.indexOf('[')
  const jsonEnd = source.lastIndexOf(']')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(source.slice(jsonStart, jsonEnd + 1)) as unknown
      if (Array.isArray(parsed)) {
        const out: PlotSuggestion[] = []
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim()) out.push({ direction: item.trim(), effect: '' })
          else if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>
            const direction = String(rec.direction ?? rec.plot ?? rec.text ?? '').trim()
            if (direction) out.push({ direction, effect: String(rec.effect ?? rec.reason ?? '').trim() })
          }
        }
        if (out.length) return out.slice(0, 6)
      }
    } catch {
      // 非 JSON，退回行解析
    }
  }
  // 行解析：去掉序号、项目符号与 markdown 标记，每行一条。
  return source
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)）])\s*/, '').trim())
    .filter((line) => line.length >= 6 && !/^[{}\[\],]+$/.test(line))
    .slice(0, 6)
    .map((line) => ({ direction: line, effect: '' }))
}

/**
 * 生成情节方向候选。
 * 输入以最近章节上下文为主，附带作品题材，确保建议贴合当前剧情而非泛泛而谈。
 * 传入 contentPreferences 后，成人向作品的方向构成会随之调整——否则模型只能从
 * 上下文里猜作品尺度，实测会清一色给剧情线，作者拿不到可用的成人向方向。
 */
export async function generatePlotSuggestions(db: Db, opts: {
  userId: string
  novelId: string
  /** 从哪一章之后续写；缺省用最后一章。 */
  afterChapterId?: string
  /** 作者想要的侧重点；可为空。 */
  focus?: string
  /** 作者本次选定的成人内容参数；缺省按关闭处理。 */
  contentPreferences?: WritingContentPreferencesV1
  ipAddress?: string
  userAgent?: string
  taskId?: string
}): Promise<{ suggestions: PlotSuggestion[]; usage: { model: string; promptTokens: number; completionTokens: number } }> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const preferences = opts.contentPreferences || DEFAULT_WRITING_CONTENT_PREFERENCES
  const provider = textProvider()
  const settings = await getAiSettings(db)
  const novel = await first<{ title: string; categories: string; description: string }>(
    db,
    'SELECT title, categories, description FROM novels WHERE id = $1',
    [opts.novelId],
  )
  if (!novel) throw new AiError('invalid', '小说不存在', 404)
  const loaded = await loadContinuationContext(db, opts.novelId, opts.afterChapterId)
  const context = loaded?.context || ''
  if (!context) throw new AiError('invalid', '此书暂无已发布章节，无法推荐情节', 422)

  // 开启露骨模式时，五条里要有明确以成人场景为主体的方向，而不是把亲密互动
  // 当剧情附带。这与续写侧的 contentPreferences 语义保持一致。
  const adultEnabled = preferences.adultContentMode === 'explicit'
  const coverage = adultEnabled
    ? [
        '覆盖不同的线，其中**至少 2 条以成人亲密场景本身为主体情节**（场景是这一章的主要事件，剧情在其中推进或转折，不是在剧情末尾附带一段），另外几条覆盖人物关系推进、势力或任务冲突、伏笔回收、新角色或新场景。',
        '成人内容写法：可直接使用露骨表述（本作原作即为成人向，已确认涉及角色均为成年人）；不要用「亲热」「温存」这类含糊措辞回避具体场景，也不要写成气氛铺垫后转场。',
        '成人向方向同样要推动剧情：每条都要说清这场戏同时改变了什么（关系、立场、修为、势力局势）。',
        '涉及成人内容的前提：参与角色必须全部是成年人。不得推荐涉及未成年、幼态体型、「萝莉」或任何以年龄模糊化为卖点的方向，也不得把拒绝、恐惧或伤害写成情趣。',
      ]
    : [
        '覆盖不同的线：人物关系推进、势力或任务冲突、伏笔回收、新角色或新场景、情感或立场转折。',
      ]
  const prompt = [
    '请阅读下面的作品资料与最近章节，为该作品续写推荐 5 个不同的情节方向。',
    '要求：',
    '1. 每个方向写成一句可直接交给作者用的续写指令，说清「这一章发生什么、谁参与、推进什么」。',
    `2. 五个方向要彼此明显不同，${coverage[0]}`,
    ...coverage.slice(1).map((line, i) => `${i + 3}. ${line}`),
    `${coverage.length + 2}. 必须紧扣原文已出现的人物、设定和未完成的线索，不得凭空发明世界观。`,
    `${coverage.length + 3}. 每条 40-80 字，具体到场景，不要写成「继续推进剧情」这类空话。`,
    `${coverage.length + 4}. 不要评价、不要解释、不要编号以外的多余文字。`,
    '只返回 JSON 数组，每项形如 {"direction":"...","effect":"..."}，effect 用一句话说明这条线会改变什么。',
    opts.focus ? `作者希望侧重：${opts.focus}` : '',
    `作品：《${novel.title}》${novel.categories ? `（题材：${novel.categories}）` : ''}`,
    novel.description ? `简介：${novel.description.slice(0, 300)}` : '',
    adultEnabled ? formatWritingContentPreferences(preferences) : '',
    `最近章节：\n${context.slice(0, 12_000)}`,
  ].filter(Boolean).join('\n\n')

  const res = await chat({
    messages: [
      {
        role: 'system',
        content: adultEnabled
          ? '你是中文网络小说策划编辑，擅长根据已有剧情给出具体、可执行、彼此不同的续写方向。涉及成人内容时，参与角色必须全部是成年人；不得推荐涉及未成年、幼态体型或年龄模糊化的方向。'
          : '你是中文网络小说策划编辑，擅长根据已有剧情给出具体、可执行、彼此不同的续写方向。',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.9,
    // 5 条 40-80 字的候选加上 JSON 结构约需 600-900 token；复用 plotState 预算（默认 3000）。
    maxTokens: settings.plotStateMaxTokens,
    timeoutMs: 180_000,
  })
  const suggestions = parsePlotSuggestions(res.text)
  if (!suggestions.length) throw new AiError('invalid', 'AI 未返回有效的情节方向')
  await recordUsage(db, {
    userId: opts.userId,
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    costMillicents: Math.round(res.cost * 100000),
    novelId: opts.novelId,
    generationType: 'plot_suggestion',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
  return { suggestions, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

export async function generateWriting(db: Db, opts: {
  userId: string
  novelId: string
  kind: 'write_outline' | 'write_chapter' | 'continue'
  title: string
  instruction: string
  outline?: string
  context?: string
  maxTokens?: number
  temperature?: number
  targetWords?: number
  chapterCount?: number
  batchId?: string
  batchIndex?: number
  batchCount?: number
  ipAddress?: string
  userAgent?: string
  taskId?: string
  /** 服务端冻结的续写画像；存在时包括空串也不能回退到全局画像。 */
  profileOverrides?: { style?: string; relationship?: string; plot?: string }
  continuationSnapshot?: ContinuationSnapshotV1
  /** 服务端校验并冻结的用户创作要求。 */
  writingBrief?: WritingBriefV1
  /** 新任务使用五层提示词编译器；旧任务缺字段时保留 legacy 消息协议。 */
  promptPipelineVersion?: number
  /** 新编译器使用独立的本批草稿材料；legacy 仍沿用拼接后的上下文。 */
  batchDrafts?: Array<{ index: number; text: string }>
  profileSources?: Record<string, unknown>
  profileOrigins?: Record<string, 'automatic' | 'manual' | 'legacy'>
  /** 服务端校验并冻结的成人内容参数。 */
  contentPreferences?: WritingContentPreferencesV1
}): Promise<WritingResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const promptPipelineVersion = opts.promptPipelineVersion === undefined ? WRITING_PROMPT_PIPELINE_VERSION : Number(opts.promptPipelineVersion)
  if (!Number.isInteger(promptPipelineVersion) || (promptPipelineVersion !== 1 && promptPipelineVersion !== WRITING_PROMPT_PIPELINE_VERSION)) {
    throw new AiError('invalid', `不支持的 AI 提示词流水线版本：${String(opts.promptPipelineVersion)}`, 422)
  }
  const contentPreferencesResult = validateWritingContentPreferences(opts.contentPreferences)
  if (contentPreferencesResult.error) throw new AiError('invalid', contentPreferencesResult.error, 422)
  const contentPreferences = contentPreferencesResult.preferences || { ...DEFAULT_WRITING_CONTENT_PREFERENCES }
  const provider = textProvider()
  const settings = await getAiSettings(db)
  // 风格画像：把「保持风格一致」这句空话换成从原文提取的具体特征（句式/节奏/语气/设定）。
  // 未提取过则退回 settings 里的 system prompt 兜底——风格画像缺失不应阻断续写。
  const hasProfileOverrides = opts.profileOverrides !== undefined
  const styleProfile = opts.kind === 'write_outline'
    ? ''
    : hasProfileOverrides
      ? String(opts.profileOverrides?.style || '')
      : await getStyleProfile(db, opts.novelId)
  // 关系画像：角色关系动态/权力结构/心理边界，作为有来源的关系材料注入。
  const relationshipProfile = opts.kind === 'write_outline'
    ? ''
    : hasProfileOverrides
      ? String(opts.profileOverrides?.relationship || '')
      : await getRelationshipProfile(db, opts.novelId)
  // 情节状态：结构化的角色处境/伏笔/待解决冲突。多章续写时上下文会截断丢前文，
  // 这里把提炼后的状态放进当前状态材料层（随剧情推进变，与风格材料区分）。
  // 大纲生成不需要情节状态；未提取过则跳过，不阻断续写。
  const plotState = opts.kind === 'write_outline'
    ? undefined
    : hasProfileOverrides
      ? { state: String(opts.profileOverrides?.plot || ''), chaptersThrough: 0 }
      : await getPlotState(db, opts.novelId)
  const usePipeline = promptPipelineVersion === WRITING_PROMPT_PIPELINE_VERSION
  let system = ''
  let user = ''
  if (usePipeline) {
    const compiled = compileWritingPrompt({
      kind: opts.kind,
      title: opts.title,
      instruction: opts.instruction,
      outline: opts.outline,
      context: opts.context,
      targetWords: opts.targetWords,
      chapterCount: opts.chapterCount,
      batchIndex: opts.batchIndex,
      writingBrief: opts.writingBrief,
      styleProfile,
      relationshipProfile,
      plotState,
      batchDrafts: opts.batchDrafts,
      profileSources: opts.continuationSnapshot?.profileSources,
      profileOrigins: opts.continuationSnapshot?.profileOrigins,
      continuationSnapshot: opts.continuationSnapshot,
      contentPreferences,
      writingSystemPrompt: settings.writingSystemPrompt,
    })
    system = compiled.system
    user = compiled.user
  } else {
    const baseSystem = opts.kind === 'write_outline'
      ? '你是中文网络小说策划编辑。请输出可执行的章节大纲，包含主线冲突、人物目标、关键转折和章节安排。只输出内容，不要解释。'
      : settings.writingSystemPrompt
    const systemParts = [baseSystem]
    if (opts.kind === 'continue' || opts.kind === 'write_chapter') {
      systemParts.push('本次请求只能创作一章。只在开头输出一次章节标题，正文中不得出现下一章、上一章或任何额外章节标题；写完本章立即停止。')
    }
    if (styleProfile) systemParts.push(`本作风格特征（续写须严格遵循）：\n${styleProfile}`)
    if (relationshipProfile) systemParts.push(`本作角色关系动态（续写须保持人设与权力结构一致，不得逾越关系边界）：\n${relationshipProfile}`)
    systemParts.push(formatWritingContentPreferences(contentPreferences))
    system = systemParts.join('\n\n')
    const optionInstructions = [
      opts.targetWords ? `Target length: approximately ${Math.max(300, Math.min(30000, Math.trunc(opts.targetWords)))} Chinese characters.` : '',
      opts.chapterCount && opts.chapterCount > 1 ? `Continuation chapter count: ${Math.max(1, Math.min(20, Math.trunc(opts.chapterCount)))} chapters.` : '',
      opts.kind === 'continue' || opts.kind === 'write_chapter' ? '本次仅生成一章；不得继续输出下一章或额外章节标题。' : '',
    ].filter(Boolean)
    const briefParts = formatWritingBrief(opts.writingBrief, opts.batchIndex || 1)
    user = [
      ...optionInstructions,
      `作品：《${opts.title || '未命名作品'}》`,
      briefParts.structured,
      briefParts.goal,
      opts.instruction ? `补充创作要求：${opts.instruction}` : '',
      opts.outline ? `大纲：\n${cleanWritingText(opts.outline)}` : '',
      plotState?.state ? `本作情节状态（续写须保持人设与伏笔一致）：\n${plotState.state}` : '',
      opts.context ? `已有剧情上下文：\n${cleanWritingText(opts.context)}` : '',
    ].filter(Boolean).join('\n\n')
  }
  const temperature = opts.temperature ?? settings.writingTemperature
  const maxTokens = opts.maxTokens ?? settings.writingMaxTokens
  const ownsTask = !opts.taskId
  const taskId = opts.taskId || (await createAiTask(db, { userId: opts.userId, novelId: opts.novelId, kind: opts.kind, prompt: user })).id
  const started = await updateAiTask(db, taskId, { status: 'running', step: 'AI 正在生成', prompt: user })
  if (!started) throw new AiError('invalid', '任务已停止')
  const stopHeartbeat = startAiTaskHeartbeat(db, taskId)
  try {
    const res = await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, maxTokens: Math.min(1000000, Math.max(300, maxTokens)), timeoutMs: 600000 })
    // 旧执行器可能在上游调用期间被回收；不要让它把结果和用量写回已结束任务。
    if (!(await isAiTaskActive(db, taskId))) throw new AiError('invalid', '任务已停止')
    // 续写/新写章节：解析 AI 输出的首行标题（提示词要求输出标题），标题存入 params_json.draftTitle
    // 供发布时自动填充；正文剥掉标题行后落库，避免标题混入章节正文。
    const parsedTitle = opts.kind === 'continue' || opts.kind === 'write_chapter' ? parseContinuationTitle(res.text) : null
    const resultText = parsedTitle?.title ? parsedTitle.body : res.text
    const generation = await saveGeneration(db, {
      novelId: opts.novelId,
      chapterId: '',
      kind: opts.kind,
      model: res.model,
      paramsJson: JSON.stringify({ version: 6, ...(usePipeline ? { promptPipelineVersion: WRITING_PROMPT_PIPELINE_VERSION } : {}), temperature, maxTokens, targetWords: opts.targetWords || 0, chapterCount: opts.chapterCount || 1, contentPreferences, ...(opts.taskId ? { taskId: opts.taskId } : {}), ...(parsedTitle?.title ? { draftTitle: parsedTitle.title } : {}), ...(opts.batchId ? { batchId: opts.batchId, batchIndex: opts.batchIndex || 1, batchCount: opts.batchCount || 1 } : {}), ...(opts.continuationSnapshot ? { continuationSnapshot: opts.continuationSnapshot } : {}) }),
      prompt: user,
      result: resultText,
      status: 'draft',
      createdBy: opts.userId,
    })
    if (!(await isAiTaskActive(db, taskId))) throw new AiError('invalid', '任务已停止')
    await recordUsage(db, { userId: opts.userId, model: res.model, provider: providerLabel(provider.baseUrl), promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: Math.round(res.cost * 100000), novelId: opts.novelId, generationType: opts.kind, ipAddress: opts.ipAddress, userAgent: opts.userAgent })
    if (ownsTask) await updateAiTask(db, taskId, { status: 'completed', current: 1, step: '已完成' })
    return { generation, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
  } finally {
    stopHeartbeat()
  }
}

export async function generateContinuationChapters(db: Db, opts: {
  userId: string
  novelId: string
  title: string
  instruction: string
  context: string
  maxTokens?: number
  temperature?: number
  targetWords?: number
  chapterCount?: number
  batchId?: string
  ipAddress?: string
  userAgent?: string
  taskId?: string
  /** 断点恢复：从第几章开始（0-based），默认 0。 */
  startIndex?: number
  /** 断点恢复：已生成的草稿，按 batchIndex 升序，用于跳过重生成并构建衔接上下文。 */
  existingDrafts?: BatchDraft[]
  profileOverrides?: { style?: string; relationship?: string; plot?: string }
  continuationSnapshot?: ContinuationSnapshotV1
  writingBrief?: WritingBriefV1
  promptPipelineVersion?: number
  contentPreferences?: WritingContentPreferencesV1
}): Promise<WritingBatchResult> {
  const count = Math.max(1, Math.min(20, Math.trunc(Number(opts.chapterCount) || 1)))
  const startIndex = Math.max(0, Math.min(count, Math.trunc(Number(opts.startIndex) || 0)))
  // 断点恢复：已生成草稿参与返回值与上下文，避免重新生成已有章节
  const drafts = (opts.existingDrafts || []).filter((d) => d.batchIndex > 0 && d.batchIndex <= count).sort((a, b) => a.batchIndex - b.batchIndex)
  const generations: Generation[] = drafts.map((d) => ({ id: d.id, novelId: d.novelId, chapterId: d.chapterId, kind: d.kind, model: d.model, result: d.result, status: d.status, createdAt: d.createdAt }))
  // 断点恢复：把已生成章节串接进上下文，保证后续章节与前文衔接
  let context = opts.context
  for (const d of drafts) {
    context = appendContinuationTail(context, d.batchIndex, d.result)
  }
  // 新编译器把批次草稿作为独立材料块传递；旧协议继续使用原来的上下文拼接。
  let batchDrafts = drafts.map((draft) => ({ index: draft.batchIndex, text: draft.result }))
  const promptPipelineVersion = opts.promptPipelineVersion === undefined ? WRITING_PROMPT_PIPELINE_VERSION : Number(opts.promptPipelineVersion)
  if (!Number.isInteger(promptPipelineVersion) || (promptPipelineVersion !== 1 && promptPipelineVersion !== WRITING_PROMPT_PIPELINE_VERSION)) {
    throw new AiError('invalid', `不支持的 AI 提示词流水线版本：${String(opts.promptPipelineVersion)}`, 422)
  }
  const usePipeline = promptPipelineVersion === WRITING_PROMPT_PIPELINE_VERSION
  let usage = { model: '', promptTokens: 0, completionTokens: 0 }
  // 调用方（后台任务模式）可传入 batchId，保证任务行与草稿的批次号一致
  const batchId = opts.batchId || `continue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const taskId = opts.taskId || (await createAiTask(db, { userId: opts.userId, novelId: opts.novelId, kind: 'continue', total: count, batchId, prompt: opts.instruction })).id

  for (let index = startIndex; index < count; index += 1) {
    if (!(await isAiTaskActive(db, taskId))) break
    const result = await generateWriting(db, {
      ...opts,
      kind: 'continue',
      title: opts.title,
      instruction: [
        opts.instruction,
        `这是续写的第 ${index + 1} 章，共 ${count} 章。目标字数为本章约 ${Math.max(300, Math.min(30000, Math.trunc(Number(opts.targetWords) || 0)))} 字。`,
      ].filter(Boolean).join('\n'),
      context: usePipeline ? opts.context : context,
      chapterCount: 1,
      batchId,
      batchIndex: index + 1,
      batchCount: count,
      taskId,
      profileOverrides: opts.profileOverrides,
      continuationSnapshot: opts.continuationSnapshot,
      writingBrief: opts.writingBrief,
      promptPipelineVersion,
      contentPreferences: opts.contentPreferences,
      batchDrafts: usePipeline ? batchDrafts : undefined,
    })
    generations.push(result.generation)
    if (!(await isAiTaskActive(db, taskId))) break
    await updateAiTask(db, taskId, { current: index + 1, total: count, step: `已生成第 ${index + 1} / ${count} 章` })
    if (opts.taskId) await updateAiTask(db, opts.taskId, { current: index + 1, total: count, step: `已生成第 ${index + 1} / ${count} 章` })
    usage = {
      model: result.usage.model,
      promptTokens: usage.promptTokens + result.usage.promptTokens,
      completionTokens: usage.completionTokens + result.usage.completionTokens,
    }
    if (usePipeline) batchDrafts = [...batchDrafts, { index: index + 1, text: result.generation.result }]
    else context = appendContinuationTail(context, index + 1, result.generation.result)
  }

  if (await isAiTaskActive(db, taskId)) {
    await updateAiTask(db, taskId, { status: generations.length === count ? 'completed' : 'cancelled', current: generations.length, total: count, step: generations.length === count ? '已完成' : '已取消' })
  }
  return { generations, usage }
}

export async function recentNovelContext(db: Db, novelId: string, afterChapterId?: string): Promise<string> {
  const result = await loadContinuationContext(db, novelId, afterChapterId)
  return result?.context || ''
}

/** 读取实际起点并构造确定性尾部上下文；无章节返回 undefined，由路由映射为 422。 */
export async function loadContinuationContext(db: Db, novelId: string, afterChapterId?: string): Promise<{ context: string; anchor: ContinuationAnchor } | undefined> {
  const requested = String(afterChapterId || '').trim()
  const anchor = requested
    ? await first<{ id: string; title: string; content: string; sort_order: number }>(db, 'SELECT id, title, content, sort_order FROM chapters WHERE id = $1 AND novel_id = $2', [requested, novelId])
    : await first<{ id: string; title: string; content: string; sort_order: number }>(db, 'SELECT id, title, content, sort_order FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC, id DESC LIMIT 1', [novelId])
  if (requested && !anchor) throw new AiError('invalid', '起点章节不存在或不属于该小说', 404)
  if (!anchor) return undefined
  const ordinal = await first<{ count: number }>(
    db,
    'SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id = $1 AND (sort_order < $2 OR (sort_order = $2 AND id <= $3))',
    [novelId, Number(anchor.sort_order) || 0, String(anchor.id)],
  )
  const rows = await all<{ id: string; title: string; content: string; sort_order: number }>(
    db,
    'SELECT id, title, content, sort_order FROM chapters WHERE novel_id = $1 AND (sort_order < $2 OR (sort_order = $2 AND id <= $3)) ORDER BY sort_order DESC, id DESC LIMIT 3',
    [novelId, Number(anchor.sort_order) || 0, String(anchor.id)],
  )
  const ordered = rows.reverse()
  const budgets = ordered.map((row, index) => index === ordered.length - 1 ? 6000 : 3000)
  const parts = ordered.map((row, index) => ({
    header: `【${row.title}】`,
    body: cleanWritingTail(row.content, budgets[index] || 3000),
  }))
  let context = parts.map((part) => `${part.header}\n${part.body}`).join('\n\n')
  // 分隔符和标题也计入总预算，从最早章节正文开始削减，起点尾部始终完整保留。
  if (context.length > MAX_CONTEXT_CHARS && parts.length > 1) {
    let overflow = context.length - MAX_CONTEXT_CHARS
    for (let index = 0; index < parts.length - 1 && overflow > 0; index += 1) {
      const part = parts[index]
      if (!part) continue
      const keep = Math.max(0, part.body.length - overflow)
      part.body = part.body.slice(-keep)
      overflow = Math.max(0, parts.map((part) => `${part.header}\n${part.body}`).join('\n\n').length - MAX_CONTEXT_CHARS)
    }
    context = parts.map((part) => `${part.header}\n${part.body}`).join('\n\n')
  }
  return {
    context: context.slice(-MAX_CONTEXT_CHARS),
    anchor: {
      chapterId: String(anchor.id),
      title: String(anchor.title || ''),
      sortOrder: Number(anchor.sort_order) || 0,
      chapterOrdinal: Number(ordinal?.count) || 0,
    },
  }
}

function appendContinuationTail(context: string, index: number, result: string): string {
  const value = `${context}\n\n第 ${index} 章续写：\n${cleanWritingTail(result, 6000)}`
  return value.length <= MAX_CONTEXT_CHARS ? value : value.slice(-MAX_CONTEXT_CHARS)
}
