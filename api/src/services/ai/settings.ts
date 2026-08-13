/**
 * AI 运营设置 —— 存 app_settings.ai_settings（JSON），与供应商密钥分开：
 * 密钥走 .env / 安装向导（config.ts），这里只管「开不开、给谁用、给多少」。
 */
import type { Db } from '../../db/pool'
import { first, run } from '../../db/query'

export interface AiSettings {
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
  /** 同时运行的创作任务上限（大纲/章节/续写共用） */
  maxConcurrentWritingTasks: number
  imageSize: string
  imageQuality: string
  imageResponseFormat: string

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

export const DEFAULT_AI_SETTINGS: AiSettings = {
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
  writingSystemPrompt: '你是中文网络小说作者。请根据提供的设定和上下文创作正文，保持人物动机、叙事视角和风格一致。只输出正文，不要标题、解释或 Markdown。',
  maxConcurrentWritingTasks: 3,
  imageSize: '1024x1024',
  imageQuality: 'standard',
  imageResponseFormat: 'b64_json',

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
  maxConcurrentWritingTasks: { min: 1, max: 10 },
  imageSize: { maxLength: 20 },
  imageQuality: { maxLength: 20 },
  imageResponseFormat: { maxLength: 20 },
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
  return {
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
    maxConcurrentWritingTasks: clampInt(obj.maxConcurrentWritingTasks, DEFAULT_AI_SETTINGS.maxConcurrentWritingTasks, LIMITS.maxConcurrentWritingTasks),
    imageSize: clampEnum(obj.imageSize, DEFAULT_AI_SETTINGS.imageSize, ['1024x1024', '1792x1024', '1024x1792', '512x512']),
    imageQuality: clampEnum(obj.imageQuality, DEFAULT_AI_SETTINGS.imageQuality, ['standard', 'hd']),
    imageResponseFormat: clampEnum(obj.imageResponseFormat, DEFAULT_AI_SETTINGS.imageResponseFormat, ['b64_json', 'url']),

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
