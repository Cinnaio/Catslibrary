export const USER_ROLES = ['reader', 'admin', 'super_admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export function isUserRole(role: unknown): role is UserRole {
  return USER_ROLES.some(value => value === role)
}
export function isAdministrator(role: unknown): boolean {
  return role === 'admin' || role === 'super_admin'
}
export function isSuperAdministrator(role: unknown): boolean {
  return role === 'super_admin'
}
export function roleLabel(role: unknown): string {
  return role === 'super_admin' ? '超级管理员' : role === 'admin' ? '管理员' : role === 'reader' ? '读者' : '未知角色'
}
export function canManageUser(actor: unknown, target: unknown): boolean {
  return isUserRole(target) && (actor === 'super_admin' || (actor === 'admin' && target === 'reader'))
}

/** API 和界面共用的站点级权限边界。 */
export function requiresSuperAdministrator(path: string, method = 'GET', action = ''): boolean {
  path = path.replace(/\/+$/, '')
  if (['/api/admin/site', '/api/admin/site/traffic'].includes(path) && method === 'GET') return false
  return /^\/api\/admin\/(backups|site-settings|site)(?:\/|$)/.test(path) ||
    (/^\/api\/admin\/security(?:\/|$)/.test(path) && (method !== 'GET' || !/^\/api\/admin\/security\/(mail|events)(?:\/|$)/.test(path))) ||
    path === '/api/admin/content-policy' ||
    /^\/api\/ai\/(provider|provider-presets|test)(?:\/|$)/.test(path) ||
    (path === '/api/ai/settings' && method !== 'GET') ||
    (path === '/api/scrape' && /^(proxy|source-account)(?:-|$)/.test(action))
}

export function requiresSuperAdministratorPage(path: string, search = ''): boolean {
  path = path.replace(/\/+$/, '')
  const params = new URLSearchParams(search)
  return ['/admin/site-settings', '/admin/backups', '/admin/content-policy'].includes(path) ||
    (path === '/admin/security' && !['mail','events'].includes(params.get('view') || '')) ||
    (path === '/admin/ai' && ['config', 'params'].includes(params.get('sub') || '')) ||
    (path === '/admin/scrape' && params.get('view') === 'proxy') ||
    (path === '/admin/calls' && params.get('view') === 'outbound')
}
