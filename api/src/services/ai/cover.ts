/**
 * AI 小说封面生成 —— 读取小说元数据 → 文本模型翻英文描述词 → 图像模型出图 → 落候选表。
 * 生成结果存 ai_cover_candidates（候选），不覆盖当前封面；管理员在后台预览后「采纳」才
 * 经 adoptCoverCandidate 覆盖 novel_covers，公开页经 /api/cover/:id 生效。
 * 任务记录在 ai_tasks（kind='cover'），成本记账在 ai_usage（generation_type='cover', image_count=1），
 * 不进 ai_generations（该表是文本草稿+发布流转专用，result 是 TEXT 装不下二进制）。
 */
import type { Db } from '../../db/pool'
import { first } from '../../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { generateImage, isImageAiConfigured, imageProvider, imageProviderLabel } from './image'
import { recordUsage } from './usage'
import { getAiSettings } from './settings'
import { createAiTask, isAiTaskCancelled, updateAiTask, getAiTask } from './tasks'
import { storeCoverCandidate, MAX_COVER_BYTES } from '../covers'
import { GENRE_STYLES, GENRE_PRIORITY, PLATFORM_STYLES, inferGenre, isCoverPlatform, type CoverPlatform, type Genre, type GenreStyle } from './cover-styles'

interface NovelMeta {
  title: string
  author: string
  description: string
  categories: string[]
}

/** buildImagePrompt 的封面选项：文字层、平台风格、安全归一化，均由调用方透传。 */
export interface CoverPromptOptions {
  /** 启用安全归一化：把限制级/暴力内容抽象为唯美氛围画面，规避上游图像安全策略 */
  safe: boolean
  /** 渲染书名+作者名文字层：默认 true（story-cover 核心——书名与作者名是封面必需信息），显式 false 才关闭 */
  renderTitle?: boolean
  /** 平台风格调性；缺省或非法值按 'default'（通用竖版，不叠加平台专属风格） */
  platform?: CoverPlatform | string
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
  return buildImagePrompt(meta, opts)
}

/** 取任务当前 step（失败时回显用的实际 prompt 就存在这里）。 */
async function getTaskStep(db: Db, taskId: string): Promise<{ step: string }> {
  const task = await getAiTask(db, taskId)
  return { step: task?.step || '' }
}

interface BuildPromptResult {
  prompt: string
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
 * - opts.safe=true：启用安全归一化，强制把画面导向非具名、非性化、非暴力的唯美氛围，
 *   规避 18+/暴力/禁忌题材词汇触发上游图像服务的安全策略。
 */
export async function buildImagePrompt(meta: NovelMeta, opts: CoverPromptOptions): Promise<BuildPromptResult> {
  const safe = opts.safe
  const renderTitle = opts.renderTitle !== false
  const platform = normalizePlatform(opts.platform)

  const titleHint = meta.title.slice(0, 60)
  const authorHint = meta.author.slice(0, 40)
  const catHint = meta.categories.slice(0, 3).join(', ')
  const descHint = meta.description.slice(0, 300)

  // 题材判定 + 画面层：文本模型就绪时语义判定题材并用其模板生成画面；否则关键词推断 + 模板画面
  let genre: Genre
  let scene: string
  let textUsage: BuildPromptResult['textUsage'] = null
  if (isTextAiConfigured()) {
    const judged = await judgeGenre(meta)
    genre = judged.genre
    const generated = await generateSceneDescription({ titleHint, catHint, descHint, style: GENRE_STYLES[genre], safe })
    scene = generated.scene
    textUsage = mergeTextUsage(judged.textUsage, generated.textUsage)
  } else {
    genre = inferGenre(meta.title, meta.categories)
    scene = `${GENRE_STYLES[genre].figure} ${GENRE_STYLES[genre].background}`
  }

  const style = GENRE_STYLES[genre]
  const platformStyle = PLATFORM_STYLES[platform]

  const prompt = assembleCoverPrompt({ scene, style, platformStyle, titleHint, authorHint, renderTitle, safe })
  return { prompt, textUsage }
}

/** 组装最终送图像模型的完整 prompt：平台层 + 文字层 + 画面层 + 风格/色彩/光效 + 通用修饰。 */
function assembleCoverPrompt(args: {
  scene: string
  style: (typeof GENRE_STYLES)[keyof typeof GENRE_STYLES]
  platformStyle: string
  titleHint: string
  authorHint: string
  renderTitle: boolean
  safe: boolean
}): string {
  const { scene, style, platformStyle, titleHint, authorHint, renderTitle, safe } = args
  const lines: string[] = []

  lines.push(['Chinese web novel cover design', platformStyle].filter(Boolean).join(', ') + '.')

  // 文字层：默认渲染书名+作者名，仅显式关闭才省略
  if (renderTitle && titleHint) {
    lines.push(`Title text '${titleHint}' at top center in ${style.titleFont}.`)
    if (authorHint) lines.push(`Author name '${authorHint}' at bottom center in ${style.authorFont}.`)
  }

  lines.push(`${style.tag}. ${scene}.`)
  lines.push(`${style.color}. ${style.light}.`)

  const tail = ['Professional book cover, high detail digital painting, portrait 2:3 ratio']
  if (renderTitle && titleHint) tail.push('keep title and author name inside the central safe area away from edges (inner ~85%)')
  else tail.push('no text')
  tail.push('no watermark')
  if (safe) tail.push('elegant, atmospheric, safe for work, no explicit scenes')
  lines.push(tail.join(', '))

  return lines.join('\n')
}

/** 题材中文别名，用于解析文本模型的判定输出（模型可能回中文而非英文代号）。 */
const GENRE_ALIASES: Record<Genre, string[]> = {
  xianxia: ['仙侠', '玄幻', '修真'],
  urban: ['都市', '现代'],
  ancient: ['古言', '宫斗', '古风', '古代'],
  romance: ['现言', '甜宠', '言情'],
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
  const genre = parseGenreText(res.text) || inferGenre(meta.title, meta.categories)
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
  safe: boolean
}): Promise<{ scene: string; textUsage: BuildPromptResult['textUsage'] }> {
  const { titleHint, catHint, descHint, style, safe } = args
  const textProvider_ = textProvider()

  const safeRules = safe
    ? [
        '6. 严禁出现性暗示、裸露、暴力、血腥、禁忌题材、具名真人或版权角色的直白描述；',
        '7. 把任何限制级/暴力内容抽象为唯美的氛围画面（如烛光、绸缎、暗调光影），不描写具体行为；',
      ]
    : []
  const user = [
    '你是网文封面画面设计师。结合「题材视觉模板」与小说元数据，写一段英文封面画面描述。',
    '要求：',
    '1. 只输出一段英文描述（1-2 句），不要解释、不要引号、不要换行；',
    '2. 必须包含人物形象（服饰/姿态/道具）与场景背景两个层次，越具体越好；',
    '3. 在模板基础上细化，可用模板中的风格、色彩、光效关键词；',
    '4. 长度控制在 60-90 个英文单词以内；',
    '5. 不要包含任何文字/标题/水印描述（title、text、watermark 等词一律不要出现）。',
    ...safeRules,
    '题材视觉模板：',
    `- 风格：${style.tag}`,
    `- 人物：${style.figure}`,
    `- 背景：${style.background}`,
    `- 色彩：${style.color}`,
    `- 光效：${style.light}`,
    titleHint ? `标题：${titleHint}` : '',
    catHint ? `分类：${catHint}` : '',
    descHint ? `简介：${descHint}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const systemContent = safe
    ? '你是为 AI 图像生成模型撰写英文封面画面描述的专家。结合题材视觉模板把小说元数据转化为能通过内容安全审核的唯美画面：规避所有性化、暴力、禁忌题材词汇，把成人/限制级内容抽象为不含具象行为、不含具名人物的氛围画面。只描述画面本身（人物+背景），不要出现任何文字/标题描述。'
    : '你是为 AI 图像生成模型撰写英文封面画面描述的专家，擅长把小说元数据转化为有视觉冲击力的画面描述（人物+背景）。只描述画面本身，不要出现任何文字/标题描述。'

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

function normalizeCustomPrompt(value: unknown, safe: boolean): string {
  const prompt = String(value || '').trim()
  if (!prompt) return ''
  if (prompt.length > 2_000) throw new AiError('invalid', '封面描述词不能超过 2000 个字符', 422)
  // 自定义描述词是用户完全掌控的成品 prompt，不注入 no text（用户可能自己写了文字层）；
  // 仅在安全模式下补充安全约束稀释负面信号。
  if (safe && !/safe for work/i.test(prompt)) {
    return `${prompt}, elegant, atmospheric, digital painting, safe for work, no explicit scenes`
  }
  return prompt
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
    /** 启用安全归一化：把限制级/暴力内容抽象为唯美氛围画面，规避上游图像安全策略 */
    safe?: boolean
    /** 渲染书名+作者名文字层（模型需支持中文渲染，如 gpt-image-2） */
    renderTitle?: boolean
    /** 平台风格调性 */
    platform?: CoverPlatform | string
    prompt?: string
    ipAddress?: string
    userAgent?: string
  },
): Promise<{ taskId: string }> {
  if (!isImageAiConfigured()) throw new AiError('disabled', 'AI 图像服务未配置', 503)

  const meta = await loadNovelMeta(db, opts.novelId)
  if (!meta) throw new AiError('invalid', '小说不存在', 404)

  const safe = opts.safe !== false ? true : false
  const renderTitle = !!opts.renderTitle
  const platform = normalizePlatform(opts.platform)
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
        params: JSON.stringify({ novelId: opts.novelId, safe, renderTitle, platform }),
      })
    ).id
  await updateAiTask(db, taskId, { status: 'running', step: `正在生成封面描述词${safe ? '（安全模式）' : ''}` })
  if (await isAiTaskCancelled(db, taskId)) throw new AiError('invalid', '任务已取消')

  try {
    const imageProvider_ = imageProvider()
    await updateAiTask(db, taskId, { step: `正在生成封面描述词${safe ? '（安全模式）' : ''}` })
    const customPrompt = normalizeCustomPrompt(opts.prompt, safe)
    const { prompt, textUsage } = customPrompt ? { prompt: customPrompt, textUsage: null } : await buildImagePrompt(meta, { safe, renderTitle, platform })
    if (await isAiTaskCancelled(db, taskId)) throw new AiError('invalid', '任务已取消')

    // 把最终送图像模型的 prompt 落进任务 step：失败时据此定位是哪个词触发了上游安全策略
    await updateAiTask(db, taskId, { step: `正在生成封面（prompt：${prompt.slice(0, 200)}）` })

    const imageSettings = await getAiSettings(db)
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
