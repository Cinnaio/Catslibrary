import { assertRestoreImpactBinding, restoreImpactReport, checkRestoreImpactFreshness } from '../services/backups/impact'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import type { BackupPolicy, BackupSettingsInput, BackupTargetInput, BackupDeploymentInput } from '@shared/backups'
import { configureDeployment, deploymentView } from '../services/backups/deployment'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { verifyPassword } from '../services/auth'
import { BackupError, BACKUP_LOCK, encryptionReady, backupRoot, keyId, allowedHosts } from '../services/backups/config'
import { enqueue, maintenance, policy, savePolicy, saveTarget, targetRows, targetView, taskView, versions, type TaskRow } from '../services/backups/store'
import {
  backupSettings,
  saveBackupSettings,
  createRehearsalDatabase,
  rehearsalInfo,
  checkRehearsalConnection,
  removeRehearsalConnection,
} from '../services/backups/settings'
import { archivePath, type Manifest } from '../services/backups/archive'
import { ensureLocalArchive } from '../services/backups/storage'
import { startAdminOperationAudit, finishAdminOperationAudit } from '../services/admin-operation-audit'
import { requestHash } from '../services/idempotency'
import { randomUUID, randomBytes } from 'node:crypto'

export const backupRoutes = new Hono<AuthEnv>()
backupRoutes.use('*', requireAdmin())
backupRoutes.use('*', bodyLimit({ maxSize: 65536, onError: (c) => c.json({ error: '请求内容过大' }, 413) }))
backupRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})
backupRoutes.onError((error, c) =>
  error instanceof BackupError
    ? c.json({ error: error.message, code: error.code }, error.status as 400)
    : c.json({ error: '备份操作失败，请检查部署配置', code: 'BACKUP_FAILED' }, 500),
)
async function bodyJSON<T = Record<string, unknown>>(c: Context<AuthEnv>): Promise<T> {
  const value = await c.req.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupError('INVALID_CONFIG', '请提交有效的 JSON 对象')
  return value as T
}
let capabilitiesCache: { expires: number; value: { dump: boolean; restore: boolean; transfer: boolean } } | null = null
async function toolsReady() {
  if (!capabilitiesCache || capabilitiesCache.expires < Date.now()) {
    const { tools } = await deploymentView()
    capabilitiesCache = {
      expires: Date.now() + 30000,
      value: { dump: tools.dump.ready, restore: tools.restore.ready && tools.psql.ready, transfer: tools.transfer.ready },
    }
  }
  return capabilitiesCache.value
}
backupRoutes.get('/settings', async (c) => {
  const runtime = await deploymentView()
  return c.json({
    settings: await backupSettings(getDb()),
    deployment: {
      localDirectory: backupRoot(),
      environmentAllowedHosts: allowedHosts(),
      keyId: runtime.keyId,
      encryption: runtime.keyConfigured,
      dump: runtime.tools.dump.ready,
      restore: runtime.tools.restore.ready && runtime.tools.psql.ready,
      transfer: runtime.tools.transfer.ready,
      runtime,
    },
  })
})
backupRoutes.post('/deployment/key', async (c) => {
  if (await maintenance(getDb())) throw new BackupError('MAINTENANCE', '恢复中不能生成主密钥', 409)
  if (encryptionReady()) throw new BackupError('KEY_ROTATION_REQUIRED', '已有主密钥，请保留当前密钥', 409)
  return c.json({ masterKey: randomBytes(32).toString('base64'), keyId: keyId() })
})
backupRoutes.post('/deployment/detect', async (c) => {
  const body = await bodyJSON<BackupDeploymentInput>(c)
  return c.json(await configureDeployment(getDb(), body, true))
})
backupRoutes.put('/deployment', async (c) => {
  const body = await bodyJSON<BackupDeploymentInput>(c)
  const result = await configureDeployment(getDb(), body)
  capabilitiesCache = null
  // The local file is already durable; an audit outage must not report it as unsaved.
  await audit(c.get('user').id, 'deployment-save').catch(() => console.error('[backups] 本地配置已保存，操作审计写入失败'))
  return c.json(result)
})
backupRoutes.put('/settings', async (c) => {
  const settings = await saveBackupSettings(getDb(), await bodyJSON<BackupSettingsInput>(c))
  await audit(c.get('user').id, 'settings-save')
  return c.json(settings)
})
backupRoutes.post('/settings/rehearsal', async (c) => {
  const body = await bodyJSON<{ revision: number }>(c)
  const settings = await createRehearsalDatabase(getDb(), body.revision)
  await audit(c.get('user').id, 'rehearsal-create').catch(() => console.error('[backups] 演练库已创建，操作审计写入失败'))
  return c.json({ settings })
})
backupRoutes.get('/settings/rehearsal', async (c) => c.json(await rehearsalInfo(getDb())))
backupRoutes.post('/settings/rehearsal/check', async (c) => {
  const body = await bodyJSON<{ revision: number }>(c)
  return c.json(await checkRehearsalConnection(getDb(), body.revision))
})
backupRoutes.delete('/settings/rehearsal', async (c) => {
  const body = await bodyJSON<{ revision: number }>(c)
  const settings = await removeRehearsalConnection(getDb(), body.revision)
  await audit(c.get('user').id, 'rehearsal-disconnect').catch(() => console.error('[backups] 演练连接已移除，操作审计写入失败'))
  return c.json({ settings })
})
backupRoutes.get('/overview', async (c) => {
  const db = getDb(),
    runtime = await backupSettings(db),
    tools = await toolsReady()
  const tasks = await all<TaskRow>(db, 'SELECT * FROM backup_control.tasks ORDER BY created_at DESC,id DESC LIMIT 15')
  return c.json({
    policy: await policy(db),
    targets: (await targetRows(db)).map(targetView),
    capabilities: {
      ...tools,
      encryption: encryptionReady(),
      rehearsal: runtime.rehearsalConfigured,
      allowedHosts: runtime.allowedHosts,
    },
    maintenance: await maintenance(db),
    tasks: tasks.map((row) => {
      const task = taskView(row)
      if (row.actor_id !== c.get('user').id && task.result) delete task.result.previewToken
      return task
    }),
  })
})
async function audit(actorId: string, action: string) {
  const db = getDb(),
    operationId = randomUUID()
  const id = await startAdminOperationAudit(db, {
    operationId,
    scope: `backup.${action}`,
    actorUserId: actorId,
    action: `backup-${action}`,
    requestHash: requestHash({ action }),
  })
  await finishAdminOperationAudit(db, id, { status: 'completed', responseStatus: 200 })
}
backupRoutes.post('/targets', async (c) => {
  if (await maintenance(getDb())) throw new BackupError('MAINTENANCE', '恢复中不能修改目标', 409)
  const body = await bodyJSON<BackupTargetInput>(c)
  if (body.type !== 'sftp') throw new BackupError('UNSUPPORTED_TARGET', '首版优先支持 SFTP 服务器')
  const target = await saveTarget(getDb(), body)
  await audit(c.get('user').id, 'target-save')
  return c.json(target)
})
backupRoutes.delete('/targets/:id', async (c) => {
  const db = getDb()
  if (await maintenance(db)) throw new BackupError('MAINTENANCE', '恢复中不能修改目标', 409)
  await withTx(db, async (query) => {
    await query('SELECT pg_advisory_xact_lock(730049)')
    const config = await policy({ query })
    if (config.targetIds.includes(c.req.param('id'))) throw new BackupError('TARGET_IN_USE', '请先从自动备份计划中移除目标')
    await query('UPDATE backup_control.targets SET archived=TRUE WHERE id=$1', [c.req.param('id')])
  })
  await audit(c.get('user').id, 'target-archive')
  return c.json({ ok: true })
})
backupRoutes.put('/policy', async (c) => {
  const db = getDb()
  if (await maintenance(db)) throw new BackupError('MAINTENANCE', '恢复中不能修改计划', 409)
  const body = await bodyJSON<BackupPolicy>(c)
  if (body.enabled && !encryptionReady()) throw new BackupError('KEY_UNAVAILABLE', '请先配置备份主密钥')
  const config = await savePolicy(db, body)
  await audit(c.get('user').id, 'policy-save')
  return c.json(config)
})
function pagination(c: { req: { query: (key: string) => string | undefined } }) {
  return {
    limit: Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') || '') || 20)),
    offset: Math.min(2147483647, Math.max(0, Number.parseInt(c.req.query('offset') || '') || 0)),
  }
}
backupRoutes.get('/versions', async (c) => {
  const { limit, offset } = pagination(c)
  return c.json(await versions(getDb(), limit, offset))
})
backupRoutes.patch('/versions/:id', async (c) => {
  const db = getDb()
  if (await maintenance(db)) throw new BackupError('MAINTENANCE', '恢复中不能修改版本', 409)
  const body = await bodyJSON<{ note?: string; pinned?: boolean }>(c)
  if ((body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 300)) || (body.pinned !== undefined && typeof body.pinned !== 'boolean'))
    throw new BackupError('INVALID_CONFIG', '备注或保留标记无效')
  await withTx(db, async (query) => {
    const lock = await query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [BACKUP_LOCK])
    if (!lock.rows[0]?.locked) throw new BackupError('BACKUP_BUSY', '任务正在执行，请稍后修改保留标记', 409)
    const row = await first<{ protection: boolean }>({ query }, 'SELECT protection FROM backup_control.versions WHERE id=$1 AND deleted=FALSE FOR UPDATE', [
      c.req.param('id'),
    ])
    if (!row) throw new BackupError('NOT_FOUND', '版本不存在', 404)
    if (row.protection && body.pinned === false) throw new BackupError('VERSION_PROTECTED', '保护版本保持固定保留')
    await query('UPDATE backup_control.versions SET note=COALESCE($2,note),pinned=COALESCE($3,pinned) WHERE id=$1', [
      c.req.param('id'),
      body.note ?? null,
      body.pinned ?? null,
    ])
  })
  await audit(c.get('user').id, 'version-update')
  return c.json({ ok: true })
})
async function queue(c: Context<AuthEnv>, kind: Parameters<typeof enqueue>[1], body: Record<string, unknown>) {
  if (!encryptionReady()) throw new BackupError('KEY_UNAVAILABLE', '请先在备份设置中配置主密钥')
  const user = c.get('user'),
    task = await enqueue(getDb(), kind, body, { id: user.id, name: user.username })
  await audit(user.id, kind)
  return c.json(task, 202)
}
backupRoutes.post('/versions', async (c) => queue(c, 'backup', await bodyJSON(c)))
backupRoutes.post('/targets/:id/test', async (c) => queue(c, 'test', { ...(await bodyJSON(c)), targetId: c.req.param('id') }))
backupRoutes.post('/versions/:id/retry', async (c) => queue(c, 'retry', { ...(await bodyJSON(c)), versionId: c.req.param('id') }))
backupRoutes.post('/versions/:id/restore-preview', async (c) => queue(c, 'preview', { ...(await bodyJSON(c)), versionId: c.req.param('id') }))
backupRoutes.delete('/versions/:id', async (c) => queue(c, 'delete', { ...(await bodyJSON(c)), versionId: c.req.param('id') }))
backupRoutes.post('/versions/:id/restore', async (c) => {
  const body = await bodyJSON(c)
  if (
    body.confirmVersion !== c.req.param('id') ||
    typeof body.password !== 'string' ||
    body.password.length > 512 ||
    !(await verifyPassword(body.password, c.get('user')))
  )
    throw new BackupError('REAUTH_FAILED', '版本确认或管理员密码不正确', 403)
  if (body.impactAcknowledged !== true) throw new BackupError('IMPACT_ACK_REQUIRED', '请先查看并确认回滚影响', 400)
  await assertRestoreImpactBinding(getDb(), String(body.previewTaskId || ''), c.get('user').id, c.req.param('id'))
  const { password: _password, ...safe } = body
  return queue(c, 'restore', { ...safe, versionId: c.req.param('id') })
})
backupRoutes.get('/tasks/:id', async (c) => {
  const task = await first<TaskRow>(getDb(), 'SELECT * FROM backup_control.tasks WHERE id=$1', [c.req.param('id')])
  if (!task) return c.notFound()
  const result = taskView(task)
  if (task.actor_id !== c.get('user').id && result.result) delete result.result.previewToken
  return c.json(result)
})
backupRoutes.get('/tasks/:id/impact', async (c) => {
  const { limit, offset } = pagination(c)
  return c.json(await restoreImpactReport(getDb(), c.req.param('id'), c.req.query('group') || '', c.req.query('change') || '', limit, offset))
})
backupRoutes.post('/tasks/:id/impact/check', async (c) => {
  const body = await bodyJSON<{ versionId: string }>(c)
  return c.json(await checkRestoreImpactFreshness(getDb(), c.req.param('id'), c.get('user').id, String(body.versionId || '')))
})
backupRoutes.get('/logs', async (c) => {
  const { limit, offset } = pagination(c),
    db = getDb(),
    taskId = c.req.query('taskId') || '',
    level = c.req.query('level') || ''
  const where = "WHERE ($1='' OR task_id=$1) AND ($2='' OR level=$2)"
  const items = await all<{ id: number; taskId: string; level: string; message: string; createdAt: number }>(
    db,
    `SELECT id,task_id AS "taskId",level,message,created_at AS "createdAt" FROM backup_control.events ${where} ORDER BY id DESC LIMIT $3 OFFSET $4`,
    [taskId, level, limit, offset],
  )
  const total = await first<{ total: number }>(db, `SELECT count(*)::int AS total FROM backup_control.events ${where}`, [taskId, level])
  return c.json({ items, total: total?.total || 0 })
})
backupRoutes.get('/versions/:id/download', async (c) => {
  const db = getDb(),
    id = c.req.param('id')
  if (await maintenance(db)) throw new BackupError('MAINTENANCE', '恢复中暂停归档下载', 409)
  const client = await db.connect()
  let held = false,
    streaming = false
  try {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [BACKUP_LOCK])
    held = Boolean(lock.rows[0]?.locked)
    if (!held) throw new BackupError('BACKUP_BUSY', '备份任务正在执行，请稍后下载', 409)
    const row = await first<{ manifest: string }>(db, 'SELECT manifest FROM backup_control.versions WHERE id=$1 AND deleted=FALSE', [id])
    if (!row?.manifest) throw new BackupError('ARCHIVE_UNAVAILABLE', '版本没有完整归档')
    const manifest: Manifest = JSON.parse(row.manifest)
    await ensureLocalArchive(db, id, manifest)
    c.header('Content-Type', 'application/octet-stream')
    c.header('Content-Disposition', `attachment; filename="${id}.zzbackup"`)
    c.header('Content-Length', String(manifest.size))
    const data = Readable.from(
      (async function* () {
        try {
          for await (const chunk of createReadStream(archivePath(id))) yield chunk
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => {})
          client.release()
        }
      })(),
    )
    streaming = true
    return c.body(Readable.toWeb(data) as ReadableStream)
  } finally {
    if (!streaming) {
      if (held) await client.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => {})
      client.release()
    }
  }
})
backupRoutes.get('/versions/:id/manifest', async (c) => {
  const row = await first<{ manifest: string }>(getDb(), 'SELECT manifest FROM backup_control.versions WHERE id=$1 AND deleted=FALSE', [c.req.param('id')])
  if (!row?.manifest) return c.notFound()
  return c.json(JSON.parse(row.manifest))
})
