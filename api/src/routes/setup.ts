/**
 * /api/setup/* —— 首次安装向导（数据库配置 + 可选项）。
 *
 * 信任模型与门禁（与既有 bootstrap「首个访问者创建管理员」一致）：
 * - database：仅当 DATABASE_URL 尚未配置（needsSetup 窗口），否则 409。
 * - options：仅当尚无管理员（needsBootstrap 窗口），否则 403。
 * 管理员创建后所有 setup 端点关闭。密钥值不回显。
 */
import { Hono } from 'hono'
import { Pool } from 'pg'
import { loadConfig } from '../config'
import { getDb, resetPool } from '../db/pool'
import { migrate } from '../db/migrate'
import { first } from '../db/query'
import {
  applyRuntimeConfigToEnv,
  configuredRuntimeKeys,
  readRuntimeConfig,
  writeRuntimeConfig,
  type RuntimeConfigKey,
} from '../runtime-config'

export const setupRoutes = new Hono()

async function adminExists(): Promise<boolean> {
  return Boolean(await first(getDb(), "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"))
}

type AdminProbe = 'yes' | 'no' | 'error'

/** 三态探测：区分「确认无管理员」与「查询失败」，门禁必须 fail-closed。 */
async function probeAdmin(): Promise<AdminProbe> {
  try {
    return (await adminExists()) ? 'yes' : 'no'
  } catch {
    return 'error'
  }
}

setupRoutes.get('/status', async (c) => {
  const configured = loadConfig().configured
  if (!configured) {
    return c.json({ needsSetup: true, needsBootstrap: true, optionalKeys: configuredRuntimeKeys() })
  }
  // 查询失败按仍需引导报告（前端仅用于路由），写操作门禁另行 fail-closed
  return c.json({
    needsSetup: false,
    needsBootstrap: (await probeAdmin()) !== 'yes',
    optionalKeys: configuredRuntimeKeys(),
  })
})

interface DatabaseBody {
  host?: unknown
  port?: unknown
  user?: unknown
  password?: unknown
  database?: unknown
  ssl?: unknown
}

/** 分字段组装连接串；各值 percent-encode，避免特殊字符破坏 URL。导出供单测。 */
export function buildDatabaseUrl(body: DatabaseBody): { url: string } | { error: string } {
  const host = String(body.host ?? '').trim()
  const portRaw = String(body.port ?? '5432').trim() || '5432'
  const user = String(body.user ?? '').trim()
  const password = String(body.password ?? '')
  const database = String(body.database ?? '').trim()
  const ssl = Boolean(body.ssl)

  if (!host) return { error: '主机不能为空' }
  if (/[\s/@#?]/.test(host)) return { error: '主机格式不正确' }
  const port = Number.parseInt(portRaw, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: '端口需为 1-65535' }
  if (!user) return { error: '用户名不能为空' }
  if (!database) return { error: '数据库名不能为空' }
  if (/[\s/@#?]/.test(database)) return { error: '数据库名格式不正确' }

  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user)
  // IPv6 字面量需要方括号
  const hostPart = host.includes(':') ? `[${host}]` : host
  const url = `postgres://${auth}@${hostPart}:${port}/${encodeURIComponent(database)}${ssl ? '?sslmode=require' : ''}`
  return { url }
}

/** 试连错误脱敏：只回传可行动的分类信息，不透传驱动原文（可能含地址细节）。 */
function sanitizeConnectError(err: unknown): string {
  const msg = String((err as Error)?.message || err || '')
  const code = String((err as { code?: string })?.code || '')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '无法解析主机名'
  if (code === 'ECONNREFUSED') return '连接被拒绝：请检查主机与端口'
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) return '连接超时：请检查网络与防火墙'
  if (/password authentication failed/i.test(msg) || code === '28P01') return '用户名或密码错误'
  if (/database .* does not exist/i.test(msg) || code === '3D000') return '数据库不存在'
  if (/no pg_hba\.conf entry/i.test(msg) || code === '28000') return '服务器拒绝该来源/用户连接（pg_hba）'
  if (/ssl/i.test(msg)) return 'SSL 协商失败：请检查 SSL 选项'
  return '连接失败：请检查各项参数'
}

// 进程内互斥：并发提交会导致双写配置 + 并发迁移互撞，失败方回滚还会抹掉成功方的配置
let databaseSetupInFlight = false

setupRoutes.post('/database', async (c) => {
  // 门禁：已配置则关闭（无论配置来自 env 还是先前的向导写入）
  if (loadConfig().configured) return c.json({ error: '数据库已配置' }, 409)
  if (databaseSetupInFlight) return c.json({ error: '另一个配置请求正在处理中，请稍候' }, 409)

  const body = (await c.req.json().catch(() => ({}))) as DatabaseBody
  const built = buildDatabaseUrl(body)
  if ('error' in built) return c.json({ error: built.error }, 400)

  databaseSetupInFlight = true
  try {
    if (loadConfig().configured) return c.json({ error: '数据库已配置' }, 409)

    // 短超时试连（独立临时池，不污染生产单例）
    const probe = new Pool({ connectionString: built.url, max: 1, connectionTimeoutMillis: 5000 })
    try {
      const client = await probe.connect()
      try {
        await client.query('SELECT 1')
      } finally {
        client.release()
      }
    } catch (err) {
      return c.json({ error: sanitizeConnectError(err) }, 400)
    } finally {
      await probe.end().catch(() => {})
    }

    // 持久化 → 注入 env → 重建池 → 自动迁移（保持生产池开启）
    writeRuntimeConfig({ DATABASE_URL: built.url })
    applyRuntimeConfigToEnv()
    resetPool()
    try {
      const applied = await migrate({ keepPoolOpen: true })
      return c.json({ ok: true, applied })
    } catch (err) {
      // 迁移失败：回滚写入，避免卡在「已配置但库不完整」的半初始化状态
      writeRuntimeConfig({ DATABASE_URL: '' })
      delete process.env.DATABASE_URL
      resetPool()
      console.error('[setup] 迁移失败:', err)
      return c.json({ error: '数据库迁移失败：请确认该账号有建表权限' }, 400)
    }
  } finally {
    databaseSetupInFlight = false
  }
})

/** 可选项白名单：向导第二步可写的键（database 之外）。 */
const OPTION_KEYS: RuntimeConfigKey[] = [
  'AI_TEXT_BASE_URL',
  'AI_TEXT_API_KEY',
  'AI_TEXT_MODEL',
  'AI_IMAGE_BASE_URL',
  'AI_IMAGE_API_KEY',
  'AI_IMAGE_MODEL',
  'PROXY_BASE',
  'PROXY_DOMAINS',
  'CORS_ORIGINS',
]

setupRoutes.post('/options', async (c) => {
  // 门禁：数据库须已配置，且**确认**尚无管理员（查询失败必须 fail-closed，
  // 否则已安装实例在数据库瞬断期间会重新打开免鉴权写入窗口）
  if (!loadConfig().configured) return c.json({ error: '请先完成数据库配置' }, 409)
  const admin = await probeAdmin()
  if (admin === 'error') return c.json({ error: '数据库暂不可用，请稍后重试' }, 503)
  if (admin === 'yes') return c.json({ error: '安装已完成，请在后台修改配置' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Partial<Record<RuntimeConfigKey, string>> = {}
  for (const key of OPTION_KEYS) {
    if (key in body) patch[key] = String(body[key] ?? '').trim()
  }

  // env 同步：applyRuntimeConfigToEnv 仅填空，二次提交的修正值/删除不会生效。
  // 对「当前 env 值来自运行时层」（等于旧文件值）或为空的键，强制同步本次 patch；
  // 运维经真实环境变量显式设定的值仍然优先，不被覆盖。
  const before = readRuntimeConfig()
  writeRuntimeConfig(patch)
  for (const [key, value] of Object.entries(patch)) {
    const current = process.env[key]?.trim() || ''
    if (current && current !== (before as Record<string, string | undefined>)[key]) continue
    if (value) process.env[key] = value
    else delete process.env[key]
  }
  return c.json({ ok: true, optionalKeys: configuredRuntimeKeys() })
})
