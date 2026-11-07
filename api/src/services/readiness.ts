import { Pool } from 'pg'
import { loadConfig } from '../config'
import { buildInfo, requiredMigrations, type BuildInfo } from './build-info'

export const READINESS_SQL = `SELECT
  (SELECT COALESCE(json_agg(json_build_object('version', version, 'name', name)), '[]'::json) FROM schema_migrations) AS migrations,
  COALESCE((SELECT value FROM backup_control.settings WHERE key='maintenance'), 'false') AS maintenance,
  (SELECT COUNT(*) FROM (SELECT id, visibility, content_rating FROM novels LIMIT 0) sample) AS catalog,
  (SELECT COUNT(*) FROM (SELECT ip_address, user_agent FROM ai_usage LIMIT 0) sample) AS usage_audit,
  (SELECT COUNT(*) FROM (SELECT connectivity, connectivity_checked_at, connectivity_error FROM scrape_sources LIMIT 0) sample) AS source_connectivity`

export interface DatabaseState { migrations: Array<{ version: number; name: string }>; maintenance: string }
interface ReadinessState { ready: boolean; version: string; release: string; reason?: string }
let pool: Pool | undefined
let poolUrl = ''

async function queryDatabase(): Promise<DatabaseState | undefined> {
  const databaseUrl = loadConfig().databaseUrl
  if (!pool || poolUrl !== databaseUrl) {
    void pool?.end().catch(() => {})
    poolUrl = databaseUrl
    // 探针不占用业务连接池，数据库排队、执行和网络等待均有上限。
    pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 800, statement_timeout: 800, query_timeout: 1200, idleTimeoutMillis: 5000, allowExitOnIdle: true })
    pool.on('error', () => {})
  }
  return (await pool.query<DatabaseState>(READINESS_SQL)).rows[0]
}

export function createReadinessProbe(options: {
  configured?: () => boolean
  query?: () => Promise<DatabaseState | undefined>
  info?: BuildInfo
  timeoutMs?: number
  cacheMs?: number
} = {}) {
  const info = options.info || buildInfo
  const configured = options.configured || (() => loadConfig().configured)
  const query = options.query || queryDatabase
  let pending: Promise<ReadinessState> | undefined
  let cached: { until: number; state: ReadinessState } | undefined
  const response = (ready: boolean, reason?: string): ReadinessState => ({ ready, version: info.apiVersion, release: info.releaseSha, ...(reason ? { reason } : {}) })

  async function inspect(): Promise<ReadinessState> {
    const [state, expected] = await Promise.all([query(), requiredMigrations(info)])
    if (!state) return response(false, 'database_unavailable')
    const actual = new Map(state.migrations.map(row => [Number(row.version), row.name]))
    // 早期两份 006 冲突；007 补齐审计字段，010 重编号并补齐连通性字段。
    // 仅接受这条已修复的历史记录，保留真实记账名称；其他改名仍拒绝。
    const repairedLegacySix = actual.get(6) === '006_scrape_source_connectivity.sql'
      && actual.get(7) === '007_repair_ai_usage_request_audit.sql'
      && actual.get(10) === '010_scrape_source_connectivity.sql'
    const missing = expected.some(row => actual.get(row.version) !== row.name
      && !(repairedLegacySix && row.version === 6 && row.name === '006_ai_usage_request_audit.sql'))
    if (!expected.length || missing) return response(false, 'schema_pending')
    if (JSON.parse(state.maintenance)) return response(false, 'maintenance')
    return response(true)
  }

  return async (): Promise<ReadinessState> => {
    if (info.nodeVersion && process.versions.node !== info.nodeVersion) return response(false, 'runtime_mismatch')
    if (!configured()) return response(false, 'not_configured')
    if (pending) return pending
    if (cached && cached.until > Date.now()) return cached.state
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ReadinessState>(resolve => { timer = setTimeout(() => resolve(response(false, 'database_timeout')), options.timeoutMs ?? 2000) })
    pending = Promise.race([inspect().catch(() => response(false, 'database_unavailable')), timeout])
      .then(state => { cached = { until: Date.now() + (options.cacheMs ?? 1000), state }; return state })
      .finally(() => { clearTimeout(timer); pending = undefined })
    return pending
  }
}

export const checkReadiness = createReadinessProbe()
