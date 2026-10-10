import { backupSettings, rehearsalConnection, saveBackupSettings } from './settings'
import { Pool } from 'pg'
import { mkdtemp, readFile, writeFile, rm, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import type { Db } from '../../db/pool'
import { runMigrations } from '../../db/migrate'
import { enqueue, getSetting, logEvent, setSetting, siteId } from './store'
import { runBackupTick } from './worker'
import { archivePath, currentMigration, generateArchive, type Manifest } from './archive'
import { rehearse, prepareRestore } from './restore'
import { command, pgEnvironment, psqlTool } from './process'
import { defaultPolicy } from './config'
import { saveTarget } from './store'
import { testRemote, ensureLocalArchive } from './storage'

const connection = process.env.BACKUP_INTEGRATION_DATABASE_URL
describe.skipIf(!connection)('真实 PostgreSQL 全链路（仅专用测试库）', () => {
  let pool: Pool, db: Db, root: string
  beforeAll(async () => {
    if (!connection!.includes('backup_integration')) throw new Error('Integration requires a dedicated backup_integration database')
    pool = new Pool({ connectionString: connection })
    db = pool as unknown as Db
    vi.stubEnv('DATABASE_URL', connection!)
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'))
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', process.env.BACKUP_INTEGRATION_REHEARSAL_URL || '')
    root = await mkdtemp(path.join(tmpdir(), 'zhi-zhou-backup-integration-'))
    vi.stubEnv('BACKUP_ROOT', root)
    vi.stubEnv('BACKUP_CONFIG_FILE', path.join(root, 'backup-config.json'))
    await runMigrations(db)
    await db.query(
      "INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('backup-admin','backup-admin','admin','test','test',1,1)",
    )
    await db.query("INSERT INTO novels(id,title,author,created_at,updated_at) VALUES('backup-novel','备份前的小说','测试',1,1)")
    await db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('backup-chapter','backup-novel','第一章','原始正文',1,1)")
    await db.query("INSERT INTO novel_covers(novel_id,data,content_type,updated_at) VALUES('backup-novel',$1,'image/png',1)", [Buffer.from([1, 2, 3, 4])])
  })
  afterAll(async () => {
    if (pool) await pool.end()
    if (root) await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })
  it('后台演练库配置真实验证，加密保存且不回显，错误配置不生效', async () => {
    const initial = await backupSettings(db)
    const url = process.env.BACKUP_INTEGRATION_REHEARSAL_URL!
    const saved = await saveBackupSettings(db, { ...initial, rehearsalSource: 'custom', rehearsalUrl: url })
    expect(saved.rehearsalConfigured).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(url)
    const row = (await db.query<{ value: string }>("SELECT value FROM backup_control.settings WHERE key='runtime'")).rows[0]!.value
    expect(row).not.toContain(url)
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', '')
    expect(await rehearsalConnection(db)).toBe(url)
    await expect(saveBackupSettings(db, { ...saved, rehearsalSource: 'custom', rehearsalUrl: connection! })).rejects.toThrow()
    await expect(saveBackupSettings(db, { ...saved, rehearsalUrl: url.replace(new URL(url).pathname, '/backup_integration_missing_guard') })).rejects.toThrow()
    expect((await backupSettings(db)).revision).toBe(saved.revision)
  })
  it('创建加密版本，真实隔离演练并恢复指定版本，控制日志不回滚', async () => {
    const backup = await enqueue(db, 'backup', { operationId: 'integration-backup-1', targetIds: [] }, { id: 'backup-admin', name: '管理员' })
    await runBackupTick(db)
    const version = await db.query<{ manifest: string; state: string }>('SELECT manifest,state FROM backup_control.versions WHERE id=$1', [backup.versionId])
    expect(version.rows[0]!.state).toBe('completed')
    const manifest: Manifest = JSON.parse(version.rows[0]!.manifest)
    expect((await readFile(archivePath(backup.versionId))).includes(Buffer.from('原始正文'))).toBe(false)
    await db.query("UPDATE novels SET title='备份后的修改' WHERE id='backup-novel'")
    await db.query('CREATE TABLE public.after_backup_table(id int)')
    const preview = await enqueue(db, 'preview', { operationId: 'integration-preview-1', versionId: backup.versionId }, { id: 'backup-admin', name: '管理员' })
    await runBackupTick(db)
    const task = await db.query<{ state: string; result: string; error: string }>('SELECT state,result,error FROM backup_control.tasks WHERE id=$1', [
      preview.id,
    ])
    expect(task.rows[0]!.error).toBe('')
    expect(task.rows[0]!.state).toBe('completed')
    const result = JSON.parse(task.rows[0]!.result)
    expect(result.impact.groups.novels.modified).toBe(1)
    expect(result.impact.schemaChanges).toContainEqual({ table: 'after_backup_table', change: 'remove' })
    expect(result.administrators).toContain('backup-admin')
    await logEvent(db, preview.id, '备份之后新增的日志，恢复后必须保留')
    await db.query("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES('fixture-token','backup-admin',$1,1)", [Date.now() + 3600000])
    const restore = await enqueue(
      db,
      'restore',
      { operationId: 'integration-restore-1', versionId: backup.versionId, previewTaskId: preview.id, previewToken: result.previewToken },
      { id: 'backup-admin', name: '管理员' },
    )
    await runBackupTick(db)
    const finished = await db.query<{ state: string; error: string; result: string }>('SELECT state,error,result FROM backup_control.tasks WHERE id=$1', [
      restore.id,
    ])
    expect(finished.rows[0]!.error).toBe('')
    expect(finished.rows[0]!.state).toBe('completed')
    expect((await db.query<{ title: string }>("SELECT title FROM novels WHERE id='backup-novel'")).rows[0]!.title).toBe('备份前的小说')
    expect((await db.query<{ data: Buffer }>("SELECT data FROM novel_covers WHERE novel_id='backup-novel'")).rows[0]!.data).toEqual(Buffer.from([1, 2, 3, 4]))
    expect((await db.query<{ table: string | null }>("SELECT to_regclass('public.after_backup_table') AS table")).rows[0]!.table).toBeNull()
    expect((await db.query('SELECT * FROM user_sessions')).rows).toHaveLength(0)
    expect((await db.query("SELECT * FROM backup_control.events WHERE message='备份之后新增的日志，恢复后必须保留'")).rows).toHaveLength(1)
    expect(JSON.parse(finished.rows[0]!.result).protectionId).toMatch(/^protection_/)
    expect(await getSetting(db, 'maintenance', true)).toBe(false)
    const journal = JSON.parse(await readFile(path.join(root, 'restore-journal.json'), 'utf8'))
    expect(journal.stage).toBe('completed')
    expect(manifest.migrationVersion).toBe(await currentMigration(db))
  }, 60000)
  it('预检后业务变化或报告不完整时阻止回滚，保留数据并退出维护', async () => {
    const versionId = (await db.query<{ id: string }>('SELECT id FROM backup_control.versions WHERE protection=FALSE AND deleted=FALSE LIMIT 1')).rows[0]!.id
    for (const reason of ['stale', 'incomplete']) {
      const preview = await enqueue(db, 'preview', { operationId: `blocked-preview-${reason}`, versionId }, { id: 'backup-admin', name: '管理员' })
      await runBackupTick(db)
      const result = JSON.parse((await db.query<{ result: string }>('SELECT result FROM backup_control.tasks WHERE id=$1', [preview.id])).rows[0]!.result)
      expect(result.impact).toBeTruthy()
      const title = `拒绝回滚时保留-${reason}`
      if (reason === 'stale') await db.query("UPDATE novels SET title=$1 WHERE id='backup-novel'", [title])
      else await db.query("UPDATE backup_control.restore_impacts SET state='failed' WHERE task_id=$1", [preview.id])
      const before = (await db.query<{ count: string }>('SELECT count(*) FROM backup_control.versions WHERE protection=TRUE')).rows[0]!.count
      const restore = await enqueue(
        db,
        'restore',
        { operationId: `blocked-restore-${reason}`, versionId, previewTaskId: preview.id, previewToken: result.previewToken },
        { id: 'backup-admin', name: '管理员' },
      )
      await runBackupTick(db)
      const task = (await db.query<{ state: string; error: string }>('SELECT state,error FROM backup_control.tasks WHERE id=$1', [restore.id])).rows[0]!
      expect(task.state).toBe('failed')
      expect(task.error).toContain(reason === 'stale' ? '线上业务数据已变化' : '没有完整')
      expect((await db.query<{ title: string }>("SELECT title FROM novels WHERE id='backup-novel'")).rows[0]!.title).toBe(
        reason === 'stale' ? title : '拒绝回滚时保留-stale',
      )
      expect((await db.query<{ count: string }>('SELECT count(*) FROM backup_control.versions WHERE protection=TRUE')).rows[0]!.count).toBe(before)
      expect(await getSetting(db, 'maintenance', true)).toBe(false)
    }
  }, 60000)
  it('旧版备份在空演练控制区补齐新迁移并生成完整影响报告', async () => {
    const backup = await enqueue(db, 'backup', { operationId: 'migration47-backup', targetIds: [] }, { id: 'backup-admin', name: '管理员' })
    // Build an actual v47 schema, rather than removing only a migration marker
    // from today's schema. This stays valid when later migrations add tables.
    const migrations = fileURLToPath(new URL('../../db/migrations/', import.meta.url))
    const legacy = await mkdtemp(path.join(root, 'migration47-'))
    for (const file of await readdir(migrations)) {
      if (/^\d+_.*\.sql$/.test(file) && Number.parseInt(file) <= 47) await copyFile(path.join(migrations, file), path.join(legacy, file))
    }
    const shadow = new Pool({ connectionString: process.env.BACKUP_INTEGRATION_REHEARSAL_URL })
    try {
      await shadow.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS backup_control CASCADE')
      await runMigrations(shadow as unknown as Db, legacy)
      await shadow.query(
        "INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('backup-admin','backup-admin','admin','test','test',1,1)",
      )
      await shadow.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('backup-novel','旧版书名',1,1)")
      vi.stubEnv('DATABASE_URL', process.env.BACKUP_INTEGRATION_REHEARSAL_URL!)
      const manifest = await generateArchive(shadow as unknown as Db, backup.versionId, await siteId(db))
      expect(manifest.migrationVersion).toBe(47)
      await db.query("UPDATE backup_control.versions SET state='completed',manifest=$2,digest=$3 WHERE id=$1", [
        backup.versionId,
        JSON.stringify(manifest),
        manifest.digest,
      ])
      await db.query("UPDATE backup_control.copies SET state='available' WHERE version_id=$1", [backup.versionId])
      await db.query("UPDATE backup_control.tasks SET state='completed' WHERE id=$1", [backup.id])
      await shadow.query('DROP SCHEMA IF EXISTS backup_control CASCADE')
    } finally {
      vi.stubEnv('DATABASE_URL', connection!)
      await shadow.end()
    }
    const preview = await enqueue(db, 'preview', { operationId: 'migration47-preview', versionId: backup.versionId }, { id: 'backup-admin', name: '管理员' })
    await runBackupTick(db)
    const task = (
      await db.query<{ state: string; error: string; result: string }>('SELECT state,error,result FROM backup_control.tasks WHERE id=$1', [preview.id])
    ).rows[0]!
    expect(task.error).toBe('')
    expect(task.state).toBe('completed')
    expect(JSON.parse(task.result).impact).toBeTruthy()
    const restored = new Pool({ connectionString: process.env.BACKUP_INTEGRATION_REHEARSAL_URL })
    try {
      expect(await currentMigration(restored as unknown as Db)).toBe(await currentMigration(db))
      expect((await restored.query("SELECT to_regclass('public.chapter_illustrations') AS table")).rows[0].table).toBe('chapter_illustrations')
    } finally {
      await restored.end()
    }
  }, 60000)
  it('损坏归档无法恢复；演练库指向业务库时拒绝操作', async () => {
    const row = await db.query<{ manifest: string }>('SELECT manifest FROM backup_control.versions WHERE protection=TRUE LIMIT 1'),
      manifest: Manifest = JSON.parse(row.rows[0]!.manifest)
    const original = await readFile(archivePath(manifest.id))
    await writeFile(archivePath(manifest.id), Buffer.from('corrupt'))
    await expect(rehearse(db, manifest)).rejects.toThrow()
    await writeFile(archivePath(manifest.id), original)
    await saveBackupSettings(db, { ...(await backupSettings(db)), rehearsalSource: 'environment' })
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', connection!)
    await expect(rehearse(db, manifest)).rejects.toThrow('不能与业务数据库相同')
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', process.env.BACKUP_INTEGRATION_REHEARSAL_URL || '')
  })
  it('事务恢复途中 SQL 失败，原业务数据与结构保持完整', async () => {
    const row = await db.query<{ manifest: string }>('SELECT manifest FROM backup_control.versions WHERE protection=TRUE LIMIT 1'),
      manifest: Manifest = JSON.parse(row.rows[0]!.manifest)
    await db.query("UPDATE novels SET title='事务失败必须保留的修改' WHERE id='backup-novel'")
    await db.query('CREATE TABLE public.rollback_sentinel(id int)')
    const prepared = await prepareRestore(db, manifest)
    try {
      const sql = await readFile(prepared.script, 'utf8')
      await writeFile(prepared.script, sql.replace(/COMMIT;\s*$/, 'SELECT * FROM public.missing_restore_test_table; COMMIT;'))
      await expect(command(psqlTool(), ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', prepared.script], { env: pgEnvironment() })).rejects.toThrow()
      expect((await db.query<{ title: string }>("SELECT title FROM novels WHERE id='backup-novel'")).rows[0]!.title).toBe('事务失败必须保留的修改')
      expect((await db.query<{ table: string }>("SELECT to_regclass('public.rollback_sentinel') AS table")).rows[0]!.table).toBe('rollback_sentinel')
    } finally {
      await rm(prepared.dir, { recursive: true, force: true })
    }
  })
  it('提交后业务检查失败时使用保护版本补偿，保留控制日志并退出维护', async () => {
    const versionId = (await db.query<{ id: string }>('SELECT id FROM backup_control.versions WHERE protection=FALSE AND deleted=FALSE LIMIT 1')).rows[0]!.id
    await db.query("UPDATE novels SET title='补偿必须恢复的当前书名' WHERE id='backup-novel'")
    const preview = await enqueue(db, 'preview', { operationId: 'compensation-preview', versionId }, { id: 'backup-admin', name: '管理员' })
    await runBackupTick(db)
    const result = JSON.parse((await db.query<{ result: string }>('SELECT result FROM backup_control.tasks WHERE id=$1', [preview.id])).rows[0]!.result)
    const restore = await enqueue(
      db,
      'restore',
      {
        operationId: 'compensation-restore',
        versionId,
        previewTaskId: preview.id,
        previewToken: result.previewToken,
      },
      { id: 'backup-admin', name: '管理员' },
    )
    let checked = false
    const failing: Db = {
      query: async (sql, params) => {
        if (sql === "SELECT count(*)::int AS count FROM public.users WHERE role='admin' AND status='active'") {
          // Inject only the post-commit health failure; both restores execute real SQL.
          expect(await getSetting(db, 'restoreCommit', '')).toBe(restore.id)
          expect((await db.query<{ title: string }>("SELECT title FROM novels WHERE id='backup-novel'")).rows[0]!.title).not.toBe('补偿必须恢复的当前书名')
          checked = true
          throw new Error('fixture post-commit health failure')
        }
        return db.query(sql, params)
      },
      connect: () => db.connect(),
      end: () => db.end(),
    }
    await runBackupTick(failing)
    expect(checked).toBe(true)
    const task = (await db.query<{ state: string; result: string }>('SELECT state,result FROM backup_control.tasks WHERE id=$1', [restore.id])).rows[0]!
    expect(task.state).toBe('failed')
    const protectionId = JSON.parse(task.result).protectionId
    expect((await db.query<{ title: string }>("SELECT title FROM novels WHERE id='backup-novel'")).rows[0]!.title).toBe('补偿必须恢复的当前书名')
    expect(await getSetting(db, 'restoreCommit', '')).toBe(`${restore.id}:compensation`)
    expect(await getSetting(db, 'maintenance', true)).toBe(false)
    expect(JSON.parse(await readFile(path.join(root, 'restore-journal.json'), 'utf8'))).toMatchObject({
      taskId: restore.id,
      stage: 'compensated',
      protectionId,
    })
    expect((await db.query('SELECT id FROM backup_control.events WHERE task_id=$1', [restore.id])).rows.length).toBeGreaterThan(0)
    expect((await readFile(archivePath(protectionId))).length).toBeGreaterThan(0)
  }, 60000)
  it('补偿也失败时保持维护、保留保护归档，并阻止下一次 Worker 写入', async () => {
    const versionId = (await db.query<{ id: string }>('SELECT id FROM backup_control.versions WHERE protection=FALSE AND deleted=FALSE LIMIT 1')).rows[0]!.id
    const preview = await enqueue(db, 'preview', { operationId: 'manual-recovery-preview', versionId }, { id: 'backup-admin', name: '管理员' })
    await runBackupTick(db)
    const result = JSON.parse((await db.query<{ result: string }>('SELECT result FROM backup_control.tasks WHERE id=$1', [preview.id])).rows[0]!.result)
    const restore = await enqueue(
      db,
      'restore',
      {
        operationId: 'manual-recovery-restore',
        versionId,
        previewTaskId: preview.id,
        previewToken: result.previewToken,
      },
      { id: 'backup-admin', name: '管理员' },
    )
    const queued = await enqueue(db, 'backup', { operationId: 'blocked-after-compensation-failure', targetIds: [] }, { id: 'backup-admin', name: '管理员' })
    await db.query('UPDATE backup_control.tasks SET created_at=(SELECT created_at+1 FROM backup_control.tasks WHERE id=$2) WHERE id=$1', [
      queued.id,
      restore.id,
    ])
    let committed = false,
      compensationAttempted = false
    const failing: Db = {
      query: async (sql, params) => {
        if (sql === "SELECT count(*)::int AS count FROM public.users WHERE role='admin' AND status='active'") {
          expect(await getSetting(db, 'restoreCommit', '')).toBe(restore.id)
          committed = true
          throw new Error('fixture health failure')
        }
        if (committed && sql === "SELECT current_setting('server_version_num') AS version") {
          compensationAttempted = true
          throw new Error('fixture compensation connection failure')
        }
        return db.query(sql, params)
      },
      connect: () => db.connect(),
      end: () => db.end(),
    }
    try {
      await runBackupTick(failing)
      expect(compensationAttempted).toBe(true)
      const task = (
        await db.query<{ state: string; error: string; result: string }>('SELECT state,error,result FROM backup_control.tasks WHERE id=$1', [restore.id])
      ).rows[0]!
      expect(task.state).toBe('failed')
      expect(task.error).toContain('站点保持维护模式')
      expect(await getSetting(db, 'maintenance', false)).toBe(true)
      const protectionId = JSON.parse(task.result).protectionId
      expect((await readFile(archivePath(protectionId))).length).toBeGreaterThan(0)
      expect(JSON.parse(await readFile(path.join(root, 'restore-journal.json'), 'utf8'))).toMatchObject({ taskId: restore.id, stage: 'applying', protectionId })
      await expect(enqueue(db, 'backup', { operationId: 'rejected-during-maintenance' }, { id: 'backup-admin', name: '管理员' })).rejects.toThrow('正在恢复')
      await runBackupTick(db)
      expect((await db.query<{ state: string }>('SELECT state FROM backup_control.tasks WHERE id=$1', [queued.id])).rows[0]!.state).toBe('queued')
    } finally {
      await db.query("UPDATE backup_control.tasks SET state='cancelled' WHERE id=$1", [queued.id])
      // Only this disposable test cluster is released; production stays in maintenance.
      await setSetting(db, 'maintenance', false)
    }
  }, 60000)
  it('多个 Worker 互斥，自动调度补一次并按保留数量清理旧版本', async () => {
    const protectionBefore = (await db.query('SELECT id FROM backup_control.versions WHERE protection=TRUE AND deleted=FALSE')).rows
    await setSetting(db, 'policy', { ...defaultPolicy, enabled: true, localRetention: 1, nextRunAt: Date.now() - 86400000, revision: 8 })
    await Promise.all([runBackupTick(db), runBackupTick(db)])
    expect((await db.query('SELECT * FROM backup_control.schedule_runs WHERE revision=8')).rows).toHaveLength(1)
    await runBackupTick(db)
    expect(
      (await db.query("SELECT * FROM backup_control.versions WHERE deleted=FALSE AND protection=FALSE AND manifest!='' AND trigger='manual'")).rows,
    ).toHaveLength(0)
    expect((await db.query('SELECT id FROM backup_control.versions WHERE protection=TRUE AND deleted=FALSE')).rows).toEqual(
      expect.arrayContaining(protectionBefore),
    )
    expect((await db.query('SELECT id FROM backup_control.versions WHERE protection=TRUE AND deleted=FALSE')).rows).toHaveLength(protectionBefore.length)
    await setSetting(db, 'policy', defaultPolicy)
  })
  it.skipIf(!process.env.BACKUP_INTEGRATION_SFTP_HOST)(
    '真实 SFTP 上传、回读校验、远程取回及主机身份拒绝',
    async () => {
      const host = process.env.BACKUP_INTEGRATION_SFTP_HOST!
      vi.stubEnv('BACKUP_ALLOWED_HOSTS', '')
      await saveBackupSettings(db, { ...(await backupSettings(db)), hostSource: 'custom', allowedHosts: [host] })
      vi.stubEnv('BACKUP_RCLONE_PATH', process.env.BACKUP_INTEGRATION_RCLONE_PATH!)
      const key = (await readFile(process.env.BACKUP_INTEGRATION_SFTP_HOST_KEY!, 'utf8')).trim().split(' ').slice(0, 2).join(' ')
      const target = await saveTarget(db, {
        name: '隔离 SFTP',
        type: 'sftp',
        enabled: true,
        required: true,
        host,
        port: Number(process.env.BACKUP_INTEGRATION_SFTP_PORT || 55222),
        path: '/backups',
        username: 'backup',
        hostKey: key,
        password: 'fixture-password',
        retention: 30,
        bucket: '',
        region: '',
      })
      const test = await enqueue(db, 'test', { operationId: 'integration-sftp-test', targetId: target.id }, { id: 'backup-admin', name: '管理员' })
      await runBackupTick(db)
      const tested = await db.query<{ state: string; error: string }>('SELECT state,error FROM backup_control.tasks WHERE id=$1', [test.id])
      expect(tested.rows[0]!.error).toBe('')
      expect(tested.rows[0]!.state).toBe('completed')
      const task = await enqueue(db, 'backup', { operationId: 'integration-sftp-backup', targetIds: [target.id] }, { id: 'backup-admin', name: '管理员' })
      await runBackupTick(db)
      const copies = await db.query<{ state: string }>('SELECT state FROM backup_control.copies WHERE version_id=$1', [task.versionId])
      expect(copies.rows.map((row) => row.state)).toEqual(['available', 'available'])
      const stored = await db.query<{ manifest: string }>('SELECT manifest FROM backup_control.versions WHERE id=$1', [task.versionId]),
        manifest: Manifest = JSON.parse(stored.rows[0]!.manifest)
      await rm(archivePath(task.versionId))
      await ensureLocalArchive(db, task.versionId, manifest)
      expect((await readFile(archivePath(task.versionId))).length).toBe(manifest.size)
      const row = (
        await db.query<{ id: string; config: string; secret: string; revision: number }>('SELECT * FROM backup_control.targets WHERE id=$1', [target.id])
      ).rows[0]!
      const altered = {
        ...row,
        config: JSON.stringify({ ...JSON.parse(row.config), hostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZm' }),
      }
      await expect(testRemote(altered, db)).rejects.toThrow()
    },
    60000,
  )
  it('后台日志期限被 Worker 读取，恢复日志保留，任务锁拒绝配置变更', async () => {
    const current = await backupSettings(db)
    const client = await db.connect()
    try {
      await client.query('SELECT pg_advisory_lock(730047)')
      await expect(saveBackupSettings(db, { ...current, logRetentionDays: 7 })).rejects.toThrow('备份任务正在执行')
    } finally {
      await client.query('SELECT pg_advisory_unlock(730047)')
      client.release()
    }
    await saveBackupSettings(db, { ...current, logRetentionDays: 7 })
    await db.query(
      "INSERT INTO backup_control.events(task_id,level,message,created_at) VALUES('integration-old-backup','info','过期普通日志',$1),('integration-old-restore','info','恢复记录',$1)",
      [Date.now() - 8 * 86400000],
    )
    const task = await enqueue(db, 'backup', { operationId: 'integration-logs-settings', targetIds: [] }, { id: 'backup-admin', name: '管理员' })
    await db.query("UPDATE backup_control.events SET task_id=$1 WHERE task_id='integration-old-backup'", [task.id])
    const restore = (await db.query<{ id: string }>("SELECT id FROM backup_control.tasks WHERE kind='restore' LIMIT 1")).rows[0]!.id
    await db.query("UPDATE backup_control.events SET task_id=$1 WHERE task_id='integration-old-restore'", [restore])
    await runBackupTick(db)
    expect((await db.query("SELECT * FROM backup_control.events WHERE message='过期普通日志'")).rows).toHaveLength(0)
    expect((await db.query("SELECT * FROM backup_control.events WHERE message='恢复记录'")).rows).toHaveLength(1)
  })
  it('重启识别中断任务；恢复保持维护，不自动重放', async () => {
    const backup = await enqueue(db, 'backup', { operationId: 'integration-interrupted' }, { id: 'backup-admin', name: '管理员' })
    await db.query("UPDATE backup_control.tasks SET state='running',kind='restore' WHERE id=$1", [backup.id])
    await setSetting(db, 'maintenance', true)
    await runBackupTick(db)
    expect((await db.query<{ state: string }>('SELECT state FROM backup_control.tasks WHERE id=$1', [backup.id])).rows[0]!.state).toBe('interrupted')
    expect(await getSetting(db, 'maintenance', false)).toBe(true)
    await setSetting(db, 'maintenance', false)
    await setSetting(db, 'policy', defaultPolicy)
  })
})
