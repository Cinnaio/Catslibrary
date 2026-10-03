import { ShieldIcon } from './icons'
import type { ContentMode } from '../context/ContentPolicyContext'
import { Link } from 'react-router-dom'
import { useOptionalSession } from '../context/SessionContext'

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

  async function unlock() {
    if (mode === 'adult') return
    if (session?.user) await onModeChange('adult')
  }

  return (
    <section className={`content-restriction${compact ? ' content-restriction--compact' : ''}`} role="status">
      <div className="content-restriction__icon" aria-hidden="true"><ShieldIcon /></div>
      <div className="content-restriction__body">
        <h2>{title}</h2>
        <p>{description}</p>
        {mode === 'safe' && canUnlock && !session?.user && <Link to="/auth" className="btn btn--primary btn--sm">登录后开启</Link>}
        {mode === 'safe' && canUnlock && session?.user && (
          <button type="button" className="btn btn--primary btn--sm" onClick={unlock}>
            查看限制级内容
          </button>
        )}
      </div>
    </section>
  )
}
