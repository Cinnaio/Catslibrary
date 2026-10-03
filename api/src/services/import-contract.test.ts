import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { applyImport, createPreview, rollbackImport, type StoredImportRun } from './book-import'
import type { BookImportPayload } from '@shared/types'
import { applyContentRatingChange } from './content-rating-governance'
import { withTx } from '../db/query'
import { getCachedRecap, recapParams } from './ai/summary'
import { saveGeneration } from './ai/generations'
let t: TestDb
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
async function previewRun(payload: BookImportPayload, targetNovelId?: string) {
  const preview = await createPreview(t.db, { sourceType: 'file', sourceLabel: 'test.txt', sourceUrl: '', payload, targetNovelId })
  await t.db.query("INSERT INTO book_import_runs (id,actor_user_id,source_type,source_label,target_novel_id,payload_json,preview_json,created_at) VALUES ($1,'test','file','test.txt',$2,$3,$4,1)", [preview.runId, targetNovelId || '', JSON.stringify(payload), JSON.stringify(preview)])
  const run = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [preview.runId])).rows[0]!
  return { preview, run }
}
async function novel(id: string, rating = 'unknown') {
  await t.db.query('INSERT INTO novels (id,title,author,content_rating,created_at,updated_at) VALUES ($1,$1,\'作者\',$2,1,1)', [id, rating])
}
it('导入更新 unknown 元数据触发规则，保留人工 general；撤回同步恢复分级', async () => {
  for (const rating of ['unknown', 'general']) {
    const id = 'import-rating-' + rating
    await novel(id, rating)
    const payload = { title: id, author: '作者', description: '限制级 R18', categories: ['h'], chapters: [{ title: '一', order: 1, content: '正文' }] }
    const { preview, run } = await previewRun(payload, id)
    await applyImport(t.db, { run, targetNovelId: id, selectedChapterIds: preview.chapters.map(c => c.id), metadataFields: ['description', 'categories'], metadataMode: 'replace', actorUserId: 'test' })
    expect((await t.db.query<{ content_rating: string }>('SELECT content_rating FROM novels WHERE id=$1', [id])).rows[0]?.content_rating).toBe(rating === 'unknown' ? 'restricted' : 'general')
    const stored = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [run.id])).rows[0]!
    expect((await rollbackImport(t.db, stored)).conflicts).toHaveLength(0)
    expect((await t.db.query<{ content_rating: string }>('SELECT content_rating FROM novels WHERE id=$1', [id])).rows[0]?.content_rating).toBe(rating)
  }
})
it('导入后人工分级审核构成撤回冲突，不能删除新作品', async () => {
  const payload = { title: '已审核的导入作品', author: '作者', chapters: [{ title: '一', order: 1, content: '正文' }] }
  const { preview, run } = await previewRun(payload)
  const result = await applyImport(t.db, { run, selectedChapterIds: preview.chapters.map(c => c.id), metadataFields: [], metadataMode: 'missing', actorUserId: 'test' })
  await withTx(t.db, q => applyContentRatingChange(q, { novelId: result.novelId, rating: 'general', source: 'manual', actorUserId: 'test' }))
  const stored = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [run.id])).rows[0]!
  const rollback = await rollbackImport(t.db, stored)
  expect(rollback.conflicts.some(c => c.id.startsWith('novel:'))).toBe(true)
  expect((await t.db.query('SELECT id FROM novels WHERE id=$1', [result.novelId])).rows).toHaveLength(1)
  expect((await t.db.query('SELECT id FROM chapters WHERE novel_id=$1', [result.novelId])).rows).toHaveLength(1)
})
it('正文更新与恢复作废提要，旧正文的迟到生成结果不能命中新缓存', async () => {
  await novel('cache-book')
  await t.db.query("INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ('cache-ch','cache-book','一','旧正文',1,1)")
  const params = await recapParams(t.db, 'test', '旧正文')
  const save = () => saveGeneration(t.db, { novelId: 'cache-book', chapterId: 'cache-ch', kind: 'summary', model: 'test', paramsJson: params, prompt: '', result: '旧提要', status: 'published', createdBy: 'test' })
  await save()
  expect(await getCachedRecap(t.db, 'cache-ch', 'test')).toBeDefined()
  const { preview, run } = await previewRun({ title: 'cache-book', author: '作者', chapters: [{ title: '一', order: 1, content: '新正文' }] }, 'cache-book')
  const imported = await applyImport(t.db, { run, targetNovelId: 'cache-book', selectedChapterIds: preview.chapters.map(c => c.id), metadataFields: [], metadataMode: 'missing', actorUserId: 'test' })
  expect(imported.updated).toBe(1)
  expect(await getCachedRecap(t.db, 'cache-ch', 'test')).toBeUndefined()
  await save() // 模拟更新前已经发出的请求在更新后返回。
  expect(await getCachedRecap(t.db, 'cache-ch', 'test')).toBeUndefined()
  const stored = (await t.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id=$1', [run.id])).rows[0]!
  expect((await rollbackImport(t.db, stored)).conflicts).toHaveLength(0)
  expect(await getCachedRecap(t.db, 'cache-ch', 'test')).toBeUndefined()
})
