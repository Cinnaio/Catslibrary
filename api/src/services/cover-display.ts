import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { DbClient } from '../db/pool'

export type CoverDisplayWidth = 320 | 1024
interface CoverImage { data: Uint8Array; contentType: string }
interface DisplayRow { data: Uint8Array | null; content_type: string }

// 修改编码策略时递增，避免读取上一版编码结果。
const ENCODING_VERSION = 'webp-85-v1'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const pending = new WeakMap<DbClient, Map<string, Promise<CoverImage>>>()
let active = 0
const waiting: Array<() => void> = []

async function compress(image: CoverImage, width: CoverDisplayWidth): Promise<CoverImage> {
  // 限制同一 API 进程内的编码并发，避免书库首屏或候选批量读取争抢 CPU。
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve))
  else active++
  try {
    const input = sharp(image.data, { limitInputPixels: 40_000_000, animated: false })
    const meta = await input.metadata()
    // 动图保持原样；展示优化不能默默丢掉动画。
    if ((meta.pages || 1) > 1 || !['jpeg', 'png', 'webp', 'avif', 'gif'].includes(meta.format || '')) return image
    const data = await input.rotate()
      .resize({ width, height: width * 3, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85, effort: 4, smartSubsample: true })
      .toBuffer()
    return data.byteLength < image.data.byteLength ? { data, contentType: 'image/webp' } : image
  } catch {
    // 历史损坏图片、像素超限及当前解码器不支持的图片继续沿用原读取行为。
    return image
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

/** 权限检查由调用方完成。本表只缓存衍生数据，不参与原图版本、历史或导出。 */
export async function getCoverDisplay(
  db: DbClient, novelId: string, image: CoverImage, width: CoverDisplayWidth = 1024,
): Promise<CoverImage> {
  const hash = createHash('sha256').update(ENCODING_VERSION).update('\0')
    .update(image.contentType).update('\0').update(image.data).digest('hex')
  let jobs = pending.get(db)
  if (!jobs) { jobs = new Map(); pending.set(db, jobs) }
  const key = `${novelId}:${hash}:${width}`
  const existing = jobs.get(key)
  if (existing) return existing
  const job = (async () => {
    const result = await db.query<DisplayRow>(
      'SELECT data, content_type FROM cover_display_images WHERE novel_id=$1 AND image_hash=$2 AND width=$3',
      [novelId, hash, width],
    )
    const row = result.rows[0]
    if (row) return row.data ? { data: row.data, contentType: row.content_type } : image
    const display = await compress(image, width)
    await db.query(
      `INSERT INTO cover_display_images(novel_id,image_hash,width,data,content_type,created_at)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [novelId, hash, width, display === image ? null : display.data, display.contentType, Date.now()],
    )
    // 每次补图只清理少量过期衍生数据，不扫描或改写原图。删除作品由外键级联清理。
    await db.query(`DELETE FROM cover_display_images WHERE (novel_id,image_hash,width) IN (
      SELECT novel_id,image_hash,width FROM cover_display_images WHERE created_at < $1 ORDER BY created_at LIMIT 32
    )`, [Date.now() - RETENTION_MS])
    return display
  })()
  jobs.set(key, job)
  try { return await job }
  finally { jobs.delete(key) }
}

/** 在生成、下载、上传完成后预热；旧记录和导入回滚也能在读取时按原图哈希补图。 */
export async function prepareCoverDisplays(db: DbClient, novelId: string, image: CoverImage): Promise<void> {
  try {
    await getCoverDisplay(db, novelId, image, 320)
    await getCoverDisplay(db, novelId, image, 1024)
  } catch {
    console.warn('[cover-display] 展示图预热失败，将在读取时重试')
  }
}
