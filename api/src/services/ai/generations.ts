/**
 * AI 生成产物存取 —— ai_generations 既是审核队列也是缓存：
 * 同一 (kind, chapter_id, params) 的已发布产物直接复用，不重复烧钱。
 * params_json 参与命中判断，因此换模型或改提示词版本会自然失效重算。
 */
import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { newId } from '../auth'

export type GenerationKind = 'continue' | 'summary' | 'dialogue' | 'catchup'
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

/** 缓存键：字段顺序固定，保证同一组参数序列化结果稳定可比。 */
export function cacheKey(params: { version: number; model: string }): string {
  return JSON.stringify({ version: params.version, model: params.model })
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
     WHERE kind = $1 AND chapter_id = $2 AND status = 'published' AND params_json = $3
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
    ? await all<GenerationRow>(db, 'SELECT * FROM ai_generations WHERE status = $1 ORDER BY created_at DESC LIMIT $2', [opts.status, limit])
    : await all<GenerationRow>(db, 'SELECT * FROM ai_generations ORDER BY created_at DESC LIMIT $1', [limit])
  return rows.map(rowToGeneration)
}

/** 作废某章的缓存（重新生成 / 章节内容更新后调用）。 */
export async function invalidateChapter(db: Db, kind: GenerationKind, chapterId: string): Promise<number> {
  return run(db, `UPDATE ai_generations SET status = 'rejected' WHERE kind = $1 AND chapter_id = $2 AND status = 'published'`, [
    kind,
    chapterId,
  ])
}
