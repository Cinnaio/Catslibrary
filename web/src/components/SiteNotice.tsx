import { useEffect, useState } from 'react'
import { siteApi } from '@/lib/api'

export default function SiteNotice() {
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    void siteApi.settings().then((settings) => setAnnouncement(settings.announcement)).catch(() => {})
  }, [])

  if (!announcement) return null
  return <div className="site-notice" role="status">{announcement}</div>
}
