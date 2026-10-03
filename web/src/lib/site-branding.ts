import { useSyncExternalStore } from 'react'
import { DEFAULT_SITE_BRANDING, type SiteBranding } from '@shared/site-settings'
import { url } from './api'

function initialBranding(): SiteBranding {
  try {
    const value = JSON.parse(document.getElementById('site-branding')?.textContent || 'null')
    return value?.name ? { ...DEFAULT_SITE_BRANDING, ...value } : DEFAULT_SITE_BRANDING
  } catch { return DEFAULT_SITE_BRANDING }
}
let branding = initialBranding()
let version = 0
export function siteBrandingVersion(): number { return version }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useSiteBranding(): SiteBranding { return useSyncExternalStore(subscribe, () => branding, () => DEFAULT_SITE_BRANDING) }
export function brandingAssetUrl(path: string): string { return path.startsWith('/api/') ? url(path.slice(4)) : path }
export function setSiteBranding(value: SiteBranding) {
  version++
  branding = { ...value, logoUrl: brandingAssetUrl(value.logoUrl), faviconUrl: brandingAssetUrl(value.faviconUrl) }
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.append(icon) }
  icon.type = 'image/png'
  icon.href = branding.faviconUrl
  listeners.forEach(listener => listener())
}
