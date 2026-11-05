import '@/styles/content-policy.css'
import { Button } from '@/components/ui/button'
import { ShieldIcon } from './icons'
import type { ContentMode } from '../context/ContentPolicyContext'
import { Link, useLocation } from 'react-router-dom'
import { useOptionalSession } from '../context/SessionContext'
import PageState from './PageState'

interface ContentRestrictionNoticeProps {
  mode: ContentMode
  onModeChange: (mode: ContentMode) => void | Promise<void>
  title?: string
  description?: string
  canUnlock?: boolean
  compact?: boolean
}

export default function ContentRestrictionNotice({
  mode,
  onModeChange,
  title = '内容安全模式已拦截',
  description = '限制级作品仅供已登录且年满 18 岁的读者，开启前需完成成年确认与人机验证。',
  canUnlock = true,
  compact = false,
}: ContentRestrictionNoticeProps) {
  const session = useOptionalSession()
  const location = useLocation()

  async function unlock() {
    if (session?.user) await onModeChange('adult')
  }

  return (
    <PageState
      inline={compact}
      icon={<ShieldIcon />}
      title={title}
      description={!compact && !canUnlock ? '站点当前未开放成人内容模式，限制级作品暂不可阅读。你仍可返回首页浏览其他小说。' : description}
      actions={(!compact || canUnlock && mode === 'safe') ? <>
        {canUnlock && (!compact || mode === 'safe') && (!session?.user
          ? <Button asChild variant="default"><Link to="/auth" state={{ from: `${location.pathname}${location.search}` }} >登录后开启</Link></Button>
          : <Button variant="default" type="button"  onClick={unlock}>{mode === 'adult' ? '重新验证' : '查看限制级内容'}</Button>)}
        {!compact && <Button asChild variant={canUnlock ? 'secondary' : 'default'}><Link to="/">返回首页</Link></Button>}
      </> : undefined}
    />
  )
}
