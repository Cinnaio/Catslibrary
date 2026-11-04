import { Spinner } from '@/components/ui/spinner'
import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Pencil, BookOpen, Clock, Hash } from 'lucide-react'
import type { ChapterMeta } from '@shared/types'
import { chaptersApi } from '@/lib/api'
import { formatContent } from '@/lib/reader-utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"

interface ChapterQuickReaderDialogProps {
  open: boolean
  onClose: () => void
  chapter: ChapterMeta | null
  novelTitle?: string
  chapters: ChapterMeta[]
  onEdit: (chapter: ChapterMeta) => void
}

export default function ChapterQuickReaderDialog({
  open,
  onClose,
  chapter,
  novelTitle,
  chapters,
  onEdit,
}: ChapterQuickReaderDialogProps) {
  const [currentChapter, setCurrentChapter] = useState<ChapterMeta | null>(chapter)
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCurrentChapter(chapter)
  }, [chapter])

  useEffect(() => {
    if (!open || !currentChapter) return
    let active = true
    setLoading(true)
    setError(null)

    chaptersApi
      .get(currentChapter.id)
      .then((data) => {
        if (!active) return
        setContent(data.chapter?.content || '')
      })
      .catch((err) => {
        if (!active) return
        setError((err as Error).message || '正文加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, currentChapter])

  if (!currentChapter) return null

  const currentIndex = chapters.findIndex((c) => c.id === currentChapter.id)
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null
  const nextChapter = currentIndex >= 0 && currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null

  const formattedHtml = { __html: formatContent(content || '') }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogFrame variant="editor" className="chapter-quick-reader-dialog sm:max-w-[720px]">
        <DialogHeader className="chapter-quick-reader__header">
          <div className="chapter-quick-reader__meta">
            <span className="chapter-quick-reader__novel-tag">
              <BookOpen className="size-3.5" />
              {novelTitle || '小说章节速读'}
            </span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Hash className="size-3" />
                第 {currentChapter.order} 章
              </span>
              <span>·</span>
              <span>{currentChapter.wordCount ? `${currentChapter.wordCount.toLocaleString()} 字` : '未统计字数'}</span>
              {currentChapter.createdAt && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {new Date(currentChapter.createdAt).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          </div>
          <DialogTitle className="chapter-quick-reader__title font-serif">
            {currentChapter.title}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="chapter-quick-reader__body">
          {loading ? (
            <div className="chapter-quick-reader__loading">
              <Spinner  />
              <p className="text-sm text-muted-foreground">正在翻开书页…</p>
            </div>
          ) : error ? (
            <div className="chapter-quick-reader__error">
              <p className="text-destructive font-medium">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 rounded-full"
                onClick={() => {
                  setLoading(true)
                  setError(null)
                  chaptersApi
                    .get(currentChapter.id)
                    .then((data) => setContent(data.chapter?.content || ''))
                    .catch((err) => setError((err as Error).message || '加载失败'))
                    .finally(() => setLoading(false))
                }}
              >
                重试加载
              </Button>
            </div>
          ) : !content ? (
            <div className="chapter-quick-reader__empty text-muted-foreground text-center py-12">
              <p>本章暂无正文内容</p>
            </div>
          ) : (
            <article
              className="chapter-quick-reader__content font-serif"
              dangerouslySetInnerHTML={formattedHtml}
            />
          )}
        </DialogBody>

        <DialogFooter className="chapter-quick-reader__footer flex items-center justify-between sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full gap-1"
              disabled={!prevChapter || loading}
              onClick={() => prevChapter && setCurrentChapter(prevChapter)}
              title={prevChapter ? `上一章：${prevChapter.title}` : '已是第一章'}
            >
              <ChevronLeft className="size-4" />
              上一章
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full gap-1"
              disabled={!nextChapter || loading}
              onClick={() => nextChapter && setCurrentChapter(nextChapter)}
              title={nextChapter ? `下一章：${nextChapter.title}` : '已是最后一章'}
            >
              下一章
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={() => {
                onClose()
                onEdit(currentChapter)
              }}
            >
              <Pencil className="size-3.5" />
              转入编辑
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full" onClick={onClose}>
              关闭
            </Button>
          </div>
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  )
}
