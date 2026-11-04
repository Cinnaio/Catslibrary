import type { ComponentProps } from 'react'
import { Button } from './button'
import { cn } from '@/lib/utils'
import styles from './filter-chip.module.css'

/** 共享筛选外观；选择、移除和展开等动作仍由使用方决定其 ARIA 与回调。 */
export function FilterChip({
  selected = false,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'asChild'> & { selected?: boolean }) {
  return <Button type="button" variant="ghost" size="sm" data-selected={selected} className={cn(styles.chip, 'filter-chip', className)} {...props} />
}
