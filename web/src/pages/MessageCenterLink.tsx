import { Button } from '../components/ui/button'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { notificationsApi } from '../lib/notifications'
import { useSession } from '../context/SessionContext'
import { useContentPolicy } from '../context/ContentPolicyContext'
export default function MessageCenterLink() {
  const { user } = useSession(),
    { safeMode } = useContentPolicy()
  const userId = user?.id
  const scope = `${userId}:${safeMode}`
  const [result, setResult] = useState({ scope: '', count: 0 })
  const count = result.scope === scope ? result.count : 0
  useEffect(() => {
    let active = true
    if (!userId) return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void notificationsApi
        .list('?unread=1')
        .then((r) => {
          if (active) setResult({ scope, count: r.unread })
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    window.addEventListener('library-messages-changed', refresh)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('library-messages-changed', refresh)
    }
  }, [userId, scope])
  return (
    <Button asChild variant="ghost">
      <Link to="/messages">消息中心{count > 0 ? ` · ${count > 99 ? '99+' : count} 条未读` : ''}</Link>
    </Button>
  )
}
