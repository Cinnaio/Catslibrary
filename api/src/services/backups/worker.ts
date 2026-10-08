import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '../../db/pool'
import { resetPool } from '../../db/pool'
import { first, all, withTx } from '../../db/query'
import { BACKUP_LOCK, BUSINESS_LOCK, BackupError, backupRoot, nextRun } from './config'
import { durableJson, generateArchive, type Manifest, versionDirectory } from './archive'
import { deleteRemote, ensureLocalArchive, testRemote, uploadRemote } from './storage'
import { currentMigration } from './archive'
import { rehearse, restoreBusiness } from './restore'
import { enqueue, getSetting, setSetting, logEvent, maintenance, policy, siteId, type TaskRow, type TargetRow, targetView } from './store'

async function manifestFor(db: Db, id: string): Promise<Manifest> {
  const row = await first<{ manifest: string }>(db, 'SELECT manifest FROM backup_control.versions WHERE id=$1 AND deleted=FALSE', [id])
  if (!row?.manifest) throw new BackupError('ARCHIVE_UNAVAILABLE', '该版本尚无完整归档')
  return JSON.parse(row.manifest) as Manifest
}
async function makeBackup(db: Db, task: TaskRow, protection = false) {
  await logEvent(db, task.id, protection ? '正在生成回滚前保护备份' : '正在导出并加密数据库')
  let id = task.version_id
  if (protection) {
    id = `protection_${randomUUID()}`
    await db.query(
      "INSERT INTO backup_control.versions(id,created_at,note,pinned,protection,trigger,state) VALUES($1,$2,'回滚前保护备份',TRUE,TRUE,'protection','running')",
      [id, Date.now()],
    )
    await db.query('INSERT INTO backup_control.copies(version_id,target_id,target_config) VALUES($1,\'local\',\'{"name":"本地"}\')', [id])
  }
  await db.query("UPDATE backup_control.versions SET state='running' WHERE id=$1", [id])
  const manifest = await generateArchive(db, id, await siteId(db))
  await db.query("UPDATE backup_control.versions SET manifest=$2,digest=$3,size=$4,snapshot_at=$5,migration_version=$6,state='completed' WHERE id=$1", [
    id,
    JSON.stringify(manifest),
    manifest.digest,
    manifest.size,
    manifest.snapshotAt,
    manifest.migrationVersion,
  ])
  await db.query("UPDATE backup_control.copies SET state='available',verified_at=$2,error='' WHERE version_id=$1 AND target_id='local'", [id, Date.now()])
  if (!protection) await uploadCopies(db, task, manifest)
  return manifest
}
async function uploadCopies(db: Db, task: TaskRow, manifest: Manifest) {
  const payload = JSON.parse(task.payload) as { targetIds?: string[] }
  const copies = await all<{ target_id: string; target_config: string; state: string; attempts: number }>(
    db,
    "SELECT * FROM backup_control.copies WHERE version_id=$1 AND target_id!='local'",
    [manifest.id],
  )
  let partial = false
  for (const copy of copies) {
    if (task.kind === 'retry' && payload.targetIds && !payload.targetIds.includes(copy.target_id)) continue
    if (copy.state === 'available') continue
    let target: TargetRow = JSON.parse(copy.target_config)
    await logEvent(db, task.id, `正在传输并回读校验：${targetView(target).name}`)
    try {
      if (task.kind === 'retry') {
        const latest = await first<TargetRow>(db, 'SELECT * FROM backup_control.targets WHERE id=$1 AND archived=FALSE', [copy.target_id])
        if (latest) {
          if (!targetView(latest).enabled) throw new BackupError('TARGET_DISABLED', '该存储目标已停用，请先启用后重试')
          target = latest
          await db.query('UPDATE backup_control.copies SET target_config=$3 WHERE version_id=$1 AND target_id=$2', [
            manifest.id,
            copy.target_id,
            JSON.stringify(latest),
          ])
        }
      }
      await db.query("UPDATE backup_control.copies SET state='uploading',error='',attempts=attempts+1,retry_at=0 WHERE version_id=$1 AND target_id=$2", [
        manifest.id,
        copy.target_id,
      ])
      await uploadRemote(target, manifest)
      await db.query("UPDATE backup_control.copies SET state='available',verified_at=$3 WHERE version_id=$1 AND target_id=$2", [
        manifest.id,
        copy.target_id,
        Date.now(),
      ])
      await logEvent(db, task.id, `远程副本已通过完整摘要校验：${targetView(target).name}`)
    } catch (error) {
      partial = true
      const message = safeError(error)
      const retryable = error instanceof BackupError && ['COMMAND_FAILED', 'WRITE_FAILED'].includes(error.code)
      const delay = [60000, 300000, 900000][copy.attempts]
      await db.query("UPDATE backup_control.copies SET state='failed',error=$3,retry_at=$4 WHERE version_id=$1 AND target_id=$2", [
        manifest.id,
        copy.target_id,
        message,
        retryable && delay ? Date.now() + delay : 0,
      ])
      await logEvent(db, task.id, message, 'error')
    }
  }
  const incomplete = await first<{ count: number }>(db, "SELECT count(*)::int AS count FROM backup_control.copies WHERE version_id=$1 AND state!='available'", [
    manifest.id,
  ])
  partial ||= Boolean(incomplete?.count)
  await db.query('UPDATE backup_control.versions SET state=$2 WHERE id=$1', [manifest.id, partial ? 'partial' : 'completed'])
  await db.query('UPDATE backup_control.tasks SET state=$2 WHERE id=$1', [task.id, partial ? 'partial' : 'running'])
}
export function safeError(error: unknown) {
  return error instanceof BackupError ? `${error.code}：${error.message}` : 'BACKUP_FAILED：操作失败，请检查部署依赖与数据库权限'
}
async function assertIdle(db: Db) {
  const ai = await first<{ count: number }>(db, "SELECT count(*)::int AS count FROM ai_tasks WHERE status IN ('queued','running')")
  const scrape = await first<{ count: number }>(
    db,
    "SELECT count(*)::int AS count FROM scrape_jobs WHERE status NOT IN ('completed','partial','failed','cancelled')",
  )
  if (ai?.count || scrape?.count) throw new BackupError('BUSINESS_BUSY', '仍有抓取或 AI 任务执行中，请等待或终止任务后重新恢复')
}
async function executeRestore(db: Db, task: TaskRow) {
  const payload = JSON.parse(task.payload) as { previewToken: string; previewTaskId: string }
  const preview = await first<TaskRow>(db, "SELECT * FROM backup_control.tasks WHERE id=$1 AND kind='preview' AND state='completed'", [payload.previewTaskId])
  const result = preview?.result ? JSON.parse(preview.result) : null
  const manifest = await manifestFor(db, task.version_id)
  if (
    !preview ||
    preview.actor_id !== task.actor_id ||
    preview.version_id !== task.version_id ||
    result?.previewToken !== payload.previewToken ||
    result.expiresAt < Date.now() ||
    result.digest !== manifest.digest ||
    result.migration !== (await currentMigration(db))
  )
    throw new BackupError('PREVIEW_EXPIRED', '恢复预检已过期或不匹配，请重新预检')
  await logEvent(db, task.id, '正在进入维护模式，检查在途请求与后台任务')
  const gate = await db.connect()
  let locked = false,
    committed = false,
    protection: Manifest | undefined
  try {
    await setSetting(db, 'maintenance', true)
    const lock = await gate.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [BUSINESS_LOCK])
    if (!lock.rows[0]?.locked) throw new BackupError('BUSINESS_BUSY', '存在在途业务请求，请稍后重新预检恢复')
    locked = true
    await assertIdle(db)
    // 再次演练与归档认证后生成停写状态下的保护版本。
    await rehearse(db, manifest)
    protection = await makeBackup(db, task, true)
    await ensureLocalArchive(db, protection.id, protection)
    await db.query('UPDATE backup_control.tasks SET result=$2 WHERE id=$1', [task.id, JSON.stringify({ protectionId: protection.id })])
    await durableJson(path.join(backupRoot(), 'restore-journal.json'), {
      taskId: task.id,
      versionId: manifest.id,
      protectionId: protection.id,
      stage: 'applying',
      at: Date.now(),
    })
    await logEvent(db, task.id, '正在事务恢复业务数据、升级结构并失效历史会话')
    try {
      await restoreBusiness(db, manifest, task.id)
    } catch (error) {
      // psql 可能在提交后断线；数据库事务内标记可以证明是否已经提交。
      if ((await getSetting(db, 'restoreCommit', '')) !== task.id) throw error
    }
    committed = true
    const healthy = await first<{ count: number }>(db, "SELECT count(*)::int AS count FROM public.users WHERE role='admin' AND status='active'")
    if (!healthy?.count) throw new BackupError('HEALTH_FAILED', '恢复后业务检查失败')
    await durableJson(path.join(backupRoot(), 'restore-journal.json'), {
      taskId: task.id,
      versionId: manifest.id,
      protectionId: protection.id,
      stage: 'completed',
      at: Date.now(),
    })
    await setSetting(db, 'maintenance', false)
    await logEvent(db, task.id, '恢复完成，所有用户需要重新登录')
  } catch (error) {
    if (committed && protection) {
      await logEvent(db, task.id, '提交后检查失败，正在使用保护版本补偿恢复', 'error')
      try {
        await restoreBusiness(db, protection, `${task.id}:compensation`)
        await setSetting(db, 'maintenance', false)
        await durableJson(path.join(backupRoot(), 'restore-journal.json'), {
          taskId: task.id,
          stage: 'compensated',
          protectionId: protection.id,
          at: Date.now(),
        })
      } catch {
        await logEvent(db, task.id, '补偿恢复失败，保持维护模式，请使用部署侧恢复工具', 'error')
        throw new BackupError('RESTORE_MANUAL_REQUIRED', '恢复失败，站点保持维护模式，保护备份与日志已保留')
      }
    } else {
      // 未提交且数据库仍能确认状态，原业务事务已回滚。
      const marker = await getSetting(db, 'restoreCommit', '')
      if (marker === task.id) throw new BackupError('RESTORE_MANUAL_REQUIRED', '已提交的恢复状态待核实，保持维护模式')
      await setSetting(db, 'maintenance', false)
    }
    throw error
  } finally {
    if (locked) await gate.query('SELECT pg_advisory_unlock($1)', [BUSINESS_LOCK]).catch(() => {})
    gate.release()
  }
}
async function removeCopy(db: Db, id: string, targetId: string, manifest: Manifest | null, config: string) {
  await db.query("UPDATE backup_control.copies SET state='delete_pending' WHERE version_id=$1 AND target_id=$2", [id, targetId])
  try {
    if (targetId === 'local') await rm(versionDirectory(id), { recursive: true, force: true })
    else if (manifest) await deleteRemote(JSON.parse(config), manifest)
    await db.query("UPDATE backup_control.copies SET state='deleted',error='' WHERE version_id=$1 AND target_id=$2", [id, targetId])
  } catch (error) {
    await db.query('UPDATE backup_control.copies SET error=$3 WHERE version_id=$1 AND target_id=$2', [id, targetId, safeError(error)])
    throw error
  }
}
async function deleteVersion(db: Db, task: TaskRow) {
  const version = await first<{ pinned: boolean; protection: boolean; manifest: string }>(db, 'SELECT * FROM backup_control.versions WHERE id=$1', [
    task.version_id,
  ])
  if (!version || version.pinned || version.protection) throw new BackupError('VERSION_PROTECTED', '固定或保护版本不能删除')
  const remaining = await first<{ count: number }>(
    db,
    "SELECT count(DISTINCT v.id)::int AS count FROM backup_control.versions v JOIN backup_control.copies c ON c.version_id=v.id WHERE v.deleted=FALSE AND c.state='available' AND v.id!=$1",
    [task.version_id],
  )
  if (!remaining?.count && version.manifest) throw new BackupError('LAST_VERSION', '不能删除最后一个可恢复版本')
  const copies = await all<{ target_id: string; target_config: string; state: string }>(db, 'SELECT * FROM backup_control.copies WHERE version_id=$1', [
    task.version_id,
  ])
  for (const copy of copies)
    if (copy.state !== 'deleted')
      await removeCopy(db, task.version_id, copy.target_id, version.manifest ? JSON.parse(version.manifest) : null, copy.target_config)
  await db.query('UPDATE backup_control.versions SET deleted=TRUE WHERE id=$1', [task.version_id])
}
async function retention(db: Db, taskId: string) {
  const config = await policy(db)
  const rows = await all<{ version_id: string; target_id: string; target_config: string; manifest: string; pinned: boolean; protection: boolean }>(
    db,
    "SELECT c.*,v.manifest,v.pinned,v.protection FROM backup_control.copies c JOIN backup_control.versions v ON v.id=c.version_id WHERE c.state='available' AND v.deleted=FALSE ORDER BY v.created_at DESC,v.id DESC",
  )
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.pinned || row.protection) continue
    const count = (counts.get(row.target_id) || 0) + 1
    counts.set(row.target_id, count)
    const retain = row.target_id === 'local' ? config.localRetention : targetView(JSON.parse(row.target_config)).retention
    if (count <= retain) continue
    const active = await first<{ count: number }>(
      db,
      "SELECT count(*)::int AS count FROM backup_control.tasks WHERE version_id=$1 AND state IN ('queued','running') AND id!=$2",
      [row.version_id, taskId],
    )
    if (active?.count) continue
    if (row.target_id === 'local') {
      const incomplete = await all<{ target_config: string; state: string }>(
        db,
        "SELECT target_config,state FROM backup_control.copies WHERE version_id=$1 AND target_id!='local'",
        [row.version_id],
      )
      if (incomplete.some((copy) => targetView(JSON.parse(copy.target_config)).required && copy.state !== 'available')) continue
      if (incomplete.some((copy) => copy.state !== 'available' && copy.state !== 'deleted')) continue
    }
    const other = await first<{ count: number }>(
      db,
      "SELECT count(*)::int AS count FROM backup_control.copies WHERE version_id=$1 AND state='available' AND target_id!=$2",
      [row.version_id, row.target_id],
    )
    // 仅当已超过本目标保留数量时，最后一个副本可随整个旧版本过期。
    try {
      await removeCopy(db, row.version_id, row.target_id, JSON.parse(row.manifest), row.target_config)
      if (!other?.count) await db.query('UPDATE backup_control.versions SET deleted=TRUE WHERE id=$1', [row.version_id])
      await logEvent(db, taskId, `已按保留策略清理 ${row.target_id === 'local' ? '本地' : targetView(JSON.parse(row.target_config)).name} 的旧副本`)
    } catch (error) {
      await logEvent(db, taskId, safeError(error), 'warning')
    }
  }
}
async function schedule(db: Db) {
  const current = await policy(db)
  if (!current.enabled || !current.nextRunAt || current.nextRunAt > Date.now()) return
  const run = await first(db, 'SELECT task_id FROM backup_control.schedule_runs WHERE revision=$1 AND scheduled_at=$2', [current.revision, current.nextRunAt])
  if (!run)
    await enqueue(
      db,
      'backup',
      { operationId: `schedule:${current.revision}:${current.nextRunAt}`, targetIds: current.targetIds },
      { id: 'system', name: '自动备份' },
      { revision: current.revision, at: current.nextRunAt },
    )
  await withTx(db, async (query) => {
    await query('SELECT pg_advisory_xact_lock(730049)')
    const fresh = await policy({ query })
    if (fresh.revision === current.revision && fresh.nextRunAt === current.nextRunAt)
      await setSetting({ query }, 'policy', { ...fresh, nextRunAt: nextRun(fresh, Date.now()) })
  })
}
export async function runBackupTick(db: Db) {
  const connection = await db.connect()
  let locked = false,
    restored = false
  try {
    const lock = await connection.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [BACKUP_LOCK])
    if (!lock.rows[0]?.locked) return
    locked = true
    // 能取得全站任务锁说明上个 Worker 已退出；恢复任务不盲目重放。
    const interrupted = await all<TaskRow>(db, "SELECT * FROM backup_control.tasks WHERE state='running'")
    for (const task of interrupted) {
      await db.query("UPDATE backup_control.tasks SET state='interrupted',error='进程中断，请检查后重试',finished_at=$2 WHERE id=$1", [task.id, Date.now()])
      await logEvent(db, task.id, '任务进程中断；已完成副本保留，恢复不自动重放', 'error')
      if (task.kind === 'backup')
        await db.query("UPDATE backup_control.versions SET state=CASE WHEN manifest='' THEN 'interrupted' ELSE 'partial' END WHERE id=$1", [task.version_id])
    }
    if (interrupted.length) {
      // 站点任务锁已取得，没有其他有效 Worker/下载；清理崩溃遗留的明文和认证暂存。
      await rm(path.join(backupRoot(), 'work'), { recursive: true, force: true })
      const unfinished = await all<{ id: string }>(
        db,
        "SELECT id FROM backup_control.versions WHERE state IN ('queued','running','failed','interrupted','partial')",
      )
      for (const row of unfinished) {
        for (const name of ['database.tmp', 'archive.tmp', 'download.tmp']) await rm(path.join(versionDirectory(row.id), name), { force: true })
      }
      await db.query("UPDATE backup_control.versions SET state='interrupted' WHERE state='running' AND manifest=''")
    }
    if (await maintenance(db)) return
    await schedule(db)
    const retry = await first<{ version_id: string; target_id: string; attempts: number }>(
      db,
      "SELECT c.version_id,c.target_id,c.attempts FROM backup_control.copies c JOIN backup_control.versions v ON v.id=c.version_id WHERE c.state='failed' AND c.retry_at>0 AND c.retry_at<=$1 AND v.deleted=FALSE ORDER BY c.retry_at LIMIT 1",
      [Date.now()],
    )
    if (retry) {
      await enqueue(
        db,
        'retry',
        { operationId: `retry:${retry.version_id}:${retry.target_id}:${retry.attempts}`, versionId: retry.version_id, targetIds: [retry.target_id] },
        { id: 'system', name: '自动重试' },
      )
      await db.query('UPDATE backup_control.copies SET retry_at=0 WHERE version_id=$1 AND target_id=$2', [retry.version_id, retry.target_id])
    }
    const task = await first<TaskRow>(db, "SELECT * FROM backup_control.tasks WHERE state='queued' ORDER BY created_at,id LIMIT 1")
    if (!task) return
    await db.query("UPDATE backup_control.tasks SET state='running',heartbeat_at=$2 WHERE id=$1", [task.id, Date.now()])
    try {
      if (task.kind === 'backup') {
        await makeBackup(db, task)
        await retention(db, task.id)
      } else if (task.kind === 'test') {
        await testRemote(JSON.parse(task.payload).target)
        await logEvent(db, task.id, '连接测试通过：上传、读取校验、删除均完成')
      } else if (task.kind === 'retry') {
        const manifest = await manifestFor(db, task.version_id)
        await ensureLocalArchive(db, manifest.id, manifest)
        await uploadCopies(db, task, manifest)
      } else if (task.kind === 'preview') {
        const manifest = await manifestFor(db, task.version_id)
        await logEvent(db, task.id, '正在验证归档并在隔离数据库演练恢复')
        const administrators = await rehearse(db, manifest)
        const result = {
          previewToken: randomUUID(),
          expiresAt: Date.now() + 600000,
          administrators,
          digest: manifest.digest,
          migration: await currentMigration(db),
        }
        await db.query('UPDATE backup_control.tasks SET result=$2 WHERE id=$1', [task.id, JSON.stringify(result)])
        await logEvent(db, task.id, '恢复演练通过，确认令牌在 10 分钟内有效')
      } else if (task.kind === 'restore') {
        await executeRestore(db, task)
        restored = true
      } else if (task.kind === 'delete') await deleteVersion(db, task)
      await db.query("UPDATE backup_control.tasks SET state=CASE WHEN state='partial' THEN state ELSE 'completed' END,finished_at=$2 WHERE id=$1", [
        task.id,
        Date.now(),
      ])
      await db.query(
        "DELETE FROM backup_control.events WHERE created_at<$1 AND task_id IN (SELECT id FROM backup_control.tasks WHERE kind IN ('backup','test','retry','delete'))",
        [Date.now() - 180 * 86400000],
      )
    } catch (error) {
      const message = safeError(error)
      await logEvent(db, task.id, message, 'error')
      await db.query("UPDATE backup_control.tasks SET state='failed',error=$2,finished_at=$3 WHERE id=$1", [task.id, message, Date.now()])
      if (task.kind === 'backup')
        await db.query("UPDATE backup_control.versions SET state=CASE WHEN manifest='' THEN 'failed' ELSE 'partial' END WHERE id=$1", [task.version_id])
    }
  } finally {
    if (locked) await connection.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => {})
    connection.release()
    if (restored) resetPool()
  }
}
