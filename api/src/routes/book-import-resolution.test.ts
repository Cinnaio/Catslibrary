import { afterAll, beforeAll, expect, it } from 'vitest'
import type { BookImportPreview } from '@shared/types'
import { app } from '../app'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { createPreview } from '../services/book-import'
import { resolveImportChapter } from '../services/book-import-resolution'

let t: TestDb,
  token = '',
  actorId = '',
  counter = 0
const oldDatabaseUrl = process.env.DATABASE_URL
async function request(path: string, body: unknown, auth = true) {
  return app.request(`/api/book-import/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}
const rows = async (id: string) =>
  (
    await t.db.query<{ id: string; title: string; sort_order: number; content: string; source_url: string }>(
      'SELECT id,title,sort_order,content,source_url FROM chapters WHERE novel_id=$1 ORDER BY sort_order,id',
      [id],
    )
  ).rows
async function fixture(extra = false, multiple = false) {
  const id = `resolve-${++counter}`
  await t.db.query("INSERT INTO novels(id,title,author,created_at,updated_at) VALUES($1,$1,'作者',1,1)", [id])
  await t.db.query(
    "INSERT INTO chapters(id,novel_id,title,sort_order,content,source_url,created_at) VALUES($1,$3,'第一章 起点',1,'起点正文','file:///original#1',1),($2,$3,'第三章 终点',2,'终点正文','file:///original#2',1)",
    [`${id}-a`, `${id}-c`, id],
  )
  if (extra)
    await t.db.query("INSERT INTO chapters(id,novel_id,title,sort_order,content,created_at) VALUES($1,$2,'没有自动对应的本地章节',5,'旧版正文',1)", [
      `${id}-extra`,
      id,
    ])
  const payload = {
    title: id,
    author: '作者',
    chapters: [
      { title: '第一章 起点', order: 1, content: '起点正文' },
      { title: '第二章 插章', order: 2, content: '插章正文' },
      { title: '第三章 终点', order: 3, content: '终点正文' },
      { title: '第四章 尾章', order: 4, content: '尾章正文' },
    ],
  }
  if (multiple) {
    payload.chapters.splice(2, 0, { title: '补章 过渡', order: 3, content: '过渡正文' })
    payload.chapters.forEach((chapter, index) => { chapter.order = index + 1 })
  }
  const preview = await createPreview(t.db, {
    sourceType: 'file',
    sourceLabel: '样本.txt',
    sourceUrl: 'https://example.com/file',
    payload,
    targetNovelId: id,
    preserveLocalOrder: true,
  })
  preview.supplementary = { bindingId: 'binding', fileKey: 'file' }
  preview.revision = 0
  await t.db.query(
    "INSERT INTO book_import_runs(id,actor_user_id,target_novel_id,source_label,source_url,payload_json,preview_json,created_at,supplementary_binding_id) VALUES($1,$2,$3,'样本.txt','https://example.com/file',$4,$5,1,'binding')",
    [preview.runId, actorId, id, JSON.stringify(preview.book), JSON.stringify(preview)],
  )
  expect(preview.chapters[1]?.status).toBe('conflict')
  return { id, preview, before: await rows(id) }
}
async function resolve(p: BookImportPreview, data: Record<string, unknown>) {
  return request(`${p.runId}/resolve-chapter`, { revision: p.revision || 0, chapterId: 'chapter-2', ...data })
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://isolated/test'
  const response = await app.request('/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'resolution-admin', password: 'password123' }),
  })
  token = ((await response.json()) as { token: string }).token
  actorId = (await t.db.query<{ id: string }>("SELECT id FROM users WHERE username='resolution-admin'")).rows[0]!.id
})
afterAll(async () => {
  setDbForTests(null)
  if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = oldDatabaseUrl
  await t.close()
})

it('确认中间插章只修改预览，最终导入顺延本地序号、正确追加尾章并可整体撤回', async () => {
  const { id, preview: p, before } = await fixture()
  const response = await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })
  expect(response.status).toBe(200)
  const next = (await response.json()) as BookImportPreview
  expect(next).toMatchObject({ revision: 1, targetNovelId: id, summary: { conflictCount: 0 } })
  expect(next.chapters[1]).toMatchObject({ status: 'new', selected: true, incomingOrder: 2 })
  expect(next.chapters[3]?.incomingOrder).toBe(4)
  expect(await rows(id)).toEqual(before)
  const result = await request(`${p.runId}/commit`, { revision: 1, targetNovelId: id, selectedChapterIds: ['chapter-2', 'chapter-4'], metadataFields: [] })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ created: 2, conflicts: [] })
  expect((await rows(id)).map((c) => [c.sort_order, c.content])).toEqual([
    [1, '起点正文'],
    [2, '插章正文'],
    [3, '终点正文'],
    [4, '尾章正文'],
  ])
  const repeated = await createPreview(t.db, {
    sourceType: 'file',
    sourceLabel: '样本.txt',
    sourceUrl: 'https://example.com/file',
    payload: p.book,
    targetNovelId: id,
    preserveLocalOrder: true,
  })
  expect(repeated.summary).toMatchObject({ newCount: 0, conflictCount: 0, unchangedCount: 4 })
  expect((await request(`${p.runId}/rollback`, {})).status).toBe(200)
  expect(await rows(id)).toEqual(before)
})
it('取消勾选已确认插章时，不顺延已有章节且尾章使用正确位置', async () => {
  const { id, preview: p } = await fixture()
  expect((await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })).ok).toBe(true)
  const result = await request(`${p.runId}/commit`, { revision: 1, selectedChapterIds: ['chapter-4'], metadataFields: [] })
  expect(result.status).toBe(200)
  expect((await rows(id)).map((c) => [c.sort_order, c.content])).toEqual([
    [1, '起点正文'],
    [2, '终点正文'],
    [3, '尾章正文'],
  ])
})
it('对应已有章节后保留本地序号，正文变化默认不选，确认提交后可撤回', async () => {
  const { id, preview: p, before } = await fixture(true)
  const response = await resolve(p, { action: 'match', localChapterId: `${id}-extra` })
  expect(response.status).toBe(200)
  const next = (await response.json()) as BookImportPreview
  expect(next.chapters[1]).toMatchObject({ status: 'changed', selected: false, localChapterId: `${id}-extra`, incomingOrder: 5, localContent: '旧版正文' })
  expect(await rows(id)).toEqual(before)
  expect((await request(`${p.runId}/commit`, { revision: 1, selectedChapterIds: ['chapter-2'], metadataFields: [] })).status).toBe(200)
  expect((await rows(id)).find((c) => c.id === `${id}-extra`)).toMatchObject({ content: '插章正文', sort_order: 5 })
  expect((await request(`${p.runId}/rollback`, {})).status).toBe(200)
  expect(await rows(id)).toEqual(before)
})
it('确认后本地正文变化会拒绝提交，不留下新增或序号修改', async () => {
  const { id, preview: p } = await fixture()
  await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })
  await t.db.query("UPDATE chapters SET content='并发编辑' WHERE id=$1", [`${id}-c`])
  const before = await rows(id)
  const result = await request(`${p.runId}/commit`, { revision: 1, selectedChapterIds: ['chapter-2'], metadataFields: [] })
  expect(result.status).toBe(409)
  expect(await rows(id)).toEqual(before)
})
it('拒绝跨书目标、重复对应本地章节、旧版本及非创建者，撤销确认恢复保护', async () => {
  const { id, preview: p, before } = await fixture()
  expect((await request(`${p.runId}/resolve-chapter`, { revision: 0, chapterId: 'chapter-2', action: 'insert', afterChapterId: null }, false)).status).toBe(401)
  await expect(
    resolveImportChapter(t.db, { runId: p.runId, actorUserId: 'another-admin', revision: 0, chapterId: 'chapter-2', action: 'insert', afterChapterId: null }),
  ).rejects.toThrow('不存在')
  expect((await resolve(p, { action: 'match', localChapterId: 'another-book-chapter' })).ok).toBe(false)
  expect((await resolve(p, { action: 'match', localChapterId: `${id}-a` })).ok).toBe(false)
  expect((await resolve(p, { action: 'insert', afterChapterId: 'another-book-chapter' })).ok).toBe(false)
  expect((await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })).ok).toBe(true)
  expect((await resolve(p, { action: 'clear' })).status).toBe(409)
  const cleared = await resolve({ ...p, revision: 1 }, { action: 'clear' })
  expect(cleared.status).toBe(200)
  expect(((await cleared.json()) as BookImportPreview).chapters[1]).toMatchObject({ status: 'conflict', selected: false })
  expect(await rows(id)).toEqual(before)
})
it('插章导入后相关章节被编辑时，撤回整体保留新增和已调整的序号', async () => {
  const { id, preview: p } = await fixture()
  await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })
  await request(`${p.runId}/commit`, { revision: 1, selectedChapterIds: ['chapter-2'], metadataFields: [] })
  await t.db.query("UPDATE chapters SET content='人工编辑插章' WHERE novel_id=$1 AND sort_order=2", [id])
  const before = await rows(id)
  const result = await request(`${p.runId}/rollback`, {})
  expect(await result.json()).toMatchObject({ rolledBack: 0, conflicts: [expect.objectContaining({ reason: expect.stringContaining('整体保留') })] })
  expect(await rows(id)).toEqual(before)
})

it('同一位置连续确认两章时按文件顺序插入，尾章和撤回顺序均正确', async () => {
  const { id, preview: p, before } = await fixture()
  const book = structuredClone(p.book)
  book.chapters.splice(2, 0, { title: '补章 过渡', order: 3, content: '过渡正文' })
  book.chapters.forEach((c, index) => {
    c.order = index + 1
  })
  const next = await createPreview(t.db, {
    sourceType: 'file',
    sourceLabel: '样本.txt',
    sourceUrl: 'https://example.com/file',
    payload: book,
    targetNovelId: id,
    runId: p.runId,
    preserveLocalOrder: true,
  })
  next.supplementary = p.supplementary
  next.revision = 0
  await t.db.query('UPDATE book_import_runs SET payload_json=$1,preview_json=$2 WHERE id=$3', [JSON.stringify(next.book), JSON.stringify(next), p.runId])
  expect((await resolve(next, { action: 'insert', afterChapterId: `${id}-a` })).status).toBe(200)
  expect((await resolve({ ...next, revision: 1 }, { chapterId: 'chapter-3', action: 'insert', afterChapterId: `${id}-a` })).status).toBe(200)
  const result = await request(`${p.runId}/commit`, { revision: 2, selectedChapterIds: ['chapter-2', 'chapter-3', 'chapter-5'], metadataFields: [] })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ created: 3, conflicts: [] })
  expect((await rows(id)).map((c) => [c.sort_order, c.content])).toEqual([
    [1, '起点正文'],
    [2, '插章正文'],
    [3, '过渡正文'],
    [4, '终点正文'],
    [5, '尾章正文'],
  ])
  expect((await request(`${p.runId}/rollback`, {})).status).toBe(200)
  expect(await rows(id)).toEqual(before)
})
it('过期预览与进行中的 AI 复核不能被人工确认绕过', async () => {
  const { id, preview: p, before } = await fixture()
  await t.db.query('UPDATE book_import_runs SET source_expires_at=$1 WHERE id=$2', [Date.now() - 1, p.runId])
  expect((await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })).status).toBe(409)
  await t.db.query("UPDATE book_import_runs SET source_expires_at=$1,review_token='busy',review_started_at=$2 WHERE id=$3", [
    Date.now() + 60000,
    Date.now(),
    p.runId,
  ])
  expect((await resolve(p, { action: 'insert', afterChapterId: `${id}-a` })).status).toBe(409)
  expect(await rows(id)).toEqual(before)
  expect((await t.db.query<{ revision: number }>('SELECT revision FROM book_import_runs WHERE id=$1', [p.runId])).rows[0]?.revision).toBe(0)
})

async function confirmedChain(extra = false) {
  const result = await fixture(extra, true)
  const first = await resolve(result.preview, { action: 'insert', afterChapterId: `${result.id}-a` })
  expect(first.status).toBe(200)
  const second = await resolve(await first.json() as BookImportPreview, { chapterId: 'chapter-3', action: 'insert', afterIncomingChapterId: 'chapter-2' })
  expect(second.status).toBe(200)
  return { ...result, preview: await second.json() as BookImportPreview }
}
it('连续补章以本轮新增章为锚点，预览和实际顺序一致并可撤回', async () => {
  const { id, preview, before } = await confirmedChain()
  expect(preview.chapters.slice(1, 3).map(c => c.incomingOrder)).toEqual([2, 3])
  expect(preview.chapterResolutions?.[1]).toMatchObject({ afterIncomingChapterId: 'chapter-2', afterChapterId: null })
  expect(await rows(id)).toEqual(before)
  const result = await request(`${preview.runId}/commit`, { revision: 2, selectedChapterIds: ['chapter-2', 'chapter-3', 'chapter-5'], metadataFields: [] })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ created: 3, conflicts: [] })
  expect((await rows(id)).map(c => [c.sort_order, c.content])).toEqual([[1, '起点正文'], [2, '插章正文'], [3, '过渡正文'], [4, '终点正文'], [5, '尾章正文']])
  expect((await request(`${preview.runId}/rollback`, {})).status).toBe(200)
  expect(await rows(id)).toEqual(before)
})
it('连续补章取消勾选前章，后章仍接在原位置且不自动导入前章', async () => {
  const { id, preview, before } = await confirmedChain()
  const result = await request(`${preview.runId}/commit`, { revision: 2, selectedChapterIds: ['chapter-3', 'chapter-5'], metadataFields: [] })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ created: 2, conflicts: [] })
  expect((await rows(id)).map(c => [c.sort_order, c.content])).toEqual([[1, '起点正文'], [2, '过渡正文'], [3, '终点正文'], [4, '尾章正文']])
  expect((await request(`${preview.runId}/rollback`, {})).status).toBe(200)
  expect(await rows(id)).toEqual(before)
})
it('撤销前章确认会把后章接回原锚点，剩余确认仍可导入', async () => {
  const { id, preview, before } = await confirmedChain()
  const result = await resolve(preview, { action: 'clear' })
  expect(result.status).toBe(200)
  const cleared = await result.json() as BookImportPreview
  expect(cleared.chapters[1]).toMatchObject({ status: 'conflict', selected: false })
  expect(cleared.chapterResolutions).toEqual([{ chapterId: 'chapter-3', action: 'insert', afterChapterId: `${id}-a` }])
  expect(cleared.chapters[2]?.incomingOrder).toBe(2)
  expect(await rows(id)).toEqual(before)
  expect((await request(`${preview.runId}/commit`, { revision: 3, selectedChapterIds: ['chapter-3'], metadataFields: [] })).status).toBe(200)
  expect((await rows(id)).map(c => c.content)).toEqual(['起点正文', '过渡正文', '终点正文'])
})
it('调整前章插入位置时后章跟随移动，不能选择自身、后继、无效或歧义锚点', async () => {
  const { id, preview, before } = await confirmedChain()
  for (const data of [
    { afterChapterId: null, afterIncomingChapterId: 'chapter-2' },
    { afterChapterId: null, afterIncomingChapterId: 'chapter-3' },
    { afterChapterId: null, afterIncomingChapterId: 'chapter-4' },
    { afterChapterId: null, afterIncomingChapterId: 'another-run-chapter' },
    { afterChapterId: `${id}-a`, afterIncomingChapterId: 'chapter-3' },
    { afterChapterId: null, afterIncomingChapterId: 123 },
  ]) expect((await resolve(preview, { action: 'insert', ...data })).ok).toBe(false)
  const result = await resolve(preview, { action: 'insert', afterChapterId: `${id}-c` })
  expect(result.status).toBe(200)
  const moved = await result.json() as BookImportPreview
  expect(moved.revision).toBe(3)
  expect(moved.chapters.slice(1, 3).map(c => c.incomingOrder)).toEqual([3, 4])
  expect(await rows(id)).toEqual(before)
  expect((await request(`${preview.runId}/commit`, { revision: 3, selectedChapterIds: ['chapter-2', 'chapter-3'], metadataFields: [] })).status).toBe(200)
  expect((await rows(id)).map(c => c.content)).toEqual(['起点正文', '终点正文', '插章正文', '过渡正文'])
})
it('前章改为对应已有章节后，后章接回旧位置，原标题和正文按勾选保留', async () => {
  const { id, preview } = await confirmedChain(true)
  const result = await resolve(preview, { action: 'match', localChapterId: `${id}-extra` })
  expect(result.status).toBe(200)
  const next = await result.json() as BookImportPreview
  expect(next.chapters[1]).toMatchObject({ status: 'changed', selected: false, incomingOrder: 5 })
  expect(next.chapterResolutions?.find(r => r.chapterId === 'chapter-3')).toEqual({ chapterId: 'chapter-3', action: 'insert', afterChapterId: `${id}-a` })
  expect((await request(`${preview.runId}/commit`, { revision: 3, selectedChapterIds: ['chapter-3'], metadataFields: [] })).status).toBe(200)
  expect((await rows(id)).map(c => [c.sort_order, c.content])).toEqual([[1, '起点正文'], [2, '过渡正文'], [3, '终点正文'], [5, '旧版正文']])
})
it('显式调换两段补章顺序后，实际写入遵循指定位置而不是文件顺序', async () => {
  const { id, preview, before } = await confirmedChain()
  const detached = await resolve(preview, { chapterId: 'chapter-3', action: 'insert', afterChapterId: `${id}-a` })
  expect(detached.status).toBe(200)
  const reordered = await resolve(await detached.json() as BookImportPreview, { action: 'insert', afterChapterId: null, afterIncomingChapterId: 'chapter-3' })
  expect(reordered.status).toBe(200)
  expect((await request(`${preview.runId}/commit`, { revision: 4, selectedChapterIds: ['chapter-2', 'chapter-3'], metadataFields: [] })).status).toBe(200)
  expect((await rows(id)).map(c => c.content)).toEqual(['起点正文', '过渡正文', '插章正文', '终点正文'])
  expect((await request(`${preview.runId}/rollback`, {})).status).toBe(200)
  expect(await rows(id)).toEqual(before)
})
