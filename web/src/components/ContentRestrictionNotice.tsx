import { ShieldIcon } from './icons'
import type { ContentMode } from '../context/ContentPolicyContext'
import { useConfirm } from './feedback'

interface ContentRestrictionNoticeProps {
  mode: ContentMode
  onModeChange: (mode: ContentMode) => void
  title?: string
  description?: string
  canUnlock?: boolean
  compact?: boolean
}

export default function ContentRestrictionNotice({
  mode,
  onModeChange,
  title = '内容安全模式已拦截',
  description = '这部作品包含可能不适合所有读者的内容。确认已年满 18 岁后，可在本设备上显示限制级作品。',
  canUnlock = true,
  compact = false,
}: ContentRestrictionNoticeProps) {
  const { confirm } = useConfirm()

  async function unlock() {
    if (mode === 'adult') return
    const confirmed = await confirm({
      title: '显示限制级内容？',
      message: '仅限年满 18 岁的用户查看限制级内容。此设置会同步到你的账号。',
      okText: '确认查看',
      cancelText: '暂不查看',
    })
    if (confirmed) onModeChange('adult')
  }

  return (
    <section className={`content-restriction${compact ? ' content-restriction--compact' : ''}`} role="status">
      <div className="content-restriction__icon" aria-hidden="true"><ShieldIcon /></div>
      <div className="content-restriction__body">
        <h2>{title}</h2>
        <p>{description}</p>
        {mode === 'safe' && canUnlock && (
          <button type="button" className="btn btn--primary btn--sm" onClick={unlock}>
            查看限制级内容
          </button>
        )}
      </div>
    </section>
  )
}
