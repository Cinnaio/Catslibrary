import { Pool } from 'pg'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Db } from '../../db/pool'
import { runMigrations } from '../../db/migrate'
import { enqueue, setSetting } from './store'
import { generateRestoreImpact, restoreImpactReport, checkRestoreImpactFreshness } from './impact'
import { liveImpactFingerprint } from './impact-snapshot'
import { currentMigration, type Manifest } from './archive'

const url = process.env.BACKUP_IMPACT_INTEGRATION_DATABASE_URL
const shadowUrl = process.env.BACKUP_IMPACT_INTEGRATION_REHEARSAL_URL
describe.skipIf(!url || !shadowUrl)('真实 PostgreSQL 回滚影响报告（仅专用测试库）', () => {
  let live: Pool, shadow: Pool, db: Db, target: Db, root: string, taskId: string, versionId: string
  beforeAll(async () => {
    if (!/^\/backup_integration_impact_[a-f0-9]{8}$/.test(new URL(url!).pathname) || new URL(shadowUrl!).pathname !== new URL(url!).pathname + '_shadow')
      throw new Error('Requires dedicated impact test databases')
    root = await mkdtemp(path.join(tmpdir(), 'zz-impact-integration-'))
    vi.stubEnv('BACKUP_CONFIG_FILE', path.join(root, 'config.json'))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 31).toString('base64'))
    vi.stubEnv('DATABASE_URL', url!)
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', shadowUrl!)
    live = new Pool({ connectionString: url })
    shadow = new Pool({ connectionString: shadowUrl })
    db = live as unknown as Db
    target = shadow as unknown as Db
    await runMigrations(db)
    await runMigrations(target)
    for (const pool of [live, shadow]) {
      await pool.query(
        "INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('admin','管理员','admin',$1,'private-salt',1,1)",
        [pool === live ? 'current-private-hash' : 'target-private-hash'],
      )
      await pool.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('same',$1,1,1),($2,$3,1,1)", [
        pool === live ? '当前书名' : '恢复书名',
        pool === live ? 'remove' : 'add',
        pool === live ? '线上独有小说' : '备份独有小说',
      ])
      await pool.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('time-only','仅时间变化的小说',1,1)")
      await pool.query("INSERT INTO chapters(id,novel_id,title,content,created_at) VALUES('chapter','same','第一章',$1,1)", [
        pool === live ? '当前私密正文' : '备份私密正文',
      ])
      await pool.query("INSERT INTO novel_covers(novel_id,data,updated_at) VALUES('same',$1,1)", [Buffer.alloc(pool === live ? 3 : 5, 7)])
      await pool.query("INSERT INTO app_settings(key,value,updated_at) VALUES('site_turnstile',$1,1),('site_branding',$2,1)", [
        JSON.stringify({ secret: pool === live ? 'current-private-token' : 'target-private-token' }),
        JSON.stringify({ name: pool === live ? '当前站点' : '恢复站点', unknownSecret: 'private-branding-field' }),
      ])
      await pool.query("CREATE TABLE public.no_primary_key(value text); INSERT INTO public.no_primary_key VALUES('同一记录'),('同一记录')")
    }
    await live.query("INSERT INTO public.no_primary_key VALUES('同一记录')")
    await live.query("UPDATE novels SET updated_at=9 WHERE id='time-only'")
    await live.query('CREATE TABLE public.live_empty_table(value text)')
    await live.query("UPDATE novels SET description='private-description',updated_at=8,update_checked_at=9,remote_chapter_count=10 WHERE id='same'")
    const backup = await enqueue(db, 'backup', { operationId: 'impact-backup-fixture', targetIds: [] }, { id: 'admin', name: '管理员' })
    versionId = backup.versionId
    const manifest = { id: versionId, digest: 'fixture-digest', migrationVersion: await currentMigration(db) } as Manifest
    await live.query('UPDATE backup_control.versions SET manifest=$2,digest=$3 WHERE id=$1', [versionId, JSON.stringify(manifest), manifest.digest])
    const task = await enqueue(db, 'preview', { operationId: 'impact-preview-fixture', versionId }, { id: 'admin', name: '管理员' })
    taskId = task.id
    const impact = await generateRestoreImpact(db, target, { id: taskId, actor_id: 'admin' }, manifest)
    const report = await restoreImpactReport(db, taskId, '', '', 20, 0)
    await live.query("UPDATE backup_control.tasks SET state='completed',result=$2 WHERE id=$1", [
      taskId,
      JSON.stringify({ impact, previewToken: 'fixture-token', expiresAt: report.expiresAt, migration: manifest.migrationVersion }),
    ])
  }, 60000)
  afterAll(async () => {
    if (live) await live.end()
    if (shadow) await shadow.end()
    if (root) await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })
  it('新增/修改/移除以回滚方向统计，正文、密码及密钥不进入报告或详情存储', async () => {
    const report = await restoreImpactReport(db, taskId, '', '', 100, 0)
    expect(report.summary.groups.novels).toMatchObject({ current: 3, restored: 3, added: 1, modified: 2, removed: 1 })
    expect(report.items.items.find((row) => row.table === 'novels' && row.change === 'modify')?.changedFields).toEqual(
      expect.arrayContaining(['书名', '简介', '更新时间', '最近更新检查时间', '来源章节总数']),
    )
    expect(report.items.items.find((row) => row.table === 'users')?.changedFields).toContain('密码认证信息（内容隐藏）')
    expect(report.items.items.find((row) => row.table === 'novel_covers')?.changedFields).toContain('图片内容')
    expect(report.items.items.find((row) => row.name === '仅时间变化的小说')?.changedFields).toEqual(['更新时间'])
    expect(report.summary.groups.chapters).toMatchObject({ modified: 1 })
    expect(report.items.items.find((row) => row.table === 'chapters')?.changedFields).toContain('正文内容')
    expect(report.summary.groups.users.modified).toBe(1)
    expect(report.summary.groups.assets).toMatchObject({ currentBytes: 3, restoredBytes: 5, modified: 1 })
    const serialized = JSON.stringify(report) + JSON.stringify((await live.query('SELECT data FROM backup_control.restore_impact_items')).rows)
    for (const secret of [
      '当前私密正文',
      '备份私密正文',
      'private-hash',
      'private-salt',
      'private-token',
      'private-branding-field',
      'private-description',
      'field_signatures',
    ])
      expect(serialized).not.toContain(secret)
    expect(serialized).toContain('当前站点')
    expect(serialized).toContain('恢复站点')
    expect(report.summary.schemaChanges).toContainEqual({ table: 'live_empty_table', change: 'remove' })
    expect(report.summary.tables.find((table) => table.name === 'no_primary_key')).toMatchObject({ removed: 1, stableIds: false })
  })
  it('详情筛选与分页稳定，不一次返回全量记录', async () => {
    const first = await restoreImpactReport(db, taskId, 'novels', '', 1, 0),
      second = await restoreImpactReport(db, taskId, 'novels', '', 1, 1)
    expect(first.items.total).toBe(4)
    expect(first.items.items).toHaveLength(1)
    expect(second.items.items[0]?.sequence).not.toBe(first.items.items[0]?.sequence)
    expect((await restoreImpactReport(db, taskId, 'novels', 'remove', 20, 0)).items.items[0]?.name).toBe('线上独有小说')
    await expect(restoreImpactReport(db, taskId, 'invalid', '', 20, 0)).rejects.toThrow('筛选条件')
  })
  it('重复扫描结果一致，读取报告不改动业务数据', async () => {
    const stored = (await live.query('SELECT live_fingerprint FROM backup_control.restore_impacts WHERE task_id=$1', [taskId])).rows[0].live_fingerprint
    expect(await liveImpactFingerprint(db)).toBe(stored)
    expect(await liveImpactFingerprint(db)).toBe(stored)
    expect((await live.query("SELECT title FROM novels WHERE id='same'")).rows[0].title).toBe('当前书名')
    expect(await checkRestoreImpactFreshness(db, taskId, 'admin', versionId)).toMatchObject({ fresh: true })
  })
  it('差异详情写入失败不发布半份报告，清理明细并拒绝继续回滚', async () => {
    const task = await enqueue(db, 'preview', { operationId: 'failed-impact-preview', versionId }, { id: 'admin', name: '管理员' })
    const manifest = JSON.parse((await live.query('SELECT manifest FROM backup_control.versions WHERE id=$1', [versionId])).rows[0].manifest) as Manifest
    const failing: Db = {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO backup_control.restore_impact_items')) throw new Error('private-database-error')
        return db.query(sql, params)
      },
      connect: () => db.connect(),
      end: () => db.end(),
    }
    await expect(generateRestoreImpact(failing, target, { id: task.id, actor_id: 'admin' }, manifest)).rejects.toThrow('回滚影响分析未完成')
    expect((await live.query('SELECT state FROM backup_control.restore_impacts WHERE task_id=$1', [task.id])).rows[0].state).toBe('failed')
    expect((await live.query('SELECT * FROM backup_control.restore_impact_items WHERE task_id=$1', [task.id])).rows).toHaveLength(0)
    await expect(restoreImpactReport(db, task.id, '', '', 20, 0)).rejects.toThrow('没有完整')
    await expect(checkRestoreImpactFreshness(db, task.id, 'admin', versionId)).rejects.toThrow('没有完整')
  })
  it('自身操作审计和会话变化不导致报告过期，真正业务变化会使其失效', async () => {
    await live.query("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES('private-session','admin',9999999999999,1)")
    await live.query("UPDATE users SET last_login_at=7 WHERE id='admin'")
    await live.query("INSERT INTO login_failures(key_hash,created_at) VALUES('private-request',1)")
    expect(await checkRestoreImpactFreshness(db, taskId, 'admin', versionId)).toMatchObject({ fresh: true })
    await live.query("UPDATE chapters SET content='预检后的正文变化' WHERE id='chapter'")
    expect(await checkRestoreImpactFreshness(db, taskId, 'admin', versionId)).toMatchObject({ fresh: false })
  })
  it('报告绑定发起管理员、时效和设置版本，不允许跨人或旧配置恢复', async () => {
    await expect(checkRestoreImpactFreshness(db, taskId, 'other-admin', versionId)).rejects.toThrow('发起预检')
    await setSetting(db, 'runtime', {
      revision: 1,
      hostSource: 'environment',
      allowedHosts: [],
      rehearsalSource: 'environment',
      rehearsalSecret: '',
      rehearsalLabel: '',
      retryLimit: 3,
      logRetentionDays: 180,
    })
    await expect(checkRestoreImpactFreshness(db, taskId, 'admin', versionId)).rejects.toThrow('过期')
    await live.query("DELETE FROM backup_control.settings WHERE key='runtime'")
    await live.query('UPDATE backup_control.restore_impacts SET expires_at=1 WHERE task_id=$1', [taskId])
    await expect(checkRestoreImpactFreshness(db, taskId, 'admin', versionId)).rejects.toThrow('过期')
  })
})
