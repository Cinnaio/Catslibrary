const RECOVERY_KEY = 'zhi-zhou:page-recovery'
const RECOVERY_COOLDOWN = 5 * 60 * 1000

/** Only resource failures should trigger an automatic reload; rendering bugs need a visible fallback. */
export function isPageResourceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .+ failed|Unable to preload CSS for/i.test(message)
}

/** Persist before reloading, so even a second failure on the next document cannot loop. */
export function recoverPageResource(
  error: unknown,
  reload: () => void = () => window.location.reload(),
  now = Date.now(),
): boolean {
  if (!isPageResourceError(error)) return false
  try {
    const previous = Number(sessionStorage.getItem(RECOVERY_KEY))
    if (previous > 0 && now - previous < RECOVERY_COOLDOWN) return false
    sessionStorage.setItem(RECOVERY_KEY, String(now))
  } catch {
    // Without persistent storage, a reload cannot safely be bounded across documents.
    return false
  }
  reload()
  return true
}
