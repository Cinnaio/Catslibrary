/**
 * AI 用量记账与配额 —— 每次真实调用落 ai_usage，命中缓存不记账也不计配额。
 * cost_millicents 默认来自上游 usage.cost，兼容顶层 cost（货币单位 × 100_000），
 * 缺失或无效时落 0，不按模型标价估算；币种由供应商口径决定，本模块不假设。
 */
import type { Db } from '../../db/pool'
import { first, run } from '../../db/query'
import { newId } from '../auth'
import type { UpstreamUsage } from './upstream-usage'

export interface UsageRecord extends UpstreamUsage {
  userId: string
  model: string
  provider: string
  promptTokens: number
  completionTokens: number
  imageCount?: number
  costMillicents?: number
  // 审计字段
  novelId?: string
  chapterId?: string
  generationType?: string
  ipAddress?: string
  userAgent?: string
}

export async function recordUsage(db: Db, rec: UsageRecord): Promise<void> {
  await run(
    db,
    `INSERT INTO ai_usage (id, user_id, model, provider, prompt_tokens, completion_tokens, image_count, cost_millicents, novel_id, chapter_id, generation_type, ip_address, user_agent, created_at, cache_read_tokens, cache_write_tokens, reasoning_tokens, cost_reported)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      newId('aiuse'),
      rec.userId || '',
      rec.model || '',
      rec.provider || '',
      Math.max(0, Math.trunc(rec.promptTokens) || 0),
      Math.max(0, Math.trunc(rec.completionTokens) || 0),
      Math.max(0, Math.trunc(rec.imageCount || 0)),
      Math.max(0, Math.trunc(rec.costMillicents || 0)),
      rec.novelId || '',
      rec.chapterId || '',
      rec.generationType || '',
      // 审计字段来自请求头，截断防御超长输入膨胀审计表
      String(rec.ipAddress || '').slice(0, 100),
      String(rec.userAgent || '').slice(0, 500),
      Date.now(),
      rec.cacheReadTokens ?? null,
      rec.cacheWriteTokens ?? null,
      rec.reasoningTokens ?? null,
      rec.costReported ?? (rec.costMillicents ?? 0) > 0,
    ],
  )
}

export interface QuotaState {
  ok: boolean
  used: number
  limit: number
  /** 配额重置时刻（下一个本地零点，epoch 毫秒） */
  resetAt: number
}

/** 本地日历日的零点——配额按自然日重置，与用户直觉一致。 */
export function startOfToday(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfTomorrow(now = Date.now()): number {
  const d = new Date(startOfToday(now))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

export async function countUsageSince(db: Db, userId: string, since: number): Promise<number> {
  const row = await first<{ total: number }>(db, 'SELECT COUNT(*)::int AS total FROM ai_usage WHERE user_id = $1 AND created_at >= $2', [userId, since])
  return Number(row?.total) || 0
}

/** 管理员不限额（传 unlimited=true）；读者按 dailyQuota 卡自然日调用次数。 */
export async function checkQuota(db: Db, userId: string, dailyQuota: number, unlimited = false): Promise<QuotaState> {
  const resetAt = startOfTomorrow()
  if (unlimited) return { ok: true, used: 0, limit: -1, resetAt }
  if (dailyQuota <= 0) return { ok: false, used: 0, limit: 0, resetAt }
  const used = await countUsageSince(db, userId, startOfToday())
  return { ok: used < dailyQuota, used, limit: dailyQuota, resetAt }
}

export interface UsageSummary {
  calls: number
  promptTokens: number
  completionTokens: number
  costMillicents: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheReadReportedCalls: number
  cacheWriteReportedCalls: number
  costReportedCalls: number
}

export async function summarizeUsage(db: Db, since: number): Promise<UsageSummary> {
  const row = await first<Record<string, string | number>>(
    db,
    `SELECT COUNT(*)::int AS calls,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost_millicents) FILTER (WHERE cost_reported), 0) AS cost,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
            COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
            COUNT(cache_read_tokens)::int AS cache_read_reported_calls,
            COUNT(cache_write_tokens)::int AS cache_write_reported_calls,
            COUNT(*) FILTER (WHERE cost_reported)::int AS cost_reported_calls
     FROM ai_usage WHERE created_at >= $1`,
    [since],
  )
  return {
    calls: Number(row?.calls) || 0,
    promptTokens: Number(row?.prompt_tokens) || 0,
    completionTokens: Number(row?.completion_tokens) || 0,
    costMillicents: Number(row?.cost) || 0,
    cacheReadTokens: Number(row?.cache_read_tokens) || 0,
    cacheWriteTokens: Number(row?.cache_write_tokens) || 0,
    cacheReadReportedCalls: Number(row?.cache_read_reported_calls) || 0,
    cacheWriteReportedCalls: Number(row?.cache_write_reported_calls) || 0,
    costReportedCalls: Number(row?.cost_reported_calls) || 0,
  }
}
