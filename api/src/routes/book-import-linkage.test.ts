import { afterAll, beforeAll, expect, it } from 'vitest'
import type { BookImportCommitResult, BookImportPreview } from '@shared/types'
import type { SupplementaryOverview } from '@shared/supplementary-source'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { sourceSyncTestHelpers } from '../services/source-sync'

let t: TestDb,
  token = ''
const previousDatabaseUrl = process.env.DATABASE_URL
const sourceUrl = 'https://www.po18.tw/books/123'
const fileName = '[更2] 联动样本 作者：样本作者.txt'
const fileUrl = 'https://dudu88.lanzov.com/iLinked'
const text = '书名：联动样本\n作者：样本作者\n简介：样本介绍。\n第0001章 1.启程（微h）\n第一章的唯一正文。\n第0002章 2.归途（微h）\n第二章的唯一正文。'
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.ok).toBe(true)
  return response.json() as Promise<T>
}
async function preview(bindingId?: string): Promise<BookImportPreview> {
  const form = new FormData()
  form.append('file', new File([text], fileName))
  if (bindingId) {
    form.append('supplementaryBindingId', bindingId)
    form.append('fileKey', 'linked-file')
  }
  const response = await app.request('/api/book-import/preview', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  expect(response.status).toBe(200)
  return response.json() as Promise<BookImportPreview>
}
const chapters = async (id: string) =>
  (
    await t.db.query<{ id: string; title: string; sort_order: number; content: string; source_url: string }>(
      'SELECT id,title,sort_order,content,source_url FROM chapters WHERE novel_id=$1 ORDER BY sort_order,id',
      [id],
    )
  ).rows
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://isolated/test'
  token = (await post<{ token: string }>('/api/auth/bootstrap-admin', { username: 'linkage-admin', password: 'password123' })).token
})
afterAll(async () => {
  setDbForTests(null)
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseUrl
  await t.close()
})

it('有明确章名的空打赏章可实际导入，字数为零且重复预览不新增', async () => {
  const content = '书名：空章样本\n作者：样本作者\n第0008章 前文\n正文八。\n第0009章 打赏章，随缘！\n\n第0010章 后文\n正文十。'
  async function emptyPreview() {
    const form = new FormData()
    form.append('file', new File([content], '空章样本.txt'))
    const response = await app.request('/api/book-import/preview', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
    expect(response.status).toBe(200)
    return response.json() as Promise<BookImportPreview>
  }
  const p = await emptyPreview()
  const imported = await post<BookImportCommitResult>(`/api/book-import/${p.runId}/commit`, {
    revision: p.revision,
    selectedChapterIds: p.chapters.map((c) => c.id),
    metadataFields: [],
  })
  expect(imported.created).toBe(3)
  const rows = await chapters(imported.novelId)
  expect(rows[1]).toMatchObject({ title: '第0009章 打赏章，随缘！', sort_order: 2 })
  expect(rows[1]?.content.trim()).toBe('')
  const words = await t.db.query<{ word_count: number }>('SELECT word_count FROM chapters WHERE id=$1', [rows[1]!.id])
  expect(words.rows[0]?.word_count).toBe(0)
  const repeated = await emptyPreview()
  expect(repeated.summary).toMatchObject({ unchangedCount: 3, newCount: 0 })
})

it('正文差一个字的同章版本默认不选，绕过界面同时提交被拒绝，选择一个后可导入并撤回', async () => {
  const form = new FormData()
  form.append('file', new File(['题名：版本样本\n作者：样本作者\n第1章 初见\n原始正文甲。\n第1章 初见\n原始正文乙。'], '版本样本.txt'))
  const response = await app.request('/api/book-import/preview', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  expect(response.status).toBe(200)
  const p = (await response.json()) as BookImportPreview
  expect(p.chapters).toHaveLength(2)
  expect(p.chapters.every((c) => !c.selected)).toBe(true)
  const rejected = await app.request(`/api/book-import/${p.runId}/commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: p.revision, selectedChapterIds: p.chapters.map((c) => c.id), metadataFields: [] }),
  })
  expect(rejected.ok).toBe(false)
  expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('只选择其中一个版本') })
  expect((await t.db.query("SELECT id FROM novels WHERE title='版本样本'")).rows).toHaveLength(0)
  const imported = await post<BookImportCommitResult>(`/api/book-import/${p.runId}/commit`, {
    revision: p.revision,
    selectedChapterIds: ['chapter-2'],
    metadataFields: [],
  })
  expect(imported.created).toBe(1)
  expect((await chapters(imported.novelId))[0]?.content).toContain('原始正文乙')
  expect((await chapters(imported.novelId))[0]?.sort_order).toBe(1)
  expect(await post(`/api/book-import/${p.runId}/rollback`, {})).toMatchObject({ conflicts: [] })
  expect(await chapters(imported.novelId)).toHaveLength(0)
})

it('导入 → 源站改名改序 → 附加源追加 → 重复预览 → 两层撤回保留章节 ID 和正文', async () => {
  const first = await preview()
  const imported = await post<BookImportCommitResult>(`/api/book-import/${first.runId}/commit`, {
    revision: first.revision,
    selectedChapterIds: ['chapter-1'],
    metadataFields: [],
  })
  const id = imported.novelId,
    before = await chapters(id)
  expect(imported.created).toBe(1)
  const locals = before.map((c) => ({ id: c.id, title: c.title, order: c.sort_order }))
  const sources = [
    { key: 'announcement', order: 1, title: '公告', url: `${sourceUrl}/articles/1` },
    { key: 'one', order: 2, title: '1.启程', url: `${sourceUrl}/articles/2` },
    { key: 'two', order: 3, title: '2.归途', url: `${sourceUrl}/articles/3` },
  ]
  const metadata = { title: '', author: '', description: '', coverUrl: '', category: '', categories: [], status: '', sourceUrl }
  const sync = sourceSyncTestHelpers().buildPreview(
    sources,
    locals,
    metadata,
    true,
    { runId: 'linked-sync', bindingId: 'linked-binding', novelId: id, site: 'po18tw', sourceUrl },
    [],
  )
  await t.db.query('INSERT INTO novel_source_bindings(id,novel_id,source_url,created_at,updated_at) VALUES($1,$2,$3,1,1)', [sync.bindingId, id, sourceUrl])
  await t.db.query(
    'INSERT INTO source_sync_runs(id,binding_id,novel_id,metadata_json,source_chapters_json,changes_json,mapping_json,local_snapshot_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)',
    [
      sync.runId,
      sync.bindingId,
      id,
      JSON.stringify(metadata),
      JSON.stringify(sources),
      JSON.stringify(sync.changes),
      JSON.stringify(sync.mappings),
      JSON.stringify(locals),
    ],
  )
  const fused = await post<{ updated: number; orderUpdated: number }>('/api/scrape', {
    action: 'source-sync-apply',
    runId: sync.runId,
    revision: 0,
    repairOrder: true,
    confirmedOrderIds: sync.orderChanges.map((c) => c.localChapterId),
    confirmedChangeIds: sync.changes.map((c) => c.localChapterId),
  })
  expect(fused).toMatchObject({ updated: 1, orderUpdated: 1 })
  const fusedRows = await chapters(id)
  expect(fusedRows[0]).toMatchObject({ id: before[0]!.id, title: '1.启程', sort_order: 2, content: before[0]!.content })
  const source = await post<{ id: string }>('/api/supplementary-sources', { name: '隔离来源', url: 'https://dudu88.lanzov.com/bLinked', enabled: false })
  await t.db.query('UPDATE supplementary_sources SET files_json=$2 WHERE id=$1', [
    source.id,
    JSON.stringify([{ key: 'linked-file', title: '联动样本', author: '样本作者', name: fileName, url: fileUrl, folder: '1018', size: '', revision: 2 }]),
  ])
  const bound = await post<SupplementaryOverview>('/api/supplementary-sources/bindings', { sourceId: source.id, novelId: id, fileKey: 'linked-file' })
  const bindingId = bound.bindings[0]!.id
  await t.db.query("UPDATE novels SET description='' WHERE id=$1", [id])
  const uploaded = await preview(bindingId)
  const targeted = await post<BookImportPreview>(`/api/book-import/${uploaded.runId}/target`, { revision: uploaded.revision, targetNovelId: id })
  const next = await post<BookImportPreview>(`/api/book-import/${targeted.runId}/boundaries`, {
    revision: targeted.revision,
    changes: [{ line: 4, verdict: 'heading' }],
  })
  expect(next.metadataDiff.every((field) => !field.selected)).toBe(true)
  expect(next.summary).toMatchObject({ newCount: 1, changedCount: 1, conflictCount: 0 })
  expect(next.chapters.map((c) => c.incomingOrder)).toEqual([2, 3])
  const legacy = await preview(bindingId)
  legacy.chapters[0]!.incomingOrder = 1
  await t.db.query('UPDATE book_import_runs SET preview_json=$2 WHERE id=$1', [legacy.runId, JSON.stringify(legacy)])
  const refused = await post<BookImportCommitResult>(`/api/book-import/${legacy.runId}/commit`, {
    revision: legacy.revision,
    targetNovelId: id,
    metadataFields: [],
    selectedChapterIds: ['chapter-1'],
  })
  expect(refused.updated).toBe(0)
  expect(refused.conflicts[0]?.reason).toContain('旧预览')
  expect(await chapters(id)).toEqual(fusedRows)
  const appended = await post<BookImportCommitResult>(`/api/book-import/${next.runId}/commit`, {
    revision: next.revision,
    targetNovelId: id,
    metadataFields: [],
    selectedChapterIds: next.chapters.filter((c) => c.selected).map((c) => c.id),
  })
  expect(appended).toMatchObject({ created: 1, updated: 0, conflicts: [], metadataUpdated: [] })
  const after = await chapters(id)
  expect(after[0]).toEqual(fusedRows[0])
  expect(after[1]).toMatchObject({ sort_order: 3, source_url: `${fileUrl}#chapter=2` })
  const repeat = await preview(bindingId)
  expect(repeat.summary.newCount).toBe(0)
  expect(repeat.chapters.some((c) => c.selected)).toBe(false)
  expect(await post(`/api/book-import/${next.runId}/rollback`, {})).toMatchObject({ rolledBack: 1, conflicts: [] })
  expect(await chapters(id)).toEqual(fusedRows)
  expect(await post('/api/scrape', { action: 'source-sync-rollback', runId: sync.runId })).toMatchObject({ conflicts: [] })
  expect(await chapters(id)).toEqual(before)
})
