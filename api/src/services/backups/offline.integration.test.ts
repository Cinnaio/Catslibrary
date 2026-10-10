import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Db } from '../../db/pool'
import { runMigrations } from '../../db/migrate'
import { archivePath, generateArchive, versionDirectory, type Manifest } from './archive'
import { getSetting, setSetting } from './store'

const sourceUrl = process.env.BACKUP_OFFLINE_INTEGRATION_DATABASE_URL
const targetUrl = process.env.BACKUP_OFFLINE_INTEGRATION_TARGET_URL
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const exec = promisify(execFile)
describe.skipIf(!sourceUrl || !targetUrl)('真实 PostgreSQL 部署侧灾备恢复（仅专用测试库）', () => {
  let source: Pool, target: Pool, root: string, manifest: Manifest
  beforeAll(async () => {
    if (new URL(sourceUrl!).pathname !== '/backup_integration_offline' || new URL(targetUrl!).pathname !== '/backup_integration_offline_target')
      throw new Error('Requires dedicated offline recovery databases')
    root = await mkdtemp(path.join(tmpdir(), 'zz-offline-integration-'))
    vi.stubEnv('BACKUP_ROOT', path.join(root, 'source'))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 39).toString('base64'))
    vi.stubEnv('DATABASE_URL', sourceUrl!)
    source = new Pool({ connectionString: sourceUrl })
    target = new Pool({ connectionString: targetUrl })
    await runMigrations(source as unknown as Db)
    await source.query(
      "INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('offline-admin','offline-admin','admin','test','test',1,1)",
    )
    await source.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('offline-novel','灾备小说',1,1)")
    await source.query("INSERT INTO chapters(id,novel_id,title,content,created_at) VALUES('offline-chapter','offline-novel','第一章','灾备原始正文',1)")
    await source.query("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES('offline-session','offline-admin',9999999999999,1)")
    manifest = await generateArchive(source as unknown as Db, 'offline-fixture', 'offline-site')
  }, 60000)
  afterAll(async () => {
    if (source) await source.end()
    if (target) await target.end()
    if (root) await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })
  const recover = (args: string[]) =>
    exec(
      process.execPath,
      [
        path.join(repo, 'node_modules/tsx/dist/cli.mjs'),
        '--tsconfig',
        path.join(repo, 'api/tsconfig.json'),
        path.join(repo, 'api/scripts/backup-recovery.ts'),
        '--offline',
        '--manifest',
        path.join(versionDirectory(manifest.id), 'manifest.json'),
        '--archive',
        archivePath(manifest.id),
        ...args,
      ],
      { env: { ...process.env, DATABASE_URL: targetUrl!, BACKUP_ROOT: path.join(root, 'target') }, timeout: 60000 },
    ).then((result) => result.stdout)
  it('确认版本不匹配时拒绝，并保留空目标库', async () => {
    await expect(recover(['--empty-database', '--confirm', 'wrong-version'])).rejects.toThrow('--confirm 必须')
    expect((await target.query("SELECT tablename FROM pg_tables WHERE schemaname IN ('public','backup_control')")).rows).toHaveLength(0)
  })
  it('空库恢复真实归档、初始化控制区并失效会话', async () => {
    await expect(recover(['--empty-database', '--confirm', manifest.id])).resolves.toContain('恢复完成')
    expect((await target.query("SELECT content FROM chapters WHERE id='offline-chapter'")).rows[0].content).toBe('灾备原始正文')
    expect((await target.query('SELECT * FROM user_sessions')).rows).toHaveLength(0)
    expect((await target.query("SELECT * FROM backup_control.tasks WHERE state='completed'")).rows).toHaveLength(1)
    expect(await getSetting(target as unknown as Db, 'maintenance', true)).toBe(false)
    expect(JSON.parse(await readFile(path.join(root, 'target', 'restore-journal.json'), 'utf8')).stage).toBe('completed')
    expect((await source.query('SELECT * FROM user_sessions')).rows).toHaveLength(1)
  }, 60000)
  it('维护中离线恢复已有库，先生成可用保护版本并保留历史日志', async () => {
    await target.query("UPDATE novels SET title='需要保护的灾备前修改' WHERE id='offline-novel'")
    await target.query("INSERT INTO backup_control.events(task_id,level,message,created_at) VALUES('interrupted-fixture','info','中断前控制日志',1)")
    await setSetting(target as unknown as Db, 'maintenance', true)
    await expect(recover(['--confirm', manifest.id])).resolves.toContain('恢复完成')
    expect((await target.query("SELECT title FROM novels WHERE id='offline-novel'")).rows[0].title).toBe('灾备小说')
    expect((await target.query("SELECT * FROM backup_control.events WHERE message='中断前控制日志'")).rows).toHaveLength(1)
    const protection = (await target.query<{ id: string; manifest: string }>('SELECT id,manifest FROM backup_control.versions WHERE protection=TRUE')).rows[0]!
    expect(protection.id).toMatch(/^protection_/)
    expect((await readFile(path.join(root, 'target', 'versions', protection.id, 'archive.zzbackup'))).length).toBe(JSON.parse(protection.manifest).size)
    expect(await getSetting(target as unknown as Db, 'maintenance', true)).toBe(false)
    expect(JSON.parse(await readFile(path.join(root, 'target', 'restore-journal.json'), 'utf8'))).toMatchObject({
      stage: 'completed',
      protectionId: protection.id,
    })
  }, 60000)
})
