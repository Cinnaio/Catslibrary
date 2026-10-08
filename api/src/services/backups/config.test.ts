import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultPolicy, nextRun, seal, unseal, validatePolicy, validateTarget } from './config'
import { permittedAddress } from './storage'

afterEach(() => vi.unstubAllEnvs())
describe('备份配置与凭据', () => {
  it('默认关闭自动备份，拒绝错误时区、时间及保留数量', () => {
    expect(defaultPolicy.enabled).toBe(false)
    expect(nextRun(defaultPolicy, Date.now())).toBe(0)
    for (const patch of [{ timezone: 'invalid' }, { time: '25:00' }, { localRetention: 0 }, { intervalHours: NaN }, { targetIds: 'all' }])
      expect(() => validatePolicy({ ...defaultPolicy, ...patch } as typeof defaultPolicy)).toThrow()
  })
  it('按上海时区计算日、周及固定间隔计划', () => {
    const start = Date.parse('2026-10-08T00:00:00+08:00')
    expect(nextRun({ ...defaultPolicy, enabled: true }, start)).toBe(Date.parse('2026-10-08T03:00:00+08:00'))
    expect(nextRun({ ...defaultPolicy, enabled: true, schedule: 'weekly', weekday: 0 }, start)).toBe(Date.parse('2026-10-11T03:00:00+08:00'))
    expect(nextRun({ ...defaultPolicy, enabled: true, schedule: 'interval', intervalHours: 6 }, start)).toBe(start + 6 * 3600000)
  })
  it('夏令时缺失时间顺延，重复时间不重复执行', () => {
    const policy = { ...defaultPolicy, enabled: true, timezone: 'America/New_York', time: '02:30' }
    expect(nextRun(policy, Date.parse('2026-03-08T00:00:00-05:00'))).toBe(Date.parse('2026-03-08T03:00:00-04:00'))
    expect(nextRun({ ...policy, time: '01:30' }, Date.parse('2026-11-01T01:40:00-04:00'))).toBe(Date.parse('2026-11-02T01:30:00-05:00'))
  })
  it('凭据采用认证加密，密钥更换或篡改时拒绝解密', () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
    const cipher = seal({ password: 'secret-test' })
    expect(cipher).not.toContain('secret-test')
    expect(unseal(cipher)).toEqual({ password: 'secret-test' })
    expect(() => unseal(cipher.slice(0, -5) + 'zzzzz')).toThrow()
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('base64'))
    expect(() => unseal(cipher)).toThrow()
  })
  it('目标拒绝非允许主机、相对目录、配置注入和缺失主机公钥', () => {
    vi.stubEnv('BACKUP_ALLOWED_HOSTS', 'backup.example.com')
    const target = {
      name: '测试',
      type: 'sftp' as const,
      enabled: true,
      required: true,
      host: 'backup.example.com',
      port: 22,
      path: '/backup',
      username: 'user',
      hostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA==',
      bucket: '',
      region: '',
      retention: 30,
    }
    expect(validateTarget(target)).toMatchObject({ name: '测试' })
    for (const patch of [{ host: 'other.example.com' }, { path: '../secret' }, { username: 'user\npass = injected' }, { hostKey: '' }, { port: 0 }])
      expect(() => validateTarget({ ...target, ...patch })).toThrow()
  })
  it('即使在允许名单也禁止云元数据及回环地址', async () => {
    vi.stubEnv('BACKUP_ALLOWED_HOSTS', '169.254.169.254,127.0.0.1,::1')
    for (const host of ['169.254.169.254', '127.0.0.1', '::1']) await expect(permittedAddress(host)).rejects.toThrow()
  })
})

describe('后台允许列表配置', () => {
  it('去重与规范化，拒绝 URL、端口、通配符和配置注入', async () => {
    const { normalizeHosts } = await import('./settings')
    expect(normalizeHosts([' Backup.Example.com ', 'backup.example.com', '10.1.1.4', '::1'])).toEqual(['backup.example.com', '10.1.1.4', '::1'])
    for (const hosts of [['https://example.com'], ['example.com:22'], ['*.example.com'], ['host\npassword=x'], 'all'])
      expect(() => normalizeHosts(hosts)).toThrow()
  })
})
