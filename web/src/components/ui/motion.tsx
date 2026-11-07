import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode, type Ref } from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'
import { motionDuration, prefersReducedMotion } from '@/lib/motion'
import { useMotionPresence } from '@/hooks/useMotionPresence'
import styles from './motion.module.css'

type PresenceProps = Omit<ComponentProps<'div'>, 'ref'> & {
  open: boolean
  asChild?: boolean
  /** 保留输入节点和草稿；昂贵的浮层可以在退出结束后卸载。 */
  keepMounted?: boolean
  mode?: 'disclosure' | 'surface'
  children: ReactNode
}

/** 对外立即切换可访问状态，只让退出画面短暂保留；快速反向操作从当前画面续接。 */
export function MotionPresence({ open, asChild = false, keepMounted = false, mode = 'surface', className, children, ...props }: PresenceProps) {
  const presence = useMotionPresence(open, mode)

  if (!presence.visible && !keepMounted) return null
  const Component = asChild ? Slot.Root : 'div'
  return <Component {...props} ref={presence.ref as Ref<HTMLDivElement>} className={cn(styles.presence, className)}
    hidden={presence.hidden} inert={presence.inert} aria-hidden={presence['aria-hidden']} data-motion-open={open}>
    {children}
  </Component>
}

/** 原生 details 的渐进增强，不更改 open、summary、键盘或浏览器查找行为。 */
export function MotionDetails({ className, ...props }: ComponentProps<'details'>) {
  return <details className={cn(styles.details, className)} {...props} />
}

/** 分区只做淡入，避免 transform 改变内部 fixed 浮动操作条的定位参照。 */
export function MotionView({ asChild = false, className, motionKey, ...props }: Omit<ComponentProps<'div'>, 'ref'> & { asChild?: boolean; motionKey?: string | number }) {
  const root = useRef<HTMLDivElement>(null)
  const previous = useRef(motionKey)
  const running = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    if (previous.current === motionKey) return
    previous.current = motionKey
    const element = root.current
    const opacity = running.current && element ? getComputedStyle(element).opacity : '0.6'
    running.current?.cancel()
    running.current = null
    if (!element || prefersReducedMotion() || document.hidden || typeof element.animate !== 'function') return
    const animation = element.animate([{ opacity }, { opacity: 1 }], {
      duration: motionDuration(element, true), easing: getComputedStyle(element).getPropertyValue('--ease-out').trim() || 'ease-out',
    })
    running.current = animation
    animation.onfinish = () => { if (running.current === animation) running.current = null }
  }, [motionKey])
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const cancel = () => { running.current?.cancel(); running.current = null }
    const changed = () => { if (media?.matches || document.hidden) cancel() }
    media?.addEventListener('change', changed)
    document.addEventListener('visibilitychange', changed)
    return () => { media?.removeEventListener('change', changed); document.removeEventListener('visibilitychange', changed); cancel() }
  }, [])
  const Component = asChild ? Slot.Root : 'div'
  return <Component ref={root} className={cn(styles.view, className)} {...props} />
}
