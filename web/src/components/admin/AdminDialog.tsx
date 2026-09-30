import type { ComponentProps } from 'react'
import { DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface AdminDialogContentProps extends ComponentProps<typeof DialogContent> {
  /** form 为标准三段式；editor 为紧凑编辑；reading 为正文/Prompt；preview 为图片。 */
  variant?: 'form' | 'editor' | 'reading' | 'preview'
  size?: 'default' | 'wide'
  /** 长正文编辑窗口需要稳定高度，Prompt 窗口则随内容伸缩。 */
  fixedHeight?: boolean
}

/** 保留 Radix 的 portal、焦点管理与关闭行为，只集中管理后台弹窗外观。 */
export function AdminDialogContent({ variant = 'form', size = 'default', fixedHeight = false, className, ...props }: AdminDialogContentProps) {
  return (
    <DialogContent
      className={cn(
        variant === 'form' || variant === 'editor'
          ? 'admin-dialog'
          : variant === 'reading'
            ? 'ai-generation-dialog admin-dialog-reading'
            : 'admin-dialog-preview',
        variant === 'editor' && 'admin-dialog--editor',
        variant === 'reading' && size === 'wide' && 'admin-dialog-reading--wide',
        variant === 'reading' && fixedHeight && 'admin-dialog-reading--fixed',
        className,
      )}
      {...props}
    />
  )
}

export function AdminDialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('admin-dialog__body', className)} {...props} />
}
