import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { siteApi } from '@/lib/api'

const VISITOR_KEY = 'zhizhou-visitor-id'

function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY)
    if (existing) return existing
    const created = crypto.randomUUID().replace(/-/g, '')
    localStorage.setItem(VISITOR_KEY, created)
    return created
  } catch {
    return ''
  }
}

export default function VisitTracker() {
  const location = useLocation()

  useEffect(() => {
    if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/install') || location.pathname.startsWith('/auth')) return
    const id = visitorId()
    if (id) void siteApi.visit(id, location.pathname)
  }, [location.pathname])

  return null
}
