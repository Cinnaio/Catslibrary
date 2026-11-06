import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { createSession } from '../services/sessions'
import { hashPassword, hashToken, newSalt, type UserRow } from '../services/auth'
import { loadConfig } from '../config'
import { assertSuperAdministrator, recoverSuperAdministrator, siteInitialized } from '../services/account-security'
import { consumeAccountEmail, issueAccountEmail, limitEmailRequest } from '../services/account-email'

const mail = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../services/mail', async importOriginal => ({
  ...await importOriginal<typeof import('../services/mail')>(),
  mailConfiguration: () => ({ ready: true, publicOrigin: 'https://reader.example.test' }),
  publicMailStatus: () => ({ ready: true }),
  sendAccountMail: mail.send,
}))
let t: TestDb
let salt: string
let passwordHash: string
const password = 'Account-test-123'
const tokens: Record<string, string> = {}
function request(route: string, body?: unknown, actor?: string, method = body === undefined ? 'GET' : 'POST') {
  return app.request('/api' + route, {
    method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${tokens[actor]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function mutate(actor: string, target: string, action: string, values: Record<string, unknown> = {}) {
  return request('/admin-users', { action, id: target, expectedRole: target === 'root' ? 'super_admin' : target === 'manager' ? 'admin' : 'reader', expectedStatus: 'active', reason: '测试账号变更原因', ...values }, actor)
}
function latestToken() { return new URLSearchParams(new URL(mail.send.mock.calls.at(-1)![2]).hash.slice(1)).get('token')! }
async function row(id = 'reader') { return (await t.db.query<UserRow>('SELECT * FROM users WHERE id=$1', [id])).rows[0]! }
async function verified() { await t.db.query("UPDATE users SET email='reader@example.test',email_verified_at=1 WHERE id='reader'") }
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  salt = newSalt(); passwordHash = await hashPassword(password, salt)
})
beforeEach(async () => {
  mail.send.mockReset().mockResolvedValue(undefined)
  await t.db.query('DELETE FROM users')
  await t.db.query('DELETE FROM site_initialization')
  await t.db.query('DELETE FROM account_security_audit')
  await t.db.query('DELETE FROM admin_operation_audit')
  await t.db.query('DELETE FROM login_failures')
  for (const [id, role] of [['root', 'super_admin'], ['manager', 'admin'], ['reader', 'reader'], ['other', 'reader']] as const) {
    await t.db.query('INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,$2,$3,$4,1,1)', [id, role, passwordHash, salt])
    tokens[id] = await createSession(t.db, id, 'test', loadConfig().sessionHashSalt)
  }
})
afterAll(async () => { setDbForTests(null); delete process.env.DATABASE_URL; await t.close() })

describe('三级权限与初始化保护', () => {
  it('超级管理员可保存并读取即时生效的 SMTP 配置，旧修订不能覆盖且公开状态不泄露字段', async () => {
    const config = { revision: 0, host: 'smtp.example.test', port: 465, security: 'tls', username: 'smtp-user',
      password: 'route-fixture-secret', from: 'account@example.test', publicOrigin: 'https://reader.example.test' }
    expect((await request('/auth/mail-settings', { ...config, password: 'x'.repeat(17000) }, 'root', 'PUT')).status).toBe(413)
    expect((await request('/auth/mail-settings/test', { revision: 0, padding: 'x'.repeat(2048) }, 'root')).status).toBe(413)
    const response = await request('/auth/mail-settings', config, 'root', 'PUT')
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ revision: 1, source: 'local', host: 'smtp.example.test', passwordSet: true, ready: true })
    expect(JSON.stringify(result)).not.toContain('route-fixture-secret')
    expect((await request('/auth/mail-settings', config, 'root', 'PUT')).status).toBe(409)
    expect(await (await request('/auth/mail-status')).json()).toEqual({ ready: true })
    expect(await (await request('/auth/mail-settings', undefined, 'root')).json()).toEqual(result)
  })
  it('新安装只创建超级管理员，初始化标记在用户删除后仍生效', async () => {
    await t.db.query('DELETE FROM users')
    const response = await request('/auth/bootstrap-admin', { username: 'founder', password })
    expect(response.status).toBe(201)
    expect(((await response.json()) as { user: { role: string } }).user.role).toBe('super_admin')
    await t.db.query('DELETE FROM users')
    expect(await siteInitialized(t.db)).toBe(true)
    expect((await request('/auth/bootstrap-admin', { username: 'takeover', password })).status).toBe(409)
    await expect(assertSuperAdministrator(t.db)).rejects.toThrow('admin:recover')
  })
  it('仅有读者的旧站也不重新开放初始化；恢复只提升明确指定账号并撤销旧凭据', async () => {
    await t.db.query("DELETE FROM users WHERE role<>'reader'")
    expect((await request('/auth/bootstrap-admin', { username: 'takeover', password })).status).toBe(409)
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'verify-email')
    await expect(recoverSuperAdministrator(t.db, 'missing', '明确恢复')).rejects.toThrow('账号不存在')
    await recoverSuperAdministrator(t.db, 'reader', '站点所有者明确指定')
    expect((await row()).role).toBe('super_admin')
    expect((await request('/auth/me', undefined, 'reader')).status).toBe(401)
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(0)
    await expect(assertSuperAdministrator(t.db)).resolves.toBeUndefined()
  })
  it('070 不自动提升已有管理员，记录旧站初始化事实', async () => {
    const legacy = await createTestDb()
    try {
      const dir = fileURLToPath(new URL('../db/migrations', import.meta.url))
      const connection = await legacy.db.connect()
      for (const file of (await readdir(dir)).filter(name => name.endsWith('.sql') && Number.parseInt(name) < 70).sort((a, b) => Number.parseInt(a) - Number.parseInt(b))) {
        await connection.query(await readFile(path.join(dir, file), 'utf8'))
      }
      await legacy.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('old','old','admin',$1,$2,1,1)", [passwordHash, salt])
      await connection.query(await readFile(path.join(dir, '070_account_security.sql'), 'utf8'))
      expect((await legacy.db.query<{ role: string }>("SELECT role FROM users WHERE id='old'")).rows[0]!.role).toBe('admin')
      expect((await legacy.db.query('SELECT * FROM site_initialization')).rows).toHaveLength(1)
      await expect(assertSuperAdministrator(legacy.db)).rejects.toThrow('admin:recover')
      connection.release()
    } finally { await legacy.close() }
  })
  it('普通管理员保留内容入口，站点、备份、模型与书源凭据配置仅超级管理员可用', async () => {
    expect((await request('/admin/novel-index', undefined, 'manager')).status).toBe(200)
    expect((await request('/admin/novel-index', undefined, 'root')).status).toBe(200)
    expect((await request('/admin/novel-index', undefined, 'reader')).status).toBe(403)
    expect((await request('/admin/site', undefined, 'manager')).status).toBe(200)
    expect((await request('/admin/site', { announcement: '禁止越权' }, 'manager', 'PUT')).status).toBe(403)
    for (const route of ['/admin/content-policy', '/admin/site-settings/passkey', '/admin/backups/settings', '/ai/provider-presets', '/auth/mail-settings', '/scrape?action=po18-account', '/scrape?action=proxy-config']) {
      expect((await request(route, undefined, 'manager')).status, route).toBe(403)
    }
    expect((await request('/ai/settings', {}, 'manager', 'PUT')).status).toBe(403)
    expect((await request('/scrape', { action: 'proxy', proxyBase: '' }, 'manager')).status).toBe(403)
    expect((await request('/admin-users', { action: 'settings', registerMode: 'open' }, 'manager')).status).toBe(403)
    for (const actor of ['manager', 'reader', undefined]) {
      expect((await request('/auth/mail-settings', {}, actor, 'PUT')).status).toBe(actor ? 403 : 401)
      expect((await request('/auth/mail-settings/test', { revision: 0 }, actor)).status).toBe(actor ? 403 : 401)
    }
  })
  it('普通管理员不能修改其他管理员、授予角色或调用旧设密接口', async () => {
    expect((await mutate('manager', 'root', 'user-status', { status: 'disabled' })).status).toBe(403)
    expect((await mutate('manager', 'reader', 'user-role', { role: 'admin' })).status).toBe(403)
    expect((await request('/admin-users', { action: 'set-password', id: 'reader', newPassword: password }, 'manager')).status).toBe(410)
  })
  it('缺少原因或目标快照不能变更账号', async () => {
    expect((await mutate('root', 'reader', 'user-role', { role: 'admin', reason: '' })).status).toBe(400)
    expect((await mutate('root', 'reader', 'user-role', { role: 'admin', expectedRole: 'admin' })).status).toBe(409)
    expect((await row()).role).toBe('reader')
  })
  it('角色变更原子撤销全部会话和邮件链接，并保存可查看的原因与前后状态', async () => {
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'verify-email')
    const link = latestToken()
    expect((await mutate('root', 'reader', 'user-role', { role: 'admin' })).status).toBe(200)
    expect((await request('/auth/me', undefined, 'reader')).status).toBe(401)
    await expect(consumeAccountEmail(t.db, link, 'verify-email')).rejects.toThrow('链接无效')
    const result = await (await request('/admin/operations?action=user-role', undefined, 'root')).json() as { operations: unknown[] }
    expect(result.operations[0]).toMatchObject({ accountReason: '测试账号变更原因', accountTarget: 'reader', beforeState: { role: 'reader' }, afterState: { role: 'admin' } })
  })
  it('保护最后一位可用超级管理员，禁用和删除本人也被拒绝', async () => {
    expect((await mutate('root', 'root', 'user-role', { role: 'reader' })).status).toBe(400)
    expect((await mutate('root', 'root', 'user-status', { status: 'disabled' })).status).toBe(400)
    expect((await mutate('root', 'root', 'delete-user', { confirmUsername: 'root' })).status).toBe(400)
    await t.db.query("UPDATE users SET role='super_admin',status='disabled' WHERE id='other'")
    expect((await mutate('root', 'root', 'user-role', { role: 'reader' })).status).toBe(400)
    await t.db.query("UPDATE users SET status='active' WHERE id='other'")
    expect((await mutate('root', 'root', 'user-role', { role: 'reader' })).status).toBe(200)
    expect((await request('/auth/me', undefined, 'root')).status).toBe(401)
  })
  it('普通管理员可以禁用、恢复和删除读者，删除须确认用户名', async () => {
    expect((await mutate('manager', 'reader', 'user-status', { status: 'disabled' })).status).toBe(200)
    expect((await request('/auth/me', undefined, 'reader')).status).toBe(401)
    expect((await mutate('manager', 'reader', 'user-status', { status: 'active', expectedStatus: 'disabled' })).status).toBe(200)
    expect((await mutate('manager', 'reader', 'delete-user', { confirmUsername: 'wrong' })).status).toBe(400)
    expect((await mutate('manager', 'reader', 'delete-user', { confirmUsername: 'reader' })).status).toBe(200)
    expect(await row()).toBeUndefined()
  })
})

describe('邮箱验证与密码找回', () => {
  it('绑定需要当前密码，确认前旧邮箱保留，确认后会话撤销，链接只能使用一次', async () => {
    expect((await request('/auth/email/request', { email: 'reader@example.test', currentPassword: 'wrong' }, 'reader')).status).toBe(400)
    const response = await request('/auth/email/request', { email: ' Reader@Example.Test ', currentPassword: password }, 'reader')
    expect(response.status).toBe(200)
    expect((await row()).email).toBeNull()
    const token = latestToken()
    const records = (await t.db.query<{ token_hash: string }>('SELECT * FROM account_email_tokens')).rows
    expect(records[0]!.token_hash).not.toBe(token)
    expect(records[0]!.token_hash).toBe(await hashToken(token, loadConfig().sessionHashSalt))
    expect((await request('/auth/email/verify', { token })).status).toBe(200)
    expect((await row()).email).toBe('reader@example.test')
    expect((await request('/auth/me', undefined, 'reader')).status).toBe(401)
    expect((await request('/auth/email/verify', { token })).status).toBe(400)
  })
  it('同邮箱的两个待确认请求只有一个能绑定成功', async () => {
    await issueAccountEmail(t.db, 'reader', 'shared@example.test', 'verify-email'); const first = latestToken()
    await issueAccountEmail(t.db, 'other', 'shared@example.test', 'verify-email'); const second = latestToken()
    await consumeAccountEmail(t.db, first, 'verify-email')
    await expect(consumeAccountEmail(t.db, second, 'verify-email')).rejects.toThrow('此邮箱无法绑定')
    expect((await row('other')).email).toBeNull()
  })
  it('拒绝过期、用途错误、重发前和凭据变更前的链接', async () => {
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'verify-email'); const old = latestToken()
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'verify-email'); const current = latestToken()
    await expect(consumeAccountEmail(t.db, old, 'verify-email')).rejects.toThrow('链接无效')
    await expect(consumeAccountEmail(t.db, current, 'reset-password', password)).rejects.toThrow('链接无效')
    await t.db.query('UPDATE account_email_tokens SET expires_at=1')
    await expect(consumeAccountEmail(t.db, current, 'verify-email')).rejects.toThrow('链接无效')
    await expect(issueAccountEmail(t.db, 'reader', 'reader@example.test', 'verify-email', 'reader', { role: 'reader', status: 'active', passwordHash: 'old' })).rejects.toThrow('凭据已变化')
  })
  it('管理员重置仅发邮件、保留密码，用户确认后更换密码并撤销会话', async () => {
    expect((await mutate('manager', 'reader', 'reset-password')).status).toBe(400)
    await verified()
    const result = await mutate('manager', 'reader', 'reset-password')
    expect(result.status).toBe(200)
    expect(await result.json()).not.toHaveProperty('tempPassword')
    expect((await row()).password_hash).toBe(passwordHash)
    expect((await request('/auth/me', undefined, 'reader')).status).toBe(200)
    const token = latestToken()
    expect((await request('/auth/reset-password', { token, password: 'short' })).status).toBe(400)
    expect((await request('/auth/reset-password', { token, password: 'New-password-456' })).status).toBe(200)
    expect((await request('/auth/me', undefined, 'reader')).status).toBe(401)
    expect((await request('/auth/login', { username: 'reader', password })).status).toBe(401)
    expect((await request('/auth/login', { username: 'reader', password: 'New-password-456' })).status).toBe(200)
    expect((await request('/auth/reset-password', { token, password })).status).toBe(400)
  })
  it('自行改密会废弃之前邮件链接；更换邮箱也废弃旧重置链接', async () => {
    await verified()
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password'); const old = latestToken()
    expect((await request('/auth/change-password', { currentPassword: password, newPassword: 'Own-new-password' }, 'reader')).status).toBe(200)
    await expect(consumeAccountEmail(t.db, old, 'reset-password', password)).rejects.toThrow('链接无效')
    await issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password'); const previousEmail = latestToken()
    await issueAccountEmail(t.db, 'reader', 'new@example.test', 'verify-email')
    expect((await row()).email).toBe('reader@example.test')
    await consumeAccountEmail(t.db, latestToken(), 'verify-email')
    await expect(consumeAccountEmail(t.db, previousEmail, 'reset-password', password)).rejects.toThrow('链接无效')
  })
  it('发送失败撤销刚签发的链接，并且不会改动密码', async () => {
    await verified(); mail.send.mockRejectedValueOnce(new Error('fake SMTP failure'))
    await expect(issueAccountEmail(t.db, 'reader', 'reader@example.test', 'reset-password')).rejects.toThrow()
    expect((await t.db.query('SELECT * FROM account_email_tokens')).rows).toHaveLength(0)
    expect((await row()).password_hash).toBe(passwordHash)
    expect((await t.db.query<{ status: string; response_status: number }>("SELECT status,response_status FROM admin_operation_audit WHERE action='request-reset-password'")).rows[0]).toEqual({ status: 'failed', response_status: 503 })
  })
  it('公开找回接口对不存在、未验证与已验证账号返回相同消息', async () => {
    await verified()
    const responses = []
    for (const identifier of ['missing', 'other', 'reader']) {
      const response = await request('/auth/forgot-password', { identifier })
      expect(response.status).toBe(200); responses.push(await response.json())
    }
    expect(responses[0]).toEqual(responses[1]); expect(responses[1]).toEqual(responses[2])
    await vi.waitFor(() => expect(mail.send).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect((await t.db.query<{ status: string }>("SELECT status FROM admin_operation_audit WHERE action='request-reset-password'")).rows[0]?.status).toBe('completed'))
  })
  it('账号和 IP 限流均落在数据库，不能换地址或账号绕过', async () => {
    for (let index = 0; index < 3; index++) await limitEmailRequest(t.db, 'one', `ip${index}`)
    await expect(limitEmailRequest(t.db, 'one', 'new-ip')).rejects.toMatchObject({ status: 429 })
    for (let index = 0; index < 20; index++) await limitEmailRequest(t.db, `person${index}`, 'same-ip')
    await expect(limitEmailRequest(t.db, 'another', 'same-ip')).rejects.toMatchObject({ status: 429 })
  })
})
