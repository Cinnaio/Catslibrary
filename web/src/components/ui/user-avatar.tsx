import { useState, type ComponentProps } from 'react'
import { url } from '@/lib/api'
import { cn } from '@/lib/utils'
import { InitialAvatar } from './initial-avatar'

interface UserAvatarProps extends ComponentProps<'span'> {
  name: string
  src?: string
  size?: 'default' | 'inherit'
}

/** User images take priority; initials are a decorative fallback only. */
export function UserAvatar({ name, src, size = 'default', className, ...props }: UserAvatarProps) {
  const rawSource = src?.trim() || ''
  const source = /^(blob:|data:image\/)/i.test(rawSource) ? rawSource : rawSource ? url(rawSource) : ''
  const [failedSource, setFailedSource] = useState('')
  return (
    <span aria-hidden="true" className={cn('shared-user-avatar', size === 'inherit' && 'shared-user-avatar--inherit', className)} {...props}>
      {source && source !== failedSource ? (
        <img key={source} src={source} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
      ) : (
        <InitialAvatar name={name} size="inherit" />
      )}
    </span>
  )
}
