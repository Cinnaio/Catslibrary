export interface EmailDomainPolicy {
  allowlistEnabled: boolean
  includeSubdomains: boolean
  blocklist: string[]
  allowlist: string[]
}

export const DEFAULT_EMAIL_DOMAIN_POLICY: EmailDomainPolicy = {
  allowlistEnabled: false,
  includeSubdomains: false,
  blocklist: [],
  allowlist: [],
}
export const EMAIL_DOMAIN_LIST_LIMIT = 200

export function normalizeEmailDomain(value: string): string | null {
  const input = value.trim()
  if (!/^[a-zA-Z0-9.-]+$/.test(input)) return null
  const domain = input.toLowerCase()
  const labels = domain.split('.')
  if (domain.length > 253 || labels.length < 2 || !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(labels.at(-1) || '')) return null
  if (labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
  return domain
}

export function parseEmailDomainList(input: unknown): { domains: string[]; error: string } {
  if (!Array.isArray(input) || input.length > 1000 || input.some((value) => typeof value !== 'string')) return { domains: [], error: '请按行填写域名列表' }
  const domains = new Set<string>()
  for (const [index, value] of input.entries()) {
    if (!value.trim()) continue
    const domain = normalizeEmailDomain(value)
    if (!domain) return { domains: [], error: `第 ${index + 1} 行不是有效域名，请勿填写邮箱、网址或通配符` }
    domains.add(domain)
    if (domains.size > EMAIL_DOMAIN_LIST_LIMIT) return { domains: [], error: `每份名单最多填写 ${EMAIL_DOMAIN_LIST_LIMIT} 个域名` }
  }
  return { domains: [...domains], error: '' }
}

export function emailDomainRejection(email: string, policy: EmailDomainPolicy): 'mail_domain_blocked' | 'mail_domain_not_allowed' | null {
  const at = email.lastIndexOf('@')
  const domain = at > 0 ? normalizeEmailDomain(email.slice(at + 1)) : null
  if (!domain) return 'mail_domain_blocked'
  const matches = (entry: string) => domain === entry || (policy.includeSubdomains && domain.endsWith('.' + entry))
  if (policy.blocklist.some(matches)) return 'mail_domain_blocked'
  if (policy.allowlistEnabled && !policy.allowlist.some(matches)) return 'mail_domain_not_allowed'
  return null
}
