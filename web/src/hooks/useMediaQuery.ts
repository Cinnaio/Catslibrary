import { useMemo, useSyncExternalStore } from 'react'

/** Sync with CSS breakpoints, including resize; isolated tests fall back to desktop. */
export function useMediaQuery(query: string): boolean {
  const media = useMemo(() => typeof window.matchMedia === 'function' ? window.matchMedia(query) : null, [query])
  return useSyncExternalStore(
    listener => { media?.addEventListener('change', listener); return () => media?.removeEventListener('change', listener) },
    () => media?.matches ?? false,
    () => false,
  )
}
