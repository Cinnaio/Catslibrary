import { useEffect } from 'react'
import { siteSettingsApi } from '../lib/api'
import { setSiteBranding, siteBrandingVersion } from '../lib/site-branding'

/** No blocking gate: SSR branding/defaults remain usable if the settings API is unavailable. */
export default function SiteBrandingSync() {
  useEffect(() => {
    let active = true
    let round = 0
    const refresh = () => {
      const request = ++round
      const version = siteBrandingVersion()
      void siteSettingsApi.publicBranding().then(value => { if (active && request === round && version === siteBrandingVersion()) setSiteBranding(value) }).catch(() => {})
    }
    const storage = (event: StorageEvent) => { if (event.key === 'site-branding-updated') refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', storage)
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener('storage', storage) }
  }, [])
  return null
}
