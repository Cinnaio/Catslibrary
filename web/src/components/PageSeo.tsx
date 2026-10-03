import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { SEO_DESCRIPTION, setPageSeo } from '../lib/seo'

/** Reset metadata on SPA navigation; preserve server-rendered general detail on first load. */
export default function PageSeo() {
  const { pathname, search } = useLocation()
  const previousRoute = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = pathname + search
    if (previousRoute.current === key) return
    const initial = previousRoute.current === null
    previousRoute.current = key
    if (initial && !search && /^\/novel\/[^/]+$/.test(pathname) && document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content === 'index, follow')
      return
    setPageSeo(pathname === '/' && !search, SEO_DESCRIPTION, pathname === '/' ? '/' : undefined)
  }, [pathname, search])
  return null
}
