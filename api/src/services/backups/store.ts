import { randomUUID } from 'node:crypto'
import type { BackupKind, BackupPolicy, BackupTarget, BackupTargetInput, BackupTask, BackupVersion } from '@shared/backups'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { requestHash } from '../idempotency'
import { BackupError, defaultPolicy, seal, validatePolicy, validateTarget, nextRun } from './config'

export interface TargetRow {
  id: string
  config: string
  secret: string
  revision: number
}
export interface TaskRow {
  id: string
  kind: BackupKind
  version_id: string
  state: BackupTask['state']
  stage: string
  actor: string
  actor_id: string
  payload: string
  created_at: number
  finished_at: number
  error: string
  result: string | null
}
export const taskView = (row: TaskRow): BackupTask => ({
  id: row.id,
  kind: row.kind,
  versionId: row.version_id,
  state: row.state,
  stage: row.stage,
  actor: row.actor,
  createdAt: Number(row.created_at),
  finishedAt: Number(row.finished_at),
  error: row.error,
  result: row.result ? JSON.parse(row.result) : null,
})
export async function getSetting<T>(db: DbClient, key: string, fallback: T): Promise<T> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM backup_control.settings WHERE key=$1', [key])
  return row ? (JSON.parse(row.value) as T) : fallback
}
export async function setSetting(db: DbClient, key: string, value: unknown) {
  await db.query(
    'INSERT INTO backup_control.settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at',
    [key, JSON.stringify(value), Date.now()],
  )
}
export const policy = (db: DbClient) => getSetting(db, 'policy', defaultPolicy)
export const maintenance = (db: DbClient) => getSetting(db, 'maintenance', false)
export async function siteId(db: Db) {
  return withTx(db, async (query) => {
    await query('SELECT pg_advisory_xact_lock(730049)')
    const client = { query },
      existing = await getSetting(client, 'siteId', '')
    if (existing) return existing
    const id = randomUUID()
    await setSetting(client, 'siteId', id)
    return id
  })
}
export function targetView(row: TargetRow): BackupTarget {
  return { ...JSON.parse(row.config), id: row.id, revision: row.revision, credentialSet: Boolean(row.secret) }
}
export async function targetRows(db: DbClient) {
  return all<TargetRow>(db, 'SELECT * FROM backup_control.targets WHERE archived=FALSE ORDER BY id')
}
export async function saveTarget(db: Db, input: BackupTargetInput) {
  const config = validateTarget(input)
  for (const secret of [input.password, input.privateKey])
    if (secret !== undefined && (typeof secret !== 'string' || secret.length > 32768)) throw new BackupError('INVALID_CONFIG', '认证材料无效或过长')
  if (input.password && input.privateKey) throw new BackupError('INVALID_CONFIG', '密码和私钥请选择一种认证方式')
  if (input.password && /[\r\n\0]/.test(input.password)) throw new BackupError('INVALID_CONFIG', '密码不能包含换行或空字符')
  if (input.privateKey && config.type !== 'sftp') throw new BackupError('INVALID_CONFIG', '只有 SFTP 支持私钥认证')
  return withTx(db, async (query) => {
    await query('SELECT pg_advisory_xact_lock(730049)')
    const previous = input.id ? await first<TargetRow>({ query }, 'SELECT * FROM backup_control.targets WHERE id=$1 AND archived=FALSE', [input.id]) : null
    if (input.id && !previous) throw new BackupError('NOT_FOUND', '存储目标不存在', 404)
    if (previous && previous.revision !== input.revision) throw new BackupError('REVISION_CONFLICT', '目标已被更新，请重新加载', 409)
    let secret = previous?.secret || ''
    if (input.clearCredential) secret = ''
    if (input.password || input.privateKey) secret = seal({ password: input.password || '', privateKey: input.privateKey || '' })
    if (config.enabled && !secret) throw new BackupError('INVALID_CONFIG', '启用目标前请设置认证材料')
    const id = previous?.id || randomUUID(),
      revision = (previous?.revision || 0) + 1
    await query(
      'INSERT INTO backup_control.targets(id,config,secret,revision) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,secret=EXCLUDED.secret,revision=EXCLUDED.revision',
      [id, JSON.stringify(config), secret, revision],
    )
    return targetView({ id, config: JSON.stringify(config), secret, revision })
  })
}
export async function savePolicy(db: Db, input: BackupPolicy) {
  const next = validatePolicy(input)
  return withTx(db, async (query) => {
    await query('SELECT pg_advisory_xact_lock(730049)')
    const current = await policy({ query })
    if (next.revision !== current.revision) throw new BackupError('REVISION_CONFLICT', '计划已被更新，请重新加载', 409)
    const rows = await targetRows({ query })
    if (next.targetIds.some((id) => !rows.some((row) => row.id === id && targetView(row).enabled)))
      throw new BackupError('INVALID_CONFIG', '计划包含不存在或停用的目标')
    next.revision++
    next.nextRunAt = nextRun(next, Date.now())
    await setSetting({ query }, 'policy', next)
    return next
  })
}
export async function logEvent(db: DbClient, taskId: string, message: string, level = 'info') {
  await db.query('INSERT INTO backup_control.events(task_id,level,message,created_at) VALUES($1,$2,$3,$4)', [taskId, level, message.slice(0, 1000), Date.now()])
  await db.query('UPDATE backup_control.tasks SET stage=$2,heartbeat_at=$3 WHERE id=$1', [taskId, message.slice(0, 200), Date.now()])
}
export async function enqueue(
  db: Db,
  kind: BackupKind,
  body: Record<string, unknown>,
  actor: { id: string; name: string },
  scheduled?: { revision: number; at: number },
) {
  if (body.targetIds !== undefined && (!Array.isArray(body.targetIds) || body.targetIds.length > 20 || body.targetIds.some((id) => typeof id !== 'string')))
    throw new BackupError('INVALID_CONFIG', '目标集合无效')
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 300)) throw new BackupError('INVALID_CONFIG', '版本备注最多 300 字')
  const operationId = String(body.operationId || '')
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(operationId)) throw new BackupError('INVALID_OPERATION', '请提供有效的 operationId')
  const hash = requestHash({ kind, body, actorId: actor.id })
  return withTx(db, async (query) => {
    await query('SELECT pg_advisory_xact_lock(730049)')
    const client = { query },
      existing = await first<TaskRow & { request_hash: string }>(client, 'SELECT * FROM backup_control.tasks WHERE operation_id=$1', [operationId])
    if (existing) {
      if (existing.request_hash !== hash) throw new BackupError('IDEMPOTENCY_CONFLICT', '同一操作 ID 携带不同参数', 409)
      return taskView(existing)
    }
    if (await maintenance(client)) throw new BackupError('MAINTENANCE', '正在恢复，请稍后操作', 409)
    const id = randomUUID(),
      now = Date.now()
    let versionId = String(body.versionId || ''),
      payload: Record<string, unknown> =
        kind === 'restore'
          ? { previewTaskId: String(body.previewTaskId || ''), previewToken: String(body.previewToken || '') }
          : kind === 'retry'
            ? { targetIds: body.targetIds }
            : {}
    if (kind === 'backup') {
      const config = await policy(client),
        ids = body.targetIds === undefined ? config.targetIds : body.targetIds
      if (!Array.isArray(ids) || ids.length > 20 || ids.some((v) => typeof v !== 'string')) throw new BackupError('INVALID_CONFIG', '存储目标无效')
      const targets = await targetRows(client),
        selected = [...new Set(ids)].map((targetId) => targets.find((row) => row.id === targetId))
      if (selected.some((row) => !row || !targetView(row).enabled)) throw new BackupError('INVALID_CONFIG', '目标不存在或已停用')
      versionId = `${new Date(now)
        .toISOString()
        .replace(/[-:.]/g, '')
        .replace(/\d{3}Z$/, 'Z')}_${randomUUID()}`
      await query('INSERT INTO backup_control.versions(id,created_at,note,trigger) VALUES($1,$2,$3,$4)', [
        versionId,
        now,
        String(body.note || '').slice(0, 300),
        scheduled ? 'scheduled' : 'manual',
      ])
      await query("INSERT INTO backup_control.copies(version_id,target_id,target_config) VALUES($1,'local',$2)", [versionId, JSON.stringify({ name: '本地' })])
      for (const row of selected as TargetRow[])
        await query('INSERT INTO backup_control.copies(version_id,target_id,target_config) VALUES($1,$2,$3)', [versionId, row.id, JSON.stringify(row)])
      payload = { targetIds: ids }
    } else if (kind !== 'test') {
      const version = await first(client, 'SELECT id FROM backup_control.versions WHERE id=$1 AND deleted=FALSE', [versionId])
      if (!version) throw new BackupError('NOT_FOUND', '备份版本不存在', 404)
    } else {
      const target = await first<TargetRow>(client, 'SELECT * FROM backup_control.targets WHERE id=$1 AND archived=FALSE', [body.targetId])
      if (!target) throw new BackupError('NOT_FOUND', '存储目标不存在', 404)
      payload = { target }
    }
    if (kind === 'delete') {
      const current = await first<{ pinned: boolean; protection: boolean }>(client, 'SELECT pinned,protection FROM backup_control.versions WHERE id=$1', [
        versionId,
      ])
      if (current?.pinned || current?.protection) throw new BackupError('VERSION_PROTECTED', '该版本已固定保留或为保护备份')
    }
    await query(
      'INSERT INTO backup_control.tasks(id,kind,version_id,actor,actor_id,payload,operation_id,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, kind, versionId, actor.name, actor.id, JSON.stringify(payload), operationId, hash, now],
    )
    if (scheduled)
      await query('INSERT INTO backup_control.schedule_runs(revision,scheduled_at,task_id) VALUES($1,$2,$3)', [scheduled.revision, scheduled.at, id])
    await logEvent(client, id, kind === 'restore' ? '已确认恢复，等待维护预检' : '任务已进入队列')
    return taskView((await first<TaskRow>(client, 'SELECT * FROM backup_control.tasks WHERE id=$1', [id]))!)
  })
}
export async function versions(db: DbClient, limit = 20, offset = 0) {
  const rows = await all<{
    id: string
    created_at: number
    snapshot_at: number
    state: BackupVersion['state']
    size: number
    digest: string
    note: string
    pinned: boolean
    protection: boolean
    trigger: string
    migration_version: number
  }>(db, 'SELECT * FROM backup_control.versions WHERE deleted=FALSE ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2', [limit, offset])
  const items: BackupVersion[] = []
  for (const row of rows) {
    const copies = await all<{ target_id: string; target_config: string; state: string; verified_at: number; error: string }>(
      db,
      'SELECT * FROM backup_control.copies WHERE version_id=$1 ORDER BY target_id',
      [row.id],
    )
    items.push({
      id: row.id,
      createdAt: Number(row.created_at),
      snapshotAt: Number(row.snapshot_at),
      state: row.state,
      size: Number(row.size),
      digest: row.digest,
      note: row.note,
      pinned: row.pinned,
      protection: row.protection,
      trigger: row.trigger,
      migrationVersion: row.migration_version,
      copies: copies.map((copy) => ({
        targetId: copy.target_id,
        name: copy.target_id === 'local' ? '本地' : JSON.parse(JSON.parse(copy.target_config).config).name,
        state: copy.state,
        verifiedAt: Number(copy.verified_at),
        error: copy.error,
      })),
    })
  }
  return {
    items,
    total: Number((await first<{ total: number }>(db, 'SELECT count(*)::int AS total FROM backup_control.versions WHERE deleted=FALSE'))?.total || 0),
  }
}
