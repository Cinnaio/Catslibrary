import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const smtp = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), verify: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.create } }))
import { adminMailSettings, mailConfiguration, publicMailStatus, sendAccountMail, testMailConnection } from './mail'
import { saveMailSettings } from './mail-settings'
import type { MailSettingsInput } from '@shared/mail-settings'

let configDirectory: string
const input = (overrides: Partial<MailSettingsInput> = {}): MailSettingsInput => ({
  revision: 0, host: 'smtp.saved.test', port: 587, security: 'starttls', username: 'saved-user', password: '',
  from: 'Cat’s Library <saved@example.test>', publicOrigin: 'https://saved.example.test', ...overrides,
})

beforeEach(async () => {
  configDirectory = await mkdtemp(path.join(tmpdir(), 'zhi-zhou-smtp-config-test-'))
  vi.stubEnv('MAIL_CONFIG_FILE', path.join(configDirectory, 'mail-config.json'))
  smtp.create.mockReset().mockReturnValue({ sendMail: smtp.send, verify: smtp.verify })
  smtp.verify.mockReset().mockResolvedValue(true)
  smtp.send.mockReset().mockResolvedValue({ accepted: ['reader@example.test'] })
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SMTP_URL', 'smtps://user:password@smtp.example.test:465')
  vi.stubEnv('MAIL_FROM', 'Cat’s Library <account@example.test>')
  vi.stubEnv('PUBLIC_WEB_URL', 'https://reader.example.test')
  vi.stubEnv('MAIL_OUTBOX_DIR', '')
})
afterEach(async () => { await rm(configDirectory, { recursive: true, force: true }); vi.unstubAllEnvs() })
describe('SMTP 与开发邮件箱', () => {
  it('状态只返回发件身份与固定网站地址，不回传 SMTP 凭据', () => {
    expect(publicMailStatus()).toEqual({ ready: true, mode: 'smtp', from: 'Cat’s Library <account@example.test>', publicOrigin: 'https://reader.example.test' })
    expect(JSON.stringify(publicMailStatus())).not.toContain('password')
  })
  it('生产环境拒绝 HTTP 地址、带路径地址和本地邮件箱', () => {
    for (const origin of ['http://reader.example.test', 'https://reader.example.test/path', 'https://user:password@reader.example.test']) {
      vi.stubEnv('PUBLIC_WEB_URL', origin); expect(mailConfiguration().ready).toBe(false)
    }
    vi.stubEnv('PUBLIC_WEB_URL', 'https://reader.example.test'); vi.stubEnv('SMTP_URL', ''); vi.stubEnv('MAIL_OUTBOX_DIR', 'local-outbox')
    expect(mailConfiguration().ready).toBe(false)
  })
  it('SMTP 强制 TLS 且禁用文件、URL、调试输出；失败只给安全提示', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://user:password@smtp.example.test:587')
    await sendAccountMail('reader@example.test', '验证邮箱', 'https://reader.example.test/verify-email#token=fixture')
    expect(smtp.create).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false }))
    smtp.send.mockRejectedValueOnce(new Error('fake SMTP error containing a credential'))
    await expect(sendAccountMail('reader@example.test', '验证邮箱', 'https://reader.example.test')).rejects.toThrow('邮件暂时发送失败')
  })
  it('SMTP 非法 URL 或发件头换行时拒绝发送', async () => {
    vi.stubEnv('SMTP_URL', 'https://smtp.example.test')
    expect(mailConfiguration().ready).toBe(false)
    vi.stubEnv('SMTP_URL', 'smtps://smtp.example.test')
    vi.stubEnv('MAIL_FROM', 'sender@example.test\r\nBcc: other@example.test')
    await expect(sendAccountMail('reader@example.test', '验证邮箱', 'https://reader.example.test')).rejects.toThrow('尚未配置')
    expect(smtp.send).not.toHaveBeenCalled()
  })
  it('开发邮件箱保存可打开的邮件链接，无网络投递', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'zhi-zhou-mail-test-'))
    try {
      vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SMTP_URL', ''); vi.stubEnv('MAIL_OUTBOX_DIR', directory)
      await sendAccountMail('reader@example.test', '验证邮箱', 'https://reader.example.test/verify-email#token=fixture')
      const files = await readdir(directory)
      expect(files).toHaveLength(1)
      expect(JSON.parse(await readFile(path.join(directory, files[0]!), 'utf8'))).toMatchObject({ to: 'reader@example.test', url: 'https://reader.example.test/verify-email#token=fixture' })
      expect(smtp.send).not.toHaveBeenCalled()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('前台配置即时覆盖环境配置，留空保留环境密码，回传中不含密码或 URL 凭据', async () => {
    saveMailSettings(input())
    expect(adminMailSettings()).toMatchObject({ source: 'local', revision: 1, host: 'smtp.saved.test', security: 'starttls', passwordSet: true })
    expect(JSON.stringify(adminMailSettings())).not.toContain('password"')
    expect(JSON.stringify(adminMailSettings())).not.toContain('smtps://')
    expect(publicMailStatus().publicOrigin).toBe('https://saved.example.test')
    await sendAccountMail('reader@example.test', '验证', 'https://saved.example.test')
    expect(smtp.create).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.saved.test', secure: false, requireTLS: true, auth: { user: 'saved-user', pass: 'password' } }))
    if (process.platform !== 'win32') expect((await stat(process.env.MAIL_CONFIG_FILE!)).mode & 0o777).toBe(0o600)
  })
  it('支持特殊字符密码、替换、清除与重读，并拒绝过期修订覆盖', async () => {
    saveMailSettings(input({ password: '特殊:@/%?# 密码' }))
    await sendAccountMail('reader@example.test', '验证', 'https://saved.example.test')
    expect(smtp.create.mock.calls.at(-1)![0].auth.pass).toBe('特殊:@/%?# 密码')
    expect(() => saveMailSettings(input())).toThrow('邮件配置已更新')
    saveMailSettings(input({ revision: 1, password: '', from: 'new@example.test' }))
    await sendAccountMail('reader@example.test', '验证', 'https://saved.example.test')
    expect(smtp.create.mock.calls.at(-1)![0].auth.pass).toBe('特殊:@/%?# 密码')
    saveMailSettings(input({ revision: 2, clearPassword: true, username: '' }))
    expect(adminMailSettings()).toMatchObject({ revision: 3, passwordSet: false, username: '' })
  })
  it('拒绝注入、无效端口、不安全站点及密码选项，失败不写入配置', () => {
    for (const override of [{ host: 'smtp://bad.test' }, { host: 'smtp.test/path' }, { port: 65536 }, { port: 1.5 },
      { security: 'none' }, { from: 'a@example.test\r\nBcc: b@example.test' }, { publicOrigin: 'http://example.test' },
      { publicOrigin: 'https://example.test/reset-password' }, { clearPassword: true, password: 'new' }]) {
      expect(() => saveMailSettings(input(override as Partial<MailSettingsInput>))).toThrow()
      expect(adminMailSettings().revision).toBe(0)
    }
  })
  it('损坏配置拒绝回退环境发信；连接失败不暴露原始凭据且不发邮件', async () => {
    await testMailConnection(0)
    expect(smtp.verify).toHaveBeenCalledOnce()
    expect(smtp.send).not.toHaveBeenCalled()
    smtp.verify.mockRejectedValueOnce(new Error('secret SMTP password'))
    await expect(testMailConnection(0)).rejects.toThrow('SMTP 连接或认证失败')
    await expect(testMailConnection(1)).rejects.toThrow('邮件配置已更新')
    await writeFile(process.env.MAIL_CONFIG_FILE!, '{broken')
    expect(() => mailConfiguration()).toThrow('邮件配置无法读取')
  })
})
