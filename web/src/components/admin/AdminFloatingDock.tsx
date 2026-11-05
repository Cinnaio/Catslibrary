import '@/styles/admin/components/floating-dock.css'
import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface AdminFloatingDockProps extends ComponentPropsWithoutRef<'div'> {
  /** 按实际高度预留空间，保证页尾内容能滚动到操作条上方。 */
  reserveSpace?: boolean | 'page-end'
}

/** 后台共享浮动操作条；业务提供状态、动作和显示周期。保留 DOM 位置以支持原生表单提交。 */
export default function AdminFloatingDock({ reserveSpace = false, className, children, ...props }: AdminFloatingDockProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const [spaceTarget, setSpaceTarget] = useState<Element | null>(null)

  useLayoutEffect(() => {
    if (!reserveSpace || !dockRef.current) return
    const dock = dockRef.current
    // 批量条通常声明在列表前方，留白需放到页面末尾，避免在工具栏下撑出空洞。
    setSpaceTarget(reserveSpace === 'page-end' ? dock.closest('main') : null)
    const measure = () => setHeight(dock.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    return () => observer.disconnect()
  }, [reserveSpace])

  const spacer = reserveSpace ? (
    <div
      className="admin-floating-dock-space"
      aria-hidden="true"
      style={height === undefined ? undefined : { '--admin-dock-measured-height': `${height}px` } as CSSProperties}
    />
  ) : null

  return (
    <>
      {spaceTarget ? createPortal(spacer, spaceTarget) : spacer}
      <div ref={dockRef} className={cn('admin-floating-dock', className)} {...props}>
        {children}
      </div>
    </>
  )
}
