import { ShieldIcon } from './icons'
import type { ContentMode } from '../context/ContentPolicyContext'

interface ContentRestrictionNoticeProps {
  mode: ContentMode
  onModeChange: (mode: ContentMode) => void
  title?: string
  description?: string
  compact?: boolean
}

export default function ContentRestrictionNotice({
  mode,
  onModeChange,
  title = '内容安全模式已拦截',
  description = '这部作品包含可能不适合所有读者的内容。确认已年满 18 岁后，可在本设备上显示限制级作品。',
  compact = false,
}: ContentRestrictionNoticeProps) {
  function unlock() {
    if (mode === 'adult') return
    const confirmed = window.confirm('仅限年满 18 岁的用户查看限制级内容。确认继续吗？')
    if (confirmed) onModeChange('adult')
  }

  return (
    <section className={`content-restriction${compact ? ' content-restriction--compact' : ''}`} role="status">
      <div className="content-restriction__icon" aria-hidden="true"><ShieldIcon /></div>
      <div className="content-restriction__body">
        <h2>{title}</h2>
        <p>{description}</p>
        {mode === 'safe' && (
          <button type="button" className="btn btn--primary btn--sm" onClick={unlock}>
            查看限制级内容
          </button>
        )}
      </div>
    </section>
  )
}
