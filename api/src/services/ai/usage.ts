/**
 * AI 用量记账与配额 —— 每次真实调用落 ai_usage，站内内容复用不记账也不计配额。
 * cost_millicents 来自生成响应或精确关联的中转站账单（货币单位 × 100_000，保留小数），
 * 缺失或无效时落 0 并保留未回传标记；不按模型标价估算。
 */
import type { Db, DbClient } from '../../db/pool'
import { first, run, withTx } from '../../db/query'
import { newId } from '../auth'
import type { UpstreamUsage } from './upstream-usage'

export interface UsageRecord extends UpstreamUsage {
  /** 单次真实调用的稳定记账 ID，用于同一事实的幂等写入。 */
  usageId?: string
  /** 服务端准入时间；跨零点完成的读者调用仍归属原来的额度日。 */
  createdAt?: number
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
    `INSERT INTO ai_usage (id, user_id, model, provider, prompt_tokens, completion_tokens, image_count, cost_millicents, novel_id, chapter_id, generation_type, ip_address, user_agent, created_at, cache_read_tokens, cache_write_tokens, reasoning_tokens, cost_reported, upstream_request_id, cost_source, cost_currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)${rec.usageId ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    [
      rec.usageId || newId('aiuse'),
      rec.userId || '',
      rec.model || '',
      rec.provider || '',
      Math.max(0, Math.trunc(rec.promptTokens) || 0),
      Math.max(0, Math.trunc(rec.completionTokens) || 0),
      Math.max(0, Math.trunc(rec.imageCount || 0)),
      Number.isFinite(rec.costMillicents) ? Math.max(0, rec.costMillicents ?? 0) : 0,
      rec.novelId || '',
      rec.chapterId || '',
      rec.generationType || '',
      // 审计字段来自请求头，截断防御超长输入膨胀审计表
      String(rec.ipAddress || '').slice(0, 100),
      String(rec.userAgent || '').slice(0, 500),
      rec.createdAt ?? Date.now(),
      rec.cacheReadTokens ?? null,
      rec.cacheWriteTokens ?? null,
      rec.reasoningTokens ?? null,
      rec.costReported ?? (rec.costMillicents ?? 0) > 0,
      String(rec.upstreamRequestId ?? '').slice(0, 200),
      rec.costSource ?? '',
      rec.costCurrency ?? '',
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
  // 划选图片有独立任务配额，真实调用仍保留在总用量账本，但不占文本配额。
  const row = await first<{ total: number }>(db, "SELECT COUNT(*)::int AS total FROM ai_usage WHERE user_id = $1 AND created_at >= $2 AND generation_type <> 'selection_image'", [userId, since])
  return Number(row?.total) || 0
}

/** 管理员不限额（传 unlimited=true）；读者按 dailyQuota 卡自然日调用次数。 */
export async function checkQuota(db: DbClient, userId: string, dailyQuota: number, unlimited = false, now = Date.now()): Promise<QuotaState> {
  const resetAt = startOfTomorrow(now)
  if (unlimited) return { ok: true, used: 0, limit: -1, resetAt }
  if (dailyQuota <= 0) return { ok: false, used: 0, limit: 0, resetAt }
  // One snapshot counts a reservation OR its usage row, never both. Accounting
  // and reservation cleanup need not race two separate COUNT queries.
  const row = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM (
    SELECT id FROM ai_usage WHERE user_id=$1 AND created_at >= $2 AND generation_type <> 'selection_image'
    UNION ALL
    SELECT r.id FROM ai_quota_reservations r WHERE r.user_id=$1 AND r.created_at >= $2 AND r.expires_at > $3
      AND NOT EXISTS (SELECT 1 FROM ai_usage u WHERE u.id=r.id)
  ) charged`, [userId, startOfToday(now), now])
  const used = Number(row?.total) || 0
  return { ok: used < dailyQuota, used, limit: dailyQuota, resetAt }
}

export class ReaderQuotaExceededError extends Error {
  constructor(readonly quota: QuotaState) {
    super('今日 AI 生成次数已用完（含处理中或结果未确认的调用）')
    this.name = 'ReaderQuotaExceededError'
  }
}

export interface ReaderQuotaReservation { usageId: string; createdAt: number }

/** A short transaction serializes admission per user; no lock is held during AI work. */
export async function reserveReaderQuota(db: Db, userId: string, dailyQuota: number, unlimited = false): Promise<ReaderQuotaReservation | undefined> {
  if (unlimited) return undefined
  return withTx(db, async query => {
    const user = await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    if (!user.rows.length) throw new Error('Reader quota owner no longer exists')
    const now = Date.now()
    const quota = await checkQuota({ query }, userId, dailyQuota, false, now)
    if (!quota.ok) throw new ReaderQuotaExceededError(quota)
    // Prune only this user's elapsed days; current uncertain calls are retained.
    await query('DELETE FROM ai_quota_reservations WHERE user_id=$1 AND expires_at <= $2', [userId, now])
    const id = newId('aiuse')
    await query('INSERT INTO ai_quota_reservations(id,user_id,created_at,expires_at) VALUES($1,$2,$3,$4)',
      [id, userId, now, quota.resetAt])
    return { usageId: id, createdAt: now }
  })
}

/** The stable usage ID already prevents double counting if cleanup is interrupted. */
export async function settleReaderQuota(db: Db, usageId: string | undefined): Promise<void> {
  if (!usageId) return
  await run(db, 'DELETE FROM ai_quota_reservations WHERE id=$1 AND EXISTS (SELECT 1 FROM ai_usage WHERE id=$1)', [usageId])
    .catch(() => { /* Next admission still counts the linked usage exactly once. */ })
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
