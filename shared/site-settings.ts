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
  name: 'Cat’s Library', tagline: '一个安静的中文小说书库', homeTitle: 'Cat’s Library · 小说阅读',
  description: 'Cat’s Library — 发现精彩小说，享受阅读之美', logoUrl: '/images/logo-circle.png', faviconUrl: '/images/logo-circle.png',
}
export function brandingDisplayUrl(path: string): string {
  if (path === '/images/logo.png') return DEFAULT_SITE_BRANDING.logoUrl
  if (!path.startsWith('/api/site-settings/assets/')) return path
  const value = new URL(path, 'https://branding.invalid')
  value.searchParams.set('shape', 'circle-v1')
  return `${value.pathname}${value.search}${value.hash}`
}
/** Shared upload contract; the API validates decoded content rather than trusting MIME or extension. */
export const BRANDING_IMAGE_UPLOAD = {
  maxBytes: 10 * 1024 * 1024,
  maxDimension: 8192,
  formatLabel: 'PNG / JPG / JPEG / WebP / GIF / AVIF / SVG',
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'],
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'],
} as const
export const BRANDING_IMAGE_ACCEPT = [...BRANDING_IMAGE_UPLOAD.extensions, ...BRANDING_IMAGE_UPLOAD.mimeTypes].join(',')
export const BRANDING_IMAGE_SIZE_HINT = `最大 ${BRANDING_IMAGE_UPLOAD.maxBytes / 1024 / 1024}MB，尺寸不超过 ${BRANDING_IMAGE_UPLOAD.maxDimension}×${BRANDING_IMAGE_UPLOAD.maxDimension}`
export interface TurnstileSettings {
  siteKey: string
  hostnames: string[]
  secretSet: boolean
  configured: boolean
  encryptionReady: boolean
  secretReadable: boolean
  sources: Record<'siteKey' | 'secret' | 'hostnames', 'environment' | 'database' | 'default'>
}

export interface PasskeySettings {
  enabled: boolean
  registrationEnabled: boolean
  rpName: string
}

export interface PasskeyPublicSettings extends PasskeySettings {}

export interface PasskeyAdminSettings extends PasskeySettings {
  rpId: string
  origins: string[]
  configured: boolean
  userVerification: 'required'
  sources: {
    rpId: 'environment' | 'default'
    origins: 'environment' | 'default'
  }
}
