import { removeAdPatterns } from '@shared/ad-cleaner'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import { chat, isTextAiConfigured, providerLabel, textProvider, AiError } from './client'
import { saveGeneration, type Generation, type BatchDraft } from './generations'
import { recordUsage } from './usage'
import { getAiSettings } from './settings'
import { createAiTask, isAiTaskCancelled, updateAiTask } from './tasks'
import { getStyleProfile } from './style-profile'
import { getPlotState } from './plot-state'
import { getRelationshipProfile } from './relationship-profile'

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

/**
 * 从续写输出中提取标题并返回剥离标题后的正文。兼容真实产出过的格式：
 * - 开头的章节号行（「## 第 6 章」「第 88 章」）：章节号不是标题；若同行带尾巴（「第 3 章 锁孔里的光」）则尾巴是标题，否则看下一行
 * - 「【标题】HH」/《标题》/「标题」等包裹形态：尾部可带 H 评级标记（自定义提示词要求 H 数量标注），保留进标题
 * - 「标题：xxx」/「章节标题: xxx」/「Title: xxx」前缀
 * - 裸首行标题：长度 2-30、不以句末标点结尾、且紧跟空行（提示词要求"标题后空一行再写正文"）
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
  return { title, body: rest }
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
}): Promise<WritingResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const settings = await getAiSettings(db)
  // 风格画像：把「保持风格一致」这句空话换成从原文提取的具体特征（句式/节奏/语气/设定）。
  // 未提取过则退回 settings 里的 system prompt 兜底——风格画像缺失不应阻断续写。
  const styleProfile = opts.kind === 'write_outline' ? '' : await getStyleProfile(db, opts.novelId)
  // 关系画像：角色关系动态/权力结构/心理边界，稳定的关系底色，与风格画像同属长期创作纪律。
  // 防 skill 踩坑：主从写成平等恋人、把奖赏手段当真心、从属试探写成主导。
  const relationshipProfile = opts.kind === 'write_outline' ? '' : await getRelationshipProfile(db, opts.novelId)
  const baseSystem = opts.kind === 'write_outline'
    ? '你是中文网络小说策划编辑。请输出可执行的章节大纲，包含主线冲突、人物目标、关键转折和章节安排。只输出内容，不要解释。'
    : settings.writingSystemPrompt
  const systemParts = [baseSystem]
  if (styleProfile) systemParts.push(`本作风格特征（续写须严格遵循）：\n${styleProfile}`)
  if (relationshipProfile) systemParts.push(`本作角色关系动态（续写须保持人设与权力结构一致，不得逾越关系边界）：\n${relationshipProfile}`)
  const system = systemParts.join('\n\n')
  // 情节状态：结构化的角色处境/伏笔/待解决冲突。多章续写时上下文会截断丢前文，
  // 这里把提炼后的状态塞进 user 消息（时效性上下文，随剧情推进变，与 system 里的长期风格纪律区分）。
  // 大纲生成不需要情节状态；未提取过则跳过，不阻断续写。
  const plotState = opts.kind === 'write_outline' ? null : await getPlotState(db, opts.novelId)
  const optionInstructions = [
    opts.targetWords ? `Target length: approximately ${Math.max(300, Math.min(30000, Math.trunc(opts.targetWords)))} Chinese characters.` : '',
    opts.chapterCount && opts.chapterCount > 1 ? `Continuation chapter count: ${Math.max(1, Math.min(20, Math.trunc(opts.chapterCount)))} chapters.` : '',
  ].filter(Boolean)
  const user = [
    ...optionInstructions,
    `作品：《${opts.title || '未命名作品'}》`,
    opts.instruction ? `创作要求：${opts.instruction}` : '',
    opts.outline ? `大纲：\n${cleanWritingText(opts.outline)}` : '',
    plotState?.state ? `本作情节状态（续写须保持人设与伏笔一致）：\n${plotState.state}` : '',
    opts.context ? `已有剧情上下文：\n${cleanWritingText(opts.context)}` : '',
  ].filter(Boolean).join('\n\n')
  const temperature = opts.temperature ?? settings.writingTemperature
  const maxTokens = opts.maxTokens ?? settings.writingMaxTokens
  const ownsTask = !opts.taskId
  const taskId = opts.taskId || (await createAiTask(db, { userId: opts.userId, novelId: opts.novelId, kind: opts.kind, prompt: user })).id
  await updateAiTask(db, taskId, { status: 'running', step: 'AI 正在生成', prompt: user })
  const res = await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, maxTokens: Math.min(1000000, Math.max(300, maxTokens)), timeoutMs: 600000 })
  // 续写/新写章节：解析 AI 输出的首行标题（提示词要求输出标题），标题存入 params_json.draftTitle
  // 供发布时自动填充；正文剥掉标题行后落库，避免标题混入章节正文。
  const parsedTitle = opts.kind === 'continue' || opts.kind === 'write_chapter' ? parseContinuationTitle(res.text) : null
  const resultText = parsedTitle?.title ? parsedTitle.body : res.text
  const generation = await saveGeneration(db, {
    novelId: opts.novelId,
    chapterId: '',
    kind: opts.kind,
    model: res.model,
    paramsJson: JSON.stringify({ version: 5, temperature, maxTokens, targetWords: opts.targetWords || 0, chapterCount: opts.chapterCount || 1, ...(parsedTitle?.title ? { draftTitle: parsedTitle.title } : {}), ...(opts.batchId ? { batchId: opts.batchId, batchIndex: opts.batchIndex || 1, batchCount: opts.batchCount || 1 } : {}) }),
    prompt: user,
    result: resultText,
    status: 'draft',
    createdBy: opts.userId,
  })
  await recordUsage(db, { userId: opts.userId, model: res.model, provider: providerLabel(provider.baseUrl), promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: Math.round(res.cost * 100000), novelId: opts.novelId, generationType: opts.kind, ipAddress: opts.ipAddress, userAgent: opts.userAgent })
  if (ownsTask) await updateAiTask(db, taskId, { status: 'completed', current: 1, step: '已完成' })
  return { generation, usage: { model: res.model, promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
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
}): Promise<WritingBatchResult> {
  const count = Math.max(1, Math.min(20, Math.trunc(Number(opts.chapterCount) || 1)))
  const startIndex = Math.max(0, Math.min(count, Math.trunc(Number(opts.startIndex) || 0)))
  // 断点恢复：已生成草稿参与返回值与上下文，避免重新生成已有章节
  const drafts = (opts.existingDrafts || []).filter((d) => d.batchIndex > 0 && d.batchIndex <= count).sort((a, b) => a.batchIndex - b.batchIndex)
  const generations: Generation[] = drafts.map((d) => ({ id: d.id, novelId: d.novelId, chapterId: d.chapterId, kind: d.kind, model: d.model, result: d.result, status: d.status, createdAt: d.createdAt }))
  // 断点恢复：把已生成章节串接进上下文，保证后续章节与前文衔接
  let context = opts.context
  for (const d of drafts) {
    context = `${context}\n\n第 ${d.batchIndex} 章续写：\n${cleanWritingText(d.result, 6000)}`.slice(-MAX_CONTEXT_CHARS)
  }
  let usage = { model: '', promptTokens: 0, completionTokens: 0 }
  // 调用方（后台任务模式）可传入 batchId，保证任务行与草稿的批次号一致
  const batchId = opts.batchId || `continue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const taskId = opts.taskId || (await createAiTask(db, { userId: opts.userId, novelId: opts.novelId, kind: 'continue', total: count, batchId, prompt: opts.instruction })).id

  for (let index = startIndex; index < count; index += 1) {
    if (await isAiTaskCancelled(db, taskId)) break
    const result = await generateWriting(db, {
      ...opts,
      kind: 'continue',
      title: opts.title,
      instruction: [
        opts.instruction,
        `这是续写的第 ${index + 1} 章，共 ${count} 章。目标字数为本章约 ${Math.max(300, Math.min(30000, Math.trunc(Number(opts.targetWords) || 0)))} 字。`,
      ].filter(Boolean).join('\n'),
      context,
      chapterCount: 1,
      batchId,
      batchIndex: index + 1,
      batchCount: count,
      taskId,
    })
    generations.push(result.generation)
    await updateAiTask(db, taskId, { current: index + 1, total: count, step: `已生成第 ${index + 1} / ${count} 章` })
    if (opts.taskId) await updateAiTask(db, opts.taskId, { current: index + 1, total: count, step: `已生成第 ${index + 1} / ${count} 章` })
    usage = {
      model: result.usage.model,
      promptTokens: usage.promptTokens + result.usage.promptTokens,
      completionTokens: usage.completionTokens + result.usage.completionTokens,
    }
    context = `${context}\n\n第 ${index + 1} 章续写：\n${cleanWritingText(result.generation.result, 6000)}`.slice(-MAX_CONTEXT_CHARS)
  }

  await updateAiTask(db, taskId, { status: generations.length === count ? 'completed' : 'cancelled', current: generations.length, total: count, step: generations.length === count ? '已完成' : '已取消' })
  return { generations, usage }
}

export async function recentNovelContext(db: Db, novelId: string, afterChapterId?: string): Promise<string> {
  const rows = await all<{ title: string; content: string }>(db, afterChapterId
    ? 'SELECT title, content FROM chapters WHERE novel_id = $1 AND sort_order <= (SELECT sort_order FROM chapters WHERE id = $2) ORDER BY sort_order DESC LIMIT 3'
    : 'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT 3', [novelId, ...(afterChapterId ? [afterChapterId] : [])])
  return rows.reverse().map((row) => `【${row.title}】\n${cleanWritingText(row.content, 4000)}`).join('\n\n').slice(-MAX_CONTEXT_CHARS)
}
