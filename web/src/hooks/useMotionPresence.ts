import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motionDuration, prefersReducedMotion } from '@/lib/motion'

/** 隐藏语义立即生效，退出画面完成后再释放布局；不复制子节点。 */
export function useMotionPresence(open: boolean, mode: 'disclosure' | 'surface' = 'surface') {
  const root = useRef<HTMLElement>(null)
  const [present, setPresent] = useState(open)
  const previous = useRef(open)
  const target = useRef(open)
  const running = useRef<Animation | null>(null)
  target.current = open

  useLayoutEffect(() => {
    const element = root.current
    const changed = previous.current !== open
    previous.current = open
    if (!element) return

    const active = running.current
    const current = active ? getComputedStyle(element) : null
    const from: Keyframe | undefined = current ? {
      opacity: current.opacity,
      height: `${element.getBoundingClientRect().height}px`,
      paddingTop: current.paddingTop, paddingBottom: current.paddingBottom,
      marginTop: current.marginTop, marginBottom: current.marginBottom,
    } : undefined
    active?.cancel()
    running.current = null

    // 程序收起时也不能把焦点留在已 inert 的内容里。
    if (!open && element.contains(document.activeElement) && element.id) {
      const trigger = Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]'))
        .find(candidate => candidate.getAttribute('aria-controls')?.split(/\s+/).includes(element.id)
          && !candidate.closest('[hidden], [inert]'))
        ?? element.closest('[data-slot="collapsible"]')?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')
      trigger?.focus({ preventScroll: true })
    }
    if (!changed || prefersReducedMotion() || document.hidden || typeof element.animate !== 'function') {
      setPresent(open)
      return
    }
    if (open) setPresent(true)
    const computed = getComputedStyle(element)
    const resting: Keyframe = { opacity: computed.opacity || '1' }
    const collapsed: Keyframe = { opacity: '0' }
    if (mode === 'disclosure') {
      Object.assign(resting, {
        height: `${element.getBoundingClientRect().height}px`,
        paddingTop: computed.paddingTop, paddingBottom: computed.paddingBottom,
        marginTop: computed.marginTop, marginBottom: computed.marginBottom,
        overflow: 'clip',
      })
      Object.assign(collapsed, { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', overflow: 'clip' })
    }
    const start = from ? (mode === 'surface' ? { opacity: from.opacity } : { ...from, overflow: 'clip' }) : open ? collapsed : resting
    const animation = element.animate([start, open ? resting : collapsed], {
      duration: motionDuration(element, open),
      easing: computed.getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23, 1, 0.32, 1)',
      fill: 'both',
    })
    running.current = animation
    animation.onfinish = () => {
      if (running.current !== animation) return
      running.current = null
      setPresent(target.current)
      animation.cancel()
    }
  }, [open, mode])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const settle = () => {
      if (!media?.matches && !document.hidden) return
      running.current?.cancel()
      running.current = null
      setPresent(target.current)
    }
    media?.addEventListener('change', settle)
    document.addEventListener('visibilitychange', settle)
    return () => {
      media?.removeEventListener('change', settle)
      document.removeEventListener('visibilitychange', settle)
      running.current?.cancel()
      running.current = null
    }
  }, [])

  return { ref: root, visible: open || present, hidden: !open && !present, inert: !open || undefined, 'aria-hidden': !open || undefined }
}
