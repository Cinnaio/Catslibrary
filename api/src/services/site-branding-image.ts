import { createHash } from 'node:crypto'
import sharp from 'sharp'

/** Crop at the centre and mask the corners so favicons also appear circular outside the page. */
export async function renderCircularBrandingImage(input: Buffer, maxSide: number): Promise<Buffer> {
  const meta = await sharp(input).metadata()
  if (!meta.width || !meta.height) throw new Error('Invalid branding image')
  const side = Math.min(maxSide, meta.width, meta.height)
  const mask = Buffer.from(`<svg width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="white"/></svg>`)
  return sharp(input)
    .rotate()
    .resize(side, side, { fit: 'cover', position: 'centre' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

// Only the two currently requested brand assets need an in-memory rendered copy.
const renderedAssets = new Map<string, Promise<{ data: Buffer; hash: string }>>()
export function circularBrandingAsset(kind: 'logo' | 'favicon', asset: { data: string; hash: string }) {
  const key = `${kind}:${asset.hash}`
  const cached = renderedAssets.get(key)
  if (cached) return cached
  const rendered = renderCircularBrandingImage(Buffer.from(asset.data, 'base64'), kind === 'favicon' ? 128 : 512)
    .then(data => ({ data, hash: createHash('sha256').update(data).digest('hex') }))
    .catch(error => { if (renderedAssets.get(key) === rendered) renderedAssets.delete(key); throw error })
  if (renderedAssets.size >= 2) renderedAssets.delete(renderedAssets.keys().next().value!)
  renderedAssets.set(key, rendered)
  return rendered
}
