import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

interface AdminFloatingDockProps extends ComponentPropsWithoutRef<'div'> {
  /** 表单等持续显示的操作岛预留实际高度，保证页尾内容能滚动到岛上方。 */
  reserveSpace?: boolean
}

/** 后台悬浮胶囊岛外壳；业务提供状态、动作和显示周期。保留 DOM 位置以支持原生表单提交。 */
export default function AdminFloatingDock({ reserveSpace = false, className, children, ...props }: AdminFloatingDockProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    if (!reserveSpace || !dockRef.current) return
    const dock = dockRef.current
    const measure = () => setHeight(dock.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    return () => observer.disconnect()
  }, [reserveSpace])

  return (
    <>
      {reserveSpace && (
        <div
          className="admin-floating-dock-space"
          aria-hidden="true"
          style={height === undefined ? undefined : { '--admin-dock-measured-height': `${height}px` } as CSSProperties}
        />
      )}
      <div ref={dockRef} className={cn('admin-floating-dock', className)} {...props}>
        {children}
      </div>
    </>
  )
}
