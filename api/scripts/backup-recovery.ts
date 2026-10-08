/** 部署侧灾备工具：必须先停止所有 API/Worker，显式确认目标版本。 */
import { Pool } from 'pg'
import { readFile, copyFile, mkdir, stat, chmod } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config'
import type { Db } from '../src/db/pool'
import { BACKUP_LOCK, BUSINESS_LOCK, backupRoot } from '../src/services/backups/config'
import { archivePath, digestFile, durableJson, generateArchive, type Manifest, verifyManifest, versionDirectory } from '../src/services/backups/archive'
import { getSetting, setSetting } from '../src/services/backups/store'
import { restoreBusiness } from '../src/services/backups/restore'

const args = process.argv.slice(2)
const value = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || '' : ''
}
const help = `用法：npm run backup:recover -- --offline --manifest /path/版本.manifest.json --archive /path/版本.zzbackup --confirm 版本标识
先停止全部 API/Worker。该操作会恢复 public 业务 schema，保留 backup_control 日志。
完全丢失业务库时加 --empty-database；已有业务数据时会先生成保护备份。
只查看维护状态：npm run backup:recover -- --status`
async function main() {
  if (!args.length || args.includes('--help')) {
    console.log(help)
    return
  }
  const pool = new Pool({ connectionString: loadConfig().databaseUrl, max: 5 }),
    db = pool as unknown as Db
  const lock = await pool.connect()
  let backupLocked = false,
    businessLocked = false
  try {
    if (args.includes('--status')) {
      console.log(
        JSON.stringify({ maintenance: await getSetting(db, 'maintenance', false), restoreCommit: await getSetting(db, 'restoreCommit', '') }, null, 2),
      )
      return
    }
    if (!args.includes('--offline') || !value('--manifest') || !value('--archive')) throw new Error(help)
    const manifest: Manifest = JSON.parse(await readFile(value('--manifest'), 'utf8'))
    verifyManifest(manifest)
    if (value('--confirm') !== manifest.id) throw new Error('--confirm 必须与恢复清单中的版本标识一致')
    if ((await digestFile(value('--archive'))) !== manifest.digest) throw new Error('归档摘要不匹配')
    const result = await lock.query('SELECT pg_try_advisory_lock($1) AS locked', [BACKUP_LOCK])
    backupLocked = Boolean(result.rows[0].locked)
    if (!backupLocked) throw new Error('备份 Worker 仍在执行，请先停止服务')
    const business = await lock.query('SELECT pg_try_advisory_lock($1) AS locked', [BUSINESS_LOCK])
    businessLocked = Boolean(business.rows[0].locked)
    if (!businessLocked) throw new Error('仍有业务访问，请先停止服务')
    const migration = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations/047_backups.sql')
    await pool.query(await readFile(migration, 'utf8'))
    await setSetting(db, 'maintenance', true)
    const publicTables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    let protectionId = ''
    if (publicTables.rows.length) {
      if (args.includes('--empty-database')) throw new Error('public schema 仍有数据表，不能作为空库恢复')
      protectionId = `protection_${randomUUID()}`
      const protection = await generateArchive(db, protectionId, manifest.siteId)
      await pool.query(
        "INSERT INTO backup_control.versions(id,created_at,state,manifest,digest,size,snapshot_at,migration_version,pinned,protection,trigger,note) VALUES($1,$2,'completed',$3,$4,$5,$6,$7,TRUE,TRUE,'protection','部署侧恢复前保护备份')",
        [protectionId, Date.now(), JSON.stringify(protection), protection.digest, protection.size, protection.snapshotAt, protection.migrationVersion],
      )
      await pool.query(
        "INSERT INTO backup_control.copies(version_id,target_id,target_config,state,verified_at) VALUES($1,'local','{\"name\":\"本地\"}','available',$2)",
        [protectionId, Date.now()],
      )
    } else if (!args.includes('--empty-database')) throw new Error('业务库为空，请明确指定 --empty-database')
    await mkdir(versionDirectory(manifest.id), { recursive: true, mode: 0o700 })
    if (path.resolve(value('--archive')) !== archivePath(manifest.id)) {
      try {
        await stat(archivePath(manifest.id))
        if ((await digestFile(archivePath(manifest.id))) !== manifest.digest) throw new Error('本地已有不同内容的同名版本')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await copyFile(value('--archive'), archivePath(manifest.id))
      }
    }
    await chmod(archivePath(manifest.id), 0o600)
    await durableJson(path.join(versionDirectory(manifest.id), 'manifest.json'), manifest)
    await durableJson(path.join(versionDirectory(manifest.id), 'complete.json'), { digest: manifest.digest, signature: manifest.signature })
    await pool.query(
      "INSERT INTO backup_control.versions(id,created_at,state,manifest,digest,size,snapshot_at,migration_version,trigger,note) VALUES($1,$2,'completed',$3,$4,$5,$6,$7,'offline','部署侧导入版本') ON CONFLICT(id) DO NOTHING",
      [manifest.id, manifest.snapshotAt, JSON.stringify(manifest), manifest.digest, manifest.size, manifest.snapshotAt, manifest.migrationVersion],
    )
    await pool.query(
      "INSERT INTO backup_control.copies(version_id,target_id,target_config,state,verified_at) VALUES($1,'local','{\"name\":\"本地\"}','available',$2) ON CONFLICT(version_id,target_id) DO UPDATE SET state='available',verified_at=EXCLUDED.verified_at",
      [manifest.id, Date.now()],
    )
    const taskId = `offline_${randomUUID()}`
    await pool.query(
      "INSERT INTO backup_control.tasks(id,kind,version_id,state,actor,payload,operation_id,request_hash,created_at) VALUES($1,'restore',$2,'running','部署侧恢复','{}',$1,'offline',$3)",
      [taskId, manifest.id, Date.now()],
    )
    await durableJson(path.join(backupRoot(), 'restore-journal.json'), { taskId, versionId: manifest.id, protectionId, stage: 'applying', at: Date.now() })
    await restoreBusiness(db, manifest, taskId, true)
    await setSetting(db, 'siteId', manifest.siteId)
    await setSetting(db, 'maintenance', false)
    await pool.query("UPDATE backup_control.tasks SET state='completed',stage='部署侧恢复完成',finished_at=$2 WHERE id=$1", [taskId, Date.now()])
    await durableJson(path.join(backupRoot(), 'restore-journal.json'), { taskId, versionId: manifest.id, protectionId, stage: 'completed', at: Date.now() })
    console.log(`恢复完成：${manifest.id}。保护版本：${protectionId || '空库恢复'}。可以重新启动服务，用户需重新登录。`)
  } finally {
    if (businessLocked) await lock.query('SELECT pg_advisory_unlock($1)', [BUSINESS_LOCK]).catch(() => {})
    if (backupLocked) await lock.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => {})
    lock.release()
    await pool.end()
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : '灾备恢复失败')
  process.exitCode = 1
})
