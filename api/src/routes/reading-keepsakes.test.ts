import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import type { KeepsakeContext, KeepsakeInput, KeepsakePage, ReadingKeepsake } from '@shared/reading-keepsakes'

let t: TestDb, token = '', other = '', ownerId = '', otherId = '', novelId = '', chapterId = '', momentId = '', seq = 0
const json = (body: unknown, auth = token) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) })
const base = () => `/api/reading-keepsakes/${novelId}`
const input = (values: Partial<KeepsakeInput> = {}): KeepsakeInput => ({ id: `keepsake-${seq}`, previousId: null, momentIds: [momentId], closing: '告别也是另一种陪伴。', ...values })
const get = (suffix = '', auth = token) => app.request(base() + suffix, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
const save = (body: unknown = input(), auth = token, query = '') => app.request(base() + query, json(body, auth))
const remove = (id: string, auth = token) => app.request(`${base()}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth}` } })

beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test'); vi.stubEnv('COVER_FETCH_ENABLED', '0')
  await app.request('/api/auth/bootstrap-admin', json({ username: 'keepsake-admin', password: 'adminpass123' }, ''))
  for (const name of ['keepsake-owner', 'keepsake-other']) {
    await t.db.query('INSERT INTO invites(code,created_at) VALUES($1,$2)', [name, Date.now()])
    const r = await app.request('/api/auth/register', json({ username: name, password: 'readerpass123', invite: name }, ''))
    expect(r.status).toBe(201)
    const data = await r.json() as { token: string; user: { id: string } }
    if (name.endsWith('owner')) { token = data.token; ownerId = data.user.id }
    else { other = data.token; otherId = data.user.id }
  }
})
afterAll(async () => { vi.unstubAllEnvs(); setDbForTests(null); await t.close() })
beforeEach(async () => {
  novelId = `keepsake-book-${++seq}`; chapterId = `${novelId}-chapter`; momentId = `${novelId}-thought`
  await t.db.query('INSERT INTO novels(id,title,author,created_at,updated_at) VALUES($1,$2,$3,0,0)', [novelId, '雨天的约定', '某位作者'])
  await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,1,0)', [chapterId, novelId, '归来', '把银铃留在窗边。'])
  await t.db.query(`INSERT INTO thoughts(id,novel_id,chapter_id,paragraph_index,selected_text,thought_text,user_id,created_at,updated_at)
    VALUES($1,$2,$3,0,'把银铃留在窗边。','原来他一直记得。',$4,1,1)`, [momentId, novelId, chapterId, ownerId])
})

it('只返回本人的想法，无历史事实时不捏造开始日期', async () => {
  const r = await get('/context'); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store')
  const context = await r.json() as KeepsakeContext
  expect(context).toMatchObject({ latestId: null, startedAt: null, candidatesLimited: false })
  expect(context.candidates.map(m => m.id)).toEqual([momentId])
  expect((await (await get('/context', other)).json() as KeepsakeContext).candidates).toEqual([])
  expect((await save(input(), other)).status).toBe(409)
})

it('保存文字快照，后续修改原笔记和书名不改变已存内容', async () => {
  const r = await save(); expect(r.status).toBe(200)
  const { item } = await r.json() as { item: ReadingKeepsake }
  await t.db.query("UPDATE thoughts SET thought_text='新的感受',selected_text='新句子' WHERE id=$1", [momentId])
  await t.db.query("UPDATE novels SET title='新的书名' WHERE id=$1", [novelId])
  const page = await (await get()).json() as KeepsakePage
  expect(page.items[0]).toEqual(item)
  expect(item.moments[0]?.thoughtText).toBe('原来他一直记得。')
  expect(item.title).toBe('雨天的约定')
})

it('同一保存请求重试不重复创建，即使原想法已删除也返回原回执', async () => {
  const original = await (await save()).json()
  await t.db.query('DELETE FROM thoughts WHERE id=$1', [momentId])
  expect(await (await save()).json()).toEqual(original)
  expect((await (await get()).json() as KeepsakePage).items).toHaveLength(1)
  expect((await save(input({ closing: '换一句话' }))).status).toBe(409)
})

it('旧草稿不能覆盖另一个设备刚保存的页；明确再留一页才能新建', async () => {
  await save()
  expect((await save(input({ id: 'another-card' }))).status).toBe(409)
  expect((await save(input({ id: 'another-card', previousId: input().id }))).status).toBe(200)
  expect((await (await get()).json() as KeepsakePage).items).toHaveLength(2)
})

it('再次留页只使用上一张之后的真实阅读起点', async () => {
  const start = Date.now() - 100_000
  await t.db.query(`INSERT INTO reading_stat_events(user_id,id,session_id,novel_id,chapter_id,started_at,ended_at,created_at)
    VALUES($1,'first-read','session',$2,$3,$4,$5,$5)`, [ownerId, novelId, chapterId, start, start + 30_000])
  const { item } = await (await save()).json() as { item: ReadingKeepsake }
  expect(item.startedAt).toBe(start)
  expect((await (await get('/context')).json() as KeepsakeContext).startedAt).toBeNull()
  const secondStart = item.savedAt + 1
  await t.db.query(`INSERT INTO reading_stat_events(user_id,id,session_id,novel_id,chapter_id,started_at,ended_at,created_at)
    VALUES($1,'second-read','session2',$2,$3,$4,$5,$5)`, [ownerId, novelId, chapterId, secondStart, secondStart + 1])
  const context = await (await get('/context')).json() as KeepsakeContext
  expect(context.startedAt).toBe(secondStart)
})

it('匿名、其他账号、隐藏作品和限制模式均不能读取快照或借重试绕过权限', async () => {
  expect((await get('', '')).status).toBe(401)
  await save()
  expect((await (await get('', other)).json() as KeepsakePage).items).toEqual([])
  await remove(input().id, other)
  expect((await (await get()).json() as KeepsakePage).items).toHaveLength(1)
  await t.db.query("UPDATE novels SET visibility='admin' WHERE id=$1", [novelId])
  for (const suffix of ['', '/context']) expect((await get(suffix)).status).toBe(404)
  expect((await save()).status).toBe(404)
  expect((await remove(input().id)).status).toBe(404)
  await t.db.query("UPDATE novels SET visibility='public',content_rating='restricted' WHERE id=$1", [novelId])
  expect((await get()).status).toBe(403)
  expect((await save()).status).toBe(403)
  await t.db.query("UPDATE users SET role='admin' WHERE id=$1", [ownerId])
  expect((await get('?contentMode=adult')).status).toBe(200)
  expect((await get('?contentMode=safe')).status).toBe(403)
  expect((await save(input(), token, '?contentMode=safe')).status).toBe(403)
  await t.db.query("UPDATE users SET role='reader' WHERE id=$1", [ownerId])
})

it('拒绝过长、空白、重复选项和跨书想法，允许只写寄语', async () => {
  for (const body of [null, {}, input({ closing: '字'.repeat(281) }), input({ momentIds: [], closing: ' ' }),
    input({ momentIds: [momentId, momentId] }), input({ momentIds: ['a', 'b', 'c', 'd'] })]) {
    expect((await save(body)).status).toBe(422)
  }
  await t.db.query('UPDATE thoughts SET user_id=$1 WHERE id=$2', [otherId, momentId])
  expect((await save()).status).toBe(409)
  expect((await save(input({ momentIds: [] }))).status).toBe(200)
})

it('历史分页无重叠，删除只影响指定的私人留念页', async () => {
  let previousId: string | null = null
  for (let i = 0; i < 12; i++) {
    const body = input({ id: `history-${seq}-${i}`, previousId })
    expect((await save(body)).status).toBe(200); previousId = body.id
  }
  const page = await (await get()).json() as KeepsakePage
  expect(page.items).toHaveLength(10); expect(page.nextCursor).not.toBeNull()
  const second = await (await get(`?before=${encodeURIComponent(page.nextCursor!)}`)).json() as KeepsakePage
  expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull()
  expect(new Set([...page.items, ...second.items].map(i => i.id)).size).toBe(12)
  await remove(previousId!)
  expect((await (await get()).json() as KeepsakePage).items.some(i => i.id === previousId)).toBe(false)
  expect((await t.db.query('SELECT id FROM thoughts WHERE id=$1', [momentId])).rows).toHaveLength(1)
})


it('删除会抹掉快照，延迟的旧保存请求不能让已删内容复活', async () => {
  const body = input()
  await save(body); await remove(body.id)
  expect((await save(body)).status).toBe(410)
  expect((await (await get()).json() as KeepsakePage).items).toEqual([])
  const row = (await t.db.query<{ snapshot: unknown; deleted_at: number }>('SELECT snapshot,deleted_at FROM reading_keepsakes WHERE user_id=$1 AND id=$2', [ownerId, body.id])).rows[0]!
  expect(row.snapshot).toBeNull(); expect(row.deleted_at).toBeGreaterThan(0)
  expect((await save(input({ id: 'fresh-after-delete' }))).status).toBe(200)
})

it('并发重复提交共享同一保存回执', async () => {
  const replies = await Promise.all([save(), save()])
  expect(replies.map(r => r.status)).toEqual([200, 200])
  expect(await replies[0]!.json()).toEqual(await replies[1]!.json())
  expect((await (await get()).json() as KeepsakePage).items).toHaveLength(1)
})


it('隐藏和跨书想法不能加入快照', async () => {
  await t.db.query("UPDATE thoughts SET status='hidden' WHERE id=$1", [momentId])
  expect((await (await get('/context')).json() as KeepsakeContext).candidates).toEqual([])
  expect((await save()).status).toBe(409)
  const otherBook = `${novelId}-other`
  await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$2,0,0)', [otherBook, '另一本书'])
  await t.db.query("UPDATE thoughts SET status='visible',novel_id=$1 WHERE id=$2", [otherBook, momentId])
  expect((await save()).status).toBe(409)
})

it('删除账号会级联移除留念文字与保存标识', async () => {
  await t.db.query('UPDATE thoughts SET user_id=$1 WHERE id=$2', [otherId, momentId])
  expect((await save(input(), other)).status).toBe(200)
  await t.db.query('DELETE FROM users WHERE id=$1', [otherId])
  expect((await t.db.query('SELECT id FROM reading_keepsakes WHERE user_id=$1', [otherId])).rows).toEqual([])
})
