import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { Db } from '../../db/pool'
import { createRehearsalDatabase, rehearsalConnection, verifyRehearsalConnection } from './settings'
import { BACKUP_LOCK } from './config'

const url = process.env.BACKUP_CREATE_INTEGRATION_DATABASE_URL
describe.skipIf(!url)('真实 PostgreSQL 一键创建演练库（仅专用测试库）', () => {
  let pool: Pool,
    root: string,
    createdName = ''
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/backup_integration_rehearsal_create') throw new Error('Requires dedicated backup_integration_rehearsal_create database')
    root = await mkdtemp(path.join(tmpdir(), 'zz-create-rehearsal-integration-'))
    vi.stubEnv('BACKUP_CONFIG_FILE', path.join(root, 'backup-config.json'))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 28).toString('base64'))
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', '')
    vi.stubEnv('DATABASE_URL', url!)
    pool = new Pool({ connectionString: url })
    await pool.query(`CREATE SCHEMA backup_control;
CREATE TABLE backup_control.settings(key text PRIMARY KEY, value text NOT NULL, updated_at bigint NOT NULL);
CREATE TABLE public.business_sentinel(value text);
INSERT INTO public.business_sentinel VALUES ('业务数据保持不变');`)
  })
  afterAll(async () => {
    if (createdName && /^zhi_zhou_rehearsal_[a-f0-9]{16}$/.test(createdName)) await pool.query(`DROP DATABASE "${createdName}"`)
    if (pool) await pool.end()
    if (root) await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })
  it('执行任务持锁时拒绝创建', async () => {
    const task = await pool.connect()
    try {
      await task.query('SELECT pg_advisory_lock($1)', [BACKUP_LOCK])
      await expect(createRehearsalDatabase(pool as unknown as Db, 0)).rejects.toThrow('备份任务正在执行')
    } finally {
      await task.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK])
      task.release()
    }
  })
  it('真实低权限账号不具备 CREATEDB 时不创建数据库', async () => {
    await pool.query(`CREATE ROLE fixture_rehearsal_limited LOGIN NOCREATEDB;
GRANT USAGE ON SCHEMA backup_control TO fixture_rehearsal_limited;
GRANT SELECT ON backup_control.settings TO fixture_rehearsal_limited;`)
    const limitedUrl = new URL(url!)
    limitedUrl.username = 'fixture_rehearsal_limited'
    limitedUrl.password = ''
    const limited = new Pool({ connectionString: limitedUrl.toString() })
    vi.stubEnv('DATABASE_URL', limitedUrl.toString())
    try {
      await expect(createRehearsalDatabase(limited as unknown as Db, 0)).rejects.toThrow('CREATEDB')
      expect((await pool.query("SELECT datname FROM pg_database WHERE datname LIKE 'zhi_zhou_rehearsal_%'")).rows).toHaveLength(0)
    } finally {
      vi.stubEnv('DATABASE_URL', url!)
      await limited.end()
      await pool.query('DROP OWNED BY fixture_rehearsal_limited; DROP ROLE fixture_rehearsal_limited;')
    }
  })
  it('创建独立空库并初始化标记，验证加密配置和业务库完整性', async () => {
    const result = await createRehearsalDatabase(pool as unknown as Db, 0)
    const connection = await rehearsalConnection(pool as unknown as Db)
    createdName = new URL(connection).pathname.slice(1)
    expect(createdName).toMatch(/^zhi_zhou_rehearsal_[a-f0-9]{16}$/)
    await verifyRehearsalConnection(pool as unknown as Db, connection)
    const shadow = new Pool({ connectionString: connection })
    try {
      expect((await shadow.query("SELECT value FROM backup_rehearsal.guard WHERE key='purpose'")).rows[0].value).toBe('zhi-zhou-backup-rehearsal')
      expect((await shadow.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows).toHaveLength(0)
    } finally {
      await shadow.end()
    }
    expect((await pool.query('SELECT value FROM business_sentinel')).rows[0].value).toBe('业务数据保持不变')
    const stored = (await pool.query("SELECT value FROM backup_control.settings WHERE key='runtime'")).rows[0].value
    expect(stored).not.toContain(connection)
    expect(result).toMatchObject({ revision: 1, rehearsalSource: 'custom', rehearsalConfigured: true })
    await expect(createRehearsalDatabase(pool as unknown as Db, 1)).rejects.toThrow('已配置演练数据库')
  })
})
