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
}

export const AI_SETTINGS_KEY = 'ai_settings'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  recapEnabled: true,
  dailyQuota: 30,
  maxChapterChars: 6000,
}

const LIMITS = {
  dailyQuota: { min: 0, max: 1000 },
  maxChapterChars: { min: 500, max: 20000 },
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
  }
}

function clampInt(value: unknown, fallback: number, range: { min: number; max: number }): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(range.max, Math.max(range.min, n))
}
