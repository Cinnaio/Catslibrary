import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface InitialAvatarProps extends ComponentProps<'span'> {
  name: string
  size?: 'default' | 'inherit'
}

/** Decorative fallback; the adjacent name or parent control supplies the accessible label. */
export function InitialAvatar({ name, size = 'default', className, ...props }: InitialAvatarProps) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() || '?'
  return (
    <span aria-hidden="true" className={cn('shared-initial-avatar', size === 'inherit' && 'shared-initial-avatar--inherit', className)} {...props}>
      {initial}
    </span>
  )
}
