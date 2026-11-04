import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookImportHistoryItem, BookImportRollbackResult } from '@shared/types'
import { bookImportApi, newOperationId } from '@/lib/api'
import { useConfirm } from '@/components/feedback'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import Pagination from "@/components/shared/Pagination"
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import AdminStatusBadge from './AdminStatusBadge'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { timeAgo } from '@/lib/format'

const labels: Record<BookImportHistoryItem['status'], string> = {
  preview: '预览未提交',
  expired: '预览已过期',
  applied: '已导入',
  partial: '部分完成',
  rolled_back: '已撤回',
}

export default function BookImportHistoryDialog({
  open,
  onOpenChange,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: () => void
}) {
  const { confirm } = useConfirm()
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<BookImportHistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [result, setResult] = useState<BookImportRollbackResult | null>(null)
  const revision = useRef(0)
  const rollbackLock = useRef(false)
  const operationIds = useRef(new Map<string, string>())
  const load = useCallback(async () => {
    const seq = ++revision.current
    setLoading(true)
    setError('')
    try {
      const data = await bookImportApi.history(20, (page - 1) * 20)
      if (seq !== revision.current) return
      setItems(data.items)
      setTotal(data.total ?? data.items.length)
      if (page > Math.max(1, Math.ceil((data.total || 0) / 20))) setPage(Math.max(1, Math.ceil((data.total || 0) / 20)))
    } catch (err) {
      if (seq === revision.current) setError((err as Error).message || '导入历史加载失败')
    } finally {
      if (seq === revision.current) setLoading(false)
    }
  }, [page])
  useEffect(() => {
    if (open) void load()
    return () => {
      revision.current++
    }
  }, [open, load])
  async function rollback(item: BookImportHistoryItem) {
    if (rollbackLock.current) return
    rollbackLock.current = true
    try {
      if (
        !(await confirm({
          title: '撤回导入',
          message: `撤回「${item.novelTitle}」此次导入？服务端会保留导入后再次修改的内容，并列出冲突。`,
          okText: '撤回导入',
          danger: true,
        }))
      )
        return
      setBusyId(item.runId)
      setError('')
      setResult(null)
      const operationId = operationIds.current.get(item.runId) || newOperationId('import-history-rollback')
      operationIds.current.set(item.runId, operationId)
      const next = await bookImportApi.rollback(item.runId, operationId)
      operationIds.current.delete(item.runId)
      setResult(next)
      onCompleted()
      await load()
    } catch (err) {
      setError((err as Error).message || '撤回失败，请重试')
    } finally {
      rollbackLock.current = false
      setBusyId('')
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!rollbackLock.current) onOpenChange(value)
      }}
    >
      <DialogFrame className="book-import-history-dialog">
        <DialogHeader>
          <DialogTitle>导入历史</DialogTitle>
          <DialogDescription>查看当前账号的导入记录，并撤回仍可恢复的变更。</DialogDescription>
        </DialogHeader>
        <DialogBody className="book-import-history__body" aria-busy={loading || !!busyId}>
          {error && (
            <p className="book-import-history__error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="book-import-history__result" role="status">
              <p>
                已撤回 {result.rolledBack} 项变更，保留 {result.conflicts.length} 项冲突。
              </p>
              {result.conflicts.map((c, i) => (
                <p key={`${c.id}-${i}`}>
                  {c.title}：{c.reason}
                </p>
              ))}
            </div>
          )}
          {loading ? (
            <p className="book-import-history__empty" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              正在读取导入历史…
            </p>
          ) : items.length === 0 ? (
            <p className="book-import-history__empty">暂无导入记录</p>
          ) : (
            items.map((item) => (
              <article className="book-import-history__record" key={item.runId} aria-label={`${item.novelTitle} · ${labels[item.status]}`}>
                <div className="book-import-history__copy">
                  <h3>{item.novelTitle || '未命名作品'}</h3>
                  <div className="book-import-history__meta">
                    <AdminStatusBadge tone={item.status === 'applied' ? 'success' : item.status === 'partial' ? 'warning' : 'muted'}>
                      {labels[item.status]}
                    </AdminStatusBadge>
                    <time dateTime={new Date(item.createdAt).toISOString()}>{timeAgo(item.createdAt)}</time>
                  </div>
                  <p className="book-import-history__source">来源：{item.sourceLabel || '未记录来源'}</p>
                  {item.status === 'preview' || item.status === 'expired' ? (
                    <p className="book-import-history__note">尚未写入书库</p>
                  ) : (
                    <div className="book-import-history__changes" aria-label="此次导入的章节变更">
                      <span>
                        新增 <strong>{item.created}</strong> 章
                      </span>
                      <span>
                        更新 <strong>{item.updated}</strong> 章
                      </span>
                    </div>
                  )}
                </div>
                {item.status !== 'preview' && item.status !== 'expired' && (
                  <div className="book-import-history__action">
                    {item.canRollback ? (
                      <Button variant="secondary" disabled={!!busyId} onClick={() => void rollback(item)}>
                        {busyId === item.runId ? '撤回中…' : '撤回此次导入'}
                      </Button>
                    ) : (
                      <span>{item.status === 'rolled_back' ? '撤回已完成' : '暂无可撤回变更'}</span>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </DialogBody>
        <DialogFooter className="book-import-history__footer">
          <Pagination
            variant="dialog"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / 20))}
            onPage={setPage}
            busy={loading || !!busyId}
            summary={`共 ${total} 条记录`}
          />
          <Button variant="ghost" size="icon" aria-label="刷新历史" title="刷新历史" disabled={loading || !!busyId} onClick={() => void load()}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  )
}
