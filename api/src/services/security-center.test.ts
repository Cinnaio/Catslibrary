import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, createHmac } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { app } from '../app'
import { createSession } from './sessions'
import { loadConfig } from '../config'
import { DEFAULT_SECURITY_POLICY, type SecurityPolicy } from '@shared/security'
import { issueAccountEmail } from './account-email'
import { openMail, saveSecurityPolicy, securityKey, sealMail, securityPolicy, validatePolicy } from './security-policy'
import { DEFAULT_EMAIL_DOMAIN_POLICY } from '@shared/email-domain-policy'
import { runMailTick } from './mail-worker'
import { receiveMailWebhook, reconcileDeliveryEvents } from './mail-webhook'
import { budgetPeriods, type MailJob, type MailPayload } from './mail-queue'
import { MailDeliveryError } from './mail'
import { protectRequest } from './security-requests'
import { liveImpactFingerprint } from './backups/impact-snapshot'
import { mailSecuritySettingsPath } from './mail-security-settings'

const mocks = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn() }))
vi.mock('./mail', async (original) => ({
  ...(await original<typeof import('./mail')>()),
  mailConfiguration: () => ({
    ready: true,
    smtp: 'smtps://resend:fixture@smtp.resend.com:465',
    from: 'account@example.test',
    publicOrigin: 'https://reader.example.test',
    outbox: '',
  }),
  sendAccountMail: mocks.send,
}))
vi.mock('./turnstile', () => ({ effectiveTurnstile: async () => ({ configured: true, siteKey: 'fixture' }), verifyChallenge: mocks.verify }))
let t: TestDb
const tokens: Record<string, string> = {}
async function policy(patch: Partial<SecurityPolicy> = {}) {
  const p = {
    ...structuredClone(DEFAULT_SECURITY_POLICY),
    challenges: { login: 'off', register: 'off', 'forgot-password': 'off', 'verify-email': 'off' },
    ...patch,
  }
  await t.db.query("INSERT INTO security_policy(id,value,updated_at) VALUES('site',$1::jsonb,$2) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value", [
    JSON.stringify(p),
    Date.now(),
  ])
}
async function job(id: string) {
  return (await t.db.query<MailJob>('SELECT * FROM mail_jobs WHERE id=$1', [id])).rows[0]!
}
async function count(period = budgetPeriods(Date.now())[0]) {
  return Number((await t.db.query<{ reserved: number }>('SELECT reserved FROM mail_budget WHERE period=$1', [period])).rows[0]?.reserved || 0)
}
async function api(path: string, actor = 'root', body?: unknown, method = body ? 'POST' : 'GET') {
  return app.request('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
async function signedEvent(id: string, type: string, data: Record<string, unknown>) {
  const timestamp = String(Math.floor(Date.now() / 1000)),
    raw = JSON.stringify({ type, created_at: new Date().toISOString(), data })
  const signature = createHmac('sha256', Buffer.from(process.env.RESEND_WEBHOOK_SECRET!.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64')
  await receiveMailWebhook(t.db, raw, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + signature })
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
})
beforeEach(async () => {
  rmSync(mailSecuritySettingsPath(), { force: true })
  vi.stubEnv('MAIL_QUEUE_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_' + randomBytes(32).toString('base64'))
  mocks.send.mockReset().mockResolvedValue({ providerId: 'provider-1' })
  mocks.verify.mockReset().mockResolvedValue(true)
  for (const table of [
    'mail_attempts',
    'mail_jobs',
    'mail_budget',
    'mail_delivery_events',
    'mail_worker_status',
    'security_events',
    'security_restrictions',
    'security_counters',
    'security_policy',
    'account_email_tokens',
    'account_security_audit',
    'admin_operation_audit',
    'users',
  ])
    await t.db.query(`DELETE FROM ${table}`)
  for (const [id, role] of [
    ['root', 'super_admin'],
    ['manager', 'admin'],
    ['reader', 'reader'],
    ['other', 'reader'],
  ]) {
    await t.db.query(
      `INSERT INTO users(id,username,role,password_hash,password_salt,email,email_verified_at,created_at,updated_at)
      VALUES($1,$1,$2,'credential','salt',$3,1,1,1)`,
      [id, role, id + '@example.test'],
    )
    tokens[id!] = await createSession(t.db, id!, 'fixture', loadConfig().sessionHashSalt)
  }
  await policy()
})
afterAll(async () => {
  setDbForTests(null)
  await t.close()
  vi.unstubAllEnvs()
  delete process.env.DATABASE_URL
})

describe('邮件额度、任务与防护', () => {
  it('邮件安全配置仅超级管理员可读写，有效会话提交原因即可保存', async () => {
    for (const actor of ['manager', 'reader', '']) {
      expect((await api('/admin/security/mail-settings', actor)).status).toBe(actor ? 403 : 401)
      expect((await api('/admin/security/mail-settings', actor, { reason: '初始化队列加密' }, 'PUT')).status).toBe(actor ? 403 : 401)
    }
    expect((await api('/admin/security/mail-settings', 'root', { revision: 0 }, 'PUT')).status).toBe(400)
    await t.db.query('UPDATE user_sessions SET reauthenticated_at=0')
    const result = await api('/admin/security/mail-settings', 'root', {
      revision: 0, reason: '保存回调签名配置', generateQueueKey: false, queueEncryptionKey: '', webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    }, 'PUT')
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ revision: 1 })
  })

  it('前端初始化密钥立即用于队列，状态和审计不含密钥且不能重复替换', async () => {
    vi.stubEnv('MAIL_QUEUE_ENCRYPTION_KEY', '')
    vi.stubEnv('SITE_SETTINGS_ENCRYPTION_KEY', '')
    const initial = await api('/admin/security/mail-settings')
    expect(initial.headers.get('Cache-Control')).toBe('no-store')
    expect(await initial.json()).toMatchObject({ encryptionReady: false, queueCanInitialize: true })
    const input = { revision: 0, generateQueueKey: true, queueEncryptionKey: '', webhookSecret: '', reason: '启用邮件队列加密' }
    const response = await api('/admin/security/mail-settings', 'root', input, 'PUT')
    expect(response.status).toBe(200)
    const status = await response.json()
    expect(status).toMatchObject({ revision: 1, encryptionReady: true, queueSource: 'local', queueCanInitialize: false })
    const stored = JSON.parse(readFileSync(mailSecuritySettingsPath(), 'utf8'))
    expect(Buffer.from(stored.queueEncryptionKey, 'base64')).toHaveLength(32)
    expect(JSON.stringify(status)).not.toContain(stored.queueEncryptionKey)
    const audit = (await t.db.query("SELECT before_state,after_state FROM account_security_audit WHERE action='mail-security-settings'")).rows
    expect(JSON.stringify(audit)).not.toContain(stored.queueEncryptionKey)
    expect(audit).toHaveLength(1)
    const payload = { to: 'reader@example.test', subject: '测试', url: 'https://reader.example.test' }
    expect(openMail('local-key-test', sealMail('local-key-test', payload))).toEqual(payload)
    expect((await api('/admin/security/overview')).status).toBe(200)
    expect((await api('/admin/security/mail-settings', 'root', input, 'PUT')).status).toBe(409)
    expect((await api('/admin/security/mail-settings', 'root', { ...input, revision: 1 }, 'PUT')).status).toBe(409)
    expect(JSON.parse(readFileSync(mailSecuritySettingsPath(), 'utf8')).queueEncryptionKey).toBe(stored.queueEncryptionKey)
  })

  it('保留环境密钥，拒绝无效输入，并在原密钥丢失且仍有加密邮件时阻止初始化', async () => {
    const input = { revision: 0, generateQueueKey: true, queueEncryptionKey: '', webhookSecret: '', reason: '初始化邮件安全配置' }
    expect((await api('/admin/security/mail-settings', 'root', input, 'PUT')).status).toBe(409)
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    vi.stubEnv('MAIL_QUEUE_ENCRYPTION_KEY', '')
    vi.stubEnv('SITE_SETTINGS_ENCRYPTION_KEY', '')
    const status = await (await api('/admin/security/mail-settings')).json()
    expect(status).toMatchObject({ queueCanInitialize: false, queueIssue: 'retained-payload' })
    expect((await api('/admin/security/mail-settings', 'root', input, 'PUT')).status).toBe(409)
    vi.stubEnv('MAIL_QUEUE_ENCRYPTION_KEY', 'invalid-key')
    expect(await (await api('/admin/security/mail-settings')).json()).toMatchObject({ encryptionReady: false, queueIssue: 'invalid' })
    expect((await api('/admin/security/mail-settings', 'root', { ...input, generateQueueKey: false, webhookSecret: 'invalid' }, 'PUT')).status).toBe(400)
  })

  it('后台回调密钥立即验证签名，留空保留且环境队列密钥不受影响', async () => {
    const secret = 'whsec_' + randomBytes(32).toString('base64'),
      oldKey = process.env.MAIL_QUEUE_ENCRYPTION_KEY
    const input = { revision: 0, generateQueueKey: false, queueEncryptionKey: '', webhookSecret: secret, reason: '接入投递签名回调' }
    const response = await api('/admin/security/mail-settings', 'root', input, 'PUT')
    expect(response.status).toBe(200)
    const status = await response.json()
    expect(status).toMatchObject({ revision: 1, webhookReady: true, webhookSource: 'local', queueSource: 'environment' })
    expect(JSON.stringify(status)).not.toContain(secret)
    expect(JSON.stringify((await t.db.query("SELECT * FROM account_security_audit WHERE action='mail-security-settings'")).rows)).not.toContain(secret)
    const raw = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'local-provider' } })
    const timestamp = String(Math.floor(Date.now() / 1000)),
      id = 'local-secret-event'
    const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`${id}.${timestamp}.${raw}`)
      .digest('base64')
    await expect(receiveMailWebhook(t.db, raw, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + signature })).resolves.toBeUndefined()
    await expect(signedEvent('old-environment-key', 'email.delivered', { email_id: 'local-provider' })).rejects.toThrow('回调验证失败')
    expect(process.env.MAIL_QUEUE_ENCRYPTION_KEY).toBe(oldKey)
    vi.stubEnv('MAIL_QUEUE_ENCRYPTION_KEY', '')
    const initialized = await api('/admin/security/mail-settings', 'root', { ...input, revision: 1, generateQueueKey: true, webhookSecret: '' }, 'PUT')
    expect(initialized.status).toBe(200)
    expect(JSON.parse(readFileSync(mailSecuritySettingsPath(), 'utf8')).webhookSecret).toBe(secret)
    writeFileSync(mailSecuritySettingsPath(), '{broken')
    expect((await api('/admin/security/mail-settings')).status).toBe(503)
    expect(() => sealMail('bad-file', {})).toThrow('邮件安全配置无法读取')
  })

  it('域名策略规范化并审计，旧客户端保存其他设置不会清空名单', async () => {
    const next = {
      ...DEFAULT_SECURITY_POLICY,
      emailDomains: { ...DEFAULT_EMAIL_DOMAIN_POLICY, allowlistEnabled: true, allowlist: [' EXAMPLE.TEST ', 'example.test'], blocklist: ['blocked.test'] },
    }
    const response = await api('/admin/security/policy', 'root', { policy: next, reason: '设置邮箱域名名单' }, 'PUT')
    expect(response.status).toBe(200)
    const saved = (await response.json()) as SecurityPolicy
    expect(saved.emailDomains.allowlist).toEqual(['example.test'])
    const legacy = { ...saved, daily: 90 } as Partial<SecurityPolicy>
    delete legacy.emailDomains
    const updated = await saveSecurityPolicy(t.db, 'root', legacy, '旧客户端调整每日预算')
    expect(updated.emailDomains).toEqual(saved.emailDomains)
    expect(
      (
        await t.db.query<{ after_state: SecurityPolicy }>(
          "SELECT after_state FROM account_security_audit WHERE action='security-policy' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0]?.after_state.emailDomains,
    ).toEqual(saved.emailDomains)
    await t.db.query("UPDATE security_policy SET value=value-'emailDomains'")
    expect((await securityPolicy(t.db)).emailDomains).toEqual(DEFAULT_EMAIL_DOMAIN_POLICY)
    expect(() => validatePolicy({ ...next, emailDomains: null })).toThrow('邮箱域名策略格式无效')
    expect(() => validatePolicy({ ...next, emailDomains: { ...next.emailDomains, allowlist: [] } })).toThrow('至少填写一个')
  })

  it('域名黑名单优先，普通与应急申请都不占用预算或生成邮件链接', async () => {
    await policy({ emailDomains: { ...DEFAULT_EMAIL_DOMAIN_POLICY, allowlistEnabled: true, allowlist: ['example.test'], blocklist: ['example.test'] } })
    for (const emergency of [false, true])
      await expect(
        issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password', emergency ? 'root' : 'reader', undefined, '核实用户邮箱域名', emergency),
      ).rejects.toMatchObject({ code: 'mail_domain_blocked' })
    await expect(issueAccountEmail(t.db, 'reader', 'new@other.test', 'verify-email')).rejects.toMatchObject({ code: 'mail_domain_not_allowed' })
    const test = await api('/admin/security/test-mail', 'root', { reason: '检查域名测试邮件' })
    expect(test.status).toBe(403)
    expect(await test.json()).toMatchObject({ code: 'mail_domain_blocked' })
    expect(await count()).toBe(0)
    expect((await t.db.query('SELECT id FROM mail_jobs')).rows).toHaveLength(0)
    expect((await t.db.query('SELECT token_hash FROM account_email_tokens')).rows).toHaveLength(0)
    expect((await t.db.query("SELECT rule FROM security_events WHERE rule='mail_domain_blocked' AND target_id='reader'")).rows).toHaveLength(1)
    expect((await t.db.query("SELECT rule FROM security_events WHERE rule='mail_domain_blocked' AND action='test' AND target_id='root'")).rows).toHaveLength(1)
  })

  it('白名单邮箱仍受限流、额度、停发和验证约束', async () => {
    const emailDomains = { ...DEFAULT_EMAIL_DOMAIN_POLICY, allowlistEnabled: true, allowlist: ['example.test'] }
    await policy({ emailDomains, recipientDaily: 1 })
    await issueAccountEmail(t.db, 'reader', 'shared@example.test', 'verify-email')
    await expect(issueAccountEmail(t.db, 'other', 'shared@example.test', 'verify-email')).rejects.toMatchObject({ code: 'mail_recipient_rate' })
    await policy({ emailDomains, daily: 2, monthly: 3, reserveDaily: 1, reserveMonthly: 1 })
    await expect(issueAccountEmail(t.db, 'other', 'other@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_budget_exhausted' })
    await t.db.query(
      `INSERT INTO security_restrictions(id,kind,key_hash,action,effect,hint,reason,expires_at,created_at,actor_id)
      VALUES('domain-test-stop','email',$1,'all','block','fixture','停发优先测试',$2,1,'root')`,
      [securityKey('email:other@example.test'), Date.now() + 60000],
    )
    await expect(issueAccountEmail(t.db, 'other', 'other@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_restricted' })
    await policy({ emailDomains, challenges: { ...DEFAULT_SECURITY_POLICY.challenges, 'forgot-password': 'enforce' } })
    mocks.verify.mockResolvedValue(false)
    expect((await api('/auth/forgot-password', '', { identifier: 'reader' })).status).toBe(403)
    await runMailTick(t.db)
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send.mock.calls[0]?.[0]).toBe('shared@example.test')
  })

  it('新增域名限制会取消未发送队列并归还预占，记录拦截原因', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await policy({ emailDomains: { ...DEFAULT_EMAIL_DOMAIN_POLICY, blocklist: ['example.test'] } })
    await expect(issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_domain_blocked' })
    expect(await count()).toBe(1)
    await runMailTick(t.db)
    expect(await job(id)).toMatchObject({ state: 'cancelled', error_code: 'mail_domain_blocked' })
    expect(await count()).toBe(0)
    expect(mocks.send).not.toHaveBeenCalled()
    expect((await t.db.query('SELECT token_hash FROM account_email_tokens')).rows).toHaveLength(0)
    expect((await t.db.query("SELECT rule FROM security_events WHERE rule='mail_domain_blocked'")).rows).toHaveLength(1)
  })

  it('白名单收紧后，结果曾未知的邮件不重发也不归还额度', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('provider_network', 'unknown'))
    await runMailTick(t.db)
    await policy({ transport: 'resend', emailDomains: { ...DEFAULT_EMAIL_DOMAIN_POLICY, allowlistEnabled: true, allowlist: ['other.test'] } })
    await t.db.query('UPDATE mail_jobs SET next_attempt_at=0')
    await runMailTick(t.db)
    expect(await job(id)).toMatchObject({ state: 'unknown', error_code: 'mail_domain_not_allowed' })
    expect(await count()).toBe(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect((await t.db.query('SELECT token_hash FROM account_email_tokens')).rows).toHaveLength(1)
  })

  it('匿名找回的域名拦截仍返回统一结果，不泄露账号或邮箱是否存在', async () => {
    await policy({ emailDomains: { ...DEFAULT_EMAIL_DOMAIN_POLICY, blocklist: ['example.test'] } })
    const existing = await api('/auth/forgot-password', '', { identifier: 'reader' })
    const missing = await api('/auth/forgot-password', '', { identifier: 'missing' })
    expect(existing.status).toBe(200)
    expect(await existing.json()).toEqual(await missing.json())
    expect(await count()).toBe(0)
    expect((await t.db.query('SELECT id FROM mail_jobs')).rows).toHaveLength(0)
  })

  it('重复申请只预占一次，队列加密且任务换位不能解密', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    expect(await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')).toBe(id)
    expect(await count()).toBe(1)
    expect(mocks.send).not.toHaveBeenCalled()
    const row = await job(id),
      payload = openMail<MailPayload>(id, row.payload)
    expect(row.payload).not.toContain('reader@example.test')
    expect(row.payload).not.toContain('#token=')
    expect(payload.to).toBe('reader@example.test')
    expect(() => openMail('wrong', row.payload)).toThrow()
  })
  it('缺少加密密钥时令牌、预占和任务一起回滚', async () => {
    vi.stubEnv('MAIL_QUEUE_ENCRYPTION_KEY', '')
    vi.stubEnv('SITE_SETTINGS_ENCRYPTION_KEY', '')
    await expect(issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_key_missing' })
    expect(await count()).toBe(0)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(0)
  })
  it('普通预算耗尽不影响应急预留，任何入口不能突破总预算', async () => {
    await policy({ daily: 2, monthly: 4, reserveDaily: 1, reserveMonthly: 1 })
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await expect(issueAccountEmail(t.db, 'other', 'other@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_budget_exhausted' })
    await issueAccountEmail(t.db, 'other', 'other@example.test', 'reset-password', 'root', undefined, '核实用户身份', true)
    expect(await count()).toBe(2)
    await expect(issueAccountEmail(t.db, 'manager', 'manager@example.test', 'reset-password', 'root', undefined, '核实用户身份', true)).rejects.toThrow()
  })
  it('读者不能伪装应急发送', async () => {
    await expect(issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password', 'reader', undefined, '冒充应急操作', true)).rejects.toMatchObject({
      status: 403,
    })
    expect(await count()).toBe(0)
  })
  it('跨账号向同一邮箱发送受收件人上限保护', async () => {
    await policy({ recipientDaily: 1 })
    await issueAccountEmail(t.db, 'reader', 'shared@example.test', 'verify-email')
    await expect(issueAccountEmail(t.db, 'other', 'shared@example.test', 'verify-email')).rejects.toMatchObject({ code: 'mail_recipient_rate' })
    expect(await count()).toBe(1)
  })
  it('工作进程重新检查账号，失效任务取消并释放未发送额度', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await t.db.query("UPDATE users SET status='disabled' WHERE id='reader'")
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('cancelled')
    expect(await count()).toBe(0)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('暂停阻止领取，恢复后发送并清除加密正文', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await policy({ paused: true })
    await runMailTick(t.db)
    expect(mocks.send).not.toHaveBeenCalled()
    await policy()
    await runMailTick(t.db)
    expect(await job(id)).toMatchObject({ state: 'accepted', payload: '', attempts: 1 })
    expect(await count()).toBe(1)
  })
  it('SMTP 超时保留额度与有效链接，不盲目重试', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('smtp_unknown', 'unknown'))
    await runMailTick(t.db)
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('unknown')
    expect(await count()).toBe(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(1)
  })
  it('确定拒收归还额度并移除链接', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('smtp_rejected', 'rejected'))
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('failed')
    expect(await count()).toBe(0)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(0)
  })
  it('Resend 未知结果重试保持同一幂等键和正文', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('provider_network', 'unknown'))
    await runMailTick(t.db)
    expect(await job(id)).toMatchObject({ state: 'queued', had_unknown: true })
    await t.db.query('UPDATE mail_jobs SET next_attempt_at=0')
    await t.db.query('DELETE FROM mail_worker_status')
    await runMailTick(t.db)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect((await job(id)).state).toBe('accepted')
    expect(await count()).toBe(1)
  })
  it('曾经结果未知的任务后续拒收也不释放额度', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('provider_network', 'unknown'))
    await runMailTick(t.db)
    await t.db.query('UPDATE mail_jobs SET next_attempt_at=0')
    await t.db.query('DELETE FROM mail_worker_status')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('provider_422', 'rejected'))
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('unknown')
    expect(await count()).toBe(1)
  })
  it('跨日未发送任务重新分配预算，当日额度不足则取消', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    const yesterday = Date.now() - 86400000,
      old = budgetPeriods(yesterday)
    await t.db.query('DELETE FROM mail_budget')
    for (const period of old) await t.db.query('INSERT INTO mail_budget(period,reserved,ordinary) VALUES($1,1,1)', [period])
    await t.db.query('UPDATE mail_jobs SET budget_at=$2 WHERE id=$1', [id, yesterday])
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('accepted')
    expect(await count()).toBe(1)
    expect(await count(old[0])).toBe(0)
  })
  it('恢复旧库后必须核对额度才允许解除暂停', async () => {
    await policy({ paused: true })
    await t.db.query("INSERT INTO mail_worker_status(id,updated_at) VALUES('restore-hold',1)")
    await expect(saveSecurityPolicy(t.db, 'root', { ...DEFAULT_SECURITY_POLICY, paused: false }, '核对后恢复')).rejects.toMatchObject({
      code: 'restore_reconciliation_required',
    })
    expect((await api('/admin/security/budget-reconcile', 'root', { daily: 2, monthly: 10, reason: '核对服务商控制台' })).status).toBe(200)
    expect(await count()).toBe(2)
    await expect(saveSecurityPolicy(t.db, 'root', { ...DEFAULT_SECURITY_POLICY, paused: false }, '核对后恢复')).resolves.toHaveProperty('paused', false)
  })
  it('人机验证在服务端校验用途，未通过不创建发送任务', async () => {
    await policy({ challenges: { ...DEFAULT_SECURITY_POLICY.challenges, 'forgot-password': 'enforce' } })
    mocks.verify.mockResolvedValue(false)
    const response = await api('/auth/forgot-password', '', { identifier: 'reader', turnstileToken: 'invalid' })
    expect(response.status).toBe(403)
    expect(await count()).toBe(0)
    expect(mocks.verify).toHaveBeenCalledWith('invalid', '', 'forgot_password')
  })
  it('匿名找回对不存在、未验证与已验证账号返回相同结构', async () => {
    await t.db.query("UPDATE users SET email_verified_at=0 WHERE id='other'")
    const bodies = []
    for (const identifier of ['missing', 'other', 'reader']) {
      const r = await api('/auth/forgot-password', '', { identifier })
      expect(r.status).toBe(200)
      bodies.push(await r.json())
    }
    expect(bodies[0]).toEqual(bodies[1])
    expect(bodies[1]).toEqual(bodies[2])
    expect(await count()).toBe(1)
  })
  it('IP 限流与验证例外仍不能绕过请求上限', async () => {
    await policy({ ipQuarterHour: 2, challenges: { ...DEFAULT_SECURITY_POLICY.challenges, register: 'enforce' } })
    await t.db.query(
      `INSERT INTO security_restrictions(id,kind,key_hash,action,effect,hint,reason,expires_at,created_at,actor_id)
      VALUES('allow','ip',$1,'register','allow','fixture','测试例外',$2,1,'root')`,
      [securityKey('ip:198.51.100.1'), Date.now() + 60000],
    )
    await protectRequest(t.db, 'register', 'one', '198.51.100.1', null)
    await protectRequest(t.db, 'register', 'two', '198.51.100.1', null)
    await expect(protectRequest(t.db, 'register', 'three', '198.51.100.1', null)).rejects.toMatchObject({ code: 'security_rate_limited' })
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('普通管理员仅能查看读者记录，不能修改策略或查看其他管理员详情', async () => {
    const root = await issueAccountEmail(t.db, 'root', 'root@example.test', 'reset-password')
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    const r = await api('/admin/security/mail', 'manager')
    expect(r.status).toBe(200)
    const data = (await r.json()) as { items: MailJob[] }
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.user_id).toBe('reader')
    expect(JSON.stringify(data)).not.toContain('token_hash')
    expect(JSON.stringify(data)).not.toContain('credential_hash')
    expect((await api('/admin/security/mail/' + root, 'manager')).status).toBe(403)
    expect((await api('/admin/security/policy', 'manager', { policy: DEFAULT_SECURITY_POLICY, reason: '尝试修改' }, 'PUT')).status).toBe(403)
  })
  it('验证回调签名、重复事件去重、迟到事件不倒退状态，投诉触发停发', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await runMailTick(t.db)
    async function event(type: string, eventId: string) {
      const timestamp = String(Math.floor(Date.now() / 1000)),
        raw = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: 'provider-1', tags: { job_id: id } } })
      const signature = createHmac('sha256', Buffer.from(process.env.RESEND_WEBHOOK_SECRET!.slice(6), 'base64'))
        .update(`${eventId}.${timestamp}.${raw}`)
        .digest('base64')
      await receiveMailWebhook(t.db, raw, { 'svix-id': eventId, 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + signature })
    }
    await expect(receiveMailWebhook(t.db, '{}', { 'svix-id': 'bad', 'svix-timestamp': '0', 'svix-signature': 'bad' })).rejects.toMatchObject({
      code: 'webhook_invalid',
    })
    await event('email.delivered', 'event-delivered')
    await event('email.delivered', 'event-delivered')
    await event('email.sent', 'event-sent')
    expect((await job(id)).state).toBe('delivered')
    expect((await t.db.query('SELECT * FROM mail_delivery_events')).rows).toHaveLength(2)
    await event('email.complained', 'event-complained')
    expect((await job(id)).state).toBe('complained')
    await expect(issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_restricted' })
    expect(await count()).toBe(1)
  })
  it('加密正文不接受篡改', () => {
    const encrypted = sealMail('job', { secret: 'fixture' }),
      parts = encrypted.split('.')
    parts[3] = Buffer.from('tampered').toString('base64')
    expect(() => openMail('job', parts.join('.'))).toThrow()
  })
  it('回调先于发送响应时保持投递终态，并保留尝试过程', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockImplementationOnce(async () => {
      await signedEvent('early', 'email.delivered', { email_id: 'provider-1', tags: { job_id: id } })
      return { providerId: 'provider-1' }
    })
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('delivered')
    expect((await t.db.query('SELECT outcome FROM mail_attempts WHERE job_id=$1', [id])).rows).toEqual([{ outcome: 'accepted' }])
    expect(await count()).toBe(1)
  })
  it('没有任务标签的先到回调在拿到服务商 ID 后补记', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await signedEvent('unmatched', 'email.delivered', { email_id: 'provider-1' })
    await runMailTick(t.db)
    await reconcileDeliveryEvents(t.db)
    expect((await job(id)).state).toBe('delivered')
    expect((await t.db.query('SELECT applied FROM mail_delivery_events')).rows).toEqual([{ applied: true }])
  })
  it('临时退信不永久停发，永久退信和投诉清理链接并停发', async () => {
    await policy({ transport: 'resend' })
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await runMailTick(t.db)
    await signedEvent('soft', 'email.bounced', { email_id: 'provider-1', bounce: { type: 'Transient' } })
    expect((await job(id)).state).toBe('failed')
    expect((await t.db.query('SELECT * FROM security_restrictions')).rows).toHaveLength(0)
    await signedEvent('hard', 'email.bounced', { email_id: 'provider-1', bounce: { type: 'Permanent' } })
    expect((await job(id)).state).toBe('bounced')
    expect((await t.db.query('SELECT * FROM security_restrictions')).rows).toHaveLength(1)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(0)
    expect(await count()).toBe(1)
  })
  it('管理员核实未知失败保留消耗，核实记录不会再次发送', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    mocks.send.mockRejectedValueOnce(new MailDeliveryError('smtp_unknown', 'unknown'))
    await runMailTick(t.db)
    expect((await api(`/admin/security/mail/${id}/resolve`, 'root', { state: 'failed', reason: '已核对服务商日志' })).status).toBe(200)
    expect((await job(id)).state).toBe('failed')
    expect(await count()).toBe(1)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(0)
    await runMailTick(t.db)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect((await api(`/admin/security/mail/${id}/resolve`, 'root', { state: 'accepted', reason: '重复提交核实结果' })).status).toBe(409)
  })
  it('过期的 SMTP 发送租约只标记待核实，不重复投递', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await t.db.query("UPDATE mail_jobs SET state='sending',attempts=1,lease_until=1 WHERE id=$1", [id])
    await t.db.query("INSERT INTO mail_attempts(job_id,attempt,outcome,created_at) VALUES($1,1,'sending',1)", [id])
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('unknown')
    expect(await count()).toBe(1)
    expect(mocks.send).not.toHaveBeenCalled()
    expect((await t.db.query('SELECT outcome FROM mail_attempts')).rows).toEqual([{ outcome: 'unknown' }])
  })
  it('队列过期、管理取消和投递方式变化均不会继续发送', async () => {
    const id = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await t.db.query('UPDATE mail_jobs SET expires_at=1 WHERE id=$1', [id])
    await runMailTick(t.db)
    expect((await job(id)).state).toBe('expired')
    expect(await count()).toBe(0)
    const cancel = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    expect((await api(`/admin/security/mail/${cancel}/cancel`, 'root', { reason: '用户已无需此邮件' })).status).toBe(200)
    expect(await count()).toBe(0)
    const changed = await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await policy({ transport: 'resend' })
    await runMailTick(t.db)
    expect((await job(changed)).state).toBe('cancelled')
    expect(await count()).toBe(0)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('策略冲突仍阻止覆盖，有效会话无需再次验证并保留审计前后值', async () => {
    const next = { ...DEFAULT_SECURITY_POLICY, daily: 90 }
    await saveSecurityPolicy(t.db, 'root', next, '调整本站发信预算')
    await expect(saveSecurityPolicy(t.db, 'root', next, '重复保存过期策略')).rejects.toMatchObject({ code: 'policy_conflict' })
    const audit = (
      await t.db.query<{ before_state: SecurityPolicy; after_state: SecurityPolicy }>(
        "SELECT before_state,after_state FROM account_security_audit WHERE action='security-policy'",
      )
    ).rows[0]!
    expect(audit.before_state.daily).toBe(80)
    expect(audit.after_state.daily).toBe(90)
    await t.db.query("UPDATE user_sessions SET reauthenticated_at=1 WHERE user_id='root'")
    const response = await api('/admin/security/budget-reconcile', 'root', { daily: 1, monthly: 1, reason: '核对外部邮件用量' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true })
    expect(await count()).toBe(1)
  })
  it('匿名账号输入不获得账号例外，限制自动到期且允许规则不覆盖封禁', async () => {
    await policy({ challenges: { ...DEFAULT_SECURITY_POLICY.challenges, login: 'enforce' } })
    const rule = { kind: 'account', value: 'reader', action: 'verify-email', effect: 'allow', hours: 1, reason: '核实用户后临时放行' }
    expect((await api('/admin/security/restrictions', 'root', rule)).status).toBe(200)
    mocks.verify.mockResolvedValue(false)
    await expect(protectRequest(t.db, 'login', 'reader', '', null, 'reader')).rejects.toMatchObject({ code: 'challenge_required' })
    expect((await api('/admin/security/restrictions', 'root', { ...rule, effect: 'block' })).status).toBe(200)
    await expect(protectRequest(t.db, 'verify-email', 'reader', '', null, 'reader')).rejects.toMatchObject({ code: 'security_restricted' })
    await t.db.query('UPDATE security_restrictions SET expires_at=1')
    await expect(protectRequest(t.db, 'verify-email', 'reader', '', null, 'reader')).resolves.toBeUndefined()
  })
  it('预算预占失败不会留下新任务或令牌', async () => {
    await policy({ daily: 2, monthly: 3, reserveDaily: 1, reserveMonthly: 1 })
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')
    await expect(issueAccountEmail(t.db, 'other', 'other@example.test', 'reset-password')).rejects.toMatchObject({ code: 'mail_budget_exhausted' })
    expect((await t.db.query('SELECT * FROM mail_jobs')).rows).toHaveLength(1)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(1)
    expect(await count()).toBe(1)
  })

  it('可从脱敏事件限制来源，同一目标账号仍可从其他来源操作', async () => {
    await policy({ challenges: { ...DEFAULT_SECURITY_POLICY.challenges, login: 'observe' } })
    await protectRequest(t.db, 'login', 'reader', '198.51.100.10', null, 'reader')
    const events = (await (await api('/admin/security/events')).json()) as { items: Array<{ id: string; can_restrict_source: boolean }> }
    expect(events.items[0]?.can_restrict_source).toBe(true)
    expect(JSON.stringify(events)).not.toContain('198.51.100.10')
    expect(JSON.stringify(events)).not.toContain('source_hash')
    const path = `/admin/security/events/${events.items[0]!.id}/restrict-source`
    expect((await api(path, 'manager', { reason: '普通管理员尝试处置' })).status).toBe(403)
    expect((await api(path, 'root', { reason: '核实异常来源后限制' })).status).toBe(200)
    await expect(protectRequest(t.db, 'login', 'reader', '198.51.100.10', null, 'reader')).rejects.toMatchObject({ code: 'security_restricted' })
    await expect(protectRequest(t.db, 'login', 'reader', '198.51.100.11', null, 'reader')).resolves.toBeUndefined()
  })

  it('队列心跳和邮件计数不使备份影响报告过期，策略修改仍会使其过期', async () => {
    const before = await liveImpactFingerprint(t.db)
    await t.db.query("INSERT INTO mail_worker_status(id,updated_at) VALUES('worker',1)")
    await t.db.query("INSERT INTO mail_budget(period,reserved,ordinary) VALUES('d:fixture',1,1)")
    expect(await liveImpactFingerprint(t.db)).toBe(before)
    await policy({ daily: 90 })
    expect(await liveImpactFingerprint(t.db)).not.toBe(before)
  })
})
