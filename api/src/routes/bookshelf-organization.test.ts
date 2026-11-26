import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../middlewares/auth', () => ({ requireUser: () => async (c: any, next: () => Promise<void>) => {
  const id = c.req.header('X-Test-User'); if (!id) return c.json({ error: 'login' }, 401)
  c.set('user', { id, role: 'reader' }); await next()
} }))
vi.mock('../services/content-access', () => ({ contentPolicyHeaders: () => ({ 'Cache-Control': 'private, no-store' }),
  resolveContentAccess: async (c: any) => ({ canViewRestricted: c.req.header('X-Adult') === 'yes' }),
  restrictedContentResponse: (c: any) => c.json({ error: 'restricted' }, 403) }))
import { bookshelfRoutes } from './bookshelf'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
let t: TestDb
function request(path: string, method = 'GET', body?: unknown, user = 'a', adult = false) {
  return bookshelfRoutes.request(path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Test-User': user } : {}), ...(adult ? { 'X-Adult': 'yes' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function group(name = '睡前读', user = 'a') {
  const r = await request('/organization/groups', 'POST', { name }, user); expect(r.status).toBe(200)
  return (await r.json() as { group: { id: string; name: string } }).group
}
const edit = (body: unknown, user = 'a', adult = false) => request('/organization/entries', 'PATCH', body, user, adult)
async function books(query = '', user = 'a') { return await (await request('/?sort=manual' + query, 'GET', undefined, user)).json() as { favorites: Array<{ novelId: string; note: string; pinned: boolean; groupIds: string[]; organizationVersion: number }>; totals: { favorites: number } } }
beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  for (const id of ['a','b']) await t.db.query("INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES($1,$1,'x','x','reader',1,1)",[id])
  for (const id of ['n1','n2','n3','restricted','hidden']) {
    await t.db.query("INSERT INTO novels(id,title,author,created_at,updated_at,content_rating,visibility) VALUES($1,$1,'作者',1,1,$2,$3)", [id,id === 'restricted' ? 'restricted' : 'general',id === 'hidden' ? 'admin' : 'public'])
    await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,'第一章','喜欢的句子',1,1)", [`c-${id}`,id])
  }
  for (const [user, book] of [['a','n1'],['a','restricted'],['a','hidden'],['b','n2']]) {
    await t.db.query("INSERT INTO reading_progress(id,user_id,novel_id,chapter_id,scroll_percent,updated_at) VALUES($1 || ':' || $2,$1,$2,$3,0.5,$4)", [user,book,`c-${book}`,book === 'n1' ? 1 : 2])
    await t.db.query("INSERT INTO thoughts(id,novel_id,chapter_id,paragraph_index,selected_text,thought_text,user_id,created_at,updated_at) VALUES($1,$2,$3,0,'喜欢的句子','心情',$4,1,1)", [`t-${user}-${book}`,book,`c-${book}`,user])
  }
})
afterAll(async () => { setDbForTests(null); await t.close() })
beforeEach(async () => {
  await t.db.query('DELETE FROM bookshelf_groups'); await t.db.query('DELETE FROM user_bookshelf')
  for (const user of ['a','b']) for (const [index,id] of ['n1','n2','n3','restricted','hidden'].entries()) await t.db.query('INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) VALUES($1,$2,1,$3)', [user,id,10-index])
})
it('private groups require login, creation is idempotent and ownership is enforced', async () => {
  expect((await request('/organization/groups','GET',undefined,'')).status).toBe(401)
  const g = await group(); expect(await group()).toEqual(g)
  expect((await (await request('/organization/groups','GET',undefined,'b')).json())).toEqual({ groups: [] })
  expect((await request(`/organization/groups/${g.id}`,'PATCH',{ name:'别人的' },'b')).status).toBe(404)
  expect((await request(`/organization/groups/${g.id}`,'DELETE',undefined,'b')).status).toBe(200)
  expect((await (await request('/organization/groups')).json() as { groups: unknown[] }).groups).toHaveLength(1)
})
it('multiple memberships and notes survive reload; stale forms cannot overwrite newer edits', async () => {
  const a = await group(), b = await group('想二刷')
  expect((await edit({ novelIds:['n1'],note:'重逢写得很好',groupIds:[a.id,b.id],expectedVersion:0 })).status).toBe(200)
  const result = (await books()).favorites.find(b => b.novelId === 'n1')!
  expect(result.note).toBe('重逢写得很好'); expect(result.groupIds.sort()).toEqual([a.id,b.id].sort())
  expect((await edit({ novelIds:['n1'],note:'过期草稿',expectedVersion:0 })).status).toBe(409)
  expect((await books()).favorites.find(b => b.novelId === 'n1')!.note).toBe('重逢写得很好')
  expect((await books('', 'b')).favorites.find(b => b.novelId === 'n1')!.note).toBe('')
  expect((await books('&search=' + encodeURIComponent('重逢'))).favorites.map(b => b.novelId)).toEqual(['n1'])
})
it('bulk changes are atomic and cannot add inaccessible books or foreign groups', async () => {
  const foreign = await group('别人的组','b'), own = await group()
  expect((await edit({ novelIds:['n1','missing'],pinned:true })).status).toBe(404)
  expect((await books()).favorites.every(b => !b.pinned)).toBe(true)
  expect((await edit({ novelIds:['n1'],addGroupIds:[foreign.id] })).status).toBe(409)
  expect((await edit({ novelIds:['hidden'],addGroupIds:[own.id] })).status).toBe(404)
  expect((await edit({ novelIds:['restricted'],pinned:true })).status).toBe(404)
  expect((await edit({ novelIds:['n1','n2'],addGroupIds:[own.id],pinned:true })).status).toBe(200)
  expect((await books(`&groupId=${own.id}`)).totals.favorites).toBe(2)
})
it('group counts and metadata use the same content and visibility filter as the shelf', async () => {
  const g = await group()
  expect((await edit({ novelIds:['n1','restricted'],addGroupIds:[g.id] },'a',true)).status).toBe(200)
  const safe = await request('/organization/groups?contentMode=safe','GET',undefined,'a',true)
  expect(safe.headers.get('cache-control')).toBe('private, no-store')
  expect((await safe.json() as { groups: { count: number }[] }).groups[0]?.count).toBe(1)
  expect((await books(`&groupId=${g.id}`)).favorites.map(b => b.novelId)).toEqual(['n1'])
})
it('manual movement preserves relative order and the pinned partition', async () => {
  expect((await request('/organization/move','POST',{ novelId:'n2',direction:'up' })).status).toBe(200)
  expect((await books()).favorites.map(b => b.novelId)).toEqual(['n2','n1','n3'])
  await edit({ novelIds:['n3'],pinned:true })
  await request('/organization/move','POST',{ novelId:'n3',direction:'down' })
  expect((await books()).favorites[0]?.novelId).toBe('n3')
  const g = await group(); await edit({ novelIds:['n1','n2'],addGroupIds:[g.id] })
  await request('/organization/move','POST',{ novelId:'n1',direction:'up',groupId:g.id })
  expect((await books(`&groupId=${g.id}`)).favorites.map(b => b.novelId)).toEqual(['n1','n2'])
})
it('deleting a group preserves favorites and notes and invalidates open membership editors', async () => {
  const g = await group(); await edit({ novelIds:['n1'],note:'保留',groupIds:[g.id],expectedVersion:0 })
  await request(`/organization/groups/${g.id}`,'DELETE')
  expect((await books()).favorites.find(b => b.novelId === 'n1')).toMatchObject({ note:'保留',groupIds:[],organizationVersion:2 })
  expect((await edit({ novelIds:['n1'],note:'旧稿',expectedVersion:1 })).status).toBe(409)
})
it('invalid inputs do not silently erase organization', async () => {
  for (const body of [{ novelIds:[],pinned:true },{ novelIds:['n1','n1'],pinned:true },{ novelIds:['n1'],note:'无版本' },{ novelIds:['n1'],note:'字'.repeat(501),expectedVersion:0 },{ novelIds:['n1'],groupIds:['x'],addGroupIds:['y'],expectedVersion:0 }]) expect((await edit(body)).status).toBe(400)
  expect((await request('/organization/groups','POST',{ name:' ' })).status).toBe(400)
})
it('widget payloads only contain the owner’s safe, visible books even in adult mode', async () => {
  const response = await request('/widgets','GET',undefined,'a',true)
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
  const data = await response.json() as { reading: { novelId: string }; quotes: { id: string }[] }
  expect(data.reading.novelId).toBe('n1'); expect(data.quotes.map(q => q.id)).toEqual(['t-a-n1'])
  expect((await request('/widgets','GET',undefined,'')).status).toBe(401)
})
it('widget deep links recheck ownership, deletion, and current visibility', async () => {
  expect((await request('/widgets/open?kind=quote&id=t-a-n1')).status).toBe(200)
  expect((await request('/widgets/open?kind=quote&id=t-b-n2')).status).toBe(404)
  expect((await request('/widgets/open?kind=continue&id=restricted','GET',undefined,'a',true)).status).toBe(404)
  await t.db.query("UPDATE thoughts SET status='deleted' WHERE id='t-a-n1'")
  expect((await request('/widgets/open?kind=quote&id=t-a-n1')).status).toBe(404)
  await t.db.query("UPDATE novels SET visibility='admin' WHERE id='n1'")
  expect((await request('/widgets/open?kind=continue&id=n1')).status).toBe(404)
  await t.db.query("UPDATE novels SET visibility='public' WHERE id='n1'")
  await t.db.query("UPDATE thoughts SET status='visible' WHERE id='t-a-n1'")
})
