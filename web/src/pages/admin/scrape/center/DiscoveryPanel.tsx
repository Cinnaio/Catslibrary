import { MotionDetails } from '@/components/ui/motion'
import { ExternalLink, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { InlineError, LoadingState } from '@/components/shared/AsyncStates'
import EmptyState from '@/components/shared/EmptyState'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import Pagination from '@/components/shared/Pagination'
import type { BatchState, DiscoverNovel } from '../types'
import { FALLBACK_COVER } from '../utils'
import { isDefaultCoverSource } from '@shared/covers'
import styles from '../workbench.module.css'

interface DiscoveryPanelProps {
  novels: DiscoverNovel[]
  selected: Set<number>
  loading: boolean
  error: string
  info: string
  page: number
  totalPages: number
  batch: BatchState | null
  onToggleAll: () => void
  onToggleSelect: (index: number) => void
  onClearSelect?: () => void
  onInspect: (index: number) => void
  onBatchScrape: () => void
  onPage: (page: number) => void
  onClearBatch: () => void
  onRetry: () => void
}

export default function DiscoveryPanel({
  novels, selected, loading, error, info, page, totalPages, batch,
  onToggleAll, onToggleSelect, onClearSelect, onInspect,
  onBatchScrape, onPage, onClearBatch, onRetry,
}: DiscoveryPanelProps) {
  const selectableCount = novels.filter((novel) => !novel.existing).length
  const selectedNewCount = Array.from(selected).filter((index) => novels[index] && !novels[index].existing).length
  const batchBusy = Boolean(batch && !batch.done)
  const processed = batch ? batch.success + batch.fail + batch.entries.filter((entry) => entry.type === 'skip').length : 0
  const batchPercent = batch?.total ? Math.min(100, (processed / batch.total) * 100) : 0

  if (!loading && !error && !info && novels.length === 0 && !batch) return null

  return (
    <section className={styles.discovery} aria-label="发现结果" aria-busy={loading} data-loading={loading}>
      <div className={styles.resultsHeading}>
        <h3>源站作品</h3>
        {!loading && info && <span className={styles.hint}>{info}</span>}
        {loading && <span className={styles.loadingLine} role="status"><Spinner size="sm" aria-hidden="true" />正在读取源站作品…</span>}
      </div>
      {loading && novels.length === 0 && <LoadingState rows={3} label="正在读取源站作品" />}
      {error && !loading && <InlineError message={error} onRetry={onRetry} />}
      {!loading && !error && novels.length === 0 && info && <EmptyState message="没有找到作品" hint="可以换一个关键词、榜单或作品链接。" icon={<SearchX aria-hidden="true" />} />}
      {novels.length > 0 && <>
        <div className={styles.selectionRow}>
          <label className={styles.selectAll}>
            <Checkbox checked={selectedNewCount === selectableCount && selectableCount > 0} disabled={loading || batchBusy || selectableCount === 0} onCheckedChange={onToggleAll} aria-label="选择所有可抓取作品" />
            全选可抓取作品
          </label>
          <span className={styles.hint}>{selectedNewCount > 0 ? `已选 ${selectedNewCount} 本` : '已收录作品自动跳过'}</span>
        </div>
        <div className={styles.discoveryList} role="list" aria-label="源站候选作品">
          {novels.map((novel, index) => <article className={styles.discoveryRow} key={`${novel.url}-${index}`} role="listitem" data-existing={novel.existing}>
            <div className={styles.rowSelect}>
              <Checkbox checked={selected.has(index)} disabled={novel.existing || loading || batchBusy} onCheckedChange={() => onToggleSelect(index)} aria-label={`选择 ${novel.title}`} />
            </div>
            <div className={styles.resultCover}>
              <span aria-hidden="true">{(novel.title || '书').slice(0, 1)}</span>
              <img src={novel.coverUrl && !isDefaultCoverSource(novel.coverUrl) ? novel.coverUrl : FALLBACK_COVER} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />
            </div>
            <div className={styles.resultInfo}>
              <div className={styles.resultTitle}>
                <h4>{novel.title || '未命名作品'}</h4>
                {novel.existing && <AdminStatusBadge tone="muted">已在书库</AdminStatusBadge>}
              </div>
              <p className={styles.hint}>{novel.author || '未知作者'}{novel.chapterCount ? ` · ${novel.chapterCount} 章` : ''}{novel.status ? ` · ${novel.status === 'completed' ? '已完结' : '连载中'}` : ''}</p>
              <p className={styles.resultDescription}>{novel.description || '暂无简介，核对作品时将重新读取。'}</p>
            </div>
            <div className={styles.resultActions}>
              <Button variant="outline" disabled={novel.existing || loading || batchBusy} onClick={() => onInspect(index)}>{novel.existing ? '已收录' : '核对作品'}</Button>
              <Button variant="ghost" size="icon" asChild><a href={novel.url} target="_blank" rel="noreferrer" aria-label={`打开 ${novel.title} 源站`}><ExternalLink aria-hidden="true" /></a></Button>
            </div>
          </article>)}
        </div>
        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPage={onPage} busy={loading || batchBusy} variant="plain" summary={`本页 ${novels.length} 本作品`} />}
      </>}
      {batch && <section className={styles.batch} aria-label="批量处理进度">
        <div className={styles.batchHeading}>
          <div><h4>{batch.done ? '批量处理已结束' : '正在创建抓取任务'}</h4><p className={styles.hint} role="status">已处理 {processed} / {batch.total} 本 · 已启动 {batch.success} 本{batch.fail > 0 ? ` · 失败 ${batch.fail} 本` : ''}</p></div>
          {batch.done && <Button variant="ghost" onClick={onClearBatch}>清除记录</Button>}
        </div>
        <Progress value={batchPercent} className={styles.batchProgress} aria-label="批量处理进度" />
        {batch.entries.length > 0 && <MotionDetails className={styles.batchDetails}><summary>查看处理明细</summary><ul className={styles.batchEntries} tabIndex={0} aria-label="批量处理明细">{batch.entries.map((entry, index) => <li key={index} data-kind={entry.type}><span>{entry.type === 'err' ? '失败' : entry.type === 'ok' ? '成功' : entry.type === 'skip' ? '跳过' : entry.type === 'novel' ? '作品' : '说明'}</span>{entry.text}</li>)}</ul></MotionDetails>}
      </section>}
      <AdminSelectionBar count={selectedNewCount} label={`已选择 ${selectedNewCount} 本作品`} onClear={onClearSelect || onToggleAll} clearLabel="取消选择" clearPlacement="actions">
        <Button onClick={onBatchScrape} disabled={selectedNewCount === 0 || loading || batchBusy}>{batchBusy ? <Spinner size="sm" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{batchBusy ? '正在批量处理…' : `批量抓取 (${selectedNewCount})`}</Button>
      </AdminSelectionBar>
    </section>
  )
}
