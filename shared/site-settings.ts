/** Public branding is deliberately separate from server-only verification credentials. */
export interface SiteBranding {
  name: string
  tagline: string
  homeTitle: string
  description: string
  logoUrl: string
  faviconUrl: string
}
export const DEFAULT_SITE_BRANDING: SiteBranding = {
  name: '知舟', tagline: '一个安静的中文小说书库', homeTitle: '知舟 — 小说阅读',
  description: '知舟 — 发现精彩小说，享受阅读之美', logoUrl: '/images/logo.png', faviconUrl: '/images/logo.png',
}
export interface TurnstileSettings {
  siteKey: string
  hostnames: string[]
  secretSet: boolean
  configured: boolean
  encryptionReady: boolean
  secretReadable: boolean
  sources: Record<'siteKey' | 'secret' | 'hostnames', 'environment' | 'database' | 'default'>
}
