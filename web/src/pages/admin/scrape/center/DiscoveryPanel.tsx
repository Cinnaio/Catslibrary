import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { Check, ExternalLink, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { AdminDataPanel, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import Pagination from '@/components/admin/Pagination'
import type { BatchState, DiscoverNovel } from '../types'
import { FALLBACK_COVER, coverOnError } from '../utils'
import { isDefaultCoverSource } from '@shared/covers'

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
  onInspect: (index: number) => void
  onBatchScrape: () => void
  onPage: (page: number) => void
  onClearBatch: () => void
}

export default function DiscoveryPanel({
  novels,
  selected,
  loading,
  error,
  info,
  page,
  totalPages,
  batch,
  onToggleAll,
  onToggleSelect,
  onInspect,
  onBatchScrape,
  onPage,
  onClearBatch,
}: DiscoveryPanelProps) {
  const selectableCount = novels.filter((novel) => !novel.existing).length
  const selectedNewCount = Array.from(selected).filter((index) => !novels[index]?.existing).length
  const processed = batch ? batch.success + batch.fail + batch.entries.filter((entry) => entry.type === 'skip').length : 0
  const batchPercent = batch ? (batch.total ? (processed / batch.total) * 100 : 0) : 0

  if (!loading && !error && !info && novels.length === 0 && !batch) return null

  return (
    <AdminDataPanel className="scrape-discovery" ariaLabel="发现结果">
      <AdminPanelHeading
        className="scrape-discovery__heading"
        title="发现结果"
        titleId="scrape-discovery-title"
        status={
          info || novels.length > 0 ? (
            <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
              {info && (
                <span role="status" className="text-xs text-muted-foreground">
                  {info}
                </span>
              )}
              {novels.length > 0 && (
                <span className="scrape-discovery__count">{selected.size > 0 ? `已选 ${selected.size} 本` : `当前 ${novels.length} 本`}</span>
              )}
            </div>
          ) : undefined
        }
      />

      {loading && (
        <div className="scrape-discovery__loading" role="status">
          <div className="scrape-skeleton-row" />
          <div className="scrape-skeleton-row" />
          <div className="scrape-skeleton-row" />
          <span>正在读取作品信息…</span>
        </div>
      )}

      {error && !loading && (
        <div className="scrape-discovery__empty" role="alert">
          <SearchX aria-hidden="true" />
          <strong>{error}</strong>
          <span>可以换一个入口，或检查源站地址和代理设置。</span>
        </div>
      )}

      {novels.length > 0 && !loading && (
        <>
          <div className="scrape-discovery__toolbar rounded-xl" aria-live="polite">
            <label className="scrape-discovery__select-all">
              <Checkbox checked={selected.size === selectableCount && selectableCount > 0} onCheckedChange={onToggleAll} aria-label="选择所有可抓取作品" className="rounded-md" />
              <span>选择可抓取作品</span>
            </label>
            <span className="scrape-discovery__toolbar-note">已收录的作品会自动跳过</span>
            <Button
              size="sm"
              onClick={onBatchScrape}
              disabled={selectedNewCount === 0}
              className="rounded-full h-8 px-3.5 text-xs font-semibold bg-[#D97757] hover:bg-[#c86646] text-white shadow-xs"
            >
              <RefreshCw className="size-3 mr-1" aria-hidden="true" />
              批量抓取 {selectedNewCount > 0 ? `(${selectedNewCount})` : ''}
            </Button>
          </div>

          <div className="scrape-discovery__list rounded-2xl border-border/80" role="list">
            {novels.map((novel, index) => (
              <article className={`scrape-discovery__row${novel.existing ? ' is-existing' : ''}`} key={`${novel.url}-${index}`} role="listitem">
                <Checkbox
                  className="scrape-discovery__checkbox rounded-md"
                  checked={selected.has(index)}
                  disabled={novel.existing}
                  onCheckedChange={() => onToggleSelect(index)}
                  aria-label={`选择 ${novel.title}`}
                />
                <div className="scrape-discovery__cover shadow-xs rounded-lg" data-letter={(novel.title || '书').slice(0, 1)}>
                  <img
                    src={novel.coverUrl && !isDefaultCoverSource(novel.coverUrl) ? novel.coverUrl : FALLBACK_COVER}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={coverOnError}
                  />
                </div>
                <div className="scrape-discovery__copy">
                  <div className="scrape-discovery__title-line">
                    <h4 className="font-serif font-semibold text-base">{novel.title || '未命名作品'}</h4>
                    {novel.existing && (
                      <AdminStatusBadge tone="success">
                        <Check aria-hidden="true" />
                        已在书库
                      </AdminStatusBadge>
                    )}
                  </div>
                  <div className="scrape-discovery__meta">
                    <span className="font-medium text-foreground/80">{novel.author || '未知作者'}</span>
                    {novel.chapterCount ? <span>{novel.chapterCount} 章</span> : null}
                    {novel.status ? <span>{novel.status === 'completed' ? '已完结' : '连载中'}</span> : null}
                  </div>
                  <p>{novel.description || '暂无简介，打开详情后会重新分析源站信息。'}</p>
                </div>
                <div className="scrape-discovery__action">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full h-8 px-3 text-xs font-medium border-border hover:border-[#D97757]/40 hover:text-[#D97757]"
                    onClick={() => onInspect(index)}
                    disabled={novel.existing}
                  >
                    查看并配置
                  </Button>
                  <a
                    href={novel.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`打开 ${novel.title} 源站`}
                    className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-[#D97757] hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPage={onPage} summary={`本页 ${novels.length} 本`} />}
        </>
      )}

      {batch && (
        <div className="scrape-batch rounded-2xl border-border bg-muted/40 p-4" role="status" aria-live="polite">
          <div className="scrape-batch__heading">
            <div className="flex items-center gap-3">
              <strong className="font-serif text-sm">{batch.done ? '批量抓取处理完成' : '正在批量处理作品'}</strong>
              <span className="font-mono text-xs text-muted-foreground">
                {processed} / {batch.total} 本
              </span>
            </div>
            {batch.done && (
              <Button variant="ghost" size="sm" className="rounded-full h-7 text-xs" onClick={onClearBatch}>
                清除记录
              </Button>
            )}
          </div>
          <Progress
            value={batchPercent}
            aria-label="批量抓取进度"
            className="my-2.5 h-2 rounded-full [&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-[#D97757] [&_[data-slot=progress-indicator]]:to-[#E58C6E]"
          />
          {batch.entries.length > 0 && (
            <div className="scrape-batch__last">
              {batch.entries.slice(-3).map((entry, index) => (
                <span className={`is-${entry.type}`} key={`${entry.text}-${index}`}>
                  {entry.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminDataPanel>
  )
}
