/** Default artwork is bundled locally; legacy URLs are kept only for recognition. */
export const DEFAULT_COVER_PATH = '/images/default-cover-flower.webp'
export const LEGACY_DEFAULT_COVER_URL = 'https://wap.po18x.vip/17mb/style/noimg.jpg'

export function isDefaultCoverSource(source: string): boolean {
  const value = String(source || '').trim()
  return value === 'default' || value === DEFAULT_COVER_PATH || value === LEGACY_DEFAULT_COVER_URL
}
