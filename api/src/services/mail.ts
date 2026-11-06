import nodemailer from 'nodemailer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AccountError } from './account-security'

export function mailConfiguration() {
  const production = process.env.NODE_ENV?.trim().toLowerCase() === 'production'
  const origin = process.env.PUBLIC_WEB_URL?.trim() || (!production ? 'http://localhost:5173' : '')
  let publicOrigin = ''
  try {
    const url = new URL(origin)
    if (url.origin === origin.replace(/\/$/, '') && !url.username && !url.password &&
      (url.protocol === 'https:' || (!production && url.protocol === 'http:'))) publicOrigin = url.origin
  } catch { /* 未配置时关闭发信，不从请求 Host 生成链接。 */ }
  const outbox = !production ? process.env.MAIL_OUTBOX_DIR?.trim() || '' : ''
  const from = process.env.MAIL_FROM?.trim() || ''
  const smtp = process.env.SMTP_URL?.trim() || ''
  let smtpValid = false
  try { const u = new URL(smtp); smtpValid = ['smtp:', 'smtps:'].includes(u.protocol) && !!u.hostname && (!u.pathname || u.pathname === '/') && !u.search && !u.hash } catch { /* 无效配置 */ }
  return { ready: Boolean(publicOrigin && (smtp ? smtpValid && from && !/[\r\n]/.test(from) : outbox)), publicOrigin, from, smtp, outbox }
}
export function publicMailStatus() {
  const config = mailConfiguration()
  return { ready: config.ready, mode: config.outbox && !config.smtp ? 'outbox' : 'smtp', from: config.from, publicOrigin: config.publicOrigin }
}
export async function sendAccountMail(to: string, subject: string, url: string) {
  const config = mailConfiguration()
  if (!config.ready) throw new AccountError('邮件服务尚未配置，请联系超级管理员', 503)
  const text = `${subject}\n\n请在浏览器中打开以下链接并确认操作：\n${url}\n\n链接会过期且只能使用一次。如果不是你的操作，请忽略此邮件。`
  if (config.smtp) {
    try {
      const u = new URL(config.smtp)
      const result = await nodemailer.createTransport({
        host: u.hostname, port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587),
        secure: u.protocol === 'smtps:', requireTLS: u.protocol !== 'smtps:',
        auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
      }).sendMail({ from: config.from, to: { address: to, name: '' }, subject, text })
      if (!result.accepted?.length) throw new Error('rejected')
      return
    } catch { throw new AccountError('邮件暂时发送失败，请稍后重试', 503) }
  }
  await mkdir(config.outbox, { recursive: true, mode: 0o700 })
  await writeFile(path.join(config.outbox, `${randomUUID()}.json`), JSON.stringify({ to, subject, text, url }), { mode: 0o600 })
}
