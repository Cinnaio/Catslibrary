import { Check, ExternalLink, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import Pagination from "@/components/shared/Pagination"
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
  onClearSelect?: () => void
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
  onClearSelect,
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
    <div className="scrape-intake scrape-discovery-card" aria-label="发现结果">
      {/* 头部：完全对齐 Claude 标准卡片规范 */}
      <div className="scrape-intake-card__head">
        <div className="scrape-intake-card__title-group">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 id="scrape-discovery-title" className="scrape-intake-card__title">
              发现结果
            </h2>
            {novels.length > 0 && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-stone-200/80 dark:border-stone-700/80">
                {selected.size > 0 ? `已选 ${selected.size} / ${novels.length} 部` : `共 ${novels.length} 部候选作品`}
              </span>
            )}
          </div>
          <p className="scrape-intake-card__subtitle">
            {info || '检索到以下源站候选作品，可点击单独配置入库，或批量勾选后通过悬浮岛一键抓取。'}
          </p>
        </div>
      </div>

      {loading && (
        <div className="scrape-discovery__loading rounded-xl border border-border/60 bg-stone-50/50 dark:bg-stone-900/30 p-6 flex flex-col items-center justify-center gap-3 text-muted-foreground" role="status">
          <RefreshCw className="size-5 animate-spin text-[#D97757]" aria-hidden="true" />
          <span className="text-xs">正在从源站检索作品信息，请稍候…</span>
        </div>
      )}

      {error && !loading && (
        <div className="scrape-discovery__empty rounded-xl border border-rose-200/60 bg-rose-50/40 dark:bg-rose-950/20 dark:border-rose-900/40 p-6 flex flex-col items-center justify-center text-center gap-2" role="alert">
          <SearchX className="size-6 text-rose-500" aria-hidden="true" />
          <strong className="text-sm text-foreground font-medium">{error}</strong>
          <span className="text-xs text-muted-foreground">可以换一个入口链接，或检查出站代理设置。</span>
        </div>
      )}

      {novels.length > 0 && !loading && (
        <div className="flex flex-col gap-2">
          {/* 轻量纯净的列表表头全选行 */}
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b border-border/40 mb-1">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-foreground hover:text-[#D97757] transition-colors">
              <Checkbox
                checked={selected.size === selectableCount && selectableCount > 0}
                onCheckedChange={onToggleAll}
                aria-label="选择所有可抓取作品"
                className="rounded-md"
              />
              <span>全选可抓取作品</span>
            </label>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              已收录的作品会自动跳过
            </span>
          </div>

          {/* Claude 风格作品列表 */}
          <div className="scrape-discovery-list" role="list">
            {novels.map((novel, index) => (
              <article
                className={`scrape-discovery-item ${novel.existing ? 'is-existing' : ''}`}
                key={`${novel.url}-${index}`}
                role="listitem"
              >
                <div className="flex items-center self-center shrink-0 pr-1">
                  <Checkbox
                    className="rounded-md"
                    checked={selected.has(index)}
                    disabled={novel.existing}
                    onCheckedChange={() => onToggleSelect(index)}
                    aria-label={`选择 ${novel.title}`}
                  />
                </div>

                <div className="scrape-discovery-cover" data-letter={(novel.title || '书').slice(0, 1)}>
                  <img
                    src={novel.coverUrl && !isDefaultCoverSource(novel.coverUrl) ? novel.coverUrl : FALLBACK_COVER}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={coverOnError}
                  />
                </div>

                <div className="scrape-discovery-details">
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <h4 className="scrape-discovery-title m-0">
                      {novel.title || '未命名作品'}
                    </h4>
                    {novel.existing && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/60">
                        <Check className="size-3" aria-hidden="true" />
                        已在书库
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="font-medium text-stone-700 dark:text-stone-300">
                      {novel.author || '未知作者'}
                    </span>
                    {novel.chapterCount ? (
                      <>
                        <span className="text-stone-300 dark:text-stone-700 select-none">·</span>
                        <span>{novel.chapterCount} 章</span>
                      </>
                    ) : null}
                    {novel.status ? (
                      <>
                        <span className="text-stone-300 dark:text-stone-700 select-none">·</span>
                        <span>{novel.status === 'completed' ? '已完结' : '连载中'}</span>
                      </>
                    ) : null}
                  </div>

                  <p className="scrape-discovery-desc m-0">
                    {novel.description || '暂无简介，打开详情后会重新分析源站信息。'}
                  </p>
                </div>

                <div className="scrape-discovery-action-group">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs font-medium px-3.5 border-[#dedcd5] hover:border-[#d97757]/60 hover:text-[#c15f3d] dark:border-[#38352f] dark:hover:bg-[#25231f] transition-all cursor-pointer"
                    onClick={() => onInspect(index)}
                    disabled={novel.existing}
                  >
                    {novel.existing ? '已收录' : '查看并配置'}
                  </Button>
                  <a
                    href={novel.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`打开 ${novel.title} 源站`}
                    className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-[#d97757] hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pt-2">
              <Pagination page={page} totalPages={totalPages} onPage={onPage} summary={`本页 ${novels.length} 部作品`} />
            </div>
          )}
        </div>
      )}

      {batch && (
        <div className="scrape-batch rounded-xl border border-border/80 bg-stone-50/60 dark:bg-stone-900/40 p-4 mt-2" role="status" aria-live="polite">
          <div className="scrape-batch__heading flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <strong className="font-serif text-sm text-foreground">{batch.done ? '批量抓取处理完成' : '正在批量处理作品'}</strong>
              <span className="font-mono text-xs text-muted-foreground">
                {processed} / {batch.total} 本
              </span>
            </div>
            {batch.done && (
              <Button variant="ghost" size="sm" className="rounded-lg h-7 text-xs" onClick={onClearBatch}>
                清除记录
              </Button>
            )}
          </div>
          <Progress
            value={batchPercent}
            aria-label="批量抓取进度"
            className="my-2.5 h-2 rounded-full [&_[data-slot=progress-indicator]]:bg-[#D97757]"
          />
          {batch.entries.length > 0 && (
            <div className="scrape-batch__last text-xs text-muted-foreground flex flex-wrap gap-2">
              {batch.entries.slice(-3).map((entry, index) => (
                <span className={`is-${entry.type}`} key={`${entry.text}-${index}`}>
                  {entry.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 底部悬浮胶囊岛（批量操作） */}
      <AdminSelectionBar
        count={selected.size}
        label={`已选择 ${selected.size} 部作品`}
        onClear={onClearSelect || onToggleAll}
        clearLabel="取消选择"
        clearPlacement="actions"
      >
        <Button
          size="sm"
          onClick={onBatchScrape}
          disabled={selectedNewCount === 0}
        >
          <RefreshCw aria-hidden="true" />
          批量抓取 {selectedNewCount > 0 ? `(${selectedNewCount})` : ''}
        </Button>
      </AdminSelectionBar>
    </div>
  )
}
