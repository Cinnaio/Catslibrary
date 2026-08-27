/**
 * 封面图片入库与读取 —— 由 Novel-KV _covers.js 平移。
 * 所有封面数据存 novel_covers 表，前端一律走 /api/cover/:id。
 */
import type { Db } from '../db/pool'
import { first, run, withTx } from '../db/query'
import { newId } from './auth'
import { outboundFetch } from './outbound-fetch'

export const DEFAULT_COVER_URL = 'https://wap.po18x.vip/17mb/style/noimg.jpg'
export const MAX_COVER_BYTES = 5 * 1024 * 1024

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
}

export interface ImageData {
  data: Uint8Array
  contentType: string
}

export async function fetchImage(url: string): Promise<ImageData | null> {
  if (process.env.COVER_FETCH_ENABLED === '0') return null
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    // cover_url 由爬虫从外部页面解析写入，属用户可控数据，须经 SSRF 防护出站
    const res = await outboundFetch(url, { headers: FETCH_HEADERS }, { scope: 'cover-download', safe: true })
    if (!res.ok) return null
    // 无 Content-Type 或非图片一律拒绝，避免把任意响应体当图片入库对外提供
    const contentType = res.headers.get('Content-Type') || ''
    if (!/^image\//i.test(contentType)) return null
    const declaredLength = Number.parseInt(res.headers.get('Content-Length') || '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_BYTES) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!buf.byteLength || buf.byteLength > MAX_COVER_BYTES) return null
    return { data: buf, contentType }
  } catch {
    return null
  }
}

export async function storeCover(db: Db, novelId: string, data: Uint8Array, contentType: string, source: string): Promise<void> {
  await db.query(
    `INSERT INTO novel_covers (novel_id, data, content_type, source, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (novel_id) DO UPDATE SET
       data = EXCLUDED.data,
       content_type = EXCLUDED.content_type,
       source = EXCLUDED.source,
       updated_at = EXCLUDED.updated_at`,
    [novelId, data, contentType || 'image/jpeg', source || '', Date.now()],
  )
}

export interface StoredCover {
  data: Uint8Array
  content_type: string
  source: string
  updated_at: number
}

export async function getStoredCover(db: Db, novelId: string): Promise<StoredCover | undefined> {
  return first<StoredCover>(db, 'SELECT data, content_type, source, updated_at FROM novel_covers WHERE novel_id = $1', [novelId])
}

/** pg 的 BYTEA 返回 Buffer（Uint8Array 视图），直接可用作 Response body。 */
export function coverDataToBody(data: unknown): Uint8Array | null {
  if (!data) return null
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (Array.isArray(data)) return new Uint8Array(data)
  return null
}

/** 先试源图，失败/无封面则存缺省图。 */
export async function cacheCoverForNovel(
  db: Db,
  novelId: string,
  opts: { defaultImage?: ImageData } = {},
): Promise<{ ok: boolean; error?: string; status?: number; source?: string; contentType?: string; bytes?: number; isDefault?: boolean }> {
  const row = await first<{ cover_url: string }>(db, 'SELECT cover_url FROM novels WHERE id = $1', [novelId])
  if (!row) return { ok: false, error: 'novel not found', status: 404 }

  const coverUrl = (row.cover_url || '').trim()
  let img = await fetchImage(coverUrl)
  let source = coverUrl

  if (!img) {
    img = opts.defaultImage || (await fetchImage(DEFAULT_COVER_URL))
    source = 'default'
  }
  if (!img) return { ok: false, error: '源图与缺省图均下载失败', status: 502 }

  await storeCover(db, novelId, img.data, img.contentType, source)
  return { ok: true, source, contentType: img.contentType, bytes: img.data.byteLength, isDefault: source === 'default' }
}

// ---------- AI 封面候选：生成结果先存候选，采纳后才覆盖当前封面 ----------

export interface CoverCandidate {
  id: string
  novelId: string
  contentType: string
  prompt: string
  taskId: string
  createdAt: number
  metadata?: CoverCandidateMetadata
}

export interface CoverCandidateMetadata {
  genre?: string
  genres?: string[]
  stylePreset?: string
  composition?: string
  variationId?: string
  romanceSubtype?: string
  romanceEmotion?: string
  visualConcept?: string
  visualAnchor?: string
  storySetting?: string
}

/** 存一张 AI 封面候选，返回候选 id。不触碰当前封面（novel_covers）。 */
export async function storeCoverCandidate(
  db: Db,
  opts: { novelId: string; data: Uint8Array; contentType: string; prompt?: string; taskId?: string; metadata?: CoverCandidateMetadata },
): Promise<string> {
  const id = newId('cc')
  await db.query(
    `INSERT INTO ai_cover_candidates (id, novel_id, data, content_type, prompt, task_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, opts.novelId, opts.data, opts.contentType || 'image/png', opts.prompt || '', opts.taskId || '', JSON.stringify(opts.metadata || {}), Date.now()],
  )
  return id
}

/** 列出一本小说的全部候选（新的在前），含 dataUrl 供前端 <img> 直接展示。 */
export async function listCoverCandidates(db: Db, novelId: string): Promise<Array<CoverCandidate & { dataUrl: string }>> {
  const rows = await db.query<{
    id: string
    novel_id: string
    data: Buffer
    content_type: string
    prompt: string
    task_id: string
    metadata: string
    created_at: number
  }>('SELECT id, novel_id, data, content_type, prompt, task_id, metadata, created_at FROM ai_cover_candidates WHERE novel_id = $1 ORDER BY created_at DESC', [
    novelId,
  ])
  return rows.rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    contentType: row.content_type || 'image/png',
    prompt: row.prompt,
    taskId: row.task_id,
    createdAt: row.created_at,
    metadata: parseCoverCandidateMetadata(row.metadata),
    dataUrl: `data:${row.content_type || 'image/png'};base64,${Buffer.from(row.data).toString('base64')}`,
  }))
}

function parseCoverCandidateMetadata(value: unknown): CoverCandidateMetadata | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (!parsed || typeof parsed !== 'object') return undefined
    const obj = parsed as Record<string, unknown>
    const metadata: CoverCandidateMetadata = {}
    if (typeof obj.genre === 'string' && obj.genre) metadata.genre = obj.genre
    if (Array.isArray(obj.genres)) {
      const genres = obj.genres.filter((genre): genre is string => typeof genre === 'string' && !!genre)
      if (genres.length) metadata.genres = genres
    }
    if (typeof obj.stylePreset === 'string' && obj.stylePreset) metadata.stylePreset = obj.stylePreset
    if (typeof obj.composition === 'string' && obj.composition) metadata.composition = obj.composition
    if (typeof obj.variationId === 'string' && obj.variationId) metadata.variationId = obj.variationId
    if (typeof obj.romanceSubtype === 'string' && obj.romanceSubtype) metadata.romanceSubtype = obj.romanceSubtype
    if (typeof obj.romanceEmotion === 'string' && obj.romanceEmotion) metadata.romanceEmotion = obj.romanceEmotion
    if (typeof obj.visualConcept === 'string' && obj.visualConcept) metadata.visualConcept = obj.visualConcept
    if (typeof obj.visualAnchor === 'string' && obj.visualAnchor) metadata.visualAnchor = obj.visualAnchor
    if (typeof obj.storySetting === 'string' && obj.storySetting) metadata.storySetting = obj.storySetting
    return Object.keys(metadata).length ? metadata : undefined
  } catch {
    return undefined
  }
}

/** 采纳候选：把候选写入当前封面（覆盖式）并删除候选。事务保证两步原子性。 */
export async function adoptCoverCandidate(db: Db, id: string): Promise<boolean> {
  return withTx(db, async (q) => {
    const row = await q<{ id: string; novel_id: string; data: Buffer; content_type: string }>(
      'SELECT id, novel_id, data, content_type FROM ai_cover_candidates WHERE id = $1',
      [id],
    )
    if (!row.rows.length) return false
    const c = row.rows[0]!
    const now = Date.now()
    await q(
      `INSERT INTO novel_covers (novel_id, data, content_type, source, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (novel_id) DO UPDATE SET
         data = EXCLUDED.data,
         content_type = EXCLUDED.content_type,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at`,
      [c.novel_id, new Uint8Array(c.data), c.content_type || 'image/png', 'ai', now],
    )
    // 封面变了同步 bump novels.updated_at：前端所有封面 <img> 用它当 ?v= 破缓存戳，不更新则读者端一直显示旧封面
    await q('UPDATE novels SET updated_at = $2 WHERE id = $1', [c.novel_id, now])
    await q('DELETE FROM ai_cover_candidates WHERE id = $1', [id])
    return true
  })
}

/** 弃用候选：删除，不触碰当前封面。返回是否删除成功。 */
export async function deleteCoverCandidate(db: Db, id: string): Promise<boolean> {
  const rowCount = await run(db, 'DELETE FROM ai_cover_candidates WHERE id = $1', [id])
  return rowCount > 0
}
