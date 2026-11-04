import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import styles from './ConfirmationDialog.module.css'

export interface ConfirmationItem {
  label: string
  detail?: string
}

interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  items?: readonly (string | ConfirmationItem)[]
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
}

/** 确认框只管理呈现和交互语义；请求、结果及关闭时机由调用方持有。 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  busy = false,
  onConfirm,
}: ConfirmationDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <AlertDialogContent
        className={styles.content}
        aria-busy={busy || undefined}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <div className={styles.body}>
          <AlertDialogHeader className={`${styles.header} text-left place-items-start`}>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription hidden={!description}>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {!!items?.length && (
            <div className={styles.items} role="region" aria-label="操作对象" tabIndex={0}>
              {items.map((item, index) => (
                <div key={index} className={styles.item}>
                  <span>{typeof item === 'string' ? item : item.label}</span>
                  {typeof item !== 'string' && item.detail && <span className={styles.detail}>{item.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <AlertDialogFooter className={styles.footer}>
          <AlertDialogCancel autoFocus disabled={busy}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? 'destructive' : 'default'}
            disabled={busy}
            onClick={(event) => {
              // Radix Action 默认立即关闭；异步操作必须由调用方在成功后关闭。
              event.preventDefault()
              if (!busy) onConfirm()
            }}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
