import { useRef, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { DialogBody, DialogFrame } from './DialogFrame'
import styles from './ReadingDialog.module.css'

interface ReadingDialogProps extends Omit<ComponentProps<typeof DialogFrame>, 'title' | 'children' | 'variant' | 'size' | 'fixedHeight'> {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  bodyLabel?: string
  children: ReactNode
  footer?: ReactNode
}

/** 正文优先的通用阅读窗；业务数据、操作和关闭时机均由使用方提供。 */
export function ReadingDialog({ title, description, eyebrow, bodyLabel = '内容', children, footer, className, onOpenAutoFocus, ...props }: ReadingDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <DialogFrame
      {...props}
      className={cn(styles.dialog, className)}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        if (!event.defaultPrevented) {
          event.preventDefault()
          titleRef.current?.focus()
        }
      }}
    >
      <DialogHeader className={styles.header}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <DialogTitle ref={titleRef} tabIndex={-1} className={styles.title}>{title}</DialogTitle>
        <DialogDescription className={styles.description} hidden={!description}>{description}</DialogDescription>
      </DialogHeader>
      <DialogBody className={styles.body} tabIndex={0} role="region" aria-label={bodyLabel}>
        {children}
      </DialogBody>
      {footer && <div className={styles.footer}>{footer}</div>}
    </DialogFrame>
  )
}

export function ReadingDialogToolbar({ label, meta, actions }: { label: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarLead}>
        <span>{label}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}

export function ReadingDialogText({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(styles.prose, className)} {...props} />
}

export function ReadingDialogEditor({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn(styles.editor, className)} {...props} />
}

/** 折叠的生成依据、原始请求等辅助长文，和正文共用中间滚动区。 */
export function ReadingDialogDisclosure({ label, hint, children, className, ...props }: Omit<ComponentProps<'details'>, 'children'> & { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <details className={cn(styles.disclosure, className)} {...props}>
      <summary className={styles.disclosureSummary}>
        <span>{label}{hint && <span className={styles.disclosureHint}>{hint}</span>}</span>
        <ChevronDown className={styles.disclosureChevron} aria-hidden="true" />
      </summary>
      <pre className={styles.disclosureText}>{children}</pre>
    </details>
  )
}
