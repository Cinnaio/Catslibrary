import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { withTx } from '../db/query'
import { applyContentRatingChange } from './content-rating-governance'
import { expireContentRatingAiSuggestions } from './content-rating-ai-lifecycle'
import { listContentRatingAiSuggestions, reviewContentRatingAiSuggestion } from './content-rating-ai'
let t: TestDb
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
async function seed(id: string) {
  await t.db.query("INSERT INTO novels(id,title,author,content_rating,content_rating_revision,created_at,updated_at) VALUES($1,$1,'作者','unknown',0,1,1)", [id])
  await t.db.query("INSERT INTO content_rating_ai_suggestions(id,novel_id,novel_rating_revision,reason,evidence,suggested_rating,created_at,updated_at) VALUES($1,$2,0,'模型原始理由','[]','restricted',1,1)", [`s-${id}`, id])
}
it('人工修改分级的同一事务让旧建议过期，保留模型输出，不记录人工拒绝', async () => {
  await seed('manual-expire')
  await withTx(t.db, q => applyContentRatingChange(q, { novelId: 'manual-expire', rating: 'general', source: 'manual', actorUserId: 'admin', reason: '人工核对', expectedRevision: 0 }))
  const { rows } = await t.db.query<Record<string, unknown>>("SELECT * FROM content_rating_ai_suggestions WHERE id='s-manual-expire'")
  expect(rows[0]).toMatchObject({ status: 'stale', reason: '模型原始理由', review_reason: '', reviewed_by: '', review_revision: 1 })
  expect(await expireContentRatingAiSuggestions(t.db.query.bind(t.db))).toBe(0)
})
it('读取列表修复历史残留，只处理旧待审核建议，修订变化后仍为unknown也过期', async () => {
  await seed('legacy-expire')
  await seed('valid-pending')
  await t.db.query("UPDATE novels SET content_rating_revision=1 WHERE id='legacy-expire'")
  const pending = await listContentRatingAiSuggestions(t.db, { status: 'pending', limit: 100, offset: 0 })
  expect(pending.items.map(row => row.id)).toContain('s-valid-pending')
  expect(pending.items.map(row => row.id)).not.toContain('s-legacy-expire')
  const stale = await listContentRatingAiSuggestions(t.db, { status: 'stale', limit: 100, offset: 0 })
  expect(stale.items.map(row => row.id)).toContain('s-legacy-expire')
  expect(stale.counts.pending).toBe(1)
  expect(stale.counts.stale).toBe(2)
  expect(await expireContentRatingAiSuggestions(t.db.query.bind(t.db))).toBe(0)
})
it('正常批准限制级建议仍为approved，修订只增加一次，不被自身修改标为过期', async () => {
  await seed('approval-kept')
  const result = await withTx(t.db, q => reviewContentRatingAiSuggestion(q, { suggestionId: 's-approval-kept', decision: 'approve', expectedRevision: 0, actorUserId: 'admin', reason: '人工确认' }))
  expect(result.applied).toBe(true)
  expect(result.suggestion.status).toBe('approved')
  expect(result.suggestion.revision).toBe(1)
  expect(await expireContentRatingAiSuggestions(t.db.query.bind(t.db))).toBe(0)
})
