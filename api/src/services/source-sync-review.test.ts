import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { applyContentRatingChange } from './content-rating-governance'
import { withTx } from '../db/query'
import {
  applySourceSync, remapSourceSync, rollbackSourceSync, listSourceSyncHistory, getSourceSyncHistoryDetail, sourceSyncTestHelpers,
  type LocalChapterForSync, type SourceChapter,
} from './source-sync'

let t: TestDb
let counter = 0
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
afterAll(async () => { await t.close() })
async function seed(localTitles = ['第一章 原标题', '第二章 原标题'], sourceTitles = ['第一章 新标题', '第二章 新标题'], orders?: number[]) {
  const novelId = `review-novel-${++counter}`
  const runId = `review-run-${counter}`
  const bindingId = `review-binding-${counter}`
  const sourceUrl = 'https://www.po18.tw/books/902326/articles'
  const local: LocalChapterForSync[] = localTitles.map((title, index) => ({ id: `${novelId}-${index}`, title, order: orders?.[index] ?? index + 1 }))
  const source: SourceChapter[] = sourceTitles.map((title, index) => ({ key: `s${index}`, title, order: index + 1, url: `${sourceUrl}/${index}` }))
  const metadata = { title: '源站书名', author: '源站作者', description: '', coverUrl: '', category: '', categories: [], status: 'ongoing', sourceUrl }
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true, { runId, novelId, bindingId, site: 'po18tw', sourceUrl }, [])
  await t.db.query('INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ($1,\'本地书名\',\'本地作者\',1,1)', [novelId])
  for (const row of local) await t.db.query('INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ($1,$2,$3,\'正文保持\',$4,1)', [row.id, novelId, row.title, row.order])
  await t.db.query('INSERT INTO novel_source_bindings (id,novel_id,source_url,created_at,updated_at) VALUES ($1,$2,$3,1,1)', [bindingId, novelId, sourceUrl])
  await t.db.query('INSERT INTO source_sync_runs (id,binding_id,novel_id,metadata_json,source_chapters_json,changes_json,mapping_json,local_snapshot_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)',
    [runId, bindingId, novelId, JSON.stringify(metadata), JSON.stringify(source), JSON.stringify(preview.changes), JSON.stringify(preview.mappings), JSON.stringify(local)])
  return { novelId, runId, preview, local, source }
}

it('匹配依据区分完整标题、编号、部分标题与顺序推断', () => {
  const cases = [
    ['第一章 暴雨', '1.暴雨', 'exact-title'],
    ['第一章 暴雨', '第一章 旧标题', 'chapter-number'],
    ['风雨中的归途', '归途', 'title-overlap'],
    ['新的开始', '正文', 'sequence'],
  ]
  for (const [source, local, reason] of cases) {
    const p = sourceSyncTestHelpers().buildPreview([{ key: 's', order: 1, title: source!, url: '' }], [{ id: 'l', order: 1, title: local! }],
      { title: '', author: '', description: '', coverUrl: '', category: '', categories: [], status: '', sourceUrl: 'https://www.po18.tw/books/1' }, true,
      { runId: 'r', novelId: 'n', bindingId: 'b', site: 'po18tw', sourceUrl: '' }, [])
    expect(p.mappings[0]).toMatchObject({ matchReason: reason, matchEvidence: expect.any(String) })
  }
})

it('人工映射拒绝占用、重复及无效目标，支持交换并要求重新确认新版本', async () => {
  const s = await seed()
  await expect(remapSourceSync(t.db, { runId: s.runId, revision: 0, manualMappings: [{ localChapterId: s.local[0]!.id, sourceChapterKey: 's1' }] })).rejects.toThrow('占用')
  await expect(remapSourceSync(t.db, { runId: s.runId, revision: 0, manualMappings: [{ localChapterId: s.local[0]!.id, sourceChapterKey: 'missing' }] })).rejects.toThrow('无效')
  await expect(remapSourceSync(t.db, { runId: s.runId, revision: 0, manualMappings: [{ localChapterId: s.local[0]!.id, sourceChapterKey: null }, { localChapterId: s.local[0]!.id, sourceChapterKey: null }] })).rejects.toThrow('重复')
  const preview = await remapSourceSync(t.db, { runId: s.runId, revision: 0, manualMappings: s.local.map((row, index) => ({ localChapterId: row.id, sourceChapterKey: `s${1 - index}` })) })
  expect(preview.revision).toBe(1)
  expect(preview.changes).toHaveLength(2)
  expect(preview.changes.every(row => row.matchReason === 'manual' && !row.eligible)).toBe(true)
  await expect(applySourceSync(t.db, { runId: s.runId, revision: 0 })).rejects.toThrow('版本已发生变化')
  const applied = await applySourceSync(t.db, { runId: s.runId, revision: 1, confirmedChangeIds: [s.local[0]!.id] })
  expect(applied.updated).toBe(1)
  const detail = await getSourceSyncHistoryDetail(t.db, s.runId)
  expect(detail.changes).toHaveLength(1)
  expect(detail.changes[0]).toMatchObject({ kind: 'chapter', id: s.local[0]!.id, after: { title: '第二章 新标题' } })
})

it('解除和恢复自动匹配均递增版本，陈旧版本与变化后的目录不能继续使用', async () => {
  const s = await seed()
  const cleared = await remapSourceSync(t.db, { runId: s.runId, revision: 0, manualMappings: [{ localChapterId: s.local[0]!.id, sourceChapterKey: null }] })
  expect(cleared.unmatchedLocal.map(row => row.id)).toContain(s.local[0]!.id)
  const reset = await remapSourceSync(t.db, { runId: s.runId, revision: 1, manualMappings: [] })
  expect(reset.revision).toBe(2)
  expect(reset.mappings).toHaveLength(2)
  await expect(remapSourceSync(t.db, { runId: s.runId, revision: 1, manualMappings: [] })).rejects.toThrow('版本已发生变化')
  await t.db.query('UPDATE chapters SET title=\'后续编辑\' WHERE id=$1', [s.local[0]!.id])
  await expect(remapSourceSync(t.db, { runId: s.runId, revision: 2, manualMappings: [] })).rejects.toThrow('目录在预览后已发生变化')
})

it('人工指定目标不会自动应用，拆分组不能被单章重映射', async () => {
  const s = await seed(['正文'], ['第一章 新标题'])
  const preview = await remapSourceSync(t.db, { runId: s.runId, revision: 0, manualMappings: [{ localChapterId: s.local[0]!.id, sourceChapterKey: 's0' }] })
  expect(preview.changes[0]?.eligible).toBe(false)
  expect((await applySourceSync(t.db, { runId: s.runId, revision: 1 })).updated).toBe(0)
  const split = await seed(['第1章 (1/2)', '第1章 (2/2)'], ['第一章 新标题'])
  await expect(remapSourceSync(t.db, { runId: split.runId, revision: 0, manualMappings: [{ localChapterId: split.local[0]!.id, sourceChapterKey: null }] })).rejects.toThrow('拆分章节')
})

it('历史记录实际应用项，撤回仅恢复标题与小说信息并保留后续正文编辑', async () => {
  const s = await seed()
  await applySourceSync(t.db, { runId: s.runId, confirmedChangeIds: [s.local[0]!.id], applyMetadata: true, metadataFields: ['title'], metadataMode: 'replace' })
  const history = await listSourceSyncHistory(t.db, s.novelId)
  expect(history.total).toBe(1)
  expect(history.items[0]).toMatchObject({ canRollback: true, summary: { titleUpdated: 1, metadataUpdated: 1 } })
  await t.db.query('UPDATE chapters SET content=\'后续正文\' WHERE id=$1', [s.local[0]!.id])
  const result = await rollbackSourceSync(t.db, s.runId, 'admin')
  expect(result).toMatchObject({ restored: 2, conflicts: [] })
  const row = (await t.db.query<{ title: string; content: string }>('SELECT title,content FROM chapters WHERE id=$1', [s.local[0]!.id])).rows[0]
  expect(row).toEqual({ title: '第一章 原标题', content: '后续正文' })
  expect((await t.db.query<{ title: string }>('SELECT title FROM novels WHERE id=$1', [s.novelId])).rows[0]?.title).toBe('本地书名')
  expect(await rollbackSourceSync(t.db, s.runId, 'admin')).toEqual(result)
  expect((await listSourceSyncHistory(t.db, s.novelId)).items[0]?.status).toBe('rolled_back')
})

it('后续标题编辑和分级审核构成撤回冲突，其他章节仍可恢复', async () => {
  const s = await seed()
  await applySourceSync(t.db, { runId: s.runId, confirmedChangeIds: s.local.map(row => row.id), applyMetadata: true, metadataFields: ['title'], metadataMode: 'replace' })
  await t.db.query('UPDATE chapters SET title=\'人工新标题\' WHERE id=$1', [s.local[0]!.id])
  await withTx(t.db, q => applyContentRatingChange(q, { novelId: s.novelId, rating: 'general', source: 'manual', actorUserId: 'admin' }))
  const result = await rollbackSourceSync(t.db, s.runId, 'admin')
  expect(result.restored).toBe(1)
  expect(result.conflicts).toHaveLength(2)
  expect((await listSourceSyncHistory(t.db, s.novelId)).items[0]?.status).toBe('rollback_partial')
  expect((await t.db.query<{ title: string }>('SELECT title FROM chapters WHERE id=$1', [s.local[0]!.id])).rows[0]?.title).toBe('人工新标题')
})

it('撤回序号修复检查后来新增章节的占用，不制造新重复序号', async () => {
  const s = await seed(['起程', '归途'], ['起程', '归途'], [1, 3])
  await applySourceSync(t.db, { runId: s.runId, repairOrder: true })
  await t.db.query('INSERT INTO chapters (id,novel_id,title,sort_order,created_at) VALUES ($1,$2,\'新增章节\',3,1)', [`${s.novelId}-new`, s.novelId])
  const result = await rollbackSourceSync(t.db, s.runId, 'admin')
  expect(result.restored).toBe(0)
  expect(result.conflicts[0]?.reason).toContain('占用')
  const row = (await t.db.query<{ sort_order: number }>('SELECT sort_order FROM chapters WHERE id=$1', [s.local[1]!.id])).rows[0]
  expect(row?.sort_order).toBe(2)
})

it('序号交换可完整撤回，删除过的章节构成冲突而不被重建', async () => {
  const swapped = await seed(['起程', '归途'], ['起程', '归途'], [2, 1])
  await applySourceSync(t.db, { runId: swapped.runId, repairOrder: true })
  expect((await rollbackSourceSync(t.db, swapped.runId, 'admin')).restored).toBe(2)
  const rows = await t.db.query<{ id: string; sort_order: number }>('SELECT id,sort_order FROM chapters WHERE novel_id=$1 ORDER BY id', [swapped.novelId])
  expect(rows.rows.map(row => row.sort_order)).toEqual([2, 1])
  const deleted = await seed()
  await applySourceSync(t.db, { runId: deleted.runId, confirmedChangeIds: deleted.local.map(row => row.id) })
  await t.db.query('DELETE FROM chapters WHERE id=$1', [deleted.local[0]!.id])
  const result = await rollbackSourceSync(t.db, deleted.runId, 'admin')
  expect(result.restored).toBe(1)
  expect(result.conflicts[0]?.id).toBe(deleted.local[0]!.id)
})

it('撤回自动分级使用治理接口，恢复 unknown 并留下新的审核修订', async () => {
  const s = await seed()
  await t.db.query('UPDATE source_sync_runs SET metadata_json=$1 WHERE id=$2', [JSON.stringify({ ...s.preview.metadata, description: '限制级 R18', categories: ['h'] }), s.runId])
  await applySourceSync(t.db, { runId: s.runId, applyMetadata: true, metadataFields: ['description', 'categories'], metadataMode: 'replace' })
  const before = (await t.db.query<{ content_rating: string; content_rating_revision: number }>('SELECT content_rating,content_rating_revision FROM novels WHERE id=$1', [s.novelId])).rows[0]!
  expect(before.content_rating).toBe('restricted')
  expect((await rollbackSourceSync(t.db, s.runId, 'admin')).conflicts).toEqual([])
  const after = (await t.db.query<{ content_rating: string; content_rating_revision: number }>('SELECT content_rating,content_rating_revision FROM novels WHERE id=$1', [s.novelId])).rows[0]!
  expect(after.content_rating).toBe('unknown')
  expect(after.content_rating_revision).toBeGreaterThan(before.content_rating_revision)
})

it('迁移前没有实际快照的已应用历史只读展示，不能推断撤回值', async () => {
  const s = await seed()
  await t.db.query("UPDATE source_sync_runs SET status='applied',applied_at=1 WHERE id=$1", [s.runId])
  const history = await listSourceSyncHistory(t.db, s.novelId, 1, 0)
  expect(history.items[0]?.canRollback).toBe(false)
  expect((await getSourceSyncHistoryDetail(t.db, s.runId)).changes).toEqual([])
  await expect(rollbackSourceSync(t.db, s.runId, 'admin')).rejects.toThrow('旧记录没有应用快照')
})


it('仅修复所选序号并记录实际历史，不修改未选章节或小说信息', async () => {
  const s = await seed(['起程', '归途'], ['起程', '归途'], [3, 4])
  const result = await applySourceSync(t.db, { runId: s.runId, repairOrder: true, confirmedOrderIds: [s.local[0]!.id] })
  expect(result).toMatchObject({ updated: 0, orderUpdated: 1, metadataUpdated: [] })
  const rows = (await t.db.query<{ id: string; sort_order: number }>('SELECT id,sort_order FROM chapters WHERE novel_id=$1 ORDER BY id', [s.novelId])).rows
  expect(rows.map(row => row.sort_order)).toEqual([1, 4])
  const detail = await getSourceSyncHistoryDetail(t.db, s.runId)
  expect(detail.changes).toHaveLength(1)
  expect(detail.changes[0]).toMatchObject({ id: s.local[0]!.id, before: { order: 3 }, after: { order: 1 } })
  expect((await rollbackSourceSync(t.db, s.runId, 'admin')).restored).toBe(1)
})

it('所选序号占用未选章节时拒绝应用，完整选择可交换且无效选择不能写入', async () => {
  const s = await seed(['起程', '归途'], ['起程', '归途'], [2, 1])
  await expect(applySourceSync(t.db, { runId: s.runId, repairOrder: true, confirmedOrderIds: [s.local[0]!.id] })).rejects.toThrow('未选章节占用')
  await expect(applySourceSync(t.db, { runId: s.runId, repairOrder: true, confirmedOrderIds: ['missing'] })).rejects.toThrow('不在序号修复预览中')
  expect((await t.db.query<{ status: string }>('SELECT status FROM source_sync_runs WHERE id=$1', [s.runId])).rows[0]?.status).toBe('preview')
  expect((await applySourceSync(t.db, { runId: s.runId, repairOrder: true, confirmedOrderIds: s.local.map(row => row.id) })).orderUpdated).toBe(2)
})

it('102章中3章未匹配不会阻塞其余30项序号修复，冲突项保留且可撤回', async () => {
  const shape = (await import('../../../shared/__fixtures__/source-sync-partial.json')).default
  const localTitles = shape.locals.map((row, i) => row.sourceOrder === null ? `第${1000 + i}章 未匹配公告` : `第${row.sourceOrder}章 测试故事-${row.sourceOrder}`)
  const sourceTitles = shape.sourceOrders.map(order => `第${order}章 测试故事-${order}`)
  const s = await seed(localTitles, sourceTitles, shape.locals.map(row => row.order))
  expect(s.preview.localChapterCount).toBe(102)
  expect(s.preview.mappings).toHaveLength(99)
  expect(s.preview.changes).toHaveLength(0)
  expect(s.preview.unmatchedLocal).toHaveLength(3)
  expect(s.preview.orderChanges).toHaveLength(30)
  expect(s.preview.orderRepairBlockedReason).toBeUndefined()
  expect(s.preview.orderRepairSkipped).toHaveLength(5)
  const original = new Map(s.local.map(row => [row.id, row.order]))
  const selected = s.preview.orderChanges.map(row => row.localChapterId)
  const result = await applySourceSync(t.db, { runId: s.runId, repairOrder: true, confirmedOrderIds: selected })
  expect(result).toMatchObject({ updated: 0, orderUpdated: 30, metadataUpdated: [] })
  const rows = (await t.db.query<{ id: string; sort_order: number; content: string }>('SELECT id,sort_order,content FROM chapters WHERE novel_id=$1', [s.novelId])).rows
  const targets = new Map(s.preview.orderChanges.map(row => [row.localChapterId, row.newOrder]))
  for (const row of rows) {
    expect(row.sort_order).toBe(targets.get(row.id) ?? original.get(row.id))
    expect(row.content).toBe('正文保持')
  }
  expect((await getSourceSyncHistoryDetail(t.db, s.runId)).changes).toHaveLength(30)
  expect((await rollbackSourceSync(t.db, s.runId, 'admin')).restored).toBe(30)
})
