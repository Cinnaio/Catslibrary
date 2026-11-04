import type { ComponentProps } from 'react'
import { DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import './DialogFrame.css'

interface DialogFrameProps extends ComponentProps<typeof DialogContent> {
  /** form 为标准三段式；editor 为紧凑编辑；reading 为正文/Prompt；preview 为图片。 */
  variant?: 'form' | 'editor' | 'reading' | 'preview'
  size?: 'default' | 'wide'
  /** 长正文编辑窗口需要稳定高度，Prompt 窗口则随内容伸缩。 */
  fixedHeight?: boolean
}

/** 保留 Radix 的 portal、焦点管理与关闭行为，只集中管理后台弹窗外观。 */
export function DialogFrame({ variant = 'form', size = 'default', fixedHeight = false, className, ...props }: DialogFrameProps) {
  return (
    <DialogContent
      className={cn(
        'dialog-frame',
        variant === 'reading' && 'dialog-frame-reading',
        variant === 'preview' && 'dialog-frame-preview',
        variant === 'editor' && 'dialog-frame--editor',
        size === 'wide' && 'dialog-frame--wide',
        variant === 'reading' && fixedHeight && 'dialog-frame-reading--fixed',
        className,
      )}
      {...props}
    />
  )
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('dialog-frame__body', className)} {...props} />
}
