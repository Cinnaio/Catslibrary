import { Hono, type Context } from 'hono'
import { loadConfig } from '../config'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { hashToken, newId } from '../services/auth'
import { clampInt, cleanText, escapeLike } from '../services/text'

const MAX_BODY_BYTES = 160 * 1024
const MAX_EVENTS_PER_BATCH = 50
const MAX_EVENTS_PER_MINUTE = 200
const MAX_PROPERTIES_BYTES = 64 * 1024
const DAY_MS = 86400000

const EVENT_TYPES = new Set(['event', 'error', 'metric', 'diagnostic'])
const SEVERITIES = new Set(['info', 'warning', 'error'])
const STATUSES = new Set(['open', 'acknowledged', 'resolved', 'ignored'])
export const MOBILE_TELEMETRY_RETENTION_DAYS = 90

type TelemetryEventInput = {
  id?: unknown
  eventId?: unknown
  type?: unknown
  name?: unknown
  severity?: unknown
  properties?: unknown
  createdAt?: unknown
}

type TelemetryBatchInput = {
  installId?: unknown
  sessionId?: unknown
  appVersion?: unknown
  buildVersion?: unknown
  osVersion?: unknown
  deviceModel?: unknown
  events?: unknown
}

type NormalizedEvent = {
  clientEventId: string
  eventType: string
  eventName: string
  severity: string
  properties: string
  clientCreatedAt: number
}

function validAnonymousId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value)
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedPropertyValue(key: string, value: unknown): string | number | boolean | null {
  if (typeof value === 'string') {
    // MetricKit JSON 需要保留原始结构；其他属性保持很短，避免把内容误当遥测上传。
    const max = key === 'json' || key === 'diagnosticJSON' ? MAX_PROPERTIES_BYTES : 500
    return value.slice(0, max)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  return null
}

function normalizeProperties(value: unknown): string | null {
  if (value === undefined || value === null) return '{}'
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const output: Record<string, string | number | boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) continue
    const cleaned = boundedPropertyValue(key, raw)
    if (cleaned !== null) output[key] = cleaned
  }
  const json = JSON.stringify(output)
  return byteLength(json) <= MAX_PROPERTIES_BYTES ? json : JSON.stringify({})
}

function normalizeEvent(value: unknown): NormalizedEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as TelemetryEventInput
  const clientEventId = boundedText(item.eventId ?? item.id, 80)
  const eventType = boundedText(item.type, 20)
  const eventName = boundedText(item.name, 64)
  const severity = boundedText(item.severity, 20) || 'info'
  if (!validAnonymousId(clientEventId)) return null
  if (!EVENT_TYPES.has(eventType) || !SEVERITIES.has(severity)) return null
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(eventName)) return null
  const properties = normalizeProperties(item.properties)
  if (properties === null) return null

  const rawCreatedAt = typeof item.createdAt === 'number' ? item.createdAt : Number(item.createdAt)
  const clientCreatedAt = Number.isFinite(rawCreatedAt) ? Math.min(Math.max(rawCreatedAt, 0), Date.now() + DAY_MS) : 0
  return { clientEventId, eventType, eventName, severity, properties, clientCreatedAt }
}

function contentLengthTooLarge(c: Context): boolean {
  const raw = Number(c.req.header('content-length') || 0)
  return Number.isFinite(raw) && raw > MAX_BODY_BYTES
}

/**
 * iOS/移动端匿名遥测写入口。
 * 客户端只有在用户主动开启“帮助改进知舟”后才会调用；服务端仍做二次大小和字段限制。
 */
export const mobileTelemetryRoutes = new Hono()

mobileTelemetryRoutes.post('/', async (c) => {
  if (contentLengthTooLarge(c)) return c.json({ error: '遥测批次过大' }, 413)

  const raw = await c.req.text()
  if (byteLength(raw) > MAX_BODY_BYTES) return c.json({ error: '遥测批次过大' }, 413)

  let body: TelemetryBatchInput
  try {
    body = JSON.parse(raw) as TelemetryBatchInput
  } catch {
    return c.json({ error: '遥测请求格式不正确' }, 400)
  }

  if (!validAnonymousId(body.installId) || !validAnonymousId(body.sessionId)) {
    return c.json({ error: '遥测标识不正确' }, 400)
  }
  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > MAX_EVENTS_PER_BATCH) {
    return c.json({ error: '遥测事件数量不正确' }, 400)
  }

  const events = body.events.map(normalizeEvent)
  if (events.some((event) => !event)) return c.json({ error: '遥测事件字段不正确' }, 400)
  const normalizedEvents = events as NormalizedEvent[]
  const config = loadConfig()
  const db = getDb()
  const installHash = await hashToken(body.installId, config.sessionHashSalt)
  const sessionHash = await hashToken(body.sessionId, config.sessionHashSalt)
  const recent = await first<{ count: number }>(
    db,
    'SELECT COUNT(*)::int AS count FROM mobile_telemetry WHERE install_hash = $1 AND received_at >= $2',
    [installHash, Date.now() - 60000],
  )
  if ((Number(recent?.count) || 0) >= MAX_EVENTS_PER_MINUTE) return c.json({ error: '遥测请求过于频繁' }, 429)

  const appVersion = boundedText(body.appVersion, 40)
  const buildVersion = boundedText(body.buildVersion, 40)
  const osVersion = boundedText(body.osVersion, 80)
  const deviceModel = boundedText(body.deviceModel, 80)
  const receivedAt = Date.now()
  let accepted = 0

  await withTx(db, async (query) => {
    for (const event of normalizedEvents) {
      accepted += await query(
        `INSERT INTO mobile_telemetry
          (id, install_hash, session_hash, client_event_id, event_type, event_name, severity,
           app_version, build_version, os_version, device_model, properties, client_created_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (install_hash, client_event_id) DO NOTHING`,
        [
          newId('telemetry'), installHash, sessionHash, event.clientEventId, event.eventType, event.eventName,
          event.severity, appVersion, buildVersion, osVersion, deviceModel, event.properties,
          event.clientCreatedAt, receivedAt,
        ],
      ).then((result) => result.rowCount ?? 0)
    }
  })

  return c.json({ accepted }, 202, { 'Cache-Control': 'no-store' })
})

export const adminMobileTelemetryRoutes = new Hono<AuthEnv>()
adminMobileTelemetryRoutes.use('*', requireAdmin())

adminMobileTelemetryRoutes.get('/', async (c) => {
  const db = getDb()
  const status = c.req.query('status') || 'all'
  const type = c.req.query('type') || 'all'
  const severity = c.req.query('severity') || 'all'
  const search = boundedText(c.req.query('search'), 80)
  const limit = clampInt(c.req.query('limit'), 10, 100, 50)
  const offset = clampInt(c.req.query('offset'), 0, 1000000, 0)
  const conditions: string[] = []
  const params: unknown[] = []

  if (STATUSES.has(status)) {
    params.push(status)
    conditions.push(`m.status = $${params.length}`)
  }
  if (EVENT_TYPES.has(type)) {
    params.push(type)
    conditions.push(`m.event_type = $${params.length}`)
  }
  if (SEVERITIES.has(severity)) {
    params.push(severity)
    conditions.push(`m.severity = $${params.length}`)
  }
  if (search) {
    params.push(`%${escapeLike(search)}%`)
    conditions.push(`(m.event_name ILIKE $${params.length} OR m.device_model ILIKE $${params.length} OR m.os_version ILIKE $${params.length})`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT m.id, m.event_type, m.event_name, m.severity, m.app_version, m.build_version,
            m.os_version, m.device_model, m.properties, m.client_created_at, m.received_at,
            m.status, m.admin_note
       FROM mobile_telemetry m
       ${where}
       ORDER BY m.received_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  const total = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM mobile_telemetry m ${where}`, params)

  const cutoff = Date.now() - 30 * DAY_MS
  const [summary, topEvents, trend] = await Promise.all([
    first<{ events: number; errors: number; diagnostics: number; installs: number; open: number }>(
      db,
      `SELECT COUNT(*)::int AS events,
              COUNT(*) FILTER (WHERE event_type = 'error')::int AS errors,
              COUNT(*) FILTER (WHERE event_type IN ('diagnostic', 'metric'))::int AS diagnostics,
              COUNT(DISTINCT install_hash)::int AS installs,
              COUNT(*) FILTER (WHERE status = 'open')::int AS open
         FROM mobile_telemetry WHERE received_at >= $1`,
      [cutoff],
    ),
    all<{ event_name: string; count: number }>(
      db,
      `SELECT event_name, COUNT(*)::int AS count
         FROM mobile_telemetry WHERE received_at >= $1
         GROUP BY event_name ORDER BY count DESC, event_name ASC LIMIT 8`,
      [cutoff],
    ),
    all<{ date: string; events: number; errors: number }>(
      db,
      `SELECT to_char(to_timestamp(received_at / 1000.0), 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS events,
              COUNT(*) FILTER (WHERE event_type = 'error')::int AS errors
         FROM mobile_telemetry WHERE received_at >= $1
         GROUP BY date ORDER BY date ASC`,
      [cutoff],
    ),
  ])

  return c.json({
    events: rows.map((row) => ({
      id: String(row.id),
      type: String(row.event_type || ''),
      name: String(row.event_name || ''),
      severity: String(row.severity || 'info'),
      appVersion: String(row.app_version || ''),
      buildVersion: String(row.build_version || ''),
      osVersion: String(row.os_version || ''),
      deviceModel: String(row.device_model || ''),
      properties: String(row.properties || '{}'),
      clientCreatedAt: Number(row.client_created_at) || 0,
      receivedAt: Number(row.received_at) || 0,
      status: String(row.status || 'open'),
      adminNote: String(row.admin_note || ''),
    })),
    total: Number(total?.total) || 0,
    limit,
    offset,
    summary: {
      events: Number(summary?.events) || 0,
      errors: Number(summary?.errors) || 0,
      diagnostics: Number(summary?.diagnostics) || 0,
      installs: Number(summary?.installs) || 0,
      open: Number(summary?.open) || 0,
      topEvents: topEvents.map((row) => ({ name: row.event_name, count: Number(row.count) || 0 })),
      trend: trend.map((row) => ({ date: row.date, events: Number(row.events) || 0, errors: Number(row.errors) || 0 })),
    },
  }, 200, { 'Cache-Control': 'no-store' })
})

adminMobileTelemetryRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = boundedText(body.id, 120)
  const status = boundedText(body.status, 20)
  if (!id || !STATUSES.has(status)) return c.json({ error: 'id 或 status 不正确' }, 400)

  const changed = await run(
    getDb(),
    'UPDATE mobile_telemetry SET status = $1, admin_note = $2 WHERE id = $3',
    [status, cleanText(body.adminNote, 500), id],
  )
  if (!changed) return c.json({ error: '遥测记录不存在' }, 404)
  return c.json({ ok: true, status })
})

/** 启动时按固定保留期清理，避免诊断数据无限增长。 */
export async function pruneMobileTelemetry(): Promise<number> {
  return run(getDb(), 'DELETE FROM mobile_telemetry WHERE received_at < $1', [Date.now() - MOBILE_TELEMETRY_RETENTION_DAYS * DAY_MS])
}
