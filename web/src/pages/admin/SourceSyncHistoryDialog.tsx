import { useCallback, useEffect, useRef, useState } from 'react'
import { scrapeApi, newOperationId, type SourceSyncAppliedChange, type SourceSyncHistoryItem, type SourceSyncRollbackResult } from '@/lib/api'
import { useConfirm } from '@/components/feedback'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import Pagination from '@/components/admin/Pagination'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { timeAgo } from '@/lib/format'

const STATUS: Record<string, string> = { applied: '已应用', rolled_back: '已撤回', rollback_partial: '部分撤回，保留冲突' }

export default function SourceSyncHistoryDialog({ open, novelId, onOpenChange, onCompleted }: {
  open: boolean; novelId: string; onOpenChange: (open: boolean) => void; onCompleted: () => void | Promise<void>
}) {
  const { confirm } = useConfirm()
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<SourceSyncHistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [result, setResult] = useState<SourceSyncRollbackResult | null>(null)
  const [detail, setDetail] = useState<{ runId: string; changes: SourceSyncAppliedChange[] } | null>(null)
  const generation = useRef({ value: 0 })
  const lock = useRef(false)
  const operations = useRef(new Map<string, string>())
  const load = useCallback(async () => {
    const revision = ++generation.current.value
    setLoading(true); setError('')
    try {
      const data = await scrapeApi.sourceSyncHistory(novelId, 20, (page - 1) * 20)
      if (revision !== generation.current.value) return
      setItems(data.items); setTotal(data.total)
      if (page > Math.max(1, Math.ceil(data.total / 20))) setPage(Math.max(1, Math.ceil(data.total / 20)))
    } catch (err) {
      if (revision === generation.current.value) setError((err as Error).message || '融合历史加载失败')
    } finally { if (revision === generation.current.value) setLoading(false) }
  }, [novelId, page, generation])
  useEffect(() => {
    let active = true
    const tracker = generation.current
    void Promise.resolve().then(() => { if (active && open && novelId) return load() })
    return () => { active = false; tracker.value++ }
  }, [open, novelId, load, generation])
  async function readDetail(runId: string) {
    if (lock.current) return
    lock.current = true; setBusyId(runId); setError('')
    try { setDetail(await scrapeApi.sourceSyncHistoryDetail(runId)) }
    catch (err) { setError((err as Error).message || '变化详情加载失败') }
    finally { lock.current = false; setBusyId('') }
  }
  async function rollback(item: SourceSyncHistoryItem) {
    if (lock.current) return
    lock.current = true
    let rolledBack = false
    try {
      if (!await confirm({ title: '撤回此次融合？', message: '恢复本次实际修改的标题、序号和小说信息。再次编辑或审核过的内容将保留，并列出冲突。正文和阅读记录保持原样。', okText: '确认撤回', danger: true })) return
      setBusyId(item.runId); setError(''); setResult(null)
      const operationId = operations.current.get(item.runId) || newOperationId('source-sync-rollback')
      operations.current.set(item.runId, operationId)
      const next = await scrapeApi.sourceSyncRollback(item.runId, operationId)
      rolledBack = true
      operations.current.delete(item.runId)
      setResult(next); setDetail(null)
      setItems(previous => previous.map(row => row.runId === item.runId ? {
        ...row, canRollback: false, status: next.conflicts.length ? 'rollback_partial' : 'rolled_back', rollback: next,
      } : row))
      await onCompleted()
      await load()
    } catch (err) {
      const message = (err as Error).message || '请重试'
      setError(rolledBack ? `撤回已完成，但作品信息刷新失败：${message}。请刷新页面查看最新信息。` : `撤回失败：${message}`)
    }
    finally { lock.current = false; setBusyId('') }
  }
  return <Dialog open={open} onOpenChange={value => { if (!lock.current) onOpenChange(value) }}>
    <AdminDialogContent variant="editor" className="chapter-merge-dialog source-sync-history-dialog" onInteractOutside={event => { if (lock.current) event.preventDefault() }} onEscapeKeyDown={event => { if (lock.current) event.preventDefault() }}>
      <DialogHeader><DialogTitle>融合历史</DialogTitle><DialogDescription>查看当前作品的实际变化，撤回仍可安全恢复的内容。</DialogDescription></DialogHeader>
      <AdminDialogBody className="source-sync-history__body">
        {error && <p role="alert" className="chapter-merge-dialog__error">{error}</p>}
        {result && <div className="source-sync-history__result" role="status"><p>已恢复 {result.restored} 项，保留 {result.conflicts.length} 项冲突。</p>{result.conflicts.map(conflict => <p key={conflict.id}>{conflict.title}：{conflict.reason}</p>)}</div>}
        {loading ? <p role="status">正在读取融合历史…</p> : !items.length ? <p>当前作品暂无已应用的融合记录。</p> : <ol className="source-sync-history__list" aria-label="融合历史记录">{items.map(item => <li key={item.runId}>
          <div className="source-sync-history__record">
            <div className="source-sync-history__record-heading"><strong>{item.summary.novelTitle || '历史融合'}</strong><span className="source-sync-history__status">{STATUS[item.status] || item.status}</span></div>
            <p className="source-sync-history__time">{timeAgo(item.appliedAt)}</p>
            <dl className="source-sync-history__counts">
              <div><dt>章节标题</dt><dd>{item.summary.titleUpdated || 0}<span> 项</span></dd></div>
              <div><dt>章节序号</dt><dd>{item.summary.orderUpdated || 0}<span> 项</span></dd></div>
              <div><dt>小说信息</dt><dd>{item.summary.metadataUpdated || 0}<span> 项</span></dd></div>
            </dl>
            {item.summary.sourceUrl && <p className="source-sync-history__source"><span>来源</span>{item.summary.sourceUrl}</p>}
            {item.rollback && <p>已恢复 {item.rollback.restored} 项，保留 {item.rollback.conflicts.length} 项冲突。</p>}
            {!!item.rollback?.conflicts.length && <details><summary>查看保留的冲突</summary>{item.rollback.conflicts.map(conflict => <p key={conflict.id}>{conflict.title}：{conflict.reason}</p>)}</details>}
            {!item.canRollback && item.status === 'applied' && <p className="admin-dialog-hint">没有可撤回的实际变化快照；旧记录不推断恢复值。</p>}
          </div>
          <div className="chapter-merge-dialog__history-actions"><Button variant="ghost" aria-expanded={detail?.runId === item.runId} aria-controls={detail?.runId === item.runId ? 'source-sync-history-detail' : undefined} disabled={!!busyId || loading} onClick={() => void readDetail(item.runId)}>查看变化</Button><Button variant="secondary" disabled={!item.canRollback || !!busyId || loading} onClick={() => void rollback(item)}>撤回此次融合</Button></div>
          {detail?.runId === item.runId && <HistoryChanges key={detail.runId} changes={detail.changes} />}
        </li>)}</ol>}
      </AdminDialogBody>
      <DialogFooter>
        <Pagination className="source-sync-history__pagination" page={page} totalPages={Math.max(1, Math.ceil(total / 20))} onPage={value => { setDetail(null); setPage(value) }} busy={loading || !!busyId} summary={`共 ${total} 次融合`} />
        <Button variant="secondary" disabled={loading || !!busyId} onClick={() => void load()}>刷新历史</Button>
      </DialogFooter>
    </AdminDialogContent>
  </Dialog>
}

function HistoryChanges({ changes }: { changes: SourceSyncAppliedChange[] }) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(changes.length / 20))
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])
  return <section id="source-sync-history-detail" className="source-sync-history__detail" aria-label="融合变化详情"><h3 ref={heading} tabIndex={-1}>本次实际变化</h3>
    {!changes.length && <p>没有记录到可展示的实际变化。</p>}
    <ol className="source-sync-history__changes">{changes.slice((page - 1) * 20, page * 20).map((change, index) => <li key={change.kind === 'chapter' ? change.id : `metadata-${index}`}>
      {change.kind === 'chapter' ? <div className="source-sync-history__comparison"><p>原：{change.before.order} · {change.before.title}</p><p>更新后：{change.after.order} · {change.after.title}</p></div> : <MetadataChanges change={change} />}
    </li>)}</ol>
    <Pagination className="source-sync-history__detail-pagination" page={page} totalPages={pages} onPage={setPage} summary={`共 ${changes.length} 项变化`} />
  </section>
}

function MetadataChanges({ change }: { change: Extract<SourceSyncAppliedChange, { kind: 'metadata' }> }) {
  const fields = { title: '书名', author: '作者', description: '简介', cover_url: '封面', categories: '分类', status: '状态', content_rating: '内容分级' }
  return <div>{Object.entries(fields).filter(([field]) => change.before[field] !== change.after[field]).map(([field, label]) => <details key={field}><summary>{label}变化</summary><p>原：{String(change.before[field] ?? '未填写')}</p><p>更新后：{String(change.after[field] ?? '未填写')}</p></details>)}</div>
}
