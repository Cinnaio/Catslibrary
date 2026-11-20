import { HTTPException } from 'hono/http-exception'
import type { GenerationAssociationPreview, GenerationAssociationRequest } from '@shared/ai-generation-association'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { requestHash } from '../idempotency'
import type { GenerationRow } from './generations'
import { captureBookSnapshot, readBookSnapshot } from './generation-book-snapshot'

const WRITING_KINDS = new Set(['continue', 'write_chapter', 'write_outline'])
const fail = (message: string, status: 400 | 404 | 409 = 409): never => { throw new HTTPException(status, { message }) }
const metadata = (row: GenerationRow): Record<string, unknown> => {
  try { return JSON.parse(row.params_json || '{}') || {} } catch { return {} }
}

export function parseAssociationRequest(body: Record<string, unknown>): GenerationAssociationRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('关联请求无效', 400)
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 ||
    body.ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) fail('请选择 1–500 条有效的生成记录', 400)
  if (typeof body.novelId !== 'string' || !body.novelId.trim() || body.novelId.length > 200) fail('请选择目标作品', 400)
  if (typeof body.includeBatch !== 'boolean') fail('请选择是否同时处理所属批次', 400)
  return { ids: [...new Set((body.ids as string[]).map(id => id.trim()))].sort(), novelId: (body.novelId as string).trim(), includeBatch: body.includeBatch as boolean }
}

async function prepare(db: DbClient, input: GenerationAssociationRequest) {
  const target = await first<{ id: string; title: string; author: string; source_url: string; updated_at: number }>(db,
    'SELECT id,title,author,source_url,updated_at FROM novels WHERE id=$1', [input.novelId])
  if (!target) fail('目标作品不存在，请重新选择', 404)
  const selected = await all<GenerationRow>(db, 'SELECT * FROM ai_generations WHERE id=ANY($1::text[]) ORDER BY id', [input.ids])
  if (selected.length !== input.ids.length) fail('部分记录已不存在，请刷新列表', 404)
  const batchKeys = selected.flatMap(row => {
    const batchId = metadata(row).batchId
    return row.kind === 'continue' && typeof batchId === 'string' && batchId ? [{ novelId: row.novel_id, batchId }] : []
  })
  // Legacy params_json can be malformed: filter potential siblings in JS, never cast it in SQL.
  const possible = batchKeys.length ? await all<GenerationRow>(db,
    `SELECT * FROM ai_generations WHERE novel_id=ANY($1::text[]) AND kind='continue' AND status='draft' AND deleted_at=0
     AND SUBSTRING(params_json FROM '"batchId"[[:space:]]*:[[:space:]]*"([[:alnum:]_-]+)"')=ANY($2::text[]) ORDER BY id LIMIT 501`,
    [[...new Set(batchKeys.map(key => key.novelId))], [...new Set(batchKeys.map(key => key.batchId))]]) : []
  if (possible.length > 500) fail('所属批次记录过多，请分批处理')
  const siblings = possible.filter(row => batchKeys.some(key => key.novelId === row.novel_id && metadata(row).batchId === key.batchId))
  const extras = siblings.filter(row => !input.ids.includes(row.id))
  const rows = [...selected, ...(input.includeBatch ? extras : [])].sort((a, b) => a.id.localeCompare(b.id))
  if (rows.length > 500) fail('一次最多重新关联 500 条记录，请分批处理', 400)
  if (rows.some(row => row.deleted_at || row.status !== 'draft' || !WRITING_KINDS.has(row.kind)))
    fail('只能重新关联尚未删除的待审创作草稿，已发布内容需单独处理')
  const existing = await all<{ id: string }>(db, 'SELECT id FROM novels WHERE id=ANY($1::text[])', [[...new Set(rows.map(row => row.novel_id).filter(Boolean))]])
  if (existing.length) fail('所选记录仍关联有效作品，请刷新列表核对')
  const active = await first<{ id: string }>(db,
    "SELECT id FROM ai_tasks WHERE novel_id=ANY($1::text[]) AND status IN ('queued','running') LIMIT 1",
    [[...new Set(rows.map(row => row.novel_id).filter(Boolean))]])
  if (active) fail('原作品仍有任务正在生成，请等待完成或停止任务后再关联')
  const targetSnapshot = { novelId: target!.id, title: target!.title, author: target!.author, sourceUrl: target!.source_url }
  const preview: GenerationAssociationPreview = {
    revision: requestHash({ input, target, rows }),
    target: targetSnapshot, selectedCount: selected.length,
    additionalCount: input.includeBatch ? extras.length : 0, batchRemainderCount: extras.length,
    items: rows.map(row => ({ id: row.id, title: String(metadata(row).draftTitle || '') || (row.kind === 'write_outline' ? '创作大纲' : '待命名章节'), source: readBookSnapshot(row.book_snapshot_json, row.novel_id) })),
  }
  return { preview, rows }
}

export async function previewGenerationAssociation(db: DbClient, input: GenerationAssociationRequest): Promise<GenerationAssociationPreview> {
  return (await prepare(db, input)).preview
}

export async function confirmGenerationAssociation(db: Db, input: GenerationAssociationRequest, revision: string, actorUserId: string, operationId: string) {
  return withTx(db, async query => {
    // Same lock order as publishing: book first, then drafts in stable ID order.
    await query('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [input.novelId])
    const initial = await prepare({ query }, input)
    await query('SELECT id FROM ai_generations WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [initial.rows.map(row => row.id)])
    const { rows, preview } = await prepare({ query }, input)
    if (!revision || revision !== preview.revision) fail('记录、批次或目标作品已变化，请重新预览后确认')
    const createdAt = Date.now()
    for (const row of rows) {
      const source = readBookSnapshot(row.book_snapshot_json, row.novel_id)
      // Enrich a legacy source with its frozen anchor, without replacing the old request.
      const captured = await captureBookSnapshot({ query }, row.novel_id, row.params_json, row.chapter_id)
      const original = { ...captured, ...source, ...(source.anchor || captured.anchor ? { anchor: source.anchor || captured.anchor } : {}) }
      const change = { operationId, actorUserId, createdAt, previousNovelId: row.novel_id, previousChapterId: row.chapter_id, target: preview.target }
      await query(`UPDATE ai_generations SET novel_id=$2, chapter_id='', book_snapshot_json=$3,
        association_revision=association_revision+1, association_history_json=association_history_json || $4::jsonb WHERE id=$1`,
      [row.id, input.novelId, JSON.stringify(original), JSON.stringify([change])])
    }
    await query('UPDATE admin_operation_audit SET target_count=$3 WHERE scope=$1 AND operation_id=$2',
      [`ai.generations.association.${actorUserId}`, operationId, rows.length])
    return { ok: true, count: rows.length, novelId: input.novelId }
  })
}
