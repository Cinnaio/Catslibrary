import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react'

export function inputMotion(event: Pick<MouseEvent, 'detail'>): 'animated' | 'instant' {
  // Keyboard and assistive-tech clicks have detail=0. Do not delay their feedback.
  return event.detail > 0 ? 'animated' : 'instant'
}

export function preserveDisclosureFocus(event: MouseEvent<HTMLButtonElement>, panelId: string, closing: boolean) {
  if (closing && document.getElementById(panelId)?.contains(document.activeElement)) event.currentTarget.focus({ preventScroll: true })
}

/** Animate a mode change without remounting form controls or duplicating accessible content. */
export function useStateChangeMotion(key: string, selector: string) {
  const root = useRef<HTMLElement>(null)
  const previous = useRef(key)
  const requested = useRef(false)
  const running = useRef(new Map<HTMLElement, Animation>())
  useLayoutEffect(() => {
    if (previous.current === key) return
    previous.current = key
    const frames = new Map<HTMLElement, { opacity: string; transform: string }>()
    for (const [element, animation] of running.current) {
      const style = getComputedStyle(element)
      frames.set(element, { opacity: style.opacity, transform: style.transform })
      animation.cancel()
    }
    running.current.clear()
    if (!requested.current || !root.current) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const tokens = getComputedStyle(root.current)
    const rawDuration = tokens.getPropertyValue(reduced ? '--motion-state-reduced' : '--motion-state-enter').trim()
    const duration = rawDuration ? parseFloat(rawDuration) * (rawDuration.endsWith('ms') ? 1 : 1000) : reduced ? 100 : 180
    const easing = tokens.getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23, 1, 0.32, 1)'
    const offset = tokens.getPropertyValue('--motion-state-offset').trim() || '4px'
    for (const element of root.current.querySelectorAll<HTMLElement>(selector)) {
      if (typeof element.animate !== 'function') continue
      const start = reduced ? { opacity: '0.9', transform: 'none' } : frames.get(element) || { opacity: '0.6', transform: `translateY(${offset})` }
      const animation = element.animate([start, { opacity: '1', transform: 'none' }], { duration, easing })
      running.current.set(element, animation)
      animation.onfinish = () => { if (running.current.get(element) === animation) running.current.delete(element) }
    }
  }, [key, selector])
  useEffect(() => {
    const animations = running.current
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const cancel = () => { for (const animation of animations.values()) animation.cancel(); animations.clear() }
    const changed = () => { if (media?.matches) cancel() }
    media?.addEventListener('change', changed)
    return () => { media?.removeEventListener('change', changed); cancel() }
  }, [])
  return { root, prepare: (event: Pick<MouseEvent, 'detail'>) => { requested.current = inputMotion(event) === 'animated' } }
}
