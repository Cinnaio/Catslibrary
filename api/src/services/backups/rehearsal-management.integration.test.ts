import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Db } from '../../db/pool'
import { BACKUP_LOCK } from './config'
import { createRehearsalDatabase, rehearsalConnection, rehearsalInfo, checkRehearsalConnection, removeRehearsalConnection } from './settings'

const url = process.env.BACKUP_REHEARSAL_MANAGEMENT_INTEGRATION_DATABASE_URL
describe.skipIf(!url)('真实 PostgreSQL 演练库管理（仅专用测试库）', () => {
  let pool: Pool,
    root: string,
    shadowUrl = '',
    createdName = ''
  beforeAll(async () => {
    if (!/^\/backup_integration_rehearsal_management_[a-f0-9]{8}$/.test(new URL(url!).pathname))
      throw new Error('Requires dedicated rehearsal management test database')
    root = await mkdtemp(path.join(tmpdir(), 'zz-rehearsal-management-integration-'))
    vi.stubEnv('BACKUP_CONFIG_FILE', path.join(root, 'config.json'))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 29).toString('base64'))
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', '')
    vi.stubEnv('DATABASE_URL', url!)
    pool = new Pool({ connectionString: url })
    await pool.query(`CREATE SCHEMA backup_control;
CREATE TABLE backup_control.settings(key text PRIMARY KEY, value text NOT NULL, updated_at bigint NOT NULL);
CREATE TABLE backup_control.tasks(id text PRIMARY KEY, kind text, state text, result text, created_at bigint, finished_at bigint);
CREATE TABLE public.business_sentinel(value text);
INSERT INTO public.business_sentinel VALUES ('业务数据保持不变');`)
  })
  afterAll(async () => {
    if (createdName && /^zhi_zhou_rehearsal_[a-f0-9]{16}$/.test(createdName)) await pool.query(`DROP DATABASE "${createdName}"`)
    if (pool) await pool.end()
    if (root) await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })
  it('真实建库后只读检查连接和保护标记，业务与演练数据均保留', async () => {
    await createRehearsalDatabase(pool as unknown as Db, 0)
    shadowUrl = await rehearsalConnection(pool as unknown as Db)
    createdName = new URL(shadowUrl).pathname.slice(1)
    const shadow = new Pool({ connectionString: shadowUrl })
    try {
      await shadow.query("CREATE TABLE public.rehearsal_sentinel(value text); INSERT INTO public.rehearsal_sentinel VALUES ('演练数据保持不变')")
      const info = await checkRehearsalConnection(pool as unknown as Db, 1)
      expect(info).toMatchObject({ database: createdName, connectionStatus: 'connected', guardStatus: 'valid', error: '' })
      expect(await rehearsalInfo(pool as unknown as Db)).toEqual(info)
      expect((await shadow.query('SELECT value FROM public.rehearsal_sentinel')).rows[0].value).toBe('演练数据保持不变')
      expect((await pool.query('SELECT value FROM public.business_sentinel')).rows[0].value).toBe('业务数据保持不变')
    } finally {
      await shadow.end()
    }
  })
  it('真实任务锁拒绝解绑，解锁后仅清除配置并保留演练库', async () => {
    const lock = await pool.connect()
    try {
      await lock.query('SELECT pg_advisory_lock($1)', [BACKUP_LOCK])
      await expect(removeRehearsalConnection(pool as unknown as Db, 1)).rejects.toThrow('备份任务正在执行')
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK])
      lock.release()
    }
    const result = await removeRehearsalConnection(pool as unknown as Db, 1)
    expect(result).toMatchObject({ rehearsalConfigured: false, rehearsalSource: 'disabled', revision: 2 })
    expect((await pool.query('SELECT datname FROM pg_database WHERE datname=$1', [createdName])).rows).toHaveLength(1)
    const shadow = new Pool({ connectionString: shadowUrl })
    try {
      expect((await shadow.query('SELECT value FROM public.rehearsal_sentinel')).rows[0].value).toBe('演练数据保持不变')
      expect((await shadow.query("SELECT value FROM backup_rehearsal.guard WHERE key='purpose'")).rows[0].value).toBe('zhi-zhou-backup-rehearsal')
    } finally {
      await shadow.end()
    }
  })
})
