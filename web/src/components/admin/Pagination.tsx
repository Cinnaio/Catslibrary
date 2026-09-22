/**
 * 管理后台统一页脚 —— 计数 / 每页条数 / 上一页 / 第 X / Y 页 / 跳转 / 下一页。
 *
 * 全站后台的唯一分页实现，固定为「数据面板页脚」这一种形态：
 * 左计数、右控件，靠 1px 上边线与表格分区，共享面板纸面。
 * 不再提供对齐或跳转框开关——只有一个正确位置，避免再次分叉。
 *
 * 现状与历史：后台曾并存 6 套实现，在按钮变体（secondary / outline / ghost /
 * 原生 .btn）、页数措辞（「第 X / Y 页」/「X / Y」）、跳转框有无、容器对齐与
 * 皮肤上各不相同，另有容器在面板外悬浮的一档。现统一到本组件。
 *
 * 容器只使用 .admin-pagination 命名空间，**不复用前台类名**。此前复用
 * .home-pagination 造成前台规则跨层漏进后台：home.css 的「卡片表面」规则组
 * 含 .home-pagination 且未加 .home-page 作用域，后台分页因此继承到前台 20px
 * 大圆角，而边框/底色/投影又被后台规则覆盖，形成半前台半后台的中间态。
 *
 * 前台 Home 保留自己的实现（Home.tsx 内联原生控件 + .home-pagination），
 * 两套刻意分开：前台是阅读场景的卡片皮肤，后台是紧凑控制带。
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'

export interface PaginationPageSize {
  value: number
  onChange: (size: number) => void
  /** 可选项；不传时用 ADMIN_PAGE_SIZE_OPTIONS（10 / 20 / 50 / 100）。 */
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
  className?: string
}

export default function Pagination({ page, totalPages, onPage, summary, pageSize, busy = false, className }: PaginationProps) {
  // null = 未处于编辑态，输入框直接显示 page；输入期间由 draft 接管。
  const [draft, setDraft] = useState<string | null>(null)

  // 既无计数、也无每页条数、又是单页时，整块不渲染（无可表达的信息）。
  if (totalPages <= 1 && !summary && !pageSize) return null

  const showPager = totalPages > 1

  function goTo(value: number) {
    const next = Math.min(Math.max(value, 1), Math.max(totalPages, 1))
    if (next !== page) onPage(next)
  }

  return (
    <div className={className ? `admin-pagination ${className}` : 'admin-pagination'}>
      {summary ? <span className="admin-pagination__summary">{summary}</span> : null}

      <div className="admin-pagination__controls">
        {pageSize ? (
          <div className="admin-pagination__page-size">
            <span>每页</span>
            <Select
              value={String(pageSize.value)}
              onValueChange={(value) => {
                pageSize.onChange(Number(value))
                // 改变每页条数后回到第 1 页：停留在原页码会落在越界区间。
                if (page !== 1) onPage(1)
              }}
            >
              <SelectTrigger size="sm" aria-label="每页显示数量">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" sideOffset={4}>
                {(pageSize.options || ADMIN_PAGE_SIZE_OPTIONS).map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {showPager ? (
          <>
            <Button variant="secondary" size="sm" disabled={busy || page <= 1} onClick={() => goTo(page - 1)}>
              上一页
            </Button>
            <span className="admin-pagination__info">
              第 {page} / {totalPages} 页
            </span>
            <span className="admin-pagination__jump">
              跳转
              <Input
                type="number"
                className="admin-pagination__jump-input"
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
            <Button variant="secondary" size="sm" disabled={busy || page >= totalPages} onClick={() => goTo(page + 1)}>
              下一页
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
