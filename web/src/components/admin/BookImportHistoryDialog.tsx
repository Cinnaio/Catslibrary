import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookImportHistoryItem, BookImportRollbackResult } from '@shared/types'
import { bookImportApi, newOperationId } from '@/lib/api'
import { useConfirm } from '@/components/feedback'
import { AdminDialogBody, AdminDialogContent } from './AdminDialog'
import Pagination from './Pagination'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { timeAgo } from '@/lib/format'

const labels: Record<BookImportHistoryItem['status'], string> = { preview: '预览未提交', applied: '已导入', partial: '部分完成', rolled_back: '已撤回' }

export default function BookImportHistoryDialog({ open, onOpenChange, onCompleted }: { open: boolean; onOpenChange: (open: boolean) => void; onCompleted: () => void }) {
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
    setLoading(true); setError('')
    try {
      const data = await bookImportApi.history(20, (page - 1) * 20)
      if (seq !== revision.current) return
      setItems(data.items); setTotal(data.total ?? data.items.length)
      if (page > Math.max(1, Math.ceil((data.total || 0) / 20))) setPage(Math.max(1, Math.ceil((data.total || 0) / 20)))
    } catch (err) {
      if (seq === revision.current) setError((err as Error).message || '导入历史加载失败')
    } finally {
      if (seq === revision.current) setLoading(false)
    }
  }, [page])
  useEffect(() => {
    if (open) void load()
    return () => { revision.current++ }
  }, [open, load])
  async function rollback(item: BookImportHistoryItem) {
    if (rollbackLock.current) return
    rollbackLock.current = true
    try {
      if (!await confirm({ title: '撤回导入', message: `撤回「${item.novelTitle}」此次导入？服务端会保留导入后再次修改的内容，并列出冲突。`, okText: '撤回导入', danger: true })) return
      setBusyId(item.runId); setError(''); setResult(null)
      const operationId = operationIds.current.get(item.runId) || newOperationId('import-history-rollback')
      operationIds.current.set(item.runId, operationId)
      const next = await bookImportApi.rollback(item.runId, operationId)
      operationIds.current.delete(item.runId)
      setResult(next); onCompleted(); await load()
    } catch (err) {
      setError((err as Error).message || '撤回失败，请重试')
    } finally {
      rollbackLock.current = false; setBusyId('')
    }
  }
  return <Dialog open={open} onOpenChange={value => { if (!rollbackLock.current) onOpenChange(value) }}>
    <AdminDialogContent>
      <DialogHeader><DialogTitle>导入历史</DialogTitle><DialogDescription>查看当前账号的导入记录，并撤回仍可恢复的变更。</DialogDescription></DialogHeader>
      <AdminDialogBody>
        {error && <p role="alert">{error}</p>}
        {result && <div role="status"><p>已撤回 {result.rolledBack} 项变更，保留 {result.conflicts.length} 项冲突。</p>{result.conflicts.map((c, i) => <p key={`${c.id}-${i}`}>{c.title}：{c.reason}</p>)}</div>}
        {loading ? <p role="status">正在读取导入历史…</p> : items.length === 0 ? <p>暂无导入记录</p> : items.map(item => <article className="bookshelf-item-wrap" key={item.runId}>
          <strong>{item.novelTitle}</strong>
          <p>{item.sourceLabel} · {labels[item.status]} · {timeAgo(item.createdAt)}</p>
          <p>新增 {item.created} 章，更新 {item.updated} 章</p>
          <Button variant="secondary" disabled={!item.canRollback || !!busyId} onClick={() => void rollback(item)}>{busyId === item.runId ? '撤回中…' : '撤回此次导入'}</Button>
        </article>)}
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / 20))} onPage={setPage} busy={loading || !!busyId} summary={`共 ${total} 次导入`} />
        <Button variant="secondary" disabled={loading || !!busyId} onClick={() => void load()}>刷新历史</Button>
      </AdminDialogBody>
    </AdminDialogContent>
  </Dialog>
}
