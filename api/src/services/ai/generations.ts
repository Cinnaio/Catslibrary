/**
 * AI 生成产物存取 —— ai_generations 既是审核队列也是缓存：
 * 同一 (kind, chapter_id, params) 的已发布产物直接复用，不重复烧钱。
 * params_json 参与命中判断，因此换模型或改提示词版本会自然失效重算。
 */
import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { newId } from '../auth'

/** 删除/发布撤销窗口（毫秒）：10 秒内可通过 restore/unpublish 恢复。 */
export const UNDO_WINDOW_MS = 10_000

export type GenerationKind = 'continue' | 'summary' | 'dialogue' | 'catchup' | 'write_outline' | 'write_chapter'
export type GenerationStatus = 'draft' | 'published' | 'rejected'

export interface GenerationRow {
  id: string
  novel_id: string
  chapter_id: string
  kind: string
  model: string
  params_json: string
  prompt: string
  result: string
  status: string
  created_by: string
  created_at: number
}

export interface Generation {
  id: string
  novelId: string
  chapterId: string
  kind: string
  model: string
  result: string
  status: string
  createdAt: number
}

export function rowToGeneration(row: GenerationRow): Generation {
  return {
    id: String(row.id),
    novelId: String(row.novel_id || ''),
    chapterId: String(row.chapter_id || ''),
    kind: String(row.kind || ''),
    model: String(row.model || ''),
    result: String(row.result || ''),
    status: String(row.status || ''),
    createdAt: Number(row.created_at) || 0,
  }
}

/** 缓存键：字段顺序固定，保证同一组参数序列化结果稳定可比。prompt 指纹用于提示词变更时自然失效。 */
export function cacheKey(params: { version: number; model: string; prompt?: string }): string {
  return JSON.stringify({ version: params.version, model: params.model, ...(params.prompt ? { prompt: params.prompt } : {}) })
}

export async function findPublished(
  db: Db,
  kind: GenerationKind,
  chapterId: string,
  paramsJson: string,
): Promise<Generation | undefined> {
  const row = await first<GenerationRow>(
    db,
    `SELECT * FROM ai_generations
     WHERE kind = $1 AND chapter_id = $2 AND status = 'published' AND params_json = $3 AND deleted_at = 0
     ORDER BY created_at DESC LIMIT 1`,
    [kind, chapterId, paramsJson],
  )
  return row ? rowToGeneration(row) : undefined
}

export interface SaveGenerationInput {
  novelId: string
  chapterId: string
  kind: GenerationKind
  model: string
  paramsJson: string
  prompt: string
  result: string
  status: GenerationStatus
  createdBy: string
}

export async function saveGeneration(db: Db, input: SaveGenerationInput): Promise<Generation> {
  const id = newId('aigen')
  const createdAt = Date.now()
  await run(
    db,
    `INSERT INTO ai_generations (id, novel_id, chapter_id, kind, model, params_json, prompt, result, status, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      input.novelId || '',
      input.chapterId || '',
      input.kind,
      input.model || '',
      input.paramsJson || '{}',
      input.prompt || '',
      input.result || '',
      input.status,
      input.createdBy || '',
      createdAt,
    ],
  )
  return {
    id,
    novelId: input.novelId || '',
    chapterId: input.chapterId || '',
    kind: input.kind,
    model: input.model || '',
    result: input.result || '',
    status: input.status,
    createdAt,
  }
}

/** 管理端列表：按状态与时间倒序。 */
export async function listGenerations(db: Db, opts: { status?: string; limit?: number } = {}): Promise<Generation[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit || 50), 1), 200)
  const rows = opts.status
    ? await all<GenerationRow>(db, "SELECT * FROM ai_generations WHERE status = $1 AND deleted_at = 0 ORDER BY created_at DESC LIMIT $2", [opts.status, limit])
    : await all<GenerationRow>(db, 'SELECT * FROM ai_generations WHERE deleted_at = 0 ORDER BY created_at DESC LIMIT $1', [limit])
  return rows.map(rowToGeneration)
}

export interface GenerationDetail extends Generation {
  novelTitle: string
  chapterTitle: string
  batchId: string
  batchIndex: number
  batchCount: number
  /** 续写时从 AI 输出解析出的章节标题（params_json.draftTitle），供发布自动填充 */
  draftTitle: string
  prompt: string
}

function batchFields(paramsJson: string): { batchId: string; batchIndex: number; batchCount: number; draftTitle: string } {
  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>
    return {
      batchId: typeof params.batchId === 'string' ? params.batchId : '',
      batchIndex: Number(params.batchIndex) || 0,
      batchCount: Number(params.batchCount) || 0,
      draftTitle: typeof params.draftTitle === 'string' ? params.draftTitle : '',
    }
  } catch {
    return { batchId: '', batchIndex: 0, batchCount: 0, draftTitle: '' }
  }
}

export interface BatchDraft extends Generation {
  batchIndex: number
  batchCount: number
}

/** 断点恢复：按 batchId 取该批次已生成的草稿（draft），按 batchIndex 升序，用于续写时跳过已生成章节。 */
export async function listBatchDrafts(db: Db, batchId: string): Promise<BatchDraft[]> {
  if (!batchId) return []
  const rows = await all<GenerationRow>(
    db,
    `SELECT * FROM ai_generations WHERE kind = 'continue' AND status = 'draft' AND deleted_at = 0 AND params_json LIKE $1 ORDER BY created_at ASC`,
    [`%"batchId":"${batchId}"%`],
  )
  return rows
    .map((row) => ({ ...rowToGeneration(row), ...batchFields(row.params_json) }))
    .filter((d) => d.batchId === batchId && d.batchIndex > 0 && d.result.trim())
    .sort((a, b) => a.batchIndex - b.batchIndex)

}

/** 「已生成内容」管理列表：带小说/章节标题、行数与分页。 */
export async function listGenerationDetails(
  db: Db,
  opts: { kind?: string; kinds?: string[]; status?: string; limit?: number; offset?: number } = {},
): Promise<{ items: GenerationDetail[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit || 50), 1), 100)
  const offset = Math.max(Math.trunc(opts.offset || 0), 0)

  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.kind) {
    params.push(opts.kind)
    conditions.push(`g.kind = $${params.length}`)
  }
  if (opts.kinds?.length) {
    const placeholders = opts.kinds.map((kind) => {
      params.push(kind)
      return `$${params.length}`
    })
    conditions.push(`g.kind IN (${placeholders.join(', ')})`)
  }
  if (opts.status) {
    params.push(opts.status)
    conditions.push(`g.status = $${params.length}`)
  }
  conditions.push('g.deleted_at = 0')
  const where = `WHERE ${conditions.join(' AND ')}`

  const rows = await all<GenerationRow & { novel_title: string; chapter_title: string }>(
    db,
    `SELECT g.*, COALESCE(n.title, '') AS novel_title, COALESCE(c.title, '') AS chapter_title
     FROM ai_generations g
     LEFT JOIN novels n ON n.id = g.novel_id
     LEFT JOIN chapters c ON c.id = g.chapter_id
     ${where}
     ORDER BY g.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )
  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM ai_generations g ${where}`, params)

  return {
    items: rows.map((r) => ({
      ...rowToGeneration(r),
      novelTitle: String(r.novel_title || ''),
      chapterTitle: String(r.chapter_title || ''),
      ...batchFields(r.params_json),
      prompt: String(r.prompt || ''),
    })),
    total: totalRow?.total || 0,
  }
}

/** 软删除某条生成记录并顺带清理过期软删；返回是否真的标记成功。 */
export async function deleteGeneration(db: Db, id: string): Promise<boolean> {
  const affected = await run(db, "UPDATE ai_generations SET deleted_at = $1 WHERE id = $2 AND deleted_at = 0", [Date.now(), id])
  await purgeExpiredDeletions(db)
  return affected > 0
}

/** 批量软删除：10 秒内可通过 restoreGenerations 撤销。 */
export async function deleteGenerations(db: Db, ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))].slice(0, 500)
  if (!uniqueIds.length) return 0
  // $1 是删除时间戳，id 占位符从 $2 开始，避免与参数顺序冲突
  const placeholders = uniqueIds.map((_, index) => `$${index + 2}`).join(', ')
  const affected = await run(
    db,
    `UPDATE ai_generations SET deleted_at = $1 WHERE id IN (${placeholders}) AND deleted_at = 0`,
    [Date.now(), ...uniqueIds],
  )
  await purgeExpiredDeletions(db)
  return affected
}

/** 撤销软删除：仅在 10 秒撤销窗口内的记录可恢复，返回恢复条数。 */
export async function restoreGenerations(db: Db, ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))].slice(0, 500)
  if (!uniqueIds.length) return 0
  // $1 是撤销窗口截止时间，id 占位符从 $2 开始
  const placeholders = uniqueIds.map((_, index) => `$${index + 2}`).join(', ')
  const cutoff = Date.now() - UNDO_WINDOW_MS
  return run(
    db,
    `UPDATE ai_generations SET deleted_at = 0 WHERE id IN (${placeholders}) AND deleted_at > 0 AND deleted_at > $1`,
    [cutoff, ...uniqueIds],
  )
}

/** 物理清理超过撤销窗口的软删记录，防止表无限膨胀；删除/恢复时顺带调用。 */
export async function purgeExpiredDeletions(db: Db): Promise<number> {
  const cutoff = Date.now() - UNDO_WINDOW_MS
  return run(db, 'DELETE FROM ai_generations WHERE deleted_at > 0 AND deleted_at <= $1', [cutoff])
}

export async function getGeneration(db: Db, id: string): Promise<GenerationRow | undefined> {
  return first<GenerationRow>(db, 'SELECT * FROM ai_generations WHERE id = $1', [id])
}

export async function updateGenerationResult(db: Db, id: string, result: string, status: GenerationStatus = 'draft'): Promise<boolean> {
  return (await run(db, 'UPDATE ai_generations SET result = $1, status = $2 WHERE id = $3', [result, status, id])) > 0
}

/** 作废某章的缓存（重新生成 / 章节内容更新后调用）。 */
export async function invalidateChapter(db: Db, kind: GenerationKind, chapterId: string): Promise<number> {
  return run(db, `UPDATE ai_generations SET status = 'rejected' WHERE kind = $1 AND chapter_id = $2 AND status = 'published'`, [
    kind,
    chapterId,
  ])
}
