/**
 * 封面图片入库与读取 —— 由 Novel-KV _covers.js 平移。
 * 所有封面数据存 novel_covers 表，前端一律走 /api/cover/:id。
 */
import { createHash } from 'node:crypto'
import type { Db, DbClient } from '../db/pool'
import { first, run, withTx } from '../db/query'
import { AiError } from './ai/client'
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

export async function storeCover(
  db: Db,
  novelId: string,
  data: Uint8Array,
  contentType: string,
  source: string,
  opts: { prompt?: string; metadata?: unknown } = {},
): Promise<void> {
  const metadata = serializeCoverMetadata(opts.metadata)
  await db.query(
    `INSERT INTO novel_covers (novel_id, data, content_type, source, prompt, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (novel_id) DO UPDATE SET
       data = EXCLUDED.data,
       content_type = EXCLUDED.content_type,
       source = EXCLUDED.source,
       prompt = EXCLUDED.prompt,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at`,
    [novelId, data, contentType || 'image/jpeg', source || '', String(opts.prompt || ''), metadata, Date.now()],
  )
}

export interface StoredCover {
  data: Uint8Array
  content_type: string
  source: string
  prompt: string
  metadata: string
  updated_at: number
}

export async function getStoredCover(db: Db, novelId: string): Promise<StoredCover | undefined> {
  return first<StoredCover>(db, 'SELECT data, content_type, source, prompt, metadata, updated_at FROM novel_covers WHERE novel_id = $1', [novelId])
}

function stableMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableMetadataValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableMetadataValue(item)]))
  }
  return value
}

export function serializeCoverMetadata(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(stableMetadataValue(value)) }
  catch { return '' }
}

export function parseStoredCoverMetadata(value: unknown): Record<string, unknown> | undefined {
  const text = String(value || '').trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

export function coverImageHash(data: unknown): string {
  const body = coverDataToBody(data) || new Uint8Array()
  return createHash('sha256').update(body).digest('hex')
}

export function coverVersion(data: unknown, metadata = ''): string {
  return createHash('sha256').update(`${coverImageHash(data)}\u0000${String(metadata || '')}`, 'utf8').digest('hex')
}

export interface CoverHistoryItem {
  id: string
  novelId: string
  contentType: string
  source: string
  prompt: string
  metadata?: Record<string, unknown>
  imageHash: string
  createdAt: number
  reason: string
  actorId: string
}

export interface CurrentCoverState {
  version: string
  source: string
  prompt: string
  metadata?: Record<string, unknown>
  updatedAt: number
  hasImage: boolean
}

export async function getCurrentCoverState(db: Db, novelId: string): Promise<CurrentCoverState | undefined> {
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return undefined
  const cover = await getStoredCover(db, novelId)
  return {
    version: coverVersion(cover?.data, cover?.metadata || ''),
    source: cover?.source || '',
    prompt: cover?.prompt || '',
    metadata: parseStoredCoverMetadata(cover?.metadata),
    updatedAt: Number(cover?.updated_at) || 0,
    hasImage: !!cover?.data,
  }
}

export async function listCoverHistory(db: Db, novelId: string): Promise<CoverHistoryItem[]> {
  const rows = await db.query<{
    id: string; novel_id: string; content_type: string; source: string; prompt: string; metadata: string
    image_hash: string; created_at: number; reason: string; actor_id: string
  }>(
    `SELECT id, novel_id, content_type, source, prompt, metadata, image_hash, created_at, reason, actor_id
     FROM novel_cover_history WHERE novel_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10`,
    [novelId],
  )
  return rows.rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    contentType: row.content_type || 'image/jpeg',
    source: row.source || '',
    prompt: row.prompt || '',
    metadata: parseStoredCoverMetadata(row.metadata),
    imageHash: row.image_hash || '',
    createdAt: Number(row.created_at) || 0,
    reason: row.reason || '',
    actorId: row.actor_id || '',
  }))
}

export async function getCoverHistoryImage(db: Db, novelId: string, historyId: string): Promise<{ data: Uint8Array; contentType: string } | undefined> {
  const row = await first<{ data: unknown; content_type: string }>(db, 'SELECT data, content_type FROM novel_cover_history WHERE id = $1 AND novel_id = $2', [historyId, novelId])
  const data = coverDataToBody(row?.data)
  return row && data ? { data, contentType: row.content_type || 'image/jpeg' } : undefined
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
  promptMode?: 'auto' | 'exact' | string
  configurationApplied?: boolean
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
    if (obj.promptMode === 'auto' || obj.promptMode === 'exact') metadata.promptMode = obj.promptMode
    if (typeof obj.configurationApplied === 'boolean') metadata.configurationApplied = obj.configurationApplied
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

export const MAX_COVER_HISTORY_ITEMS = 10
export const MAX_COVER_HISTORY_BYTES = 50 * 1024 * 1024

interface CoverReplacementInput {
  novelId: string
  actorId: string
  source: string
  reason: string
  data?: Uint8Array
  contentType?: string
  prompt?: string
  metadata?: unknown
  candidateId?: string
  historyId?: string
  expectedCoverVersion?: string
}

interface CoverReplacementResult {
  novelId: string
  version: string
  source: string
  prompt: string
  metadata?: Record<string, unknown>
  updatedAt: number
  hasImage: boolean
  historyId?: string
}

function shouldMaterializeExternalCover(url: string): boolean {
  const normalized = String(url || '').trim()
  return !!normalized && normalized !== DEFAULT_COVER_URL && /^https?:\/\//i.test(normalized)
}

function coverIsPlaceholder(source: string): boolean {
  const normalizedSource = String(source || '').trim()
  // 本地 AI/上传封面可能没有对应的 novels.cover_url；只要已有本地
  // 来源就必须进入历史，不能因为外部 URL 为空而丢掉可恢复版本。
  return normalizedSource === 'default'
    || normalizedSource === DEFAULT_COVER_URL
}

/** 清理每书最多 10 条、总字节不超过 50 MiB 的历史；调用方必须在替换事务内执行。 */
async function pruneCoverHistory(q: DbClient['query'], novelId: string): Promise<void> {
  const rows = await q<{ id: string; bytes: number }>(
    'SELECT id, octet_length(data)::bigint AS bytes FROM novel_cover_history WHERE novel_id = $1 ORDER BY created_at DESC, id DESC',
    [novelId],
  )
  let total = 0
  const keep: string[] = []
  for (const row of rows.rows) {
    const bytes = Number(row.bytes) || 0
    if (keep.length < MAX_COVER_HISTORY_ITEMS && total + bytes <= MAX_COVER_HISTORY_BYTES) {
      keep.push(row.id)
      total += bytes
    }
  }
  const remove = rows.rows.map((row) => row.id).filter((id) => !keep.includes(id))
  if (remove.length) await q(`DELETE FROM novel_cover_history WHERE novel_id = $1 AND id IN (${remove.map((_, index) => `$${index + 2}`).join(',')})`, [novelId, ...remove])
}

/**
 * 管理员封面替换的唯一事务入口。候选采纳、上传和历史恢复都走这里，
 * 爬虫/懒缓存继续使用 storeCover，不会自动建立历史记录。
 */
export async function replaceCoverForAdmin(db: Db, input: CoverReplacementInput): Promise<CoverReplacementResult> {
  const novelId = String(input.novelId || '').trim()
  if (!novelId) throw new AiError('invalid', 'novelId 必填', 400)
  if (input.candidateId && input.historyId) throw new AiError('invalid', '封面替换来源不能同时指定候选和历史', 422)

  // 外部旧封面只在锁外物化；事务内会重新核对 URL 和本地封面是否仍是同一版本。
  const beforeNovel = await first<{ id: string; cover_url: string; updated_at: number }>(db, 'SELECT id, cover_url, updated_at FROM novels WHERE id = $1', [novelId])
  if (!beforeNovel) throw new AiError('invalid', '小说不存在', 404)
  const beforeCover = await first<{ data: unknown }>(db, 'SELECT data FROM novel_covers WHERE novel_id = $1', [novelId])
  let preparedExternal: ImageData | undefined
  if (!beforeCover && shouldMaterializeExternalCover(beforeNovel.cover_url)) {
    preparedExternal = (await fetchImage(beforeNovel.cover_url)) || undefined
    if (!preparedExternal) throw new AiError('conflict', '无法在替换前备份现有外部封面，请稍后重试', 409)
  }

  return withTx(db, async (q) => {
    const novel = await q<{ id: string; cover_url: string; updated_at: number }>('SELECT id, cover_url, updated_at FROM novels WHERE id = $1 FOR UPDATE', [novelId])
    const novelRow = novel.rows[0]
    if (!novelRow) throw new AiError('invalid', '小说不存在', 404)
    const currentQuery = await q<{ data: unknown; content_type: string; source: string; prompt: string; metadata: string; updated_at: number }>(
      'SELECT data, content_type, source, prompt, metadata, updated_at FROM novel_covers WHERE novel_id = $1 FOR UPDATE',
      [novelId],
    )
    const current = currentQuery.rows[0]

    if (!beforeCover && (current || String(novelRow.cover_url || '').trim() !== String(beforeNovel.cover_url || '').trim())) {
      throw new AiError('conflict', '封面在备份期间发生变化，请重新读取后重试', 409)
    }

    const currentVersion = coverVersion(current?.data, current?.metadata || '')
    if (input.expectedCoverVersion && input.expectedCoverVersion !== currentVersion) {
      throw new AiError('conflict', '当前封面已变化，请重新读取后再操作', 409)
    }

    let data: Uint8Array | undefined = input.data
    let contentType = input.contentType || 'image/jpeg'
    let prompt = String(input.prompt || '')
    let metadata = serializeCoverMetadata(input.metadata)
    let replacementSource = input.source || ''

    if (input.candidateId) {
      const candidate = await q<{ id: string; novel_id: string; data: unknown; content_type: string; prompt: string; task_id: string; metadata: string }>(
        'SELECT id, novel_id, data, content_type, prompt, task_id, metadata FROM ai_cover_candidates WHERE id = $1 FOR UPDATE',
        [input.candidateId],
      )
      const row = candidate.rows[0]
      if (!row || row.novel_id !== novelId) throw new AiError('invalid', '候选封面不存在或不属于当前小说', 404)
      data = coverDataToBody(row.data) || undefined
      contentType = row.content_type || 'image/png'
      prompt = row.prompt || ''
      metadata = row.metadata || ''
    }

    if (input.historyId) {
      const history = await q<{ id: string; novel_id: string; data: unknown; content_type: string; source: string; prompt: string; metadata: string }>(
        'SELECT id, novel_id, data, content_type, source, prompt, metadata FROM novel_cover_history WHERE id = $1 FOR UPDATE',
        [input.historyId],
      )
      const row = history.rows[0]
      if (!row || row.novel_id !== novelId) throw new AiError('invalid', '封面历史不存在或不属于当前小说', 404)
      data = coverDataToBody(row.data) || undefined
      contentType = row.content_type || 'image/jpeg'
      // 保留历史快照原始 source；空 source 代表旧数据未知，不能伪造为 history。
      replacementSource = row.source ?? 'history'
      prompt = row.prompt || ''
      metadata = row.metadata || ''
    }

    if (!data || !data.byteLength || data.byteLength > MAX_COVER_BYTES) throw new AiError('invalid', '封面数据为空或超过 5MB', 422)
    if (!/^image\//i.test(contentType)) throw new AiError('invalid', '封面数据不是图片', 422)

    const newImageHash = coverImageHash(data)
    const currentData = coverDataToBody(current?.data)
    let oldData = currentData
    let oldContentType = current?.content_type || 'image/jpeg'
    let oldSource = current?.source || ''
    let oldPrompt = current?.prompt || ''
    let oldMetadata = current?.metadata || ''
    if (!current && preparedExternal) {
      oldData = preparedExternal.data
      oldContentType = preparedExternal.contentType || 'image/jpeg'
      oldSource = String(beforeNovel.cover_url || '').trim()
      oldPrompt = ''
      oldMetadata = ''
    }

    let historyId: string | undefined
    const oldImageHash = oldData ? coverImageHash(oldData) : ''
    if (oldData && oldImageHash !== newImageHash && !coverIsPlaceholder(oldSource)) {
      historyId = newId('coverhist')
      await q(
        `INSERT INTO novel_cover_history
         (id, novel_id, data, content_type, source, prompt, metadata, image_hash, created_at, reason, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [historyId, novelId, oldData, oldContentType, oldSource, oldPrompt, oldMetadata, oldImageHash, Date.now(), input.reason || 'replace', input.actorId || ''],
      )
    }

    const now = Math.max(Date.now(), (Number(novelRow.updated_at) || 0) + 1)
    await q(
      `INSERT INTO novel_covers (novel_id, data, content_type, source, prompt, metadata, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (novel_id) DO UPDATE SET
         data = EXCLUDED.data, content_type = EXCLUDED.content_type, source = EXCLUDED.source,
         prompt = EXCLUDED.prompt, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
      [novelId, data, contentType || 'image/jpeg', replacementSource, prompt, metadata, now],
    )
    await q('UPDATE novels SET updated_at = $2 WHERE id = $1', [novelId, now])
    if (input.candidateId) await q('DELETE FROM ai_cover_candidates WHERE id = $1 AND novel_id = $2', [input.candidateId, novelId])
    await pruneCoverHistory(q, novelId)

    return {
      novelId,
      version: coverVersion(data, metadata),
      source: replacementSource,
      prompt,
      metadata: parseStoredCoverMetadata(metadata),
      updatedAt: now,
      hasImage: true,
      ...(historyId ? { historyId } : {}),
    }
  })
}

/** 采纳候选：把候选写入当前封面（覆盖式）并删除候选；历史备份与替换同事务。 */
export async function adoptCoverCandidate(db: Db, id: string, opts: { actorId: string; expectedCoverVersion?: string }): Promise<CoverReplacementResult | undefined> {
  const candidate = await first<{ novel_id: string }>(db, 'SELECT novel_id FROM ai_cover_candidates WHERE id = $1', [id])
  if (!candidate) return undefined
  return replaceCoverForAdmin(db, { novelId: candidate.novel_id, candidateId: id, actorId: opts.actorId, source: 'ai', reason: 'adopt', expectedCoverVersion: opts.expectedCoverVersion })
}

/** 弃用候选：删除，不触碰当前封面。返回是否删除成功。 */
export async function deleteCoverCandidate(db: Db, id: string): Promise<boolean> {
  const rowCount = await run(db, 'DELETE FROM ai_cover_candidates WHERE id = $1', [id])
  return rowCount > 0
}
