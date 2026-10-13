import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { coverRoutes } from '../routes/cover'
import { applySourceSync, rollbackSourceSync } from './source-sync'
import { cacheCoverForNovel, getStoredCover, listCoverHistory, storeCover } from './covers'
import { outboundFetch } from './outbound-fetch'

vi.mock('./outbound-fetch', async importOriginal => ({
  ...await importOriginal<typeof import('./outbound-fetch')>(),
  outboundFetch: vi.fn(),
}))

let t: TestDb
let counter = 0
const app = new Hono().route('/cover', coverRoutes)
const oldUrl = 'https://images.example.com/old.jpg'
const newUrl = 'https://images.example.com/new.jpg'
const image = (text = 'new-image') => new Response(text, { headers: { 'Content-Type': 'image/jpeg' } })
const download = vi.mocked(outboundFetch)
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
})
beforeEach(() => { download.mockReset(); download.mockResolvedValue(image()) })
afterAll(async () => { setDbForTests(null); await t.close() })

async function seed(source = oldUrl, coverUrl = oldUrl) {
  const id = `cover-sync-${++counter}`
  const runId = `${id}-run`
  await t.db.query('INSERT INTO novels (id,title,cover_url,created_at,updated_at) VALUES ($1,\'测试作品\',$2,1,1)', [id, coverUrl])
  await storeCover(t.db, id, Buffer.from('old-image'), 'image/png', source, { prompt: '原提示词', metadata: { original: true } })
  await t.db.query('INSERT INTO novel_source_bindings (id,novel_id,source_url,created_at,updated_at) VALUES ($1,$2,\'https://example.com/book\',1,1)', [`${id}-binding`, id])
  const metadata = { title: '', author: '', description: '', coverUrl: newUrl, categories: [], status: '', sourceUrl: 'https://example.com/book' }
  await t.db.query('INSERT INTO source_sync_runs (id,binding_id,novel_id,metadata_json,changes_json,mapping_json,local_snapshot_json,source_chapters_json,created_at) VALUES ($1,$2,$3,$4,\'[]\',\'[]\',\'[]\',\'[]\',1)', [runId, `${id}-binding`, id, JSON.stringify(metadata)])
  return { id, runId }
}
const applyCover = (runId: string) => applySourceSync(t.db, { runId, applyMetadata: true, metadataFields: ['coverUrl'], metadataMode: 'replace', actorUserId: 'admin' })

it('融合实际更换 URL 时原子清除旧图片、保留历史，并让封面端点返回新图片', async () => {
  const { id, runId } = await seed()
  const old = await app.request(`/cover/${id}?v=1`)
  const previousVersion = Date.now() + 60_000
  await t.db.query('UPDATE novels SET updated_at=$1 WHERE id=$2', [previousVersion, id])
  const result = await applyCover(runId)
  expect(result.metadataUpdated).toEqual(['coverUrl'])
  expect(await getStoredCover(t.db, id)).toBeUndefined()
  expect(await listCoverHistory(t.db, id)).toMatchObject([{ source: oldUrl, prompt: '原提示词', metadata: { original: true }, reason: 'source-sync', actorId: 'admin' }])
  const novel = (await t.db.query<{ cover_url: string; updated_at: number }>('SELECT cover_url,updated_at FROM novels WHERE id=$1', [id])).rows[0]!
  expect(novel.cover_url).toBe(newUrl)
  expect(Number(novel.updated_at)).toBeGreaterThan(previousVersion)
  const response = await app.request(`/cover/${id}?v=${novel.updated_at}`, { headers: { 'If-None-Match': old.headers.get('etag')! } })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('new-image')
  expect(response.headers.get('etag')).not.toBe(old.headers.get('etag'))
  expect(download).toHaveBeenCalledWith(newUrl, expect.anything(), expect.anything())
  expect((await getStoredCover(t.db, id))?.source).toBe(newUrl)
})

it('未选择封面、仅补缺或 URL 不变时不使现有图片失效', async () => {
  for (const mode of ['unselected', 'missing', 'unchanged']) {
    const { id, runId } = await seed('ai', mode === 'unchanged' ? newUrl : oldUrl)
    const result = await applySourceSync(t.db, { runId, applyMetadata: true, metadataFields: mode === 'unselected' ? ['title'] : ['coverUrl'], metadataMode: mode === 'missing' ? 'missing' : 'replace' })
    expect(result.metadataUpdated).not.toContain('coverUrl')
    expect((await getStoredCover(t.db, id))?.source).toBe('ai')
    expect(await listCoverHistory(t.db, id)).toEqual([])
  }
  expect(download).not.toHaveBeenCalled()
})

it('旧融合遗留的 URL 与源图缓存不一致时，读取自动修复', async () => {
  const { id } = await seed(oldUrl, newUrl)
  const response = await app.request(`/cover/${id}`)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('new-image')
  expect((await getStoredCover(t.db, id))?.source).toBe(newUrl)
})

it('普通封面读取保留上传和 AI 图片；明确同步封面仍保存旧图片供恢复', async () => {
  for (const source of ['ai', 'upload', 'local', '']) {
    const { id, runId } = await seed(source, newUrl)
    expect(await (await app.request(`/cover/${id}`)).text()).toBe('old-image')
    expect(download).not.toHaveBeenCalled()
    await t.db.query('UPDATE source_sync_runs SET metadata_json=jsonb_set(metadata_json::jsonb,\'{coverUrl}\',to_jsonb($1::text))::text WHERE id=$2', [oldUrl, runId])
    await applyCover(runId)
    expect(await getStoredCover(t.db, id)).toBeUndefined()
    expect((await listCoverHistory(t.db, id))[0]?.source).toBe(source)
  }
})

it('新源图下载失败不返回旧图或长期缓存占位图，后续读取可重试成功', async () => {
  const { id } = await seed(oldUrl, newUrl)
  download.mockResolvedValueOnce(new Response('', { status: 503 }))
  const failed = await app.request(`/cover/${id}`)
  expect(failed.status).toBe(200)
  expect(failed.headers.get('cache-control')).toContain('no-store')
  expect(await getStoredCover(t.db, id)).toBeUndefined()
  expect(await (await app.request(`/cover/${id}`)).text()).toBe('new-image')
  expect(download).toHaveBeenCalledTimes(2)
})

it('慢下载不能覆盖其间更换的 URL 或上传封面', async () => {
  for (const changeUrl of [true, false]) {
    const { id } = await seed()
    let finish!: (response: Response) => void
    download.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = cacheCoverForNovel(t.db, id)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (changeUrl) await t.db.query('UPDATE novels SET cover_url=$1 WHERE id=$2', [newUrl, id])
    await storeCover(t.db, id, Buffer.from('later-upload'), 'image/png', 'upload')
    finish(image('stale-download'))
    const result = await pending
    expect(result.ok).toBe(!changeUrl)
    expect(Buffer.from((await getStoredCover(t.db, id))!.data).toString()).toBe('later-upload')
  }
})

it('撤回融合恢复原上传图片、来源和提示信息，并更新图片 URL 版本', async () => {
  const { id, runId } = await seed('upload')
  await applyCover(runId)
  await app.request(`/cover/${id}`)
  const before = (await t.db.query<{ updated_at: number }>('SELECT updated_at FROM novels WHERE id=$1', [id])).rows[0]!
  expect((await rollbackSourceSync(t.db, runId, 'admin')).conflicts).toEqual([])
  const restored = await getStoredCover(t.db, id)
  expect(restored).toMatchObject({ source: 'upload', prompt: '原提示词', metadata: '{"original":true}' })
  expect(Buffer.from(restored!.data).toString()).toBe('old-image')
  const after = (await t.db.query<{ cover_url: string; updated_at: number }>('SELECT cover_url,updated_at FROM novels WHERE id=$1', [id])).rows[0]!
  expect(after.cover_url).toBe(oldUrl)
  expect(Number(after.updated_at)).toBeGreaterThan(Number(before.updated_at))
})

it('撤回融合时保留后续手动换上的封面，并报告冲突', async () => {
  const { id, runId } = await seed()
  await applyCover(runId)
  await storeCover(t.db, id, Buffer.from('later-image'), 'image/png', 'ai')
  const result = await rollbackSourceSync(t.db, runId, 'admin')
  expect(result.conflicts).toMatchObject([{ title: '小说封面', reason: expect.stringContaining('后续替换') }])
  expect((await getStoredCover(t.db, id))?.source).toBe('ai')
})

it('融合事务失败不会删掉原封面或留下历史记录', async () => {
  const { id, runId } = await seed()
  await t.db.query("ALTER TABLE novels ADD CONSTRAINT cover_sync_failure_fixture CHECK (status <> 'invalid-status')")
  await t.db.query('UPDATE source_sync_runs SET metadata_json=jsonb_set(metadata_json::jsonb,\'{status}\',\'"invalid-status"\')::text WHERE id=$1', [runId])
  await expect(applySourceSync(t.db, { runId, applyMetadata: true, metadataFields: ['coverUrl', 'status'], metadataMode: 'replace' })).rejects.toThrow()
  expect((await getStoredCover(t.db, id))?.source).toBe(oldUrl)
  expect(await listCoverHistory(t.db, id)).toEqual([])
})
