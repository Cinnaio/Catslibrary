/**
 * 管理后台分页 —— 上一页 / 「第 X / Y 页」/ 跳转输入 / 下一页（shadcn 版）。
 * props 与行为不变；wrapper 保留共享类 home-pagination（前台 Home 同用），
 * 内部控件换成 shadcn Button/Input。
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface PaginationProps {
  page: number
  totalPages: number
  onPage: (page: number) => void
  className?: string
}

export default function Pagination({ page, totalPages, onPage, className }: PaginationProps) {
  const [jump, setJump] = useState(String(page))

  if (totalPages <= 1) return null

  function goTo(value: number) {
    onPage(Math.min(Math.max(value, 1), totalPages))
  }

  return (
    <div className={`home-pagination admin-pagination ${className || ''}`}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
        上一页
      </Button>
      <span className="home-pagination__info">
        第 {page} / {totalPages} 页
      </span>
      <span className="home-pagination__jump">
        跳转{' '}
        <Input
          type="number"
          className="h-8 w-[72px]"
          /* 可见文案「跳转 … 页」是输入框两侧的裸文本节点，不在任何 <label> 内，
             无法与控件建立程序化关联，读屏只会念「数字 输入框」。此处补名称；
             不用 <label> 是因为可见文本被输入框劈成两半，套 label 会连带把
             「页」字读进名称里。 */
          aria-label="跳转到指定页"
          min={1}
          max={totalPages}
          value={jump}
          onChange={(e) => {
            setJump(e.target.value)
            const n = Number.parseInt(e.target.value, 10)
            if (Number.isFinite(n) && n >= 1 && n <= totalPages) goTo(n)
          }}
          onBlur={() => setJump(String(page))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = Number.parseInt((e.target as HTMLInputElement).value, 10)
              if (Number.isFinite(n)) goTo(n)
            }
          }}
        />{' '}
        页
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => goTo(page + 1)}>
        下一页
      </Button>
    </div>
  )
}
