/**
 * AI 运营设置 —— 存 app_settings.ai_settings（JSON），与供应商密钥分开：
 * 密钥走 .env / 安装向导（config.ts），这里只管「开不开、给谁用、给多少」。
 */
import type { Db } from '../../db/pool'
import { first, run } from '../../db/query'

export interface AiSettings {
  /** 划选出图允许的登录角色；空数组关闭此功能。 */
  selectionImageRoles: string[]
  /** 每人每日出图任务上限（失败也计入，避免重复调用）；0 关闭。 */
  selectionImageDailyQuota: number
  /** 阅读器前情提要开关 */
  recapEnabled: boolean
  /** 单个读者每日生成次数上限（命中缓存不计数）；0 表示禁止读者触发 */
  dailyQuota: number
  /** 送入模型的章节正文字符上限，控制成本 */
  maxChapterChars: number

  // === 前情提要参数 ===
  /** 前情提要生成创意度（0-1，越高越随机） */
  recapTemperature: number
  /** 前情提要最大输出 token 数 */
  recapMaxTokens: number
  /** 前情提要系统提示词模板 */
  recapSystemPrompt: string

  // === 回顾总结参数 ===
  /** 回来接着读功能开关 */
  catchupEnabled: boolean
  /** 距上次阅读超过多少天才提供「回来接着读」入口 */
  catchupStaleDays: number
  /** 回顾总结最多涉及章节数 */
  catchupMaxChapters: number
  /** 回顾总结生成创意度 */
  catchupTemperature: number
  /** 回顾总结最大输出 token 数 */
  catchupMaxTokens: number

  // === AI 创作参数 ===
  writingTemperature: number
  writingMaxTokens: number
  writingSystemPrompt: string
  /** 风格画像提取的最大输出 token（推理模型先消耗思考 token，需留足余量） */
  styleProfileMaxTokens: number
  /** 情节状态提取的最大输出 token（结构化四块，天然比风格画像长） */
  plotStateMaxTokens: number
  /** 关系画像提取的最大输出 token（角色关系动态/心理边界，稳定底色） */
  relationshipProfileMaxTokens: number
  /** 章节标题生成的最大输出 token */
  titleMaxTokens: number
  /** 同时运行的创作任务上限（大纲/章节/续写共用） */
  maxConcurrentWritingTasks: number
  imageSize: string
  imageQuality: string
  imageResponseFormat: string

  // === AI 封面参数 ===
  /** 封面出图尺寸（竖版为主）：与通用 imageSize 分开，避免影响其他图像用途 */
  coverImageSize: string
  /** 是否在封面上渲染书名+作者名文字层（模型需支持中文渲染，如 gpt-image-2），默认 false */
  coverRenderTitle: boolean
  /** 默认平台风格调性：default|fanqie|qidian|jinjiang|zhihu|qimao|ciweimao */
  coverPlatform: string
  /** 封面描述词最大字符数，封面生成页可编辑的提示词上限 */
  coverPromptMaxChars: number

  // === 书籍导入复核参数 ===
  /**
   * 导入解析的 AI 边界复核开关。默认关闭：确定性启发式是主链路，
   * AI 只裁决证据不足的少数行，属于可选增强而非必需环节。
   */
  importAiReviewEnabled: boolean
  /** 单次复核最多送多少候选行，控制成本与超时。 */
  importAiMaxCandidates: number
  /** 复核输出的 token 上限（只需回行号数组，留思考余量即可）。 */
  importAiMaxTokens: number
  /** 复核系统提示词模板 */
  importAiSystemPrompt: string

  // === 运维配置 ===
  /** 已结束 AI 任务的保留天数，启动时清理更早的记录 */
  taskRetentionDays: number

  // === 审计配置 ===
  /** 是否记录用户 IP 地址 */
  logIpAddress: boolean
  /** 是否记录用户 User-Agent */
  logUserAgent: boolean
}

export const AI_SETTINGS_KEY = 'ai_settings'

/**
 * 导入复核的默认提示词。
 *
 * 输出刻意压到最小熵：只要行号数组。让模型回结构化长文会让解析本身变成新的
 * 失败点，而「哪些行是章节标题」用行号集合表达已经完备——切分、编号归一化
 * 与幂等键生成仍由确定性代码完成，模型不碰。
 */
export const DEFAULT_IMPORT_REVIEW_SYSTEM_PROMPT = `你是中文小说 TXT 导入的章节边界审核员。给定若干候选行及其上下文，判断每一行是否是章节标题。

判定为章节标题：
- 位于行首、独立成行，标记新章节开始。常见写法：「第0009章 标题」「第九章」「32 标题」「0073标题」「序章」「楔子」「番外」。

判定为非章节标题：
- 正文句子（尤其以句号、省略号收尾的长句）
- 论坛楼层（「1楼」「2楼楼主」）
- 编号列表项（「1：男强女弱…」）、数量（「1万点积分」「99%了」）、年份（「2016年」）
- 章内重抄的标题副本（同一章里第二次出现的标题行）

只输出 JSON，不要解释，不要 Markdown 代码块：
{"headings":[12,47,88]}

数组元素是判定为章节标题的候选行号。判定为非标题的行不要出现在数组里。只能使用给定的候选行号，不要臆造。`

export const DEFAULT_AI_SETTINGS: AiSettings = {
  selectionImageRoles: ['admin'],
  selectionImageDailyQuota: 10,
  recapEnabled: true,
  dailyQuota: 30,
  maxChapterChars: 6000,

  // 前情提要参数默认值（与生成逻辑历史行为一致：低温度求准确，token 给推理模型留思考余量）
  recapTemperature: 0.2,
  recapMaxTokens: 1200,
  recapSystemPrompt: '你是一个专业的小说内容总结助手。请简洁准确地总结上一章的关键情节，帮助读者快速回忆剧情。',

  // 回顾总结参数默认值（同上，maxChapters 与原候选章节数保持一致）
  catchupEnabled: true,
  catchupStaleDays: 7,
  catchupMaxChapters: 5,
  catchupTemperature: 0.2,
  catchupMaxTokens: 1200,

  // AI 创作参数默认值
  writingTemperature: 0.8,
  writingMaxTokens: 1800,
  writingSystemPrompt: '你是中文网络小说作者。请根据提供的设定和上下文创作正文，保持人物动机、叙事视角和风格一致。输出格式：第一行输出本章标题（不加书名号、不加解释），空一行后输出正文；不要 Markdown。',
  // 提取类调用的输出 token 上限：推理模型先消耗思考 token，需留足余量，避免结构化输出被截断
  styleProfileMaxTokens: 1500,
  plotStateMaxTokens: 3000,
  relationshipProfileMaxTokens: 1200,
  titleMaxTokens: 200,
  maxConcurrentWritingTasks: 3,
  imageSize: '1024x1024',
  imageQuality: 'standard',
  imageResponseFormat: 'b64_json',

  // AI 封面参数默认值（封面竖版 2:3；文字层默认渲染书名+作者名——story-cover 认为这是封面必需信息）
  coverImageSize: '1024x1536',
  coverRenderTitle: true,
  coverPlatform: 'default',
  coverPromptMaxChars: 2_000,

  // 导入复核默认值：关闭，候选上限 80（约 7k 输入 token），输出只要行号数组
  importAiReviewEnabled: false,
  importAiMaxCandidates: 80,
  importAiMaxTokens: 2000,
  importAiSystemPrompt: DEFAULT_IMPORT_REVIEW_SYSTEM_PROMPT,

  // 运维配置默认值
  taskRetentionDays: 90,

  // 审计配置默认值
  logIpAddress: false,
  logUserAgent: false,
}

const LIMITS = {
  dailyQuota: { min: 0, max: 1000 },
  maxChapterChars: { min: 500, max: 20000 },
  recapTemperature: { min: 0, max: 1 },
  recapMaxTokens: { min: 100, max: 2000 },
  recapSystemPrompt: { maxLength: 1000 },
  catchupStaleDays: { min: 1, max: 90 },
  catchupMaxChapters: { min: 1, max: 10 },
  catchupTemperature: { min: 0, max: 1 },
  catchupMaxTokens: { min: 100, max: 3000 },
  writingTemperature: { min: 0, max: 1 },
  writingMaxTokens: { min: 300, max: 1000000 },
  writingSystemPrompt: { maxLength: 2000 },
  styleProfileMaxTokens: { min: 200, max: 1000000 },
  plotStateMaxTokens: { min: 300, max: 1000000 },
  relationshipProfileMaxTokens: { min: 200, max: 1000000 },
  titleMaxTokens: { min: 50, max: 2000 },
  maxConcurrentWritingTasks: { min: 1, max: 10 },
  imageSize: { maxLength: 20 },
  imageQuality: { maxLength: 20 },
  imageResponseFormat: { maxLength: 20 },
  coverImageSize: { maxLength: 20 },
  coverPlatform: { maxLength: 20 },
  coverPromptMaxChars: { min: 100, max: 10000 },
  importAiMaxCandidates: { min: 10, max: 300 },
  importAiMaxTokens: { min: 200, max: 8000 },
  importAiSystemPrompt: { maxLength: 2000 },
  taskRetentionDays: { min: 7, max: 365 },
}

/**
 * 进程内短 TTL 缓存，按 Db 实例隔离（WeakMap 保证测试库之间互不串味）。
 * 一次 AI 请求会在路由、缓存键、生成、审计等处反复读设置，
 * 不加缓存的话单次 catchup 要查 5+ 次 app_settings。
 * 本进程写入（saveAiSettings）即时刷新；TTL 兜底外部直改数据库的场景。
 */
const settingsCache = new WeakMap<object, { value: AiSettings; expiresAt: number }>()
const SETTINGS_CACHE_TTL_MS = 5_000

export async function getAiSettings(db: Db): Promise<AiSettings> {
  const hit = settingsCache.get(db)
  if (hit && Date.now() < hit.expiresAt) return hit.value

  const row = await first<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = $1', [AI_SETTINGS_KEY])
  let value: AiSettings
  if (!row?.value) {
    value = { ...DEFAULT_AI_SETTINGS }
  } else {
    try {
      value = normalizeAiSettings(JSON.parse(row.value))
    } catch {
      value = { ...DEFAULT_AI_SETTINGS }
    }
  }
  settingsCache.set(db, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS })
  return value
}

export async function saveAiSettings(db: Db, patch: unknown): Promise<AiSettings> {
  const current = await getAiSettings(db)
  const next = normalizeAiSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) })
  await run(
    db,
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [AI_SETTINGS_KEY, JSON.stringify(next), Date.now()],
  )
  settingsCache.set(db, { value: next, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS })
  return next
}

/** 缺字段用默认值补齐，越界值夹到区间内——设置表是历史数据，不信任其形状。 */
export function normalizeAiSettings(raw: unknown): AiSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const imageRoles = obj.selectionImageRoles
  return {
    selectionImageRoles: imageRoles === undefined
      ? [...DEFAULT_AI_SETTINGS.selectionImageRoles]
      : Array.isArray(imageRoles)
        ? ['admin', 'reader'].filter((role) => imageRoles.includes(role))
        : [],
    selectionImageDailyQuota: clampInt(obj.selectionImageDailyQuota, DEFAULT_AI_SETTINGS.selectionImageDailyQuota, { min: 0, max: 100 }),
    recapEnabled: obj.recapEnabled === undefined ? DEFAULT_AI_SETTINGS.recapEnabled : !!obj.recapEnabled,
    dailyQuota: clampInt(obj.dailyQuota, DEFAULT_AI_SETTINGS.dailyQuota, LIMITS.dailyQuota),
    maxChapterChars: clampInt(obj.maxChapterChars, DEFAULT_AI_SETTINGS.maxChapterChars, LIMITS.maxChapterChars),

    // 前情提要参数
    recapTemperature: clampFloat(obj.recapTemperature, DEFAULT_AI_SETTINGS.recapTemperature, LIMITS.recapTemperature),
    recapMaxTokens: clampInt(obj.recapMaxTokens, DEFAULT_AI_SETTINGS.recapMaxTokens, LIMITS.recapMaxTokens),
    recapSystemPrompt: clampString(obj.recapSystemPrompt, DEFAULT_AI_SETTINGS.recapSystemPrompt, LIMITS.recapSystemPrompt.maxLength),

    // 回顾总结参数
    catchupEnabled: obj.catchupEnabled === undefined ? DEFAULT_AI_SETTINGS.catchupEnabled : !!obj.catchupEnabled,
    catchupStaleDays: clampInt(obj.catchupStaleDays, DEFAULT_AI_SETTINGS.catchupStaleDays, LIMITS.catchupStaleDays),
    catchupMaxChapters: clampInt(obj.catchupMaxChapters, DEFAULT_AI_SETTINGS.catchupMaxChapters, LIMITS.catchupMaxChapters),
    catchupTemperature: clampFloat(obj.catchupTemperature, DEFAULT_AI_SETTINGS.catchupTemperature, LIMITS.catchupTemperature),
    catchupMaxTokens: clampInt(obj.catchupMaxTokens, DEFAULT_AI_SETTINGS.catchupMaxTokens, LIMITS.catchupMaxTokens),

    // AI 创作参数
    writingTemperature: clampFloat(obj.writingTemperature, DEFAULT_AI_SETTINGS.writingTemperature, LIMITS.writingTemperature),
    writingMaxTokens: clampInt(obj.writingMaxTokens, DEFAULT_AI_SETTINGS.writingMaxTokens, LIMITS.writingMaxTokens),
    writingSystemPrompt: clampString(obj.writingSystemPrompt, DEFAULT_AI_SETTINGS.writingSystemPrompt, LIMITS.writingSystemPrompt.maxLength),
    styleProfileMaxTokens: clampInt(obj.styleProfileMaxTokens, DEFAULT_AI_SETTINGS.styleProfileMaxTokens, LIMITS.styleProfileMaxTokens),
    plotStateMaxTokens: clampInt(obj.plotStateMaxTokens, DEFAULT_AI_SETTINGS.plotStateMaxTokens, LIMITS.plotStateMaxTokens),
    relationshipProfileMaxTokens: clampInt(obj.relationshipProfileMaxTokens, DEFAULT_AI_SETTINGS.relationshipProfileMaxTokens, LIMITS.relationshipProfileMaxTokens),
    titleMaxTokens: clampInt(obj.titleMaxTokens, DEFAULT_AI_SETTINGS.titleMaxTokens, LIMITS.titleMaxTokens),
    maxConcurrentWritingTasks: clampInt(obj.maxConcurrentWritingTasks, DEFAULT_AI_SETTINGS.maxConcurrentWritingTasks, LIMITS.maxConcurrentWritingTasks),
    imageSize: clampEnum(obj.imageSize, DEFAULT_AI_SETTINGS.imageSize, ['1024x1024', '1792x1024', '1024x1792', '1024x1536', '768x1024', '512x512']),
    imageQuality: clampEnum(obj.imageQuality, DEFAULT_AI_SETTINGS.imageQuality, ['standard', 'hd']),
    imageResponseFormat: clampEnum(obj.imageResponseFormat, DEFAULT_AI_SETTINGS.imageResponseFormat, ['b64_json', 'url']),

    // AI 封面参数：封面尺寸以竖版为主；平台风格限定为已知平台
    coverImageSize: clampEnum(obj.coverImageSize, DEFAULT_AI_SETTINGS.coverImageSize, ['1024x1536', '768x1024', '1024x1792', '1024x1024']),
    coverRenderTitle: obj.coverRenderTitle === undefined ? DEFAULT_AI_SETTINGS.coverRenderTitle : !!obj.coverRenderTitle,
    coverPlatform: clampEnum(obj.coverPlatform, DEFAULT_AI_SETTINGS.coverPlatform, ['default', 'fanqie', 'qidian', 'jinjiang', 'zhihu', 'qimao', 'ciweimao']),
    coverPromptMaxChars: clampInt(obj.coverPromptMaxChars, DEFAULT_AI_SETTINGS.coverPromptMaxChars, LIMITS.coverPromptMaxChars),

    // 导入复核参数：默认关闭，只有管理员显式打开才会触发模型调用
    importAiReviewEnabled: obj.importAiReviewEnabled === undefined ? DEFAULT_AI_SETTINGS.importAiReviewEnabled : !!obj.importAiReviewEnabled,
    importAiMaxCandidates: clampInt(obj.importAiMaxCandidates, DEFAULT_AI_SETTINGS.importAiMaxCandidates, LIMITS.importAiMaxCandidates),
    importAiMaxTokens: clampInt(obj.importAiMaxTokens, DEFAULT_AI_SETTINGS.importAiMaxTokens, LIMITS.importAiMaxTokens),
    importAiSystemPrompt: clampString(obj.importAiSystemPrompt, DEFAULT_AI_SETTINGS.importAiSystemPrompt, LIMITS.importAiSystemPrompt.maxLength),

    // 运维配置
    taskRetentionDays: clampInt(obj.taskRetentionDays, DEFAULT_AI_SETTINGS.taskRetentionDays, LIMITS.taskRetentionDays),

    // 审计配置
    logIpAddress: obj.logIpAddress === undefined ? DEFAULT_AI_SETTINGS.logIpAddress : !!obj.logIpAddress,
    logUserAgent: obj.logUserAgent === undefined ? DEFAULT_AI_SETTINGS.logUserAgent : !!obj.logUserAgent,
  }
}

function clampInt(value: unknown, fallback: number, range: { min: number; max: number }): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(range.max, Math.max(range.min, n))
}

function clampFloat(value: unknown, fallback: number, range: { min: number; max: number }): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(range.max, Math.max(range.min, n))
}

function clampString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  return value.slice(0, maxLength)
}

function clampEnum(value: unknown, fallback: string, allowed: string[]): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}
