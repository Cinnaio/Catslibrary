export const SITE_SETTINGS_VIEWS = ['branding', 'content-policy', 'security', 'passkey', 'config', 'params'] as const
export type SiteSettingsView = (typeof SITE_SETTINGS_VIEWS)[number]

/** 旧 AI 设置地址继续使用同一个站点设置外壳，不打断导航与表单草稿。 */
export function getSiteSettingsView(pathname: string, search: string, savedAiSub?: string | null): SiteSettingsView | null {
  const params = new URLSearchParams(search)
  if (pathname === '/admin/ai') {
    const sub = params.get('sub') || savedAiSub
    return sub === 'config' || sub === 'params' ? sub : null
  }
  if (pathname !== '/admin/site-settings') return null
  const view = params.get('view')
  return SITE_SETTINGS_VIEWS.includes(view as SiteSettingsView) ? view as SiteSettingsView : 'branding'
}
