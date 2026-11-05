import { useRef, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/feedback'
import { copyText } from '@/lib/admin'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import styles from './TaskWorkspace.module.css'


export function TaskDetails({ open, onClose, children, actions }: { open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogFrame variant="form" className={styles.dialog} onOpenAutoFocus={(event) => {
        event.preventDefault()
        titleRef.current?.focus()
      }}>
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>任务详情</DialogTitle>
          <DialogDescription className="sr-only">查看执行结果、时间记录与可用操作。</DialogDescription>
        </DialogHeader>
        <DialogBody className={styles.body} tabIndex={0} role="region" aria-label="任务详情内容">{children}</DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {actions}
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  )
}

export function TaskDetailsSummary({
  title,
  meta,
  status,
}: {
  title: ReactNode
  meta?: ReactNode
  status: ReactNode
}) {
  return (
    <div className={styles.summary}>
      <div className={styles.summaryCopy}>
        <h3 className={styles.title}>{title}</h3>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      <div className={styles.status}>{status}</div>
    </div>
  )
}

export function TaskDetailsSection({ label, children, tone = 'default' }: { label: string; children: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <section className={tone === 'danger' ? styles.error : styles.section}>
      <h3 className={styles.label}>{label}</h3>
      <div className={styles.sectionContent}>{children}</div>
    </section>
  )
}

export function TaskDetailsResult({ value, hint }: { value: ReactNode; hint?: ReactNode }) {
  return (
    <div className={styles.result}>
      <strong className={styles.resultValue}>{value}</strong>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  )
}

export function TaskDetailsFacts({ children }: { children: ReactNode }) {
  return <dl className={styles.facts}>{children}</dl>
}

export function TaskDetailsFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function TaskDetailsIdentifier({ id }: { id: string }) {
  const { toast } = useToast()
  async function copy() {
    const copied = await copyText(id)
    toast(copied ? '任务 ID 已复制' : '复制失败，请手动选择任务 ID', copied ? 'success' : 'error')
  }
  return (
    <div className={styles.identifier}>
      <div className={styles.identifierCopy}>
        <span className={styles.label}>任务 ID</span>
        <code>{id}</code>
      </div>
      <Button variant="ghost" onClick={() => void copy()} aria-label="复制任务 ID">
        <Copy className="size-3.5" aria-hidden="true" />
        复制
      </Button>
    </div>
  )
}
