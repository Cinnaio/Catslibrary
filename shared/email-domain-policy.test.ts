import { describe, expect, it } from 'vitest'
import { DEFAULT_EMAIL_DOMAIN_POLICY, EMAIL_DOMAIN_LIST_LIMIT, emailDomainRejection, parseEmailDomainList } from './email-domain-policy'

describe('邮箱域名名单', () => {
  it('忽略大小写、空白行并去重，拒绝邮箱、网址和通配符', () => {
    expect(parseEmailDomainList([' EXAMPLE.COM ', '', 'example.com', 'mail.example.com'])).toEqual({ domains: ['example.com', 'mail.example.com'], error: '' })
    for (const domain of [
      'user@example.com',
      '@example.com',
      'https://example.com',
      '*.example.com',
      '-mail.example.com',
      'mail..example.com',
      '127.0.0.1',
      'a'.repeat(64) + '.com',
      '例子.公司',
      'K.com',
    ])
      expect(parseEmailDomainList([domain]).error).not.toBe('')
    expect(parseEmailDomainList(null).error).not.toBe('')
    expect(parseEmailDomainList([7]).error).not.toBe('')
    expect(parseEmailDomainList(Array.from({ length: EMAIL_DOMAIN_LIST_LIMIT + 1 }, (_, i) => `mail${i}.example.com`)).error).not.toBe('')
  })

  it('黑名单优先于白名单，白名单关闭时不限制其他域名', () => {
    const p = { ...DEFAULT_EMAIL_DOMAIN_POLICY, blocklist: ['blocked.test'], allowlist: ['allowed.test', 'blocked.test'] }
    expect(emailDomainRejection('user@other.test', p)).toBeNull()
    expect(emailDomainRejection('user@blocked.test', p)).toBe('mail_domain_blocked')
    const enabled = { ...p, allowlistEnabled: true }
    expect(emailDomainRejection('user@ALLOWED.TEST', enabled)).toBeNull()
    expect(emailDomainRejection('user@other.test', enabled)).toBe('mail_domain_not_allowed')
    expect(emailDomainRejection('user@blocked.test', enabled)).toBe('mail_domain_blocked')
  })

  it('子域名必须显式启用，后缀相似域名不能冒充名单域名', () => {
    const p = { ...DEFAULT_EMAIL_DOMAIN_POLICY, allowlistEnabled: true, allowlist: ['example.com'] }
    expect(emailDomainRejection('user@mail.example.com', p)).toBe('mail_domain_not_allowed')
    const subdomains = { ...p, includeSubdomains: true }
    expect(emailDomainRejection('user@mail.example.com', subdomains)).toBeNull()
    expect(emailDomainRejection('user@a.mail.example.com', subdomains)).toBeNull()
    for (const email of ['user@fakeexample.com', 'user@example.com.other.test', 'example.com']) expect(emailDomainRejection(email, subdomains)).not.toBeNull()
    expect(emailDomainRejection('user@mail.example.com', { ...subdomains, blocklist: ['example.com'] })).toBe('mail_domain_blocked')
  })
})
