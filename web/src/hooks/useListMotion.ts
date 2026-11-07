import { useEffect, useLayoutEffect, useRef } from 'react'
import { motionDuration, prefersReducedMotion } from '@/lib/motion'

/** 仅由已成功的用户操作调用；普通取数、轮询和滚动不会触发布局动画。 */
export function useListMotion(scope: string) {
  const root = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const animations = useRef(new Set<Animation>())
  const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-motion-item]') || [])
    .filter(element => element.getClientRects().length > 0)

  useLayoutEffect(() => {
    const before = positions.current
    positions.current = new Map()
    if (!before.size || prefersReducedMotion() || document.hidden) return
    for (const element of items()) {
      const old = before.get(element.dataset.motionItem!)
      if (!old || typeof element.animate !== 'function') continue
      const rect = element.getBoundingClientRect()
      const x = old.x - rect.left - window.scrollX
      const y = old.y - rect.top - window.scrollY
      if (Math.abs(x) < 1 && Math.abs(y) < 1) continue
      const animation = element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], {
        duration: motionDuration(element, true), easing: 'ease-out',
      })
      animations.current.add(animation)
      animation.onfinish = () => animations.current.delete(animation)
    }
  })

  useEffect(() => {
    const running = animations.current
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const cancel = () => {
      positions.current.clear()
      for (const animation of running) animation.cancel()
      running.clear()
    }
    const changed = () => { if (media?.matches || document.hidden) cancel() }
    media?.addEventListener('change', changed)
    document.addEventListener('visibilitychange', changed)
    return () => { media?.removeEventListener('change', changed); document.removeEventListener('visibilitychange', changed); cancel() }
  }, [scope])

  async function remove(id: string) {
    const visibleItems = items()
    const element = visibleItems.find(item => item.dataset.motionItem === id)
    if (!element) return
    if (element.contains(document.activeElement)) {
      const index = visibleItems.indexOf(element)
      const next = visibleItems[index + 1] || visibleItems[index - 1]
      const focus = next?.querySelector<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]')
        || root.current?.querySelector<HTMLElement>('[data-motion-fallback]')
      focus?.focus({ preventScroll: true })
    }
    if (prefersReducedMotion() || document.hidden || typeof element.animate !== 'function') return
    const wasInert = element.inert
    const hidden = element.getAttribute('aria-hidden')
    element.inert = true
    element.setAttribute('aria-hidden', 'true')
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: motionDuration(element, false), easing: 'ease-out', fill: 'both' })
    animations.current.add(animation)
    try { await animation.finished } catch { /* 偏好变化、换账号或离页时立即结束视觉等待。 */ }
    finally {
      animations.current.delete(animation)
      animation.cancel()
      element.inert = wasInert
      if (hidden === null) element.removeAttribute('aria-hidden')
      else element.setAttribute('aria-hidden', hidden)
    }
  }

  function prepare() {
    if (prefersReducedMotion() || document.hidden) return
    positions.current = new Map(items().map(element => {
      const rect = element.getBoundingClientRect()
      return [element.dataset.motionItem!, { x: rect.left + window.scrollX, y: rect.top + window.scrollY }]
    }))
  }
  return { root, remove, prepare }
}
