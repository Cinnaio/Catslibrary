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

  // 前情提要参数默认值
  recapTemperature: 0.7,
  recapMaxTokens: 500,
  recapSystemPrompt: '你是一个专业的小说内容总结助手。请简洁准确地总结上一章的关键情节，帮助读者快速回忆剧情。',

  // 回顾总结参数默认值
  catchupEnabled: true,
  catchupMaxChapters: 3,
  catchupTemperature: 0.7,
  catchupMaxTokens: 800,

  // AI 创作参数默认值
  writingTemperature: 0.8,
  writingMaxTokens: 1800,
  writingSystemPrompt: '你是中文网络小说作者。请根据提供的设定和上下文创作正文，保持人物动机、叙事视角和风格一致。只输出正文，不要标题、解释或 Markdown。',

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
  catchupMaxChapters: { min: 1, max: 10 },
  catchupTemperature: { min: 0, max: 1 },
  catchupMaxTokens: { min: 100, max: 3000 },
  writingTemperature: { min: 0, max: 1 },
  writingMaxTokens: { min: 300, max: 1000000 },
  writingSystemPrompt: { maxLength: 2000 },
}

export async function getAiSettings(db: Db): Promise<AiSettings> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = $1', [AI_SETTINGS_KEY])
  if (!row?.value) return { ...DEFAULT_AI_SETTINGS }
  try {
    return normalizeAiSettings(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
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
    catchupMaxChapters: clampInt(obj.catchupMaxChapters, DEFAULT_AI_SETTINGS.catchupMaxChapters, LIMITS.catchupMaxChapters),
    catchupTemperature: clampFloat(obj.catchupTemperature, DEFAULT_AI_SETTINGS.catchupTemperature, LIMITS.catchupTemperature),
    catchupMaxTokens: clampInt(obj.catchupMaxTokens, DEFAULT_AI_SETTINGS.catchupMaxTokens, LIMITS.catchupMaxTokens),

    // AI 创作参数
    writingTemperature: clampFloat(obj.writingTemperature, DEFAULT_AI_SETTINGS.writingTemperature, LIMITS.writingTemperature),
    writingMaxTokens: clampInt(obj.writingMaxTokens, DEFAULT_AI_SETTINGS.writingMaxTokens, LIMITS.writingMaxTokens),
    writingSystemPrompt: clampString(obj.writingSystemPrompt, DEFAULT_AI_SETTINGS.writingSystemPrompt, LIMITS.writingSystemPrompt.maxLength),

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
