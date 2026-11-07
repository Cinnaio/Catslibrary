/** 跨页面的滚动偏好，不依赖阅读业务、路由或用户数据。 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

export function motionDuration(element: HTMLElement, opening: boolean) {
  const token = getComputedStyle(element).getPropertyValue(opening ? '--motion-state-enter' : '--motion-state-exit').trim()
  const value = parseFloat(token)
  return Number.isFinite(value) ? value * (token.endsWith('ms') ? 1 : 1000) : opening ? 180 : 140
}
