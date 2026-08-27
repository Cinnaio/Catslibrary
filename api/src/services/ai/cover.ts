/**
 * AI 小说封面生成 —— 读取小说元数据 → 文本模型翻英文描述词 → 图像模型出图 → 落候选表。
 * 生成结果存 ai_cover_candidates（候选），不覆盖当前封面；管理员在后台预览后「采纳」才
 * 经 adoptCoverCandidate 覆盖 novel_covers，公开页经 /api/cover/:id 生效。
 * 任务记录在 ai_tasks（kind='cover'），成本记账在 ai_usage（generation_type='cover', image_count=1），
 * 不进 ai_generations（该表是文本草稿+发布流转专用，result 是 TEXT 装不下二进制）。
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../../db/pool'
import { first } from '../../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { generateImage, isImageAiConfigured, imageProvider, imageProviderLabel } from './image'
import { recordUsage } from './usage'
import { getAiSettings } from './settings'
import { createAiTask, isAiTaskCancelled, updateAiTask, getAiTask } from './tasks'
import { storeCoverCandidate, MAX_COVER_BYTES } from '../covers'
import {
  GENRE_PRIORITY,
  GENRE_STYLES,
  PLATFORM_STYLES,
  inferGenre,
  inferGenres,
  isCoverPlatform,
  resolveCoverDirection,
  type CoverComposition,
  type CoverDirection,
  type CoverPlatform,
  type CoverStylePreset,
  type Genre,
  type GenreStyle,
  type ResolvedCoverComposition,
  type ResolvedCoverStylePreset,
} from './cover-styles'
import { resolveRomanceVisualDNA, type RomanceEmotion, type RomanceSubtype, type RomanceVisualConcept, type RomanceVisualDNA } from './cover-romance'

interface NovelMeta {
  title: string
  author: string
  description: string
  categories: string[]
}

/** 未配置时的封面描述词默认上限；实际限制从 AI 运营设置读取。 */
export const DEFAULT_COVER_PROMPT_MAX_CHARS = 2_000
const MIN_COVER_PROMPT_MAX_CHARS = 100
const HARD_MAX_COVER_PROMPT_CHARS = 10_000

/** buildImagePrompt 的封面选项：文字层、平台风格、主视觉和构图均由调用方透传。 */
export interface CoverPromptOptions {
  /** 渲染书名+作者名文字层：默认 true（story-cover 核心——书名与作者名是封面必需信息），显式 false 才关闭 */
  renderTitle?: boolean
  /** 平台风格调性；缺省或非法值按 'default'（通用竖版，不叠加平台专属风格） */
  platform?: CoverPlatform | string
  /** 小说 ID，用于让 auto 视觉方向稳定但不同小说可区分。 */
  novelId?: string
  /** 主视觉预设；auto 按题材和 variationId 选择。 */
  stylePreset?: CoverStylePreset | string
  /** 构图预设；auto 按小说和 variationId 选择。 */
  composition?: CoverComposition | string
  /** 变体标识；相同值可复现，不同值会切换视觉方向。 */
  variationId?: string
  /** 封面描述词上限；由 AI 运营设置注入，直接调用时回退到默认值。 */
  maxPromptChars?: number
}

export interface CoverPromptMetadata {
  genre: Genre
  genres: Genre[]
  stylePreset: ResolvedCoverStylePreset
  composition: ResolvedCoverComposition
  variationId: string
  romanceSubtype?: RomanceSubtype
  romanceEmotion?: RomanceEmotion
  visualConcept?: RomanceVisualConcept
  visualAnchor?: string
  storySetting?: string
}

/** 创建一次全新的封面变体；任务参数会持久化它，重试时仍可复现。 */
export function newCoverVariationId(): string {
  return randomUUID()
}

function normalizePlatform(value: unknown): CoverPlatform {
  return isCoverPlatform(value) ? value : 'default'
}

async function loadNovelMeta(db: Db, novelId: string): Promise<NovelMeta | null> {
  const row = await first<{ title: string; author: string; description: string; categories: string }>(
    db,
    'SELECT title, author, description, categories FROM novels WHERE id = $1',
    [novelId],
  )
  if (!row) return null
  let categories: string[] = []
  try {
    const parsed = JSON.parse(row.categories || '[]') as unknown
    if (Array.isArray(parsed)) categories = parsed.map((c) => String(c)).filter(Boolean)
  } catch {
    categories = []
  }
  return { title: String(row.title || ''), author: String(row.author || ''), description: String(row.description || ''), categories }
}

export async function generateCoverPrompt(db: Db, novelId: string, opts: CoverPromptOptions): Promise<BuildPromptResult> {
  const meta = await loadNovelMeta(db, novelId)
  if (!meta) throw new AiError('invalid', '小说不存在', 404)
  const settings = await getAiSettings(db)
  return buildImagePrompt(meta, {
    ...opts,
    novelId,
    maxPromptChars: settings.coverPromptMaxChars,
    variationId: normalizeVariationId(opts.variationId),
  })
}

/**
 * 执行一个可恢复的封面描述词后台任务。
 * 结果写回 ai_tasks.result，避免生成过程依赖前端一直保持连接。
 */
export async function generateCoverPromptTask(
  db: Db,
  opts: CoverPromptOptions & {
    userId: string
    novelId: string
    taskId: string
    ipAddress?: string
    userAgent?: string
  },
): Promise<void> {
  if (await isAiTaskCancelled(db, opts.taskId)) return
  await updateAiTask(db, opts.taskId, { status: 'running', step: '正在生成封面描述词' })

  try {
    const result = await generateCoverPrompt(db, opts.novelId, opts)
    if (await isAiTaskCancelled(db, opts.taskId)) return

    if (result.textUsage) {
      await recordUsage(db, {
        userId: opts.userId,
        model: result.textUsage.model,
        provider: providerLabel(result.textUsage.baseUrl),
        promptTokens: result.textUsage.promptTokens,
        completionTokens: result.textUsage.completionTokens,
        costMillicents: Math.round(result.textUsage.cost * 100_000),
        novelId: opts.novelId,
        generationType: 'cover_prompt',
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      })
    }

    await updateAiTask(db, opts.taskId, {
      status: 'completed',
      current: 1,
      total: 1,
      step: '封面描述词已生成，可继续编辑',
      prompt: result.prompt,
      result: JSON.stringify({ prompt: result.prompt, metadata: result.metadata }),
    })
  } catch (err) {
    if (await isAiTaskCancelled(db, opts.taskId)) return
    const message = err instanceof AiError ? err.message : '封面描述词生成失败'
    await updateAiTask(db, opts.taskId, { status: 'failed', error: message }).catch(() => {})
  }
}

/** 取任务当前 step（失败时回显用的实际 prompt 就存在这里）。 */
async function getTaskStep(db: Db, taskId: string): Promise<{ step: string }> {
  const task = await getAiTask(db, taskId)
  return { step: task?.step || '' }
}

export interface BuildPromptResult {
  prompt: string
  metadata: CoverPromptMetadata
  /** 文本调用用量；未用文本模型时为 null */
  textUsage: { model: string; promptTokens: number; completionTokens: number; cost: number; baseUrl: string } | null
}

/**
 * 构建封面 prompt —— 全量按 story-cover 的模板结构：
 * 平台层 + 文字层（书名/作者名）+ 画面层 + 风格/色彩/光效 + 通用修饰。
 *
 * - 题材判定优先用文本模型语义判定（对照 skill「读书名+简介定题材」）：只靠书名/分类关键词
 *   命中时，本站大量古言/现言书名（如「花间淫事」「摄政王的掌中娇」）会误落 'urban' 兜底，
 *   拿到全书最素的 sans-serif 标题字体；语义判定可把这些书归回 'ancient'/'romance'，
 *   标题字体随之换成更有题材感的金色楷体/毛笔字。文本模型不可用时回落关键词 inferGenre。
 * - 画面层以题材视觉模板（figure/background/color/light）为骨架，
 *   文本模型结合小说元数据按简介增强（未配置文本模型则回落模板），骨架保证贴题。
 * - 文字层默认渲染书名+作者名（story-cover 认为这是封面必需信息；模型需支持中文渲染，如 gpt-image-2），
 *   显式 renderTitle=false 时关闭并走 no text。
 */
export async function buildImagePrompt(meta: NovelMeta, opts: CoverPromptOptions): Promise<BuildPromptResult> {
  const renderTitle = opts.renderTitle !== false
  const platform = normalizePlatform(opts.platform)
  const variationId = normalizeVariationId(opts.variationId)
  const novelId = String(opts.novelId || meta.title || 'novel')

  const titleHint = meta.title.slice(0, 60)
  const authorHint = meta.author.slice(0, 40)
  const catHint = meta.categories.slice(0, 3).join(', ')
  const descHint = meta.description.slice(0, 300)
  const inferredGenres = inferGenres(meta.title, meta.categories, meta.description)

  // 题材判定 + 画面层：文本模型就绪时语义判定题材并用其模板生成画面；否则关键词推断 + 模板画面
  let genre: Genre
  let scene: string
  let textUsage: BuildPromptResult['textUsage'] = null
  let direction: CoverDirection
  let romanceDNA: RomanceVisualDNA | null = null
  if (isTextAiConfigured()) {
    const judged = await judgeGenre(meta)
    // 文本模型有时会把「现代言情」概括成 urban；若本地多标签信号明确以 romance 为首，保留言情母模板和视觉 DNA。
    genre = judged.genre === 'urban' && inferredGenres[0] === 'romance' ? 'romance' : judged.genre
    direction = resolveCoverDirection({
      novelId,
      genre,
      stylePreset: opts.stylePreset,
      composition: opts.composition,
      variationId,
    })
    if (genre === 'romance' || inferredGenres.includes('romance')) {
      romanceDNA = resolveRomanceVisualDNA({ title: meta.title, categories: meta.categories, description: meta.description, variationId })
    }
    const generated = await generateSceneDescription({ titleHint, catHint, descHint, style: GENRE_STYLES[genre], direction, romanceDNA })
    scene = generated.scene
    textUsage = mergeTextUsage(judged.textUsage, generated.textUsage)
  } else {
    genre = inferGenre(meta.title, meta.categories, meta.description)
    direction = resolveCoverDirection({
      novelId,
      genre,
      stylePreset: opts.stylePreset,
      composition: opts.composition,
      variationId,
    })
    if (genre === 'romance' || inferredGenres.includes('romance')) {
      romanceDNA = resolveRomanceVisualDNA({ title: meta.title, categories: meta.categories, description: meta.description, variationId })
    }
    scene = romanceDNA ? romanceDNA.scenePrompt : `${GENRE_STYLES[genre].figure} ${GENRE_STYLES[genre].background}`
  }

  const style = GENRE_STYLES[genre]
  const platformStyle = PLATFORM_STYLES[platform]

  const prompt = limitGeneratedCoverPrompt(
    assembleCoverPrompt({
      scene,
      style,
      direction,
      platformStyle,
      titleHint,
      authorHint,
      categoryHint: catHint,
      storyHint: descHint,
      renderTitle,
      romanceDNA,
    }),
    opts.maxPromptChars,
  )
  const genres = [genre, ...inferredGenres.filter((candidate) => candidate !== genre)]
  return {
    prompt,
    metadata: {
      genre,
      genres,
      stylePreset: direction.stylePreset,
      composition: direction.composition,
      variationId,
      ...(romanceDNA
        ? {
            romanceSubtype: romanceDNA.subtype,
            romanceEmotion: romanceDNA.emotion,
            visualConcept: romanceDNA.visualConcept,
            visualAnchor: romanceDNA.visualAnchor,
            storySetting: romanceDNA.setting,
          }
        : {}),
    },
    textUsage,
  }
}

/** 组装最终送图像模型的完整 prompt：平台层 + 文字层 + 画面层 + 风格/色彩/光效 + 通用修饰。 */
function assembleCoverPrompt(args: {
  scene: string
  style: (typeof GENRE_STYLES)[keyof typeof GENRE_STYLES]
  direction: CoverDirection
  platformStyle: string
  titleHint: string
  authorHint: string
  categoryHint: string
  storyHint: string
  renderTitle: boolean
  romanceDNA: RomanceVisualDNA | null
}): string {
  const { scene, style, direction, platformStyle, titleHint, authorHint, categoryHint, storyHint, renderTitle, romanceDNA } = args
  const lines: string[] = []

  lines.push(['Chinese web novel cover design', platformStyle].filter(Boolean).join(', ') + '.')

  // 文字层：默认渲染书名+作者名，仅显式关闭才省略
  if (renderTitle && titleHint) {
    lines.push(`Title text '${titleHint}' at top center in ${style.titleFont}.`)
    if (authorHint) lines.push(`Author name '${authorHint}' at bottom center in ${style.authorFont}.`)
  }

  lines.push(`${style.tag}. ${direction.stylePrompt}. ${direction.compositionPrompt}.`)
  if (categoryHint) lines.push(`Story categories: ${categoryHint}.`)
  if (storyHint) lines.push(`Story premise and visual anchors: ${storyHint}.`)
  if (romanceDNA) lines.push(`Story-specific romance direction (must drive the image): ${romanceDNA.prompt}.`)
  lines.push(`${scene}.`)
  lines.push(`${style.color}. ${style.light}.`)

  const tail = ['Professional novel cover artwork, portrait 2:3 ratio, strong thumbnail readability']
  if (renderTitle && titleHint) tail.push('keep title and author name inside the central safe area away from edges (inner ~85%)')
  else tail.push('no text')
  tail.push('avoid generic stock cover layouts, avoid repeated composition, no watermark, no logo, no extra text')
  if (romanceDNA) {
    tail.push(
      'avoid generic romantic couple portraits, automatic pink-and-gold palettes, flowers, petals, café interiors, garden backdrops, and sunset beaches unless explicitly supported by the story',
    )
  }
  lines.push(tail.join(', '))

  return lines.join('\n')
}

/** 题材中文别名，用于解析文本模型的判定输出（模型可能回中文而非英文代号）。 */
const GENRE_ALIASES: Record<Genre, string[]> = {
  xianxia: ['仙侠', '玄幻', '修真'],
  urban: ['都市', '现代都市', '现代题材'],
  ancient: ['古言', '宫斗', '古风', '古代'],
  romance: ['现代言情', '都市言情', '悬疑言情', '校园言情', '职场言情', '现言', '言情', '爱情', '恋爱', '甜宠'],
  mystery: ['悬疑', '推理'],
  scifi: ['科幻', '末世'],
  fantasy: ['西幻', '奇幻'],
  historical: ['历史', '军事'],
  horror: ['灵异', '恐怖'],
  light: ['轻小说', '二次元'],
}

/** 从文本模型输出里提取题材代号；识别不到返回 null（调用方回落到关键词推断）。 */
export function parseGenreText(text: string): Genre | null {
  const lower = String(text || '')
    .trim()
    .toLowerCase()
  if (!lower) return null
  for (const genre of GENRE_PRIORITY) {
    const aliases = [genre, ...(GENRE_ALIASES[genre] || [])]
    if (aliases.some((alias) => lower.includes(alias))) return genre
  }
  return null
}

/** 合并两次文本调用（题材判定 + 画面描述）的用量，按一条 cover_prompt 记账。 */
function mergeTextUsage(a: BuildPromptResult['textUsage'], b: BuildPromptResult['textUsage']): BuildPromptResult['textUsage'] {
  if (!a) return b
  if (!b) return a
  return {
    model: b.model || a.model,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cost: a.cost + b.cost,
    baseUrl: b.baseUrl || a.baseUrl,
  }
}

/**
 * 语义判定题材 —— 对照 story-cover 的「读书名（必要时简介）定题材」。
 * 只靠书名/分类关键词命中时，本站大量书名不含题材词（如「花间淫事」「陛下不可以」），
 * 会误落 'urban' 兜底、拿到全书最素的标题字体；这里让文本模型读书名+简介判定，
 * 把这类书归回更贴合的题材。模型不可用或输出识别不了时回落到 inferGenre 关键词推断。
 */
async function judgeGenre(meta: NovelMeta): Promise<{ genre: Genre; textUsage: BuildPromptResult['textUsage'] }> {
  const catHint = meta.categories.slice(0, 3).join(', ')
  const descHint = meta.description.slice(0, 300)
  const genreList = GENRE_PRIORITY.join('/')
  const meaning = GENRE_PRIORITY.map((g) => `${g}=${GENRE_ALIASES[g].join('、')}`).join('；')
  const user = [
    '你是网文题材判定专家。根据书名、分类和简介，判定这本书的封面题材。',
    `可选题材（只准输出下列英文代号之一，不要输出其他任何内容）：${genreList}`,
    `各题材含义：${meaning}`,
    `书名：${meta.title}`,
    catHint ? `分类：${catHint}` : '',
    descHint ? `简介：${descHint}` : '',
    '只输出一个题材英文代号。',
  ]
    .filter(Boolean)
    .join('\n')

  const res = await chat({
    messages: [
      { role: 'system', content: '你是网文题材判定专家，只输出一个题材英文代号，不要解释。' },
      { role: 'user', content: user },
    ],
    temperature: 0,
    // 推理模型先消耗思考 token（实测判定书单经常 >100 token），给足余量避免 content 被截断成空串
    maxTokens: 4096,
    timeoutMs: 30_000,
  })
  const genre = parseGenreText(res.text) || inferGenre(meta.title, meta.categories, meta.description)
  return {
    genre,
    textUsage: {
      model: res.model,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      cost: res.cost,
      baseUrl: textProvider().baseUrl,
    },
  }
}

/** 用文本模型结合题材视觉模板 + 小说元数据，产出增强后的英文画面描述（人物+背景）。 */
async function generateSceneDescription(args: {
  titleHint: string
  catHint: string
  descHint: string
  style: GenreStyle
  direction: CoverDirection
  romanceDNA: RomanceVisualDNA | null
}): Promise<{ scene: string; textUsage: BuildPromptResult['textUsage'] }> {
  const { titleHint, catHint, descHint, style, direction, romanceDNA } = args
  const textProvider_ = textProvider()

  const user = [
    '你是网文封面画面设计师。结合「题材视觉模板」与小说元数据，写一段英文封面画面描述。',
    '要求：',
    '1. 只输出一段英文描述（1-2 句），不要解释、不要引号、不要换行；',
    '2. 必须包含人物形象（服饰/姿态/道具）与场景背景两个层次，越具体越好；',
    '3. 在模板基础上细化，可用模板中的风格、色彩、光效关键词；',
    '4. 必须遵循给定的构图方向，让画面主体位置和镜头关系明确；',
    '5. 长度控制在 60-90 个英文单词以内；',
    '6. 不要包含任何文字/标题/水印描述（title、text、watermark 等词一律不要出现）。',
    romanceDNA ? '7. 言情故事必须使用给定的视觉 DNA，具体表现关系、情绪、场景、物件和动作；不要退回通用情侣拥抱或粉色梦幻背景。' : '',
    '题材视觉模板：',
    `- 风格：${style.tag}`,
    `- 人物：${style.figure}`,
    `- 背景：${style.background}`,
    `- 色彩：${style.color}`,
    `- 光效：${style.light}`,
    `- 主视觉方向：${direction.stylePrompt}`,
    `- 构图方向：${direction.compositionPrompt}`,
    romanceDNA ? `- 言情视觉 DNA：${romanceDNA.prompt}` : '',
    titleHint ? `标题：${titleHint}` : '',
    catHint ? `分类：${catHint}` : '',
    descHint ? `简介：${descHint}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const systemContent =
    '你是为 AI 图像生成模型撰写英文封面画面描述的专家，擅长把小说元数据转化为有视觉冲击力的画面描述（人物+背景）。只描述画面本身，不要出现任何文字/标题描述。'

  const res = await chat({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    // 推理模型先消耗思考 token，给足余量避免 content 被截断报 invalid
    maxTokens: 10000,
    timeoutMs: 60_000,
  })
  const scene = res.text.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim() || `${style.figure} ${style.background}`
  return {
    scene,
    textUsage: {
      model: res.model,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      cost: res.cost,
      baseUrl: textProvider_.baseUrl,
    },
  }
}

export function normalizeCoverPrompt(value: unknown, maxPromptChars = DEFAULT_COVER_PROMPT_MAX_CHARS): string {
  const prompt = String(value || '').trim()
  if (!prompt) return ''
  const limit = normalizePromptLimit(maxPromptChars)
  if (prompt.length > limit) {
    throw new AiError('invalid', `封面描述词不能超过 ${limit} 个字符`, 422)
  }
  // 自定义描述词是用户完全掌控的成品 prompt，不注入 no text（用户可能自己写了文字层）
  return prompt
}

/** 自动生成的描述词超限时保留末尾的文字/水印约束，避免截断后放大上游出图风险。 */
function limitGeneratedCoverPrompt(value: string, maxPromptChars = DEFAULT_COVER_PROMPT_MAX_CHARS): string {
  const prompt = String(value || '').trim()
  const limit = normalizePromptLimit(maxPromptChars)
  if (prompt.length <= limit) return prompt

  const tail = prompt.slice(prompt.lastIndexOf('\n') + 1)
  if (tail.length >= limit) return prompt.slice(0, limit)

  const headLength = limit - tail.length - 1
  return `${prompt.slice(0, headLength)}\n${tail}`
}

function normalizePromptLimit(value: unknown): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n)
    ? Math.min(HARD_MAX_COVER_PROMPT_CHARS, Math.max(MIN_COVER_PROMPT_MAX_CHARS, n))
    : DEFAULT_COVER_PROMPT_MAX_CHARS
}

function normalizeVariationId(value: unknown): string {
  const variationId = String(value || '').trim()
  if (variationId.length > 120) throw new AiError('invalid', '封面变体标识不能超过 120 个字符', 422)
  return variationId || newCoverVariationId()
}

function metadataForCustomPrompt(meta: NovelMeta, opts: CoverPromptOptions, variationId: string): CoverPromptMetadata {
  const inferredGenres = inferGenres(meta.title, meta.categories, meta.description)
  const genre = inferredGenres[0] || 'urban'
  const direction = resolveCoverDirection({
    novelId: opts.novelId || meta.title || 'novel',
    genre,
    stylePreset: opts.stylePreset,
    composition: opts.composition,
    variationId,
  })
  const romanceDNA =
    genre === 'romance' || inferredGenres.includes('romance')
      ? resolveRomanceVisualDNA({ title: meta.title, categories: meta.categories, description: meta.description, variationId })
      : null
  return {
    genre,
    genres: [genre, ...inferredGenres.filter((candidate) => candidate !== genre)],
    stylePreset: direction.stylePreset,
    composition: direction.composition,
    variationId,
    ...(romanceDNA
      ? {
          romanceSubtype: romanceDNA.subtype,
          romanceEmotion: romanceDNA.emotion,
          visualConcept: romanceDNA.visualConcept,
          visualAnchor: romanceDNA.visualAnchor,
          storySetting: romanceDNA.setting,
        }
      : {}),
  }
}

/**
 * 为小说生成封面。
 * - 调用方可传 taskId（路由侧先建任务再异步执行），或不传（自建任务）。
 * - 失败时把任务标记为 failed 并带 error；成功标记 completed。
 */
export async function generateNovelCover(
  db: Db,
  opts: {
    userId: string
    novelId: string
    taskId?: string
    /** 渲染书名+作者名文字层（模型需支持中文渲染，如 gpt-image-2） */
    renderTitle?: boolean
    /** 平台风格调性 */
    platform?: CoverPlatform | string
    /** 主视觉预设 */
    stylePreset?: CoverStylePreset | string
    /** 构图预设 */
    composition?: CoverComposition | string
    /** 变体标识；重试时复用以保留同一视觉方向 */
    variationId?: string
    prompt?: string
    ipAddress?: string
    userAgent?: string
  },
): Promise<{ taskId: string }> {
  if (!isImageAiConfigured()) throw new AiError('disabled', 'AI 图像服务未配置', 503)

  const meta = await loadNovelMeta(db, opts.novelId)
  if (!meta) throw new AiError('invalid', '小说不存在', 404)

  const settings = await getAiSettings(db)
  const customPrompt = normalizeCoverPrompt(opts.prompt, settings.coverPromptMaxChars)
  const renderTitle = !!opts.renderTitle
  const platform = normalizePlatform(opts.platform)
  const variationId = normalizeVariationId(opts.variationId)
  const ownsTask = !opts.taskId
  const taskId =
    opts.taskId ||
    (
      await createAiTask(db, {
        userId: opts.userId,
        novelId: opts.novelId,
        kind: 'cover',
        total: 1,
        prompt: '生成封面',
        params: JSON.stringify({
          novelId: opts.novelId,
          renderTitle,
          platform,
          stylePreset: opts.stylePreset || 'auto',
          composition: opts.composition || 'auto',
          variationId,
          coverPromptMaxChars: settings.coverPromptMaxChars,
        }),
      })
    ).id
  await updateAiTask(db, taskId, { status: 'running', step: '正在生成封面描述词' })
  if (await isAiTaskCancelled(db, taskId)) throw new AiError('invalid', '任务已取消')

  try {
    const imageProvider_ = imageProvider()
    await updateAiTask(db, taskId, { step: '正在生成封面描述词' })
    const built = customPrompt
      ? {
          prompt: customPrompt,
          metadata: metadataForCustomPrompt(meta, { ...opts, novelId: opts.novelId, variationId }, variationId),
          textUsage: null,
        }
      : await buildImagePrompt(meta, {
          renderTitle,
          platform,
          novelId: opts.novelId,
          stylePreset: opts.stylePreset,
          composition: opts.composition,
          variationId,
        })
    const { prompt, metadata, textUsage } = built
    if (await isAiTaskCancelled(db, taskId)) throw new AiError('invalid', '任务已取消')

    // 把最终送图像模型的 prompt 落进任务 step：失败时据此定位是哪个词触发了上游安全策略
    await updateAiTask(db, taskId, { step: `正在生成封面（prompt：${prompt.slice(0, 200)}）` })

    const imageSettings = settings
    const img = await generateImage({
      prompt,
      size: imageSettings.coverImageSize || imageSettings.imageSize,
      quality: imageSettings.imageQuality,
      responseFormat: imageSettings.imageResponseFormat,
      timeoutMs: 120_000,
    })
    if (img.data.byteLength > MAX_COVER_BYTES) {
      throw new AiError('invalid', `生成的图片过大（${img.data.byteLength} 字节，上限 ${MAX_COVER_BYTES}）`)
    }

    // 生成结果不覆盖当前封面，先落候选：管理员后台预览后「采纳」才替换（旧封面永不丢）
    await storeCoverCandidate(db, {
      novelId: opts.novelId,
      data: img.data,
      contentType: img.contentType,
      prompt,
      taskId,
      metadata,
    })

    // 记账：图像调用填 image_count；文本描述词调用（若发生）单独记一次文本用量，与图像分开审计
    if (textUsage) {
      await recordUsage(db, {
        userId: opts.userId,
        model: textUsage.model,
        provider: providerLabel(textUsage.baseUrl),
        promptTokens: textUsage.promptTokens,
        completionTokens: textUsage.completionTokens,
        costMillicents: Math.round(textUsage.cost * 100_000),
        novelId: opts.novelId,
        generationType: 'cover_prompt',
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      })
    }
    await recordUsage(db, {
      userId: opts.userId,
      model: img.model,
      provider: imageProviderLabel(imageProvider_.baseUrl),
      promptTokens: 0,
      completionTokens: 0,
      imageCount: 1,
      costMillicents: Math.round(img.cost * 100_000),
      novelId: opts.novelId,
      generationType: 'cover',
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    })

    if (ownsTask) await updateAiTask(db, taskId, { status: 'completed', current: 1, step: '封面已生成，待采纳' })
    return { taskId }
  } catch (err) {
    if (ownsTask) {
      // 失败时把上游原因 + 实际 prompt 一起带出，方便定位是哪个词触发的安全拦截
      const reason = err instanceof AiError ? err.message : '封面生成失败'
      const { step } = await getTaskStep(db, taskId)
      await updateAiTask(db, taskId, { status: 'failed', error: `${reason}${step ? `（${step}）` : ''}` }).catch(() => {})
    }
    throw err
  }
}
