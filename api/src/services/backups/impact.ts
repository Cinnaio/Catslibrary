import type { Db, DbClient } from '../../db/pool'
import type { BackupImpactFreshness, BackupImpactItem, BackupImpactReport, BackupImpactSummary } from '@shared/backups'
import { BACKUP_IMPACT_GROUPS } from '@shared/backups'
import { first } from '../../db/query'
import { BackupError } from './config'
import { backupSettings } from './settings'
import type { Manifest } from './archive'
import { currentMigration } from './archive'
import { compareImpactSnapshots, liveImpactFingerprint } from './impact-snapshot'
import type { TaskRow } from './store'

interface ImpactRow {
  task_id: string
  version_id: string
  actor_id: string
  state: string
  snapshot_at: number
  completed_at: number
  expires_at: number
  settings_revision: number
  rehearsal_label: string
  backup_digest: string
  live_fingerprint: string
  summary: string
}
export const impactPreserved = ['当前服务器部署配置（主密钥、工具路径、目录等）', '备份版本、副本、任务日志与控制配置']
export const impactNotes = [
  '方向为当前线上数据 → 所选备份：新增表示恢复备份中独有记录，移除表示删除当前独有记录。',
  '比较基于迁移到当前结构的隔离恢复结果；正文、密码、令牌、密钥及其他凭据不展示原值或摘要。',
  '恢复后所有登录会话失效，进行中的 AI 与抓取任务中断；这是固定恢复行为，不逐条列出会话。',
  '访问、审计和请求限流等运行记录按预检快照统计，不参与业务影响的过期判断；用户最近登录时间也不触发过期。',
  '没有稳定主键的表按记录内容统计新增/移除；此报告解释完整版本恢复，不支持选择性恢复。',
]
export async function generateRestoreImpact(db: Db, shadow: Db, task: Pick<TaskRow, 'id' | 'actor_id'>, manifest: Manifest): Promise<BackupImpactSummary> {
  const settings = await backupSettings(db)
  await db.query(
    `INSERT INTO backup_control.restore_impacts(task_id,version_id,actor_id,snapshot_at,settings_revision,rehearsal_label,backup_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [task.id, manifest.id, task.actor_id, Date.now(), settings.revision, settings.rehearsalLabel, manifest.digest],
  )
  let sequence = 0
  let batch: BackupImpactItem[] = []
  const flush = async () => {
    if (!batch.length) return
    await db.query(
      `INSERT INTO backup_control.restore_impact_items(task_id,sequence,group_key,table_name,change,data)
      SELECT $1,x.sequence,x.data->>'group',x.data->>'table',x.data->>'change',x.data
      FROM jsonb_to_recordset($2::jsonb) AS x(sequence integer,data jsonb)`,
      [task.id, JSON.stringify(batch.map((item) => ({ sequence: item.sequence, data: item })))],
    )
    batch = []
  }
  try {
    const comparison = await compareImpactSnapshots(db, shadow, async (item) => {
      batch.push({ ...item, sequence: ++sequence })
      if (batch.length >= 500) await flush()
    })
    await flush()
    const completedAt = Date.now()
    await db.query(
      "UPDATE backup_control.restore_impacts SET state='ready',snapshot_at=$2,completed_at=$3,expires_at=$4,live_fingerprint=$5,summary=$6 WHERE task_id=$1",
      [task.id, comparison.snapshotAt, completedAt, completedAt + 600000, comparison.fingerprint, JSON.stringify(comparison.summary)],
    )
    return comparison.summary
  } catch (error) {
    await db.query("UPDATE backup_control.restore_impacts SET state='failed' WHERE task_id=$1", [task.id]).catch(() => {})
    await db.query('DELETE FROM backup_control.restore_impact_items WHERE task_id=$1', [task.id]).catch(() => {})
    if (error instanceof BackupError) throw error
    throw new BackupError('IMPACT_UNAVAILABLE', '回滚影响分析未完成，不能继续回滚；请重新预检')
  }
}
async function readyImpact(db: DbClient, taskId: string): Promise<ImpactRow> {
  const row = await first<ImpactRow>(db, 'SELECT * FROM backup_control.restore_impacts WHERE task_id=$1', [taskId])
  if (!row || row.state !== 'ready') throw new BackupError('IMPACT_REQUIRED', '没有完整的回滚影响报告，请重新预检', 409)
  return row
}
export async function restoreImpactReport(
  db: DbClient,
  taskId: string,
  group: string,
  change: string,
  limit: number,
  offset: number,
): Promise<BackupImpactReport> {
  if ((group && !(BACKUP_IMPACT_GROUPS as readonly string[]).includes(group)) || (change && !['add', 'modify', 'remove'].includes(change)))
    throw new BackupError('INVALID_CONFIG', '回滚影响筛选条件无效')
  const row = await readyImpact(db, taskId)
  const where = "WHERE task_id=$1 AND ($2='' OR group_key=$2) AND ($3='' OR change=$3)"
  const items = await db.query<{ data: BackupImpactItem }>(
    `SELECT data FROM backup_control.restore_impact_items ${where} ORDER BY sequence LIMIT $4 OFFSET $5`,
    [taskId, group, change, limit, offset],
  )
  const total = await first<{ total: number }>(db, `SELECT count(*)::int AS total FROM backup_control.restore_impact_items ${where}`, [taskId, group, change])
  return {
    taskId,
    versionId: row.version_id,
    snapshotAt: Number(row.snapshot_at),
    completedAt: Number(row.completed_at),
    expiresAt: Number(row.expires_at),
    summary: JSON.parse(row.summary) as BackupImpactSummary,
    preserved: impactPreserved,
    notes: impactNotes,
    items: { items: items.rows.map((item) => item.data), total: total?.total || 0 },
  }
}
export async function assertRestoreImpactBinding(db: DbClient, taskId: string, actorId: string, versionId: string) {
  const row = await readyImpact(db, taskId)
  const preview = await first<TaskRow>(db, "SELECT * FROM backup_control.tasks WHERE id=$1 AND kind='preview' AND state='completed'", [taskId])
  const version = await first<{ manifest: string }>(db, 'SELECT manifest FROM backup_control.versions WHERE id=$1 AND deleted=FALSE', [versionId])
  const result = preview?.result ? JSON.parse(preview.result) : null
  const settings = await backupSettings(db)
  if (row.actor_id !== actorId || preview?.actor_id !== actorId) throw new BackupError('IMPACT_FORBIDDEN', '只能由发起预检的管理员确认回滚', 403)
  if (
    !version?.manifest ||
    row.version_id !== versionId ||
    preview?.version_id !== versionId ||
    !result?.impact ||
    Number(row.expires_at) < Date.now() ||
    result.expiresAt !== Number(row.expires_at) ||
    result.migration !== (await currentMigration(db)) ||
    row.backup_digest !== (JSON.parse(version.manifest) as Manifest).digest ||
    settings.revision !== row.settings_revision ||
    !settings.rehearsalConfigured ||
    settings.rehearsalLabel !== row.rehearsal_label
  )
    throw new BackupError('IMPACT_EXPIRED', '回滚影响报告已过期或目标配置发生变化，请重新预检', 409)
  return row
}
export async function checkRestoreImpactFreshness(db: Db, taskId: string, actorId: string, versionId: string): Promise<BackupImpactFreshness> {
  const row = await assertRestoreImpactBinding(db, taskId, actorId, versionId)
  let fingerprint: string
  try {
    fingerprint = await liveImpactFingerprint(db)
  } catch {
    throw new BackupError('IMPACT_UNAVAILABLE', '无法确认当前业务数据的差异，不能继续回滚；请重新预检', 409)
  }
  // 扫描期间配置或时效也可能变化，必须在扫描之后再次校验绑定。
  await assertRestoreImpactBinding(db, taskId, actorId, versionId)
  const fresh = fingerprint === row.live_fingerprint
  return { fresh, checkedAt: Date.now(), message: fresh ? '回滚影响报告仍有效' : '线上业务数据已变化，回滚影响可能不同，请重新预检并确认' }
}
export async function requireFreshRestoreImpact(db: Db, taskId: string, actorId: string, versionId: string) {
  const result = await checkRestoreImpactFreshness(db, taskId, actorId, versionId)
  if (!result.fresh) throw new BackupError('IMPACT_STALE', result.message, 409)
}
