import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'

export function TaskSummary({ title, hint, counts, actions }: { title: string; hint: string; counts: ReactNode; actions?: ReactNode }) {
  return (
    <div className="task-workspace-summary">
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <div className="task-workspace-summary__aside">
        <span>{counts}</span>
        {actions}
      </div>
    </div>
  )
}

export function TaskDetails({ open, onClose, children, actions }: { open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <AdminDialogContent variant="form">
        <DialogHeader>
          <DialogTitle>任务详情</DialogTitle>
          <DialogDescription>查看任务记录、执行结果与可用操作。</DialogDescription>
        </DialogHeader>
        <AdminDialogBody>{children}</AdminDialogBody>
        <DialogFooter>
          {actions}
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
