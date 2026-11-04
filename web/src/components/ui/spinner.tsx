import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import styles from './spinner.module.css'

export function Spinner({
  size = 'default',
  className,
  'aria-label': label = '加载中',
  ...props
}: ComponentProps<'span'> & { size?: 'default' | 'sm' | 'lg' }) {
  return (
    <span
      role={props['aria-hidden'] ? undefined : 'status'}
      aria-label={props['aria-hidden'] ? undefined : label}
      className={cn(styles.spinner, size === 'lg' && styles.large, size === 'sm' && styles.small, className)}
      {...props}
    />
  )
}
