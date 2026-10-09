import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Db } from '../../db/pool'
import { createRehearsalDatabase } from './settings'
import { unseal } from './config'

const mock = vi.hoisted(() => ({ pool: vi.fn(), server: vi.fn(), shadow: vi.fn(), end: vi.fn() }))
vi.mock('pg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pg')>()),
  Pool: class {
    constructor(options: { connectionString: string }) {
      return mock.pool(options)
    }
  },
}))
let dir: string, current: Record<string, unknown> | undefined, maintenance: boolean, locked: boolean
const query = vi.fn(),
  release = vi.fn()
const db = { connect: async () => ({ query, release }) } as unknown as Db
const rows = (value: unknown[] = []) => ({ rows: value, rowCount: value.length })
beforeEach(() => {
  vi.resetAllMocks()
  mock.end.mockResolvedValue(undefined)
  dir = mkdtempSync(path.join(tmpdir(), 'zz-rehearsal-create-'))
  vi.stubEnv('BACKUP_CONFIG_FILE', path.join(dir, 'config.json'))
  vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 21).toString('base64'))
  vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', '')
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:private@database:5432/library')
  current = undefined
  maintenance = false
  locked = true
  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('pg_try_advisory_lock')) return rows([{ locked }])
    if (sql.includes("key='maintenance'")) return rows([{ value: String(maintenance) }])
    if (sql.includes("key='runtime'")) return rows(current ? [{ value: JSON.stringify(current) }] : [])
    if (sql.startsWith('INSERT INTO backup_control.settings')) current = JSON.parse(params![0] as string)
    if (sql.includes('current_database')) return rows([{ name: 'library' }])
    return rows()
  })
  mock.server.mockImplementation(async (sql: string) => (sql.includes('rolcreatedb') ? rows([{ allowed: true }]) : rows()))
  mock.pool.mockImplementation(({ connectionString }: { connectionString: string }) => {
    const name = new URL(connectionString).pathname.slice(1)
    if (name === 'library') return { query: mock.server, end: mock.end }
    return { query: (sql: string) => mock.shadow(sql, name), end: mock.end }
  })
  mock.shadow.mockImplementation(async (sql: string, name: string) =>
    sql.includes('current_database') ? rows([{ name }]) : sql.includes('SELECT value') ? rows([{ value: 'zhi-zhou-backup-rehearsal' }]) : rows(),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('一键创建演练库', () => {
  it('新建随机命名的空库、初始化并加密保存，不修改其他设置', async () => {
    current = {
      revision: 4,
      hostSource: 'custom',
      allowedHosts: ['backup.example.com'],
      rehearsalSource: 'disabled',
      rehearsalSecret: '',
      rehearsalLabel: '',
      retryLimit: 1,
      logRetentionDays: 365,
    }
    const result = await createRehearsalDatabase(db, 4)
    expect(result).toMatchObject({
      revision: 5,
      rehearsalSource: 'custom',
      rehearsalConfigured: true,
      retryLimit: 1,
      logRetentionDays: 365,
      allowedHosts: ['backup.example.com'],
    })
    const sql = mock.server.mock.calls.find(([sql]) => sql.startsWith('CREATE DATABASE'))![0]
    expect(sql).toMatch(/^CREATE DATABASE "zhi_zhou_rehearsal_[a-f0-9]{16}" TEMPLATE template0$/)
    expect(mock.shadow.mock.calls.some(([sql]) => sql.includes('CREATE SCHEMA backup_rehearsal'))).toBe(true)
    const saved = unseal<string>(current!.rehearsalSecret as string)
    expect(new URL(saved).pathname).toMatch(/^\/zhi_zhou_rehearsal_[a-f0-9]{16}$/)
    expect(JSON.stringify(current)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(true)
    expect(release).toHaveBeenCalledOnce()
  })
  it.each(['maintenance', 'busy', 'revision', 'configured', 'key'] as const)('%s 条件不满足时不建库', async (condition) => {
    if (condition === 'maintenance') maintenance = true
    if (condition === 'busy') locked = false
    if (condition === 'configured') vi.stubEnv('BACKUP_REHEARSAL_DATABASE_URL', 'postgresql://fixture:private@database/other')
    if (condition === 'key') vi.stubEnv('BACKUP_ENCRYPTION_KEY', '')
    await expect(createRehearsalDatabase(db, condition === 'revision' ? 1 : 0)).rejects.toThrow()
    expect(mock.pool).not.toHaveBeenCalled()
    expect(current).toBeUndefined()
    expect(release).toHaveBeenCalledOnce()
  })
  it('缺少 CREATEDB 权限时明确报错且不尝试建库', async () => {
    mock.server.mockResolvedValue(rows([{ allowed: false }]))
    await expect(createRehearsalDatabase(db, 0)).rejects.toThrow('CREATEDB')
    expect(mock.server.mock.calls.some(([sql]) => sql.startsWith('CREATE DATABASE'))).toBe(false)
  })
  it('新库初始化失败时只清理本次成功创建的库', async () => {
    mock.shadow.mockImplementation(async (sql: string, name: string) => {
      if (sql.includes('CREATE SCHEMA')) throw new Error('fixture failure')
      return rows([{ name }])
    })
    await expect(createRehearsalDatabase(db, 0)).rejects.toThrow('创建失败')
    const created = mock.server.mock.calls.find(([sql]) => sql.startsWith('CREATE DATABASE'))![0].match(/"([^"]+)"/)![1]
    expect(mock.server).toHaveBeenCalledWith(`DROP DATABASE "${created}"`)
    expect(current).toBeUndefined()
  })
  it('目标身份不匹配时不写入任何保护标记', async () => {
    mock.shadow.mockResolvedValue(rows([{ name: 'library' }]))
    await expect(createRehearsalDatabase(db, 0)).rejects.toThrow('未指向新建演练库')
    expect(mock.shadow.mock.calls.some(([sql]) => sql.includes('CREATE SCHEMA'))).toBe(false)
  })
  it('建库冲突时不删除已有库', async () => {
    mock.server.mockImplementation(async (sql: string) => {
      if (sql.startsWith('CREATE DATABASE')) throw Object.assign(new Error(), { code: '42P04' })
      return rows([{ allowed: true }])
    })
    await expect(createRehearsalDatabase(db, 0)).rejects.toThrow()
    expect(mock.server.mock.calls.some(([sql]) => sql.startsWith('DROP DATABASE'))).toBe(false)
  })
  it('配置写入结果不确定时保留新库并提示刷新', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT')) throw new Error('network')
      if (sql.includes('pg_try')) return rows([{ locked: true }])
      if (sql.includes('current_database')) return rows([{ name: 'library' }])
      return rows()
    })
    await expect(createRehearsalDatabase(db, 0)).rejects.toThrow('请刷新检查')
    expect(mock.server.mock.calls.some(([sql]) => sql.startsWith('DROP DATABASE'))).toBe(false)
  })
})
