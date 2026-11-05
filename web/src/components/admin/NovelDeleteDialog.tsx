import { useState } from 'react'
import type { Novel } from '@shared/types'
import { novelsApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'

interface NovelDeleteDialogProps {
  open: boolean
  novels: Novel[]
  onClose: () => void
  onDeleted: (deletedIds: string[]) => void
}

export default function NovelDeleteDialog({ open, novels, onClose, onDeleted }: NovelDeleteDialogProps) {
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
    <ConfirmationDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={isBatch ? `批量删除 ${novels.length} 部小说` : '确认删除小说'}
      description={
        (isBatch
          ? `你即将彻底移除选中的 ${novels.length} 部小说及其包含的全部 ${totalChapters.toLocaleString('zh-CN')} 章正文。`
          : `你即将彻底移除《${single.title}》及其包含的全部 ${(single.chapterCount || 0).toLocaleString('zh-CN')} 章正文。`) +
        '此操作不可逆，作品的本地与云端章节、阅读进度与缓存均将被清理。'
      }
      items={novels.map((novel) => ({
        label: novel.title,
        detail: `${novel.author || '未知作者'} · ${novel.chapterCount || 0} 章`,
      }))}
      danger
      busy={busy}
      confirmText={busy ? '正在删除…' : isBatch ? `确认删除这 ${novels.length} 部小说` : '确认删除'}
      onConfirm={() => void handleDelete()}
    />
  )
}
