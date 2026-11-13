/** Default artwork is bundled locally; legacy URLs are kept only for recognition. */
export const DEFAULT_COVER_PATH = '/images/default-cover-flower.webp'
const LEGACY_PLACEHOLDER_PATH = '/17mb/style/noimg.jpg'

export function isDefaultCoverSource(source: string): boolean {
  const value = String(source || '').trim()
  if (value === 'default' || value === DEFAULT_COVER_PATH) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.pathname === LEGACY_PLACEHOLDER_PATH
  } catch {
    return false
  }
}
