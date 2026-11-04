import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'
import styles from './panel.module.css'

/** 单一纸面表面；asChild 保留 section/form 等业务容器与现有 DOM 层级。 */
export function Panel({ asChild = false, className, ...props }: ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp data-slot="panel" className={cn(styles.panel, className)} {...props} />
}
