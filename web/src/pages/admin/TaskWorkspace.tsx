import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"


export function TaskDetails({ open, onClose, children, actions }: { open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogFrame variant="form" className="dialog-frame task-details-dialog">
        <DialogHeader>
          <DialogTitle>任务详情</DialogTitle>
          <DialogDescription>查看任务记录、执行结果与可用操作。</DialogDescription>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>
          {actions}
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  )
}
