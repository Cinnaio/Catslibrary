import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import styles from './CellText.module.css'

interface CellTextProps {
  /** 完整文本（字符串，用于 title 与无障碍原文），或需要在单元格内嵌入交互的元素。 */
  children: string | ReactNode
  /** 强化为主字段（书名、章节名）：加粗 + 行标题档字号。 */
  strong?: boolean
  className?: string
}

/**
 * 表格单元格文本 —— 单行截断 + 完整值可达。
 *
 * 问题：`.admin-data-panel--grid table td` 是 `overflow: hidden` 定长行高，
 * 超长书名（实测有 60+ 字的中文长标题）被静默裁掉且**没有任何补偿**——
 * 既没有省略号提示「后面还有」，也无法查看完整值。操作员在审核/分级这类
 * 需要确认「这是哪一本」的场景里，只能靠猜。
 *
 * 契约：单行截断并用省略号明示截断；完整值同时挂在原生 title（鼠标悬停）
 * 与 sr-only 补全文本（读屏）上。不用 Tooltip 组件：表格一屏几十行，
 * 每行都挂一层 portal 浮层的收益抵不过鼠标移动时的闪烁干扰，原生 title
 * 在这里是更克制也更稳的选择。
 */
export function CellText({ children, strong = false, className }: CellTextProps) {
  // 文本模式保留「完整值可达」的无障碍补充；嵌入元素时无法把节点序列化成字符串，只渲染节点本身。
  const plain = typeof children === 'string'
  return (
    <span
      className={cn(styles.text, 'cell-text', strong && styles.strong, strong && 'cell-text--strong', className)}
      title={plain ? (children as string) : undefined}
    >
      {children}
      {plain ? <span className="sr-only">（完整：{children}）</span> : null}
    </span>
  )
}
