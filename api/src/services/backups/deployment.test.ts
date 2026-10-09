import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Db } from '../../db/pool'
import { prepareDeploymentFile, readDeploymentFile, writeDeploymentFile } from './deployment-file'
import { backupKey, seal, unseal } from './config'
import { resolvedTool } from './process'
import { configureDeployment, deploymentView } from './deployment'
import { createHash, createHmac } from 'node:crypto'

const mock = vi.hoisted(() => ({ command: vi.fn() }))
vi.mock('./process', async (importOriginal) => ({ ...(await importOriginal<typeof import('./process')>()), command: mock.command }))
let dir: string
const emptyTools = { dump: '', restore: '', psql: '', transfer: '' }
const key = Buffer.alloc(32, 19).toString('base64')
const input = () => ({ revision: 0, tools: { ...emptyTools }, password: 'not-persisted' })
const query = vi.fn(async (sql: string) => ({ rows: sql.includes('pg_try') ? [{ locked: true }] : [], rowCount: 0 }))
const db = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Db
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zz-backup-config-'))
  vi.stubEnv('BACKUP_CONFIG_FILE', path.join(dir, 'backup-config.json'))
  vi.stubEnv('BACKUP_ENCRYPTION_KEY', '')
  vi.stubEnv('BACKUP_KEY_ID', 'default')
  for (const name of ['BACKUP_PG_DUMP_PATH', 'BACKUP_PG_RESTORE_PATH', 'BACKUP_PSQL_PATH', 'BACKUP_RCLONE_PATH']) vi.stubEnv(name, '')
  query.mockReset().mockImplementation(async (sql: string) => ({ rows: sql.includes('pg_try') ? [{ locked: true }] : [], rowCount: 0 }))
  mock.command.mockImplementation(async (executable: string) =>
    executable.includes('wrong')
      ? 'node v22.0.0'
      : executable.includes('rclone')
        ? 'rclone v1.70.0\nextra private output'
        : `${path.basename(executable)} (PostgreSQL) 17.2\nextra private output`,
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})
describe('备份本地运行配置', () => {
  it('主密钥保存在独立文件，重新读取后能解密；接口不回显密钥或密码', async () => {
    const result = await configureDeployment(db, { ...input(), masterKey: key })
    expect(result.deployment.keySource).toBe('local')
    expect(JSON.stringify(result)).not.toContain(key)
    expect(readFileSync(path.join(dir, 'backup-config.json'), 'utf8')).not.toContain('not-persisted')
    expect(backupKey().toString('base64')).toBe(key)
    const encrypted = seal({ password: 'test-only' })
    expect(unseal(encrypted)).toEqual({ password: 'test-only' })
    expect(readDeploymentFile().revision).toBe(1)
    if (process.platform !== 'win32') expect(statSync(path.join(dir, 'backup-config.json')).mode & 0o777).toBe(0o600)
  })
  it('部署密钥可原样迁入本地，已有密钥不可覆盖，空输入保留密钥', () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', key)
    expect(() => prepareDeploymentFile({ ...input(), masterKey: Buffer.alloc(32, 20).toString('base64') })).toThrow('不能直接替换')
    writeDeploymentFile(prepareDeploymentFile({ ...input(), masterKey: key }))
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', '')
    writeDeploymentFile(prepareDeploymentFile({ ...input(), revision: 1, masterKey: '' }))
    expect(backupKey().toString('base64')).toBe(key)
    expect(() => prepareDeploymentFile(input())).toThrow('已更新')
  })
  it('本地路径优先，清空后回退环境或自动检测，失败不改文件', async () => {
    const dump = path.join(dir, 'pg_dump')
    await configureDeployment(db, { ...input(), tools: { ...emptyTools, dump } })
    vi.stubEnv('BACKUP_PG_DUMP_PATH', path.join(dir, 'environment-pg_dump'))
    expect(resolvedTool('dump')).toBe(dump)
    const before = readFileSync(path.join(dir, 'backup-config.json'), 'utf8')
    await expect(configureDeployment(db, { ...input(), revision: 1, tools: { ...emptyTools, dump: path.join(dir, 'wrong') } })).rejects.toThrow('路径检测失败')
    expect(readFileSync(path.join(dir, 'backup-config.json'), 'utf8')).toBe(before)
    await configureDeployment(db, { ...input(), revision: 1 })
    expect(resolvedTool('dump')).toBe(path.join(dir, 'environment-pg_dump'))
    vi.stubEnv('BACKUP_PG_DUMP_PATH', '')
    expect(resolvedTool('dump')).toBe('pg_dump')
  })
  it('检测草稿不落盘，识别工具身份且只返回版本号', async () => {
    const result = await configureDeployment(db, { ...input(), tools: { ...emptyTools, transfer: path.join(dir, 'wrong') } }, true)
    expect(result.deployment.tools.transfer.ready).toBe(false)
    expect(readDeploymentFile().revision).toBe(0)
    const view = await deploymentView()
    expect(view.tools.dump.version).toBe('17.2')
    expect(JSON.stringify(view)).not.toContain('private output')
  })
  it('拒绝非法路径、密钥和损坏文件，不静默回退到另一把密钥', () => {
    for (const dump of ['relative/pg_dump', path.join(dir, 'pg_dump') + '\n--help'])
      expect(() => prepareDeploymentFile({ ...input(), tools: { ...emptyTools, dump } })).toThrow()
    expect(() => prepareDeploymentFile({ ...input(), masterKey: 'invalid' })).toThrow('32 字节')
    writeFileSync(path.join(dir, 'backup-config.json'), '{bad')
    expect(() => backupKey()).toThrow('无法读取')
  })
  it('配置路径不能进入网站静态目录', () => {
    vi.stubEnv('WEB_DIST_DIR', dir)
    expect(() => writeDeploymentFile({ revision: 1, tools: {} })).toThrow('静态目录')
  })
  it('原配置丢失后导入密钥必须匹配历史归档，并恢复原密钥标识', async () => {
    const payload = { keyId: 'original-key', id: 'old-version' }
    const signingKey = createHash('sha256').update(Buffer.from(key, 'base64')).update('zhi-zhou-backups:manifest').digest()
    const manifest = JSON.stringify({ ...payload, signature: createHmac('sha256', signingKey).update(JSON.stringify(payload)).digest('hex') })
    query.mockImplementation(
      async (sql: string) =>
        ({ rows: sql.includes('pg_try') ? [{ locked: true }] : sql.includes('SELECT manifest') ? [{ manifest }] : [], rowCount: 0 }) as never,
    )
    await expect(configureDeployment(db, { ...input(), masterKey: Buffer.alloc(32, 21).toString('base64') })).rejects.toThrow('导入原主密钥')
    expect(readDeploymentFile().revision).toBe(0)
    const saved = await configureDeployment(db, { ...input(), masterKey: key })
    expect(readDeploymentFile().keyId).toBe('original-key')
    expect(saved.deployment.keyId).toBe('original-key')
  })
})
