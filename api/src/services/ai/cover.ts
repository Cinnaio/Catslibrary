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
import { GENRE_STYLES, PLATFORM_STYLES, inferGenre, isCoverPlatform, type CoverPlatform } from './cover-styles'

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
  /** 渲染书名+作者名文字层（模型需支持中文渲染，如 gpt-image-2）；false 时结尾走 no text */
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
 * 用文本模型把中文元数据翻译成适合图像模型的「画面描述层」（人物/背景/氛围），
 * 再叠加题材风格标签、平台调性、（可选）书名+作者名文字层，拼成完整封面 prompt。
 *
 * - 文本模型职责收窄：只产出画面描述，不再管标题——书名/作者名由文字层模板 + 题材字体库拼装，
 *   避免文本模型把书名翻译成英文塞进画面。文本模型未配置时退化为直接拼题材标签，textUsage=null。
 * - opts.renderTitle=true：在图上渲染书名+作者名（模型需支持中文渲染，如 gpt-image-2）；
 *   false（默认）：结尾走 no text，只享受题材/平台/构图升级。
 * - opts.safe=true：启用安全归一化，强制把画面导向非具名、非性化、非暴力的唯美氛围，
 *   规避 18+/暴力/禁忌题材词汇触发上游图像服务的安全策略。与文字层正交，同时生效。
 */
export async function buildImagePrompt(meta: NovelMeta, opts: CoverPromptOptions): Promise<BuildPromptResult> {
  const safe = opts.safe
  const renderTitle = !!opts.renderTitle
  const platform = normalizePlatform(opts.platform)

  const titleHint = meta.title.slice(0, 60)
  const authorHint = meta.author.slice(0, 40)
  const catHint = meta.categories.slice(0, 3).join(', ')
  const descHint = meta.description.slice(0, 300)

  const genre = inferGenre(meta.title, meta.categories)
  const style = GENRE_STYLES[genre]
  const platformStyle = PLATFORM_STYLES[platform]

  // 画面描述层：优先用文本模型生成；未配置则回落题材标签
  let scene: string
  let textUsage: BuildPromptResult['textUsage'] = null
  if (isTextAiConfigured()) {
    const generated = await generateSceneDescription({ titleHint, catHint, descHint, safe })
    scene = generated.scene
    textUsage = generated.textUsage
  } else {
    scene = [catHint ? `${catHint} theme` : `${genre} theme`, 'detailed atmospheric scene'].filter(Boolean).join(', ')
  }

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

  // 文字层：仅在 renderTitle 且有书名时渲染
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

/** 用文本模型把中文元数据翻成「画面描述层」英文短语（不含标题文字）。 */
async function generateSceneDescription(args: {
  titleHint: string
  catHint: string
  descHint: string
  safe: boolean
}): Promise<{ scene: string; textUsage: BuildPromptResult['textUsage'] }> {
  const { titleHint, catHint, descHint, safe } = args
  const textProvider_ = textProvider()

  const safeRules = safe
    ? [
        '4. 严禁出现性暗示、裸露、暴力、血腥、禁忌题材、具名真人或版权角色的直白描述；',
        '5. 把任何限制级/暴力内容抽象为唯美的氛围画面（如烛光、绸缎、暗调光影），不描写具体行为；',
      ]
    : []
  const user = [
    '请把以下中文小说的元数据翻译成一句适合 AI 图像生成模型的英文「画面描述」（只描述人物、场景、氛围，不要出现书名文字）。',
    '要求：',
    '1. 只输出一句英文描述，不要解释、不要引号、不要换行；',
    '2. 突出人物形象、背景场景与氛围，越具体越好（服饰、姿态、场景、光线）；',
    '3. 长度控制在 60 个英文单词以内；',
    '4. 不要包含任何文字/标题/水印描述（title、text、watermark 等词一律不要出现）。',
    ...safeRules,
    titleHint ? `标题：${titleHint}` : '',
    catHint ? `分类：${catHint}` : '',
    descHint ? `简介：${descHint}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const systemContent = safe
    ? '你是为 AI 图像生成模型撰写英文画面描述的专家。把小说元数据转化为能通过内容安全审核的唯美画面：规避所有性化、暴力、禁忌题材词汇，把成人/限制级内容抽象为不含具象行为、不含具名人物的氛围画面。只描述画面本身，不要出现任何文字/标题描述。'
    : '你是为 AI 图像生成模型撰写英文画面描述的专家，擅长把小说元数据转化为有视觉冲击力的画面描述。只描述人物、场景与氛围，不要出现任何文字/标题描述。'

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
  const scene =
    res.text.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim() ||
    [catHint ? `${catHint} theme` : 'novel theme', 'detailed atmospheric scene'].filter(Boolean).join(', ')
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
