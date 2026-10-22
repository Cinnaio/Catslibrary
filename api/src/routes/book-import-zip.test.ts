import { beforeAll, afterAll, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { formatExportText } from '../services/novel-export-text'
import { parseBookZip } from '../services/book-import-zip'
import { exportNovels } from '../services/novel-export'
import type { BookImportPreview, BookImportCommitResult } from '@shared/types'
let t: TestDb
const token = 'zip-test-admin'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=', 'base64')
function txt(title: string) {
  return strToU8(formatExportText({ title, author: '作者', description: '简介' }, [{ title: '无编号续写', content: '完整正文。' }]))
}
function pack(title: string) {
  return zipSync({ [`${title}/正文.txt`]: txt(title), [`${title}/封面.png`]: png })
}
async function preview(data: Uint8Array, auth = true) {
  const form = new FormData()
  form.append('file', new File([Buffer.from(data)], '书籍.zip', { type: 'application/zip' }))
  return app.request('/api/book-import/preview-zip', { method: 'POST', headers: auth ? { Authorization: `Bearer ${token}` } : {}, body: form })
}
function post(path: string, body: unknown) {
  return app.request('/api/book-import/' + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function getPreview(title: string) {
  const res = await preview(pack(title))
  expect(res.status).toBe(200)
  return ((await res.json()) as { previews: BookImportPreview[] }).previews[0]!
}
async function commit(p: BookImportPreview, mode = 'missing') {
  const res = await post(p.runId + '/commit', {
    revision: p.revision,
    selectedChapterIds: p.chapters.filter((c) => c.selected).map((c) => c.id),
    metadataFields: p.metadataDiff.filter((f) => f.selected || f.field === 'coverUrl').map((f) => f.field),
    metadataMode: mode,
  })
  expect(res.status).toBe(200)
  return (await res.json()) as BookImportCommitResult
}
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test/test'
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  await t.db.query(
    "INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('admin','admin','admin','unused','unused',1,1)",
  )
  await t.db.query("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,'admin',$2,$3,$3)", [
    await hashToken(token, loadConfig().sessionHashSalt),
    Date.now() + 86400000,
    Date.now(),
  ])
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})
it('ZIP 仅管理员可预览；预览批量目录不写入书库，不把封面说明当书籍', async () => {
  const data = zipSync({ '001_甲/正文.txt': txt('ZIP甲'), '001_甲/封面.png': png, '002_乙/正文.txt': txt('ZIP乙'), '002_乙/封面说明.txt': strToU8('无封面') })
  expect((await preview(data, false)).status).toBe(401)
  const res = await preview(data)
  expect(res.status).toBe(200)
  const result = (await res.json()) as { previews: BookImportPreview[] }
  expect(result.previews.map((p) => p.book.title)).toEqual(['ZIP甲', 'ZIP乙'])
  expect(result.previews[0]!.metadataDiff.find((f) => f.field === 'coverUrl')?.incomingValue).toBe('压缩包中的本地封面')
  expect(JSON.stringify(result)).not.toContain(png.toString('base64'))
  expect((await t.db.query('SELECT id FROM novels')).rows).toHaveLength(0)
})
it('单本提交恢复正文和本地封面，撤回删除本轮新书', async () => {
  const p = await getPreview('ZIP新建')
  const result = await commit(p)
  expect((await t.db.query<{ content: string }>('SELECT content FROM chapters WHERE novel_id=$1', [result.novelId])).rows[0]?.content).toBe('完整正文。')
  const image = await t.db.query<{ data: Uint8Array; source: string }>('SELECT data,source FROM novel_covers WHERE novel_id=$1', [result.novelId])
  expect(Buffer.from(image.rows[0]!.data)).toEqual(png)
  expect(image.rows[0]!.source).toBe('import')
  const rollback = await post(p.runId + '/rollback', {})
  expect(rollback.status).toBe(200)
  expect((await t.db.query('SELECT id FROM novels WHERE id=$1', [result.novelId])).rows).toHaveLength(0)
})
it('已有作品自动匹配，补齐模式保留封面，显式替换可撤回恢复旧封面', async () => {
  await t.db.query("INSERT INTO novels(id,title,author,created_at,updated_at) VALUES('existing','ZIP已有','作者',1,1)")
  await t.db.query("INSERT INTO novel_covers(novel_id,data,content_type,source,updated_at) VALUES('existing',$1,'image/png','upload',1)", [
    Buffer.from('old-cover'),
  ])
  let p = await getPreview('ZIP已有')
  expect(p.targetNovelId).toBe('existing')
  expect(p.metadataDiff.find((f) => f.field === 'coverUrl')?.selected).toBe(false)
  await commit(p)
  expect(Buffer.from((await t.db.query<{ data: Uint8Array }>("SELECT data FROM novel_covers WHERE novel_id='existing'")).rows[0]!.data).toString()).toBe(
    'old-cover',
  )
  p = await getPreview('ZIP已有')
  await commit(p, 'replace')
  expect(Buffer.from((await t.db.query<{ data: Uint8Array }>("SELECT data FROM novel_covers WHERE novel_id='existing'")).rows[0]!.data)).toEqual(png)
  expect((await post(p.runId + '/rollback', {})).status).toBe(200)
  expect(Buffer.from((await t.db.query<{ data: Uint8Array }>("SELECT data FROM novel_covers WHERE novel_id='existing'")).rows[0]!.data).toString()).toBe(
    'old-cover',
  )
})
it('导入后封面被修改时撤回保留整本，避免覆盖后续更改', async () => {
  const p = await getPreview('ZIP保护')
  const r = await commit(p)
  await t.db.query('UPDATE novel_covers SET data=$1,updated_at=$2 WHERE novel_id=$3', [Buffer.from('later-cover'), Date.now() + 1, r.novelId])
  const res = await post(p.runId + '/rollback', {})
  expect(res.status).toBe(200)
  const body = (await res.json()) as { conflicts: unknown[] }
  expect(body.conflicts.length).toBeGreaterThan(0)
  expect((await t.db.query('SELECT id FROM novels WHERE id=$1', [r.novelId])).rows).toHaveLength(1)
})
it('本站真实导出的多书封面包能直接识别，章节和封面一致', async () => {
  await t.db.query("UPDATE novel_covers SET data=$1 WHERE novel_id='existing'", [png])
  const data = await exportNovels(t.db, ['existing'], true, true)
  const parsed = await parseBookZip(data.data)
  expect(parsed).toHaveLength(1)
  expect(parsed[0]!.detail.payload.title).toBe('ZIP已有')
  expect(parsed[0]!.detail.payload.chapters).toHaveLength(1)
  expect(parsed[0]!.detail.payload.coverImage?.dataBase64).toBe(png.toString('base64'))
})
it.each(['../evil.txt', '/evil.txt', 'C:/evil.txt', 'folder\\evil.txt'])('拒绝不安全路径 %s', async (name) => {
  await expect(parseBookZip(zipSync({ [name]: txt('恶意') }))).rejects.toThrow('不安全路径')
})
it('拒绝混淆封面、多封面、无正文和超量条目', async () => {
  await expect(parseBookZip(zipSync({ 'a.txt': txt('a'), 'b.txt': txt('b'), '封面.png': png }))).rejects.toThrow('无法确定对应关系')
  await expect(parseBookZip(zipSync({ '正文.txt': txt('a'), '封面.png': png, 'cover.png': png }))).rejects.toThrow('多个封面')
  await expect(parseBookZip(zipSync({ '封面.png': png }))).rejects.toThrow('1–100')
  const files: Record<string, Uint8Array> = {}
  for (let i = 0; i < 401; i++) files[`file${i}`] = new Uint8Array()
  await expect(parseBookZip(zipSync(files))).rejects.toThrow('条目过多')
})
it('解压超量在解压前拒绝，伪装图片拒绝', async () => {
  await expect(parseBookZip(zipSync({ 'huge.txt': new Uint8Array(65 * 1024 * 1024) }))).rejects.toThrow('解压内容超过')
  await expect(parseBookZip(zipSync({ '正文.txt': txt('a'), '封面.png': strToU8('<svg>伪装</svg>') }))).rejects.toThrow('图片类型不符')
})
