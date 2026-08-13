/**
 * AI 小说封面生成 —— 读取小说元数据 → 文本模型翻英文描述词 → 图像模型出图 → 落 novel_covers。
 * 结果直接覆盖式落库（与现有「封面即最新」模型一致），公开页经 /api/cover/:id 自动生效。
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
import { storeCover, MAX_COVER_BYTES } from '../covers'

interface NovelMeta {
  title: string
  description: string
  categories: string[]
}

async function loadNovelMeta(db: Db, novelId: string): Promise<NovelMeta | null> {
  const row = await first<{ title: string; description: string; categories: string }>(
    db,
    'SELECT title, description, categories FROM novels WHERE id = $1',
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
  return { title: String(row.title || ''), description: String(row.description || ''), categories }
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
 * 用文本模型把中文元数据翻译成适合图像模型的英文描述词。
 * 文本模型未配置时退化为直接拼标题（图像模型通常仍能处理简单标题），返回 textUsage=null。
 *
 * safe=true 时启用「安全归一化」：强制把画面导向非具名、非性化、非暴力的唯美氛围，
 * 规避 18+/暴力/禁忌题材词汇触发上游图像服务的安全策略。适合作者小说简介偏限制级时使用。
 */
async function buildImagePrompt(meta: NovelMeta, safe: boolean): Promise<BuildPromptResult> {
  const titleHint = meta.title.slice(0, 60)
  const catHint = meta.categories.slice(0, 3).join(', ')
  const descHint = meta.description.slice(0, 300)

  if (!isTextAiConfigured()) {
    const parts = [
      `book cover illustration for a novel${titleHint ? ` titled "${titleHint}"` : ''}`,
      catHint ? `${catHint} theme` : '',
      safe ? 'elegant, atmospheric, digital painting, safe for work, no text' : 'detailed, atmospheric, no text',
    ].filter(Boolean)
    return { prompt: parts.join(', '), textUsage: null }
  }

  const textProvider_ = textProvider()
  const safeRules = safe ? [
    '4. 严禁出现性暗示、裸露、暴力、血腥、禁忌题材、具名真人或版权角色的直白描述；',
    '5. 把任何限制级/暴力内容抽象为唯美的氛围画面（如烛光、绸缎、暗调光影），不描写具体行为；',
    '6. 结尾追加 "elegant, atmospheric, digital painting, safe for work, no text, no explicit scenes"。',
  ] : [
    '4. 结尾加 "no text" 避免画面里出现乱码文字。',
  ]
  const user = [
    '请把以下中文小说的元数据翻译成一句适合 AI 图像生成模型的英文描述词（prompt）。',
    '要求：',
    '1. 只输出一句英文描述词，不要解释、不要引号、不要换行；',
    '2. 突出题材氛围与视觉风格；',
    `3. 长度控制在 80 个英文单词以内。${safe ? '' : '结尾加 "no text"。'}`,
    ...safeRules,
    meta.title ? `标题：${meta.title}` : '',
    catHint ? `分类：${catHint}` : '',
    descHint ? `简介：${descHint}` : '',
  ].filter(Boolean).join('\n')

  const systemContent = safe
    ? '你是为 AI 图像生成模型撰写英文 prompt 的专家。你的任务是把小说元数据转化为能通过内容安全审核的唯美画面描述：必须规避所有性化、暴力、禁忌题材词汇，把成人/限制级内容抽象为不含具象行为、不含具名人物的氛围画面。'
    : '你是为 AI 图像生成模型撰写英文 prompt 的专家，擅长把小说元数据转化为有视觉冲击力的画面描述。'

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
  let prompt = res.text.replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim()
  // 安全模式下强制追加正向风格词稀释负面信号（若模型已带则不重复）
  if (safe && !/safe for work/i.test(prompt)) {
    prompt = `${prompt}, elegant, atmospheric, digital painting, safe for work, no text, no explicit scenes`
  }
  return {
    prompt: prompt || `book cover illustration${titleHint ? ` for "${titleHint}"` : ''}, ${catHint || 'novel'} theme, ${safe ? 'elegant, atmospheric, safe for work, ' : ''}no text`,
    textUsage: {
      model: res.model,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      cost: res.cost,
      baseUrl: textProvider_.baseUrl,
    },
  }
}

/**
 * 为小说生成封面。
 * - 调用方可传 taskId（路由侧先建任务再异步执行），或不传（自建任务）。
 * - 失败时把任务标记为 failed 并带 error；成功标记 completed。
 */
export async function generateNovelCover(db: Db, opts: {
  userId: string
  novelId: string
  taskId?: string
  /** 启用安全归一化：把限制级/暴力内容抽象为唯美氛围画面，规避上游图像安全策略 */
  safe?: boolean
  ipAddress?: string
  userAgent?: string
}): Promise<{ taskId: string }> {
  if (!isImageAiConfigured()) throw new AiError('disabled', 'AI 图像服务未配置', 503)

  const meta = await loadNovelMeta(db, opts.novelId)
  if (!meta) throw new AiError('invalid', '小说不存在', 404)

  const safe = opts.safe !== false ? true : false
  const ownsTask = !opts.taskId
  const taskId = opts.taskId || (await createAiTask(db, { userId: opts.userId, novelId: opts.novelId, kind: 'cover', total: 1, prompt: '生成封面', params: JSON.stringify({ novelId: opts.novelId, safe }) })).id
  await updateAiTask(db, taskId, { status: 'running', step: `正在生成封面描述词${safe ? '（安全模式）' : ''}` })
  if (await isAiTaskCancelled(db, taskId)) throw new AiError('invalid', '任务已取消')

  try {
    const imageProvider_ = imageProvider()
    await updateAiTask(db, taskId, { step: `正在生成封面描述词${safe ? '（安全模式）' : ''}` })
    const { prompt, textUsage } = await buildImagePrompt(meta, safe)
    if (await isAiTaskCancelled(db, taskId)) throw new AiError('invalid', '任务已取消')

    // 把最终送图像模型的 prompt 落进任务 step：失败时据此定位是哪个词触发了上游安全策略
    await updateAiTask(db, taskId, { step: `正在生成封面（prompt：${prompt.slice(0, 200)}）` })

    const imageSettings = await getAiSettings(db)
    const img = await generateImage({ prompt, size: imageSettings.imageSize, quality: imageSettings.imageQuality, responseFormat: imageSettings.imageResponseFormat, timeoutMs: 120_000 })
    if (img.data.byteLength > MAX_COVER_BYTES) {
      throw new AiError('invalid', `生成的图片过大（${img.data.byteLength} 字节，上限 ${MAX_COVER_BYTES}）`)
    }

    await storeCover(db, opts.novelId, img.data, img.contentType, 'ai')

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

    if (ownsTask) await updateAiTask(db, taskId, { status: 'completed', current: 1, step: '已完成' })
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
