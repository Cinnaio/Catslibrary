import { MotionDetails } from '@/components/ui/motion'
import type { TitleSource, TitleSourceSearchResponse } from '@/lib/api'

const SITES = ['jjwxc', 'po18tw'] as const
const priority = { high: 2, medium: 1, low: 0 }

export default function TitleSourceSearchResults({ search, disabled, onSelect }: {
  search: TitleSourceSearchResponse
  disabled: boolean
  onSelect: (url: string) => void
}) {
  const candidates = SITES.flatMap(site => search.sources?.[site]?.results || [])
    .sort((a, b) => priority[b.confidence || 'low'] - priority[a.confidence || 'low'] || (b.matchScore || 0) - (a.matchScore || 0))
  const preferred = candidates.filter(candidate => candidate.confidence === 'high' || candidate.confidence === 'medium').slice(0, 6)
  const preferredSet = new Set(preferred)

  function renderCandidate(candidate: TitleSource) {
    return (
      <button
        type="button"
        key={`${candidate.site}-${candidate.bookId || candidate.url}`}
        className="group rounded-md border border-border bg-background p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(candidate.url)}
        disabled={disabled}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <span>{candidate.title || '未识别书名'}</span>
          <span className="text-xs font-normal text-muted-foreground">{candidate.site === 'jjwxc' ? '晋江' : 'PO18.tw'}</span>
          {candidate.confidence && <span className={`text-xs font-normal ${candidate.confidence === 'high' ? 'text-primary' : 'text-muted-foreground'}`}>
            {candidate.confidence === 'high' ? '高置信匹配' : candidate.confidence === 'medium' ? '待核对' : '低匹配'}
          </span>}
          {candidate.status && <span className="text-xs font-normal text-muted-foreground">{candidate.status === 'completed' ? '完结' : '连载'}</span>}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{candidate.author || '作者未识别'} · {candidate.url}</span>
        {candidate.matchReason && <span className="mt-1 block text-xs text-muted-foreground">{candidate.matchReason}</span>}
      </button>
    )
  }

  return (
    <div className="chapter-merge-dialog__search-results mt-3 space-y-3">
      {preferred.length > 0 ? (
        <section aria-label="优先候选">
          <div className="dialog-frame-section-label mb-1">优先候选 · {preferred.length} 个</div>
          <p className="dialog-frame-hint mb-2">已按书名、作者匹配程度排序，点击候选读取预览。</p>
          <div className="grid gap-2">{preferred.map(renderCandidate)}</div>
        </section>
      ) : <p className="dialog-frame-hint">没有找到高匹配候选，可展开源站结果手动查找。</p>}
      {SITES.map(site => {
        const bucket = search.sources?.[site]
        const results = (bucket?.results || []).filter(candidate => !preferredSet.has(candidate))
        const label = site === 'jjwxc' ? '晋江' : 'PO18.tw'
        return (
          <div key={site}>
            {bucket?.error && <p className="mb-2 text-xs text-amber-600">{bucket.error}</p>}
            {results.length > 0 ? (
              <MotionDetails>
                <summary className="cursor-pointer text-sm">{label}其他结果 · {results.length} 个</summary>
                <div className="mt-2 grid gap-2">{results.map(renderCandidate)}</div>
              </MotionDetails>
            ) : <p className="dialog-frame-hint">{label} · {bucket?.results?.length ? '全部结果已列入优先候选' : bucket?.ok ? '没有匹配结果' : '搜索不可用'}</p>}
          </div>
        )
      })}
    </div>
  )
}
