import { Check, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import type { BatchState, DiscoverNovel } from '../types'
import { FALLBACK_COVER, coverOnError } from '../utils'

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
    <section className="admin-panel-card scrape-discovery" aria-labelledby="scrape-discovery-title">
      <AdminPanelHeading
        className="scrape-discovery__heading"
        title={<span id="scrape-discovery-title">发现结果</span>}
        description={info || '正在从源站读取作品…'}
        status={
          novels.length > 0 ? (
            <span className="scrape-discovery__count">{selected.size > 0 ? `已选 ${selected.size} 本` : `当前 ${novels.length} 本`}</span>
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
          <div className="scrape-discovery__toolbar" aria-live="polite">
            <label className="scrape-discovery__select-all">
              <Checkbox checked={selected.size === selectableCount && selectableCount > 0} onCheckedChange={onToggleAll} aria-label="选择所有可抓取作品" />
              <span>选择可抓取作品</span>
            </label>
            <span className="scrape-discovery__toolbar-note">已收录的作品会自动跳过</span>
            <Button size="sm" onClick={onBatchScrape} disabled={selectedNewCount === 0}>
              <RefreshCw aria-hidden="true" />
              批量抓取 {selectedNewCount > 0 ? `(${selectedNewCount})` : ''}
            </Button>
          </div>

          <div className="scrape-discovery__list" role="list">
            {novels.map((novel, index) => (
              <article className={`scrape-discovery__row${novel.existing ? ' is-existing' : ''}`} key={`${novel.url}-${index}`} role="listitem">
                <Checkbox
                  className="scrape-discovery__checkbox"
                  checked={selected.has(index)}
                  disabled={novel.existing}
                  onCheckedChange={() => onToggleSelect(index)}
                  aria-label={`选择 ${novel.title}`}
                />
                <div className="scrape-discovery__cover" data-letter={(novel.title || '书').slice(0, 1)}>
                  <img
                    src={novel.coverUrl || FALLBACK_COVER}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      coverOnError(event)
                      event.currentTarget.parentElement?.classList.add('is-broken')
                    }}
                  />
                </div>
                <div className="scrape-discovery__copy">
                  <div className="scrape-discovery__title-line">
                    <h4>{novel.title || '未命名作品'}</h4>
                    {novel.existing && (
                      <Badge className="bg-success/10 text-success">
                        <Check aria-hidden="true" />
                        已在书库
                      </Badge>
                    )}
                  </div>
                  <div className="scrape-discovery__meta">
                    <span>{novel.author || '未知作者'}</span>
                    {novel.chapterCount ? <span>{novel.chapterCount} 章</span> : null}
                    {novel.status ? <span>{novel.status === 'completed' ? '已完结' : '连载中'}</span> : null}
                  </div>
                  <p>{novel.description || '暂无简介，打开详情后会重新分析源站信息。'}</p>
                </div>
                <div className="scrape-discovery__action">
                  <Button variant="secondary" size="sm" onClick={() => onInspect(index)} disabled={novel.existing}>
                    查看并配置
                  </Button>
                  <a href={novel.url} target="_blank" rel="noreferrer" aria-label={`打开 ${novel.title} 源站`}>
                    <ExternalLink aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="scrape-discovery__pagination">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页">
                <ChevronLeft aria-hidden="true" />
                上一页
              </Button>
              <span>
                第 {page} / {totalPages} 页
              </span>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="下一页">
                下一页
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </>
      )}

      {batch && (
        <div className="scrape-batch" role="status" aria-live="polite">
          <div className="scrape-batch__heading">
            <div>
              <strong>{batch.done ? '批量抓取处理完成' : '正在批量处理作品'}</strong>
              <span>
                {processed} / {batch.total} 本
              </span>
            </div>
            {batch.done && (
              <Button variant="ghost" size="sm" onClick={onClearBatch}>
                清除记录
              </Button>
            )}
          </div>
          <Progress value={batchPercent} aria-label="批量抓取进度" />
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
    </section>
  )
}
