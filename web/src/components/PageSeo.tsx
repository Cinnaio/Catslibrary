import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { setPageSeo } from '../lib/seo'
import { useSiteBranding } from '../lib/site-branding'

/** Reset metadata on SPA navigation; preserve server-rendered general detail on first load. */
export default function PageSeo() {
  const branding = useSiteBranding()
  const { pathname, search } = useLocation()
  const previousRoute = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = pathname + search
    // Loaded novel details own their SEO. A branding-only refresh must not reset it.
    if (previousRoute.current === key && /^\/novel\/[^/]+$/.test(pathname)) return
    const initial = previousRoute.current === null
    previousRoute.current = key
    if (initial && !search && /^\/novel\/[^/]+$/.test(pathname) && document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content === 'index, follow')
      return
    setPageSeo(pathname === '/' && !search, branding.description, pathname === '/' ? '/' : undefined)
  }, [pathname, search, branding.description])
  return null
}
