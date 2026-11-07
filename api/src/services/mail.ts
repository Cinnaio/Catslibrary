import nodemailer from 'nodemailer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AccountError } from './account-security'
import type { MailSettings } from '@shared/mail-settings'
import { effectiveMailSettings, parseSmtp, validMailOrigin } from './mail-settings'

export function mailConfiguration() {
  const production = process.env.NODE_ENV?.trim().toLowerCase() === 'production'
  const effective = effectiveMailSettings()
  const publicOrigin = validMailOrigin(effective.publicOrigin)
  const outbox = !production ? process.env.MAIL_OUTBOX_DIR?.trim() || '' : ''
  const { from, smtp } = effective
  const smtpValid = Boolean(parseSmtp(smtp))
  return { ready: Boolean(publicOrigin && (smtp ? smtpValid && from && !/[\r\n]/.test(from) : outbox)), publicOrigin, from, smtp, outbox }
}
export function adminMailSettings(): MailSettings {
  const effective = effectiveMailSettings(), url = parseSmtp(effective.smtp)
  return { ...publicMailStatus(), source: effective.source, revision: effective.revision,
    host: url?.hostname || '', port: Number(url?.port) || (url?.protocol === 'smtp:' ? 587 : 465),
    security: url?.protocol === 'smtp:' ? 'starttls' : 'tls',
    username: url ? decodeURIComponent(url.username) : '', passwordSet: Boolean(url?.password) }
}
export function publicMailStatus() {
  const config = mailConfiguration()
  return { ready: config.ready, mode: config.outbox && !config.smtp ? 'outbox' as const : 'smtp' as const, from: config.from, publicOrigin: config.publicOrigin }
}
function mailTransport(smtp: string) {
  const u = new URL(smtp)
  return nodemailer.createTransport({
    host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587),
    secure: u.protocol === 'smtps:', requireTLS: u.protocol !== 'smtps:',
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  })
}
export async function testMailConnection(revision: number) {
  if (revision !== effectiveMailSettings().revision) throw new AccountError('邮件配置已更新，请刷新后重新测试', 409)
  const config = mailConfiguration()
  if (!config.ready || !config.smtp) throw new AccountError('请先保存完整的 SMTP 配置', 400)
  try { await mailTransport(config.smtp).verify() }
  catch { throw new AccountError('SMTP 连接或认证失败，请检查服务器、端口、加密方式及账号密码', 503) }
}
export class MailDeliveryError extends AccountError {
  constructor(public code: string, public outcome: 'retry' | 'rejected' | 'unknown') { super('邮件暂时发送失败，请稍后重试', 503) }
}
export async function sendAccountMail(to: string, subject: string, url: string, jobId: string = randomUUID(), transport: 'smtp' | 'resend' = 'smtp') {
  const config = mailConfiguration()
  if (!config.ready) throw new AccountError('邮件服务尚未配置，请联系超级管理员', 503)
  const text = url ? `${subject}\n\n请在浏览器中打开以下链接并确认操作：\n${url}\n\n链接会过期且只能使用一次。如果不是你的操作，请忽略此邮件。` : `${subject}\n\n这是一封由站点管理员发起的投递测试邮件，无需回复。`
  if (transport === 'resend') {
    const smtp = parseSmtp(config.smtp)
    if (!smtp || smtp.hostname !== 'smtp.resend.com') throw new MailDeliveryError('resend_configuration', 'rejected')
    let response: Response
    try { response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${decodeURIComponent(smtp.password)}`, 'Content-Type':'application/json', 'Idempotency-Key':jobId },
      body: JSON.stringify({ from:config.from,to:[to],subject,text,tags:[{name:'job_id',value:jobId}] }) }) }
    catch { throw new MailDeliveryError('provider_network', 'unknown') }
    if (!response.ok) throw new MailDeliveryError(`provider_${response.status}`, response.status===429 ? 'retry' : response.status>=500 || response.status===409 ? 'unknown' : 'rejected')
    const data = await response.json().catch(()=>null) as { id?: string } | null
    if (!data?.id) throw new MailDeliveryError('provider_response', 'unknown')
    return { providerId: data.id }
  }
  if (config.smtp) {
    try {
      const result = await mailTransport(config.smtp).sendMail({ from: config.from, to: { address: to, name: '' }, subject, text,
        headers: { 'Resend-Idempotency-Key': jobId }, messageId: `<${jobId}@${new URL(config.publicOrigin).hostname}>` })
      if (!result.accepted?.length) throw new MailDeliveryError('smtp_rejected','rejected')
      return { providerId: '' }
    } catch (error) {
      if (error instanceof MailDeliveryError) throw error
      const e = error as { responseCode?: number; code?: string }
      if (e.responseCode && e.responseCode>=400 && e.responseCode<500) throw new MailDeliveryError('smtp_temporary','retry')
      if ((e.responseCode && e.responseCode>=500) || e.code==='EAUTH') throw new MailDeliveryError('smtp_rejected','rejected')
      throw new MailDeliveryError('smtp_unknown','unknown')
    }
  }
  await mkdir(config.outbox, { recursive: true, mode: 0o700 })
  await writeFile(path.join(config.outbox, `${randomUUID()}.json`), JSON.stringify({ to, subject, text, url }), { mode: 0o600 })
  return { providerId: '' }
}
