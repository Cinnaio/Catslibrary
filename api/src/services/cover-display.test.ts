import { afterAll, beforeAll, expect, it } from 'vitest'
import sharp from 'sharp'
import { Hono } from 'hono'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { coverRoutes } from '../routes/cover'
import { getCoverDisplay } from './cover-display'
import { adoptCoverCandidate, coverVersion, getCoverHistoryImage, getStoredCover, listCoverCandidates, listCoverHistory, replaceCoverForAdmin, storeCover, storeCoverCandidate } from './covers'

let t: TestDb
let original: Buffer
let counter = 0
const app = new Hono().route('/cover', coverRoutes)
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  // 带纹理的竖版图，避免仅用极小纯色图验证编码器。
  const pixels = Buffer.alloc(1024 * 1536 * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31 + (i >> 11) * 17) % 256
  original = await sharp(pixels, { raw: { width: 1024, height: 1536, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
})
afterAll(async () => { setDbForTests(null); await t.close() })
async function seed(data = original, type = 'image/png') {
  const id = `display-${++counter}`
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,'封面',1,1)", [id])
  await storeCover(t.db, id, data, type, 'upload')
  return id
}
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer())

it('预热两种尺寸，保持原始字节；展示图减小体积、保持比例并使用实际 MIME', async () => {
  const id = await seed()
  expect(Buffer.from((await getStoredCover(t.db, id))!.data).equals(original)).toBe(true)
  const rows = await t.db.query('SELECT width FROM cover_display_images WHERE novel_id=$1 ORDER BY width', [id])
  expect(rows.rows).toEqual([{ width: 320 }, { width: 1024 }])
  for (const width of [320, 1024] as const) {
    const res = await app.request(`/cover/${id}?size=${width}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    const data = await bytes(res)
    expect(data.length).toBeLessThan(original.length)
    expect(await sharp(data).metadata()).toMatchObject({ width, height: width * 1.5, format: 'webp' })
  }
  expect((await bytes(await app.request(`/cover/${id}?size=original`))).equals(original)).toBe(true)
})

it('旧记录首次读取补图，重复读取复用数据库结果，ETag 随尺寸和图片内容变化', async () => {
  const id = await seed()
  await t.db.query('DELETE FROM cover_display_images WHERE novel_id=$1', [id])
  const res = await app.request(`/cover/${id}?size=320`)
  const etag = res.headers.get('etag')!
  expect((await app.request(`/cover/${id}?size=320`, { headers: { 'If-None-Match': etag } })).status).toBe(304)
  expect((await app.request(`/cover/${id}?size=1024`, { headers: { 'If-None-Match': etag } })).status).toBe(200)
  const stored = await t.db.query<{ data: Uint8Array }>('SELECT data FROM cover_display_images WHERE novel_id=$1 AND width=320', [id])
  expect((await bytes(res)).equals(Buffer.from(stored.rows[0]!.data))).toBe(true)
  const replacement = await sharp(original).negate().png().toBuffer()
  await storeCover(t.db, id, replacement, 'image/png', 'ai')
  const changed = await app.request(`/cover/${id}?size=320`, { headers: { 'If-None-Match': etag } })
  expect(changed.status).toBe(200)
  expect(changed.headers.get('etag')).not.toBe(etag)
})

it('候选预览压缩，采纳、历史和恢复仍使用原图哈希与原始字节', async () => {
  const id = await seed()
  const next = await sharp(original).negate().png({ compressionLevel: 0 }).toBuffer()
  const candidateId = await storeCoverCandidate(t.db, { novelId: id, data: next, contentType: 'image/png' })
  const [candidate] = await listCoverCandidates(t.db, id)
  expect(candidate!.contentType).toBe('image/webp')
  expect(Buffer.from(candidate!.dataUrl.split(',')[1]!, 'base64').length).toBeLessThan(next.length)
  const result = await adoptCoverCandidate(t.db, candidateId, { actorId: 'admin', expectedCoverVersion: coverVersion(original) })
  expect(Buffer.from((await getStoredCover(t.db, id))!.data).equals(next)).toBe(true)
  const [history] = await listCoverHistory(t.db, id)
  const preview = await getCoverHistoryImage(t.db, id, history!.id)
  expect(preview!.contentType).toBe('image/webp')
  await replaceCoverForAdmin(t.db, { novelId: id, actorId: 'admin', historyId: history!.id, source: 'history', reason: 'restore', expectedCoverVersion: result!.version })
  expect(Buffer.from((await getStoredCover(t.db, id))!.data).equals(original)).toBe(true)
})

it('无压缩收益的小图片不放大、不重复存储；不支持的旧数据只记录回退结果', async () => {
  const small = await sharp({ create: { width: 12, height: 18, channels: 3, background: '#a64d32' } }).webp({ quality: 85 }).toBuffer()
  const id = await seed(small, 'image/webp')
  const display = await getCoverDisplay(t.db, id, { data: small, contentType: 'image/webp' }, 1024)
  expect((await sharp(display.data).metadata()).width).toBe(12)
  expect(display.data.byteLength).toBeLessThanOrEqual(small.length)
  const invalidId = await seed(Buffer.from('legacy broken image'))
  const rows = await t.db.query<{ data: Uint8Array | null }>('SELECT data FROM cover_display_images WHERE novel_id=$1', [invalidId])
  expect(rows.rows).toEqual([{ data: null }, { data: null }])
  expect(await (await app.request(`/cover/${invalidId}`)).text()).toBe('legacy broken image')
})

it('GIF 动画保持原始字节，不被静默压成第一帧', async () => {
  const frames = Buffer.alloc(16 * 48 * 3)
  frames.fill(255, 16 * 24 * 3)
  const data = await sharp(frames, { raw: { width: 16, height: 48, pageHeight: 24, channels: 3 } }).gif({ delay: [100, 100] }).toBuffer()
  expect((await sharp(data).metadata()).pages).toBe(2)
  const id = await seed(data, 'image/gif')
  const res = await app.request(`/cover/${id}?size=320`)
  expect(res.headers.get('content-type')).toBe('image/gif')
  expect(await bytes(res)).toEqual(data)
})

it('压缩图和原图都先检查可见范围与内容门禁，拒绝条件请求绕过权限', async () => {
  const id = await seed()
  const first = await app.request(`/cover/${id}?size=320`)
  const headers = { 'If-None-Match': first.headers.get('etag')! }
  await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id=$1", [id])
  for (const size of ['320', '1024', 'original']) expect((await app.request(`/cover/${id}?size=${size}`, { headers })).status).toBe(403)
  await t.db.query("UPDATE novels SET visibility='admin' WHERE id=$1", [id])
  expect((await app.request(`/cover/${id}?size=original`, { headers })).status).toBe(404)
})

it('合并同一图片的并发补图，过期衍生数据可重建，作品删除级联清理', async () => {
  const id = await seed()
  await t.db.query('DELETE FROM cover_display_images WHERE novel_id=$1', [id])
  const image = { data: original, contentType: 'image/png' }
  const results = await Promise.all(Array.from({ length: 5 }, () => getCoverDisplay(t.db, id, image, 320)))
  expect(results.every(item => Buffer.from(item.data).equals(Buffer.from(results[0]!.data)))).toBe(true)
  expect((await t.db.query('SELECT width FROM cover_display_images WHERE novel_id=$1', [id])).rows).toHaveLength(1)
  await t.db.query('UPDATE cover_display_images SET created_at=1 WHERE novel_id=$1', [id])
  await seed()
  expect((await t.db.query('SELECT width FROM cover_display_images WHERE novel_id=$1', [id])).rows).toHaveLength(0)
  expect((await getCoverDisplay(t.db, id, image, 320)).data.byteLength).toBeLessThan(original.length)
  await t.db.query('DELETE FROM novels WHERE id=$1', [id])
  expect((await t.db.query('SELECT width FROM cover_display_images WHERE novel_id=$1', [id])).rows).toHaveLength(0)
})
