import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { hashParagraphText } from '@shared/thought-anchor'
import { selectionImageRevision } from '../services/ai/selection-image'
import type { ChapterIllustration, IllustrationAnchor } from '@shared/chapter-illustrations'

// The deployment's backup gate owns a separate real PG pool; route tests use PGlite.
vi.mock('../middlewares/backup-maintenance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middlewares/backup-maintenance')>()),
  backupMaintenance: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

let t: TestDb
let admin: string
let reader: string
let chapterId: string
let novelId: string
let bytes: Buffer
const content = '庭院落满了雨。\n他推开了门。\n灯火依然亮着。'
const anchor: IllustrationAnchor = {
  position: 'after',
  paragraphIndex: 1,
  paragraphText: '他推开了门。',
  paragraphHash: hashParagraphText('他推开了门。'),
  previousText: '庭院落满了雨。',
  nextText: '灯火依然亮着。',
  sourceIndex: 1,
  sourceHash: hashParagraphText('他推开了门。'),
}
const headers = (token: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})
async function post(path: string, body: unknown, token = admin) {
  return app.request(path, { method: 'POST', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function list(token = '') {
  const res = await app.request(`/api/chapters/${chapterId}/illustrations`, { headers: headers(token) })
  return { res, data: (await res.json()) as { illustrations: ChapterIllustration[]; chapterRevision: string } }
}
async function save(patch: Record<string, unknown> = {}, id?: string, token = admin, upload: Buffer | null = bytes) {
  const form = new FormData()
  form.set('metadata', JSON.stringify({ anchor, caption: '门外的庭院', size: 'medium', chapterRevision: selectionImageRevision(content), ...patch }))
  if (upload) form.set('image', new Blob([new Uint8Array(upload)], { type: 'image/png' }), 'courtyard.png')
  return app.request(`/api/chapters/${chapterId}/illustrations${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', headers: headers(token), body: form })
}
async function created() {
  const res = await save()
  expect(res.status).toBe(201)
  return ((await res.json()) as { illustration: ChapterIllustration }).illustration
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  admin = ((await (await post('/api/auth/bootstrap-admin', { username: 'illustrationadmin', password: 'adminpass123' }, '')).json()) as { token: string }).token
  await t.db.query('INSERT INTO invites(code,created_at) VALUES($1,$2)', ['ILLUSTRATION-INVITE', Date.now()])
  reader = (
    (await (await post('/api/auth/register', { username: 'illustrationreader', password: 'readerpass123', invite: 'ILLUSTRATION-INVITE' }, '')).json()) as {
      token: string
    }
  ).token
  novelId = ((await (await post('/api/novels', { title: '庭院', author: '测试', contentRating: 'general' })).json()) as { novel: { id: string } }).novel.id
  chapterId = ((await (await post('/api/chapters', { novelId, title: '雨夜', content })).json()) as { chapter: { id: string } }).chapter.id
  bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#997755' } })
    .png()
    .toBuffer()
})
beforeEach(async () => {
  await t.db.query('DELETE FROM chapter_illustrations')
  await t.db.query('DELETE FROM chapter_illustration_assets')
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [content, chapterId])
  await t.db.query("UPDATE novels SET content_rating='general' WHERE id=$1", [novelId])
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

describe('共享章节插图', () => {
  it('仅管理员能写，普通读者和访客可以查看共享插图', async () => {
    expect((await save({}, undefined, '')).status).toBe(401)
    expect((await save({}, undefined, reader)).status).toBe(403)
    const item = await created()
    expect((await list()).data.illustrations[0]).toEqual(item)
    const res = await app.request(`/api/chapters/${chapterId}/illustrations/${item.id}/image`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(20)
    expect((await t.db.query<{ content: string }>('SELECT content FROM chapters WHERE id=$1', [chapterId])).rows[0]?.content).toBe(content)
  })
  it('修改、替换、删除和撤销保留素材，乐观版本检查阻止覆盖', async () => {
    const first = await created()
    const updated = await save({ version: first.version, size: 'full', caption: '新图注' }, first.id)
    expect(updated.status).toBe(200)
    const second = ((await updated.json()) as { illustration: ChapterIllustration }).illustration
    expect(second.version).toBe(2)
    expect(second.assetId).not.toBe(first.assetId)
    expect((await save({ version: first.version }, first.id, admin, null)).status).toBe(409)
    const removed = await save({ version: second.version, deleted: true }, first.id, admin, null)
    expect(removed.status).toBe(200)
    expect((await list()).data.illustrations).toHaveLength(0)
    expect((await app.request(`/api/chapters/${chapterId}/illustrations/${first.id}/image`)).status).toBe(404)
    const restored = await save({ version: 3, deleted: false, assetId: first.assetId }, first.id, admin, null)
    expect(restored.status).toBe(200)
    expect((await list()).data.illustrations[0]?.assetId).toBe(first.assetId)
    expect((await t.db.query('SELECT id FROM chapter_illustration_assets')).rows).toHaveLength(2)
  })
  it('正文变化后拒绝旧版本提交，失效锚点仍可删除', async () => {
    const first = await created()
    await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', ['完全不同的正文。', chapterId])
    expect((await save({ version: 1 }, first.id, admin, null)).status).toBe(409)
    expect((await save({ version: 1, deleted: true, chapterRevision: selectionImageRevision('完全不同的正文。') }, first.id, admin, null)).status).toBe(200)
  })
  it('拒绝无效图像、伪造段落和无图创建，支持章首章尾', async () => {
    expect((await save({}, undefined, admin, Buffer.from('<svg></svg>'))).status).toBe(400)
    expect((await save({}, undefined, admin, null)).status).toBe(400)
    expect((await save({ anchor: { ...anchor, paragraphText: '不存在的段落', paragraphHash: hashParagraphText('不存在的段落') } })).status).toBe(409)
    expect((await save({ anchor: { ...anchor, position: 'start', paragraphIndex: -1 } })).status).toBe(201)
    expect((await save({ anchor: { ...anchor, position: 'end', paragraphIndex: 3 } })).status).toBe(201)
  })
  it('列表和二进制图片均跟随章节内容权限，不能通过图片绕过限制', async () => {
    const first = await created()
    await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id=$1", [novelId])
    expect((await list()).res.status).toBe(403)
    expect((await list(reader)).res.status).toBe(403)
    expect((await app.request(`/api/chapters/${chapterId}/illustrations/${first.id}/image`)).status).toBe(403)
    expect((await list(admin)).res.status).toBe(200)
    expect((await app.request(`/api/chapters/${chapterId}/illustrations?contentMode=safe`, { headers: headers(admin) })).status).toBe(403)
  })
  it('删除章节清理插图及其所有素材', async () => {
    const res = await post('/api/chapters', { novelId, title: '临时章节', content })
    const extraId = ((await res.json()) as { chapter: { id: string } }).chapter.id
    const original = chapterId
    chapterId = extraId
    try {
      await created()
      expect((await app.request(`/api/chapters/${extraId}`, { method: 'DELETE', headers: headers(admin) })).status).toBe(200)
      expect((await t.db.query('SELECT id FROM chapter_illustration_assets WHERE chapter_id=$1', [extraId])).rows).toHaveLength(0)
    } finally {
      chapterId = original
    }
  })
})
