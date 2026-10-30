import { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import type { Novel } from '@shared/types'
import { novelsApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'

interface NovelDeleteDialogProps {
  open: boolean
  novels: Novel[]
  onClose: () => void
  onDeleted: (deletedIds: string[]) => void
}

export default function NovelDeleteDialog({
  open,
  novels,
  onClose,
  onDeleted,
}: NovelDeleteDialogProps) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  if (!novels.length) return null

  const isBatch = novels.length > 1
  const totalChapters = novels.reduce((acc, n) => acc + (n.chapterCount || 0), 0)
  const single = novels[0]!

  async function handleDelete() {
    setBusy(true)
    const deletedIds: string[] = []
    try {
      if (isBatch) {
        await novelsApi.batchDelete(novels.map((n) => n.id))
        deletedIds.push(...novels.map((n) => n.id))
        toast(`已批量删除 ${novels.length} 部小说`, 'success')
      } else {
        await novelsApi.remove(single.id)
        deletedIds.push(single.id)
        toast('小说已删除', 'success')
      }
      onClose()
      onDeleted(deletedIds)
    } catch (err) {
      toast('删除失败: ' + ((err as Error).message || '请检查网络和权限'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <AdminDialogContent variant="form" className="novel-delete-dialog sm:max-w-[500px]">
        <DialogHeader>
          <div className="novel-delete-icon-wrap">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <DialogTitle>{isBatch ? `批量删除 ${novels.length} 部小说` : '确认删除小说'}</DialogTitle>
          <DialogDescription>
            {isBatch
              ? `你即将彻底移除选中的 ${novels.length} 部小说及其包含的全部 ${totalChapters.toLocaleString('zh-CN')} 章正文。`
              : `你即将彻底移除《${single.title}》及其包含的全部 ${(single.chapterCount || 0).toLocaleString('zh-CN')} 章正文。`}
          </DialogDescription>
        </DialogHeader>
        <AdminDialogBody>
          <div className="novel-delete-warning-panel">
            <p className="novel-delete-warning-text">
              此操作不可逆，作品的本地与云端章节、阅读进度与缓存均将被清理。
            </p>
          </div>

          <div className="novel-delete-items-list">
            {novels.slice(0, 5).map((novel) => (
              <div key={novel.id} className="novel-delete-item">
                <span className="novel-delete-item__title">{novel.title}</span>
                <span className="novel-delete-item__meta">{novel.author || '未知作者'} · {novel.chapterCount || 0} 章</span>
              </div>
            ))}
            {novels.length > 5 && (
              <p className="novel-delete-more-hint">…以及其余 {novels.length - 5} 部作品</p>
            )}
          </div>
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
            <Trash2 className="size-4" />
            {busy ? '正在删除…' : isBatch ? `确认删除这 ${novels.length} 部小说` : '确认删除'}
          </Button>
        </DialogFooter>
      </AdminDialogContent>
    </Dialog>
  )
}
