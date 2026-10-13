import { useEffect, useState } from 'react'
import { chaptersApi } from '@/lib/api'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export default function ChapterMergeContentDialog({ chapter, onClose }: { chapter: { id: string; order: number; title: string }; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    chaptersApi.get(chapter.id).then(result => {
      if (active) setContent(result.chapter.content)
    }).catch(err => { if (active) setError((err as Error).message || '正文读取失败') })
    return () => { active = false }
  }, [chapter.id])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <AdminDialogContent variant="editor">
      <DialogHeader><DialogTitle>本地 {chapter.order} · {chapter.title}</DialogTitle><DialogDescription>查看正文，确认是否属于当前作品；关闭后继续核对映射。</DialogDescription></DialogHeader>
      <AdminDialogBody>
        {error ? <p role="alert">{error}</p> : content === null ? <p role="status">正在读取正文…</p> : <div className="whitespace-pre-wrap break-words">{content || '正文为空'}</div>}
      </AdminDialogBody>
      <DialogFooter><Button variant="secondary" onClick={onClose}>返回核对</Button></DialogFooter>
    </AdminDialogContent>
  </Dialog>
}
