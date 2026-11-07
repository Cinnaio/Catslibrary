/**
 * 受控分页：页面提供页码、总页数、计数与加载状态，组件只负责可访问的操作。
 * plain 用于公开书库，panel/detached/dialog 用于数据面板与浮层；所有形态共享跳转、禁用和页大小契约。
 * 数据请求、URL 同步和账户范围始终留在使用方。
 */
import { lazy, Suspense, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import './Pagination.css'

const PageSizeSelect = lazy(() => import('./PaginationPageSize'))

export interface PaginationPageSize {
  value: number
  onChange: (size: number) => void
  /** 可选项；不传时用 DEFAULT_PAGE_SIZE_OPTIONS（15 / 20 / 50 / 100）。 */
  options?: readonly number[]
}

interface PaginationProps {
  page: number
  totalPages: number
  onPage: (page: number) => void
  /** 左侧计数文案（如「共 128 条，显示 1-10」）。 */
  summary?: React.ReactNode
  /** 每页条数选择；传入即渲染。 */
  pageSize?: PaginationPageSize
  /** 翻页请求进行中：只禁用按钮，不隐藏控件，避免布局跳动。 */
  busy?: boolean
  /** detached 将分页从数据表面中分离，适合小说管理这类表格下方独立控制带。 */
  variant?: 'panel' | 'detached' | 'dialog' | 'plain'
  ariaLabel?: string
  jump?: boolean
  className?: string
}

export default function Pagination({
  page,
  totalPages,
  onPage,
  summary,
  pageSize,
  busy = false,
  variant = 'panel',
  ariaLabel = '分页',
  jump = true,
  className,
}: PaginationProps) {
  // null = 未处于编辑态，输入框直接显示 page；输入期间由 draft 接管。
  const [draft, setDraft] = useState<string | null>(null)

  // 既无计数、也无每页条数、又是单页时，整块不渲染（无可表达的信息）。
  if (totalPages <= 1 && !summary && !pageSize) return null

  const showPager = totalPages > 1

  function goTo(value: number) {
    if (busy) return
    const next = Math.min(Math.max(value, 1), Math.max(totalPages, 1))
    if (next !== page) onPage(next)
  }

  return (
    <nav aria-label={ariaLabel} className={`pagination${variant !== 'panel' ? ` pagination--${variant}` : ''}${className ? ` ${className}` : ''}`}>
      {summary ? <span className="pagination__summary">{summary}</span> : null}

      <div className="pagination__controls">
        {pageSize ? (
          <div className="pagination__page-size">
            <span>{variant === 'detached' ? '每页行数' : '每页'}</span>
            <Suspense fallback={<Button type="button" variant="outline" size="sm" className="pagination__page-size-placeholder" role="combobox" aria-label="每页显示数量" aria-expanded={false} disabled>{pageSize.value} 条</Button>}>
              <PageSizeSelect
                busy={busy}
                pageSize={pageSize}
                onChange={(value) => {
                  if (busy) return
                  pageSize.onChange(value)
                  // 改变每页条数后回到第 1 页：停留在原页码会落在越界区间。
                  if (page !== 1) onPage(1)
                }}
              />
            </Suspense>
          </div>
        ) : null}

        {showPager ? (
          <>
            {variant === 'detached' && (
              <Button
                variant="ghost"
                size="icon"
                className="pagination__icon-button"
                aria-label="第一页"
                title="第一页"
                disabled={busy || page <= 1}
                onClick={() => goTo(1)}
              >
                <ChevronsLeft aria-hidden="true" />
              </Button>
            )}
            <Button
              variant={variant === 'detached' ? 'ghost' : 'secondary'}
              size={variant === 'detached' ? 'icon' : 'sm'}
              className={variant === 'detached' ? 'pagination__icon-button' : undefined}
              aria-label="上一页"
              title="上一页"
              disabled={busy || page <= 1}
              onClick={() => goTo(page - 1)}
            >
              {variant === 'detached' ? <ChevronLeft aria-hidden="true" /> : '上一页'}
            </Button>
            <span className="pagination__info">
              第 {page} / {totalPages} 页
            </span>
            {jump && (
              <span className="pagination__jump">
                跳转
                <Input
                  disabled={busy}
                  type="number"
                  className="pagination__jump-input"
                  /* 可见文案「跳转 … 页」被输入框劈成两半，套 <label> 会把「页」
                     读进名称里，故用 aria-label 提供程序化名称。 */
                  aria-label="跳转到指定页"
                  min={1}
                  max={totalPages}
                  /* 输入值只在编辑期间由 draft 接管，未编辑时直接跟随 page——
                     外部翻页（筛选重置、每页条数变化、深层链接）因此自动同步，
                     不需要 effect 回写 state。 */
                  value={draft ?? String(page)}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    const parsed = Number.parseInt(event.target.value, 10)
                    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= totalPages) goTo(parsed)
                  }}
                  /* 失焦时交还给 page 渲染：输入半截数字离开不该改变显示。 */
                  onBlur={() => setDraft(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      const parsed = Number.parseInt((event.target as HTMLInputElement).value, 10)
                      if (Number.isFinite(parsed)) goTo(parsed)
                      setDraft(null)
                    }
                  }}
                />
                页
              </span>
            )}
            <Button
              variant={variant === 'detached' ? 'ghost' : 'secondary'}
              size={variant === 'detached' ? 'icon' : 'sm'}
              className={variant === 'detached' ? 'pagination__icon-button' : undefined}
              aria-label="下一页"
              title="下一页"
              disabled={busy || page >= totalPages}
              onClick={() => goTo(page + 1)}
            >
              {variant === 'detached' ? <ChevronRight aria-hidden="true" /> : '下一页'}
            </Button>
            {variant === 'detached' && (
              <Button
                variant="ghost"
                size="icon"
                className="pagination__icon-button"
                aria-label="最后一页"
                title="最后一页"
                disabled={busy || page >= totalPages}
                onClick={() => goTo(totalPages)}
              >
                <ChevronsRight aria-hidden="true" />
              </Button>
            )}
          </>
        ) : null}
      </div>
    </nav>
  )
}
