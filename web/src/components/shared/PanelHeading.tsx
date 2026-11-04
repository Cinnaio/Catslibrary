import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import styles from './PanelHeading.module.css'

interface PanelHeadingProps {
  title: string
  titleId?: string
  /** 面板用途说明；属静态文案，视觉上弱于标题并独占一行。 */
  description?: string
  /** 只呈现实时状态或有归属的数据读数；静态提示移出标题行。 */
  status?: ReactNode
  /** 只放可执行控件，不放快捷键提示等静态标签。 */
  actions?: ReactNode
  className?: string
}

export function PanelHeading({ title, titleId, description, status, actions, className }: PanelHeadingProps) {
  return (
    <div className={cn(styles.heading, 'panel-heading', className)}>
      <div className={styles.copy}>
        <h3 id={titleId}>{title}</h3>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {(status || actions) && (
        <div className={cn(styles.actions, 'panel-heading__actions')}>
          {status}
          {actions}
        </div>
      )}
    </div>
  )
}
