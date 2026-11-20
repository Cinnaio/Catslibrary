import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { GenerationAssociationPreview, GenerationAssociationRequest } from '@shared/ai-generation-association'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { getGenerationDetail, generationContentRevision, listGenerationDetails, saveGeneration } from '../services/ai/generations'
import { getWritingReview } from '../services/ai/writing-review'

let t: TestDb, token: string
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const post = (path: string, body: unknown) => app.request(`/api/ai/generations/association/${path}`, json(body))
const input = (ids: string[], includeBatch = true): GenerationAssociationRequest => ({ ids, novelId: 'target', includeBatch })
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  const response = await app.request('/api/auth/bootstrap-admin', json({ username: 'bindingadmin', password: 'bindingpass123' }))
  token = (await response.json() as { token: string }).token
}, 120_000)
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_generations')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM novels')
  await t.db.query('DELETE FROM api_idempotency')
  await t.db.query("INSERT INTO novels(id,title,author,source_url,created_at,updated_at) VALUES('old','旧书名','作者甲','https://books.test/one',1,1),('other-old','另一版本','作者乙','',1,1),('target','重新入库的书','作者甲','https://books.test/one',1,1)")
})
afterAll(async () => { setDbForTests(null); vi.unstubAllEnvs(); await t.close() })
async function draft(book = 'old', batchId = 'same-batch') {
  return saveGeneration(t.db, { novelId: book, chapterId: '', kind: 'continue', model: 'test', paramsJson: JSON.stringify({ batchId, draftTitle: '雨夜', continuationSnapshot: { anchor: { chapterId: 'old-chapter', title: '原来的起点', sortOrder: 5 } } }), prompt: '原始提示词', result: '门外下着雨。', status: 'draft', createdBy: '' })
}
async function inspect(request: GenerationAssociationRequest) {
  const response = await post('preview', request)
  expect(response.status).toBe(200)
  return response.json() as Promise<GenerationAssociationPreview>
}

it('requires administrator authentication and validates malformed requests without changing drafts', async () => {
  expect((await app.request('/api/ai/generations/association/preview', { method: 'POST' })).status).toBe(401)
  expect((await post('preview', null)).status).toBe(400)
  expect((await post('preview', input([]))).status).toBe(400)
  expect((await post('confirm', input(['missing']))).status).toBe(400)
})

it('snapshots source metadata and anchor, previews only same-book siblings, preserves evidence and replays confirmation', async () => {
  const a = await draft(), b = await draft(), other = await draft('other-old')
  await t.db.query("DELETE FROM novels WHERE id IN ('old','other-old')")
  const request = input([a.id]), preview = await inspect(request)
  expect(preview).toMatchObject({ selectedCount: 1, additionalCount: 1, target: { title: '重新入库的书' } })
  expect(preview.items.map(item => item.id).sort()).toEqual([a.id, b.id].sort())
  expect(preview.items[0]!.source).toMatchObject({ title: '旧书名', author: '作者甲', sourceUrl: 'https://books.test/one', anchor: { title: '原来的起点' } })
  const before = await t.db.query('SELECT params_json FROM ai_generations WHERE id=$1', [a.id])
  const confirmation = { ...request, revision: preview.revision, operationId: 'repair-once' }
  const result = await post('confirm', confirmation)
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ count: 2 })
  const replay = await post('confirm', confirmation)
  expect(replay.status).toBe(200)
  expect(replay.headers.get('X-Idempotent-Replay')).toBe('true')
  const detail = await getGenerationDetail(t.db, a.id)
  expect(detail).toMatchObject({ novelId: 'target', status: 'draft', prompt: '原始提示词', result: '门外下着雨。', chapterId: '', association: { state: 'linked', revision: 1, source: { title: '旧书名', novelId: 'old' } } })
  expect(detail!.association.history).toHaveLength(1)
  expect((await t.db.query<{ target_count: number }>("SELECT target_count FROM admin_operation_audit WHERE operation_id='repair-once'")).rows[0]!.target_count).toBe(2)
  expect(detail!.association.history[0]).toMatchObject({ previousNovelId: 'old', target: { novelId: 'target' } })
  expect((await t.db.query('SELECT params_json FROM ai_generations WHERE id=$1', [a.id])).rows).toEqual(before.rows)
  expect((await getGenerationDetail(t.db, other.id))!.novelId).toBe('other-old')
  const published = await app.request(`/api/ai/writing/drafts/${a.id}/publish`, json({ novelId: 'target', title: '雨夜' }))
  expect(published.status).toBe(200)
})

it('allows selecting only one sibling and keeps separate book groups and missing-book filters accurate', async () => {
  const a = await draft(), b = await draft()
  await t.db.query("DELETE FROM novels WHERE id='old'")
  const request = input([a.id], false), preview = await inspect(request)
  expect(preview).toMatchObject({ additionalCount: 0, batchRemainderCount: 1 })
  expect((await post('confirm', { ...request, revision: preview.revision, operationId: 'single-repair' })).status).toBe(200)
  expect((await listGenerationDetails(t.db, { groupBatches: true })).total).toBe(2)
  expect((await listGenerationDetails(t.db, { association: 'missing' })).items.map(item => item.id)).toEqual([b.id])
  expect((await listGenerationDetails(t.db, { q: '旧书名', association: 'missing' })).total).toBe(1)
})

it('rejects a changed batch or body atomically until the author previews again', async () => {
  const a = await draft(), b = await draft()
  await t.db.query("DELETE FROM novels WHERE id='old'")
  const request = input([a.id]), preview = await inspect(request)
  await t.db.query("UPDATE ai_generations SET result='修改后的正文' WHERE id=$1", [b.id])
  expect((await post('confirm', { ...request, revision: preview.revision, operationId: 'stale-repair' })).status).toBe(409)
  expect((await getGenerationDetail(t.db, a.id))!.novelId).toBe('old')
  expect((await getGenerationDetail(t.db, b.id))!.novelId).toBe('old')
})

it('rejects valid bindings, published or deleted drafts, missing targets and active source tasks', async () => {
  const a = await draft()
  expect((await post('preview', input([a.id]))).status).toBe(409)
  await t.db.query("DELETE FROM novels WHERE id='old'")
  await t.db.query("INSERT INTO ai_tasks(id,novel_id,kind,status,created_at,updated_at) VALUES('active','old','continue','running',1,1)")
  expect((await post('preview', input([a.id]))).status).toBe(409)
  await t.db.query("UPDATE ai_tasks SET status='completed'")
  await t.db.query("UPDATE ai_generations SET status='published' WHERE id=$1", [a.id])
  expect((await post('preview', input([a.id]))).status).toBe(409)
  await t.db.query("UPDATE ai_generations SET status='draft',deleted_at=1 WHERE id=$1", [a.id])
  expect((await post('preview', input([a.id]))).status).toBe(409)
  expect((await post('preview', { ...input([a.id]), novelId: 'gone' })).status).toBe(404)
})

it('supports missing legacy metadata without guessing identity and marks previous reviews stale', async () => {
  const a = await draft()
  await t.db.query("UPDATE ai_generations SET book_snapshot_json='{}',chapter_id='gone-chapter' WHERE id=$1", [a.id])
  await t.db.query("INSERT INTO ai_writing_reviews(draft_id,input_hash,draft_revision,status,report_json,created_at) VALUES($1,'review',$2,'completed',$3,1)",
    [a.id, generationContentRevision(a.result), JSON.stringify({ draftRevision: generationContentRevision(a.result), sources: [], findings: [], inputHash: 'review', updatedAt: 1 })])
  await t.db.query("DELETE FROM novels WHERE id='old'")
  const request = input([a.id]), preview = await inspect(request)
  expect(preview.items[0]!.source.title).toBe('')
  expect((await post('confirm', { ...request, revision: preview.revision, operationId: 'legacy-repair' })).status).toBe(200)
  const row = (await t.db.query<import('../services/ai/generations').GenerationRow>('SELECT * FROM ai_generations WHERE id=$1', [a.id])).rows[0]!
  expect(row.chapter_id).toBe('')
  expect((await getWritingReview(t.db, row)).report?.stale).toBe(true)
  expect(JSON.parse(row.book_snapshot_json!)).toMatchObject({ novelId: 'old', title: '', anchor: { chapterId: 'old-chapter' } })
})
