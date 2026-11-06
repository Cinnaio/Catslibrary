import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const smtp = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.create } }))
import { mailConfiguration, publicMailStatus, sendAccountMail } from './mail'

beforeEach(() => {
  smtp.create.mockReset().mockReturnValue({ sendMail: smtp.send })
  smtp.send.mockReset().mockResolvedValue({ accepted: ['reader@example.test'] })
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SMTP_URL', 'smtps://user:password@smtp.example.test:465')
  vi.stubEnv('MAIL_FROM', '知舟 <account@example.test>')
  vi.stubEnv('PUBLIC_WEB_URL', 'https://reader.example.test')
  vi.stubEnv('MAIL_OUTBOX_DIR', '')
})
afterEach(() => vi.unstubAllEnvs())
describe('SMTP 与开发邮件箱', () => {
  it('状态只返回发件身份与固定网站地址，不回传 SMTP 凭据', () => {
    expect(publicMailStatus()).toEqual({ ready: true, mode: 'smtp', from: '知舟 <account@example.test>', publicOrigin: 'https://reader.example.test' })
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
})
