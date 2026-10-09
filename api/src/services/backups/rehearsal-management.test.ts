import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTestDb, type TestDb } from '../../test/db'
import type { Db } from '../../db/pool'
import { seal } from './config'
import { setSetting } from './store'
import { backupSettings, rehearsalInfo, checkRehearsalConnection, removeRehearsalConnection } from './settings'

const mock = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), end: vi.fn() }))
vi.mock('pg', async (original) => ({
  ...(await original<typeof import('pg')>()),
  Pool: class {
    constructor(options: unknown) {
      return mock.pool(options)
    }
  },
}))
let fixture: TestDb,
  db: Db,
  root: string,
  locked = true
const url = 'postgresql://fixture:private-secret@database:5432/shadow'
const stored = () => ({
  revision: 4,
  hostSource: 'custom',
  allowedHosts: ['backup.example.com'],
  rehearsalSource: 'custom',
  rehearsalSecret: seal(url),
  rehearsalLabel: 'database:5432/shadow',
  retryLimit: 1,
  logRetentionDays: 90,
})
beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'zz-rehearsal-management-'))
  vi.stubEnv('BACKUP_CONFIG_FILE', path.join(root, 'config.json'))
  vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 27).toString('base64'))
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:private-secret@database/library')
  fixture = await createTestDb()
  await fixture.applyMigrations()
  db = {
    ...fixture.db,
    async connect() {
      const client = await fixture.db.connect()
      return {
        release: () => client.release(),
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] as any, rowCount: 1 }
          if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 }
          if (sql.includes('current_database')) return { rows: [{ name: 'library' }] as any, rowCount: 1 }
          return client.query(sql, params)
        },
      }
    },
  }
})
afterAll(async () => {
  await fixture.close()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})
beforeEach(async () => {
  vi.resetAllMocks()
  locked = true
  vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', '')
  await db.query('DELETE FROM backup_control.settings')
  await db.query('DELETE FROM backup_control.tasks')
  await setSetting(db, 'runtime', stored())
  mock.pool.mockReturnValue({ query: mock.query, end: mock.end })
  mock.end.mockResolvedValue(undefined)
  mock.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('current_database') ? [{ name: 'shadow' }] : [{ value: 'zhi-zhou-backup-rehearsal' }],
    rowCount: 1,
  }))
})
async function task(id: string, state: string, label?: string) {
  await db.query(
    "INSERT INTO backup_control.tasks(id,kind,state,actor,operation_id,request_hash,created_at,finished_at,result) VALUES($1,'preview',$2,'管理员',$1,'fixture',1,2,$3)",
    [id, state, JSON.stringify(label ? { rehearsalLabel: label } : {})],
  )
}
describe('演练库信息、连接检查与解绑', () => {
  it('信息读取不连接目标、不泄露凭据，预检只匹配当前库', async () => {
    await task('other', 'completed', 'database/other')
    await task('legacy', 'completed')
    expect((await rehearsalInfo(db)).lastPreview).toBeNull()
    await task('current', 'completed', 'database:5432/shadow')
    const info = await rehearsalInfo(db)
    expect(info).toMatchObject({
      host: 'database',
      port: '5432',
      database: 'shadow',
      source: 'custom',
      connectionStatus: 'unchecked',
      lastPreview: { taskId: 'current', state: 'completed' },
    })
    expect(JSON.stringify(info)).not.toContain('private-secret')
    expect(JSON.stringify(info)).not.toContain('fixture')
    expect(mock.pool).not.toHaveBeenCalled()
  })
  it('连接检查只读身份与保护标记，并持久化检查时间', async () => {
    const before = await backupSettings(db)
    const info = await checkRehearsalConnection(db, 4)
    expect(info).toMatchObject({ connectionStatus: 'connected', guardStatus: 'valid', error: '' })
    expect(info.checkedAt).toBeGreaterThan(0)
    expect(await rehearsalInfo(db)).toEqual(info)
    expect(await backupSettings(db)).toEqual(before)
    expect(mock.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true)
    expect(mock.end).toHaveBeenCalledOnce()
  })
  it.each(['connection', 'marker', 'identity'])('%s 异常区分连接和标记状态，并隐藏原始错误', async (failure) => {
    mock.query.mockImplementation(async (sql: string) => {
      if (failure === 'connection' || (failure === 'marker' && sql.includes('guard'))) throw new Error(url)
      return { rows: [{ name: failure === 'identity' ? 'library' : 'shadow' }] }
    })
    const info = await checkRehearsalConnection(db, 4)
    expect(info.connectionStatus).toBe(failure === 'connection' ? 'unavailable' : 'connected')
    expect(info.guardStatus).toBe(failure === 'marker' ? 'invalid' : 'unchecked')
    expect(info.error).toBeTruthy()
    expect(JSON.stringify(info)).not.toContain('private-secret')
    expect(mock.end).toHaveBeenCalledOnce()
  })
  it('标记值不匹配时拒绝报告可用于恢复', async () => {
    mock.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('current_database') ? [{ name: 'shadow' }] : [{ value: 'wrong' }] }))
    expect(await checkRehearsalConnection(db, 4)).toMatchObject({
      connectionStatus: 'connected',
      guardStatus: 'invalid',
      error: expect.stringContaining('保护标记'),
    })
  })
  it.each(['custom', 'environment'])('移除 %s 配置保留其他设置和部署变量，不访问演练库', async (source) => {
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', url)
    await setSetting(db, 'runtime', { ...stored(), rehearsalSource: source })
    const result = await removeRehearsalConnection(db, 4)
    expect(result).toMatchObject({
      revision: 5,
      rehearsalSource: 'disabled',
      rehearsalConfigured: false,
      retryLimit: 1,
      logRetentionDays: 90,
      allowedHosts: ['backup.example.com'],
    })
    const row = (await db.query<{ value: string }>("SELECT value FROM backup_control.settings WHERE key='runtime'")).rows[0]!
    expect(JSON.parse(row.value)).toMatchObject({ rehearsalSecret: '', rehearsalLabel: '' })
    expect(process.env.BACKUP_REHEARSAL_DATABASE_URL).toBe(url)
    expect((await backupSettings(db)).rehearsalConfigured).toBe(false)
    expect(mock.pool).not.toHaveBeenCalled()
  })
  it.each(['lock', 'maintenance', 'revision', 'queued'])('%s 条件阻止解绑并保留凭据', async (condition) => {
    if (condition === 'lock') locked = false
    if (condition === 'maintenance') await setSetting(db, 'maintenance', true)
    if (condition === 'queued') await task('pending-preview', 'queued')
    await expect(removeRehearsalConnection(db, condition === 'revision' ? 3 : 4)).rejects.toThrow()
    expect((await backupSettings(db)).rehearsalConfigured).toBe(true)
    expect(mock.pool).not.toHaveBeenCalled()
  })
  it('环境连接变更后，不沿用之前的检查结果', async () => {
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', url)
    await setSetting(db, 'runtime', { ...stored(), rehearsalSource: 'environment' })
    await checkRehearsalConnection(db, 4)
    vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', url.replace('/shadow', '/new-shadow'))
    expect(await rehearsalInfo(db)).toMatchObject({ database: 'new-shadow', checkedAt: 0, connectionStatus: 'unchecked' })
  })
})
