import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { app } from '../app'
import { checkSupplementarySource, runSupplementaryTick } from '../services/supplementary-source'
import type { BookImportPreview } from '@shared/types'
import type { SupplementaryFile, SupplementaryOverview } from '@shared/supplementary-source'

const mocks = vi.hoisted(() => ({ scan: vi.fn(), download: vi.fn() }))
vi.mock('../services/lanzou', async (original) => ({
  ...(await original<typeof import('../services/lanzou')>()),
  scanLanzouFolder: mocks.scan,
  downloadLanzouFile: mocks.download,
}))
let t: TestDb,
  token = '',
  sourceId = '',
  bindingId = ''
const file: SupplementaryFile = {
  key: 'new-file',
  url: 'https://dudu88.lanzov.com/iFile2',
  name: '[更2] 网盘别名 作者：测试作者.txt',
  folder: '1016',
  size: '1 M',
  title: '网盘别名',
  author: '测试作者',
  revision: 2,
}
const text = '网盘正文书名\n作者：测试作者\n第一章 山雨\n山雨里的已有正文内容。\n第二章 夜归\n夜归时的新增正文内容。'
const call = (path: string, body?: unknown, method = body ? 'POST' : 'GET') =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
async function upload(name = file.name, content = text) {
  const form = new FormData()
  form.append('file', new File([content], name))
  form.append('supplementaryBindingId', bindingId)
  form.append('fileKey', file.key)
  return app.request('/api/book-import/preview', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const response = await call('/api/auth/bootstrap-admin', { username: 'supplementary-admin', password: 'password123' })
  token = ((await response.json()) as { token: string }).token
  await t.db.query(
    "INSERT INTO novels (id,title,author,source_url,created_at,updated_at,chapter_count) VALUES ('supp-book','站内书名','测试作者','https://original.example/book',1,1,1)",
  )
  await t.db.query(
    "INSERT INTO chapters (id,novel_id,title,sort_order,content,word_count,source_url,created_at) VALUES ('supp-existing','supp-book','第一章 山雨',1,'山雨里的已有正文内容。',12,'https://original.example/1',1)",
  )
  mocks.scan.mockResolvedValue([file])
  mocks.download.mockResolvedValue(new TextEncoder().encode(text))
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

it('目录接口只允许管理员', async () => {
  const r = await app.request('/api/supplementary-sources')
  expect(r.status).toBe(401)
})
it('添加共享源、扫描并绑定已有书籍，不回显提取码', async () => {
  const res = await call('/api/supplementary-sources', {
    name: '微博10月',
    url: 'https://dudu88.lanzov.com/bMonth',
    password: 'share-secret',
    enabled: false,
    intervalHours: 6,
  })
  expect(res.status).toBe(200)
  sourceId = ((await res.json()) as { id: string }).id
  const checked = await call(`/api/supplementary-sources/${sourceId}/check`, {})
  expect(checked.status).toBe(200)
  const overview = (await checked.json()) as SupplementaryOverview
  expect(overview.sources[0]).toMatchObject({ fileCount: 1, hasPassword: true, status: 'ok', enabled: false })
  expect(JSON.stringify(overview)).not.toContain('share-secret')
  expect((await call('/api/supplementary-sources/bindings', { sourceId, novelId: 'supp-book', fileKey: file.key })).status).toBe(200)
  const data = (await (await call('/api/supplementary-sources')).json()) as SupplementaryOverview
  bindingId = data.bindings[0]!.id
  expect(data.bindings[0]).toMatchObject({ novelTitle: '站内书名', aliasTitle: '网盘别名', candidates: [file] })
})
it('手动接续核对文件名，接受浏览器重名后缀；固定已有作品且不默认选择元数据', async () => {
  expect((await upload('错误版本.txt')).status).toBe(400)
  const response = await upload(file.name.replace('.txt', ' (1).txt'))
  expect(response.status).toBe(200)
  const p = (await response.json()) as BookImportPreview
  expect(p.targetNovelId).toBe('supp-book')
  expect(p.summary).toMatchObject({ newCount: 1, unchangedCount: 1 })
  expect(p.metadataDiff.every((f) => !f.selected)).toBe(true)
  expect(p.supplementary).toEqual({ bindingId, fileKey: file.key })
  const wrongTarget = await call(`/api/book-import/${p.runId}/target`, { revision: 0, targetNovelId: null })
  expect(wrongTarget.status).toBe(409)
  const wrongMetadata = await call(`/api/book-import/${p.runId}/commit`, {
    revision: 0,
    targetNovelId: 'supp-book',
    metadataFields: ['sourceUrl'],
    selectedChapterIds: ['chapter-2'],
  })
  expect(wrongMetadata.status).toBe(409)
})
it('两个旧预览不会重复插入，导入留存文件来源并可撤回', async () => {
  const left = (await (await upload()).json()) as BookImportPreview
  const right = (await (await upload()).json()) as BookImportPreview
  const body = { revision: 0, targetNovelId: 'supp-book', metadataFields: [], selectedChapterIds: ['chapter-2'] }
  const res = await call(`/api/book-import/${left.runId}/commit`, body)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ created: 1, updated: 0, metadataUpdated: [] })
  const repeated = await call(`/api/book-import/${right.runId}/commit`, body)
  expect(repeated.status).toBe(200)
  expect(await repeated.json()).toMatchObject({ created: 0 })
  expect((await t.db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id='supp-book'")).rows[0]!.count).toBe(2)
  const original = (await t.db.query<{ title: string; source_url: string }>("SELECT title,source_url FROM novels WHERE id='supp-book'")).rows[0]
  expect(original).toEqual({ title: '站内书名', source_url: 'https://original.example/book' })
  expect((await t.db.query<{ source_url: string }>("SELECT source_url FROM chapters WHERE novel_id='supp-book' AND sort_order=2")).rows[0]!.source_url).toBe(
    file.url + '#chapter=2',
  )
  const rollback = await call(`/api/book-import/${left.runId}/rollback`, {})
  expect(rollback.status).toBe(200)
  expect(await rollback.json()).toMatchObject({ rolledBack: 1 })
  expect((await t.db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id='supp-book'")).rows[0]!.count).toBe(1)
})
it('自动下载成功与手动上传接入相同预览', async () => {
  const res = await call('/api/book-import/preview', { supplementaryBindingId: bindingId, fileKey: file.key })
  expect(res.status).toBe(200)
  expect(((await res.json()) as BookImportPreview).summary.newCount).toBe(1)
})
it('扫描失败保留旧索引并显示失败，定时检查不写章节', async () => {
  await expect(
    checkSupplementarySource(t.db, sourceId, async () => {
      throw new Error('upstream-private-details')
    }),
  ).rejects.toThrow('目录检查失败')
  const data = (await (await call('/api/supplementary-sources')).json()) as SupplementaryOverview
  expect(data.sources[0]).toMatchObject({ status: 'error', fileCount: 1, error: '目录检查失败，请稍后重试' })
  await t.db.query('UPDATE supplementary_sources SET enabled=TRUE,next_check_at=0 WHERE id=$1', [sourceId])
  await runSupplementaryTick(t.db)
  expect(((await (await call('/api/supplementary-sources')).json()) as SupplementaryOverview).sources[0]!.status).toBe('ok')
  expect((await t.db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id='supp-book'")).rows[0]!.count).toBe(1)
})
it('部分目录受限时保留旧文件并逐项标注，成功目录仍可更新',async()=>{
  await checkSupplementarySource(t.db,sourceId,async(_url,_password,_request,failed)=>{failed?.push('1016');return [{...file,key:'fresh-file',folder:'1017',revision:3}]})
  const data=await (await call('/api/supplementary-sources')).json() as SupplementaryOverview
  expect(data.sources[0]).toMatchObject({status:'partial',fileCount:2})
  expect(data.sources[0]!.error).toContain('1016')
  expect(data.bindings[0]!.candidates.find(f=>f.key===file.key)).toMatchObject({stale:true})
  expect(data.bindings[0]!.candidates[0]).toMatchObject({key:'fresh-file',folder:'1017'})
})
it('更换月份保留书籍绑定，清空旧目录；解除绑定保留书籍', async () => {
  const res = await call('/api/supplementary-sources', {
    id: sourceId,
    name: '微博11月',
    url: 'https://dudu88.lanzov.com/bNext',
    enabled: false,
    intervalHours: 12,
  })
  expect(res.status).toBe(200)
  const data = (await (await call('/api/supplementary-sources')).json()) as SupplementaryOverview
  expect(data.sources[0]).toMatchObject({ fileCount: 0, status: 'never', hasPassword: true })
  expect(data.bindings[0]).toMatchObject({ id: bindingId, candidates: [] })
  expect((await call(`/api/supplementary-sources/bindings/${bindingId}`, undefined, 'DELETE')).status).toBe(200)
  expect((await t.db.query("SELECT id FROM novels WHERE id='supp-book'")).rows).toHaveLength(1)
})
