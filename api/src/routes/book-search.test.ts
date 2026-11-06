import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import type { BookSearchResponse } from '@shared/book-search'

let t: TestDb
const tokens = { admin: 's'.repeat(64), reader: 'r'.repeat(64) }
async function search(novelId: string, q: string, options: { who?: keyof typeof tokens; cursor?: string; mode?: string } = {}) {
  const params = new URLSearchParams({ novelId, q, cursor: options.cursor || '', contentMode: options.mode || 'safe' })
  return app.request(`/api/chapters/search?${params}`, { headers: options.who ? { Authorization: `Bearer ${tokens[options.who]}` } : {} })
}
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test/test'
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  const now = Date.now()
  for (const [id, token] of Object.entries(tokens)) {
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,$2,'unused','unused',$3,$3)", [id, id === 'admin' ? 'admin' : 'reader', now])
    await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,$2,$3,$4,$4)', [await hashToken(token, loadConfig().sessionHashSalt), id, now + 86400000, now])
  }
  for (const id of ['public', 'private', 'restricted', 'long', 'many']) {
    await t.db.query('INSERT INTO novels(id,title,content_rating,visibility,created_at,updated_at) VALUES($1,$1,$2,$3,$4,$4)',
      [id, id === 'restricted' ? 'restricted' : 'general', id === 'private' ? 'selected' : 'public', now])
  }
  await t.db.query("INSERT INTO novel_access_grants(novel_id,user_id,created_at) VALUES('private','reader',$1)", [now])
  await t.db.query(`INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES
    ('html','public','不是标题搜索','<p>海<em>风</em>&amp;光</p><p>&#x732b;Cat</p>',1,$1),
    ('literal','public','标题关键词','字面 %_ * < 5；Cat cat',2,$1),
    ('private-ch','private','私密章节','私密正文',1,$1),
    ('restricted-ch','restricted','受限章节','受限正文',1,$1)`, [now])
  await t.db.query(`INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at)
    SELECT 'long-'||n,'long','章节'||n,CASE WHEN n=201 THEN '尾部命中，尾部命中' ELSE '普通内容' END,n,$1 FROM generate_series(1,205) n`, [now])
  // Tied order values must still have a stable cursor and never lose the 21st result.
  await t.db.query(`INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at)
    SELECT 'many-'||lpad(n::text,3,'0'),'many','章节'||n,'共同关键词',1,$1 FROM generate_series(1,21) n`, [now])
})
afterAll(async () => { setDbForTests(null); delete process.env.DATABASE_URL; await t.close() })

describe('书内正文搜索', () => {
  it('解码 HTML 实体并跨行内标签匹配，不把 HTML 标记或章节标题作为正文', async () => {
    const response = await search('public', '海风&光')
    expect(response.status).toBe(200)
    const result = await response.json() as BookSearchResponse
    expect(result.items.map(hit => hit.chapterId)).toEqual(['html'])
    expect(result.items[0]?.snippet).toBe('海风&光\n猫Cat')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect((await (await search('public', '标题关键词')).json() as BookSearchResponse).items).toEqual([])
    expect((await (await search('public', '<em>')).json() as BookSearchResponse).items).toEqual([])
    const plain = await app.request('/api/chapters/html?format=text')
    expect((await plain.json() as { chapter: { content: string } }).chapter.content).toBe('海风&光\n猫Cat')
    const original = await app.request('/api/chapters/html')
    expect((await original.json() as { chapter: { content: string } }).chapter.content).toContain('<em>风</em>')
  })
  it('忽略英文字母大小写，百分号下划线保持字面含义', async () => {
    const result = await (await search('public', 'CAT')).json() as BookSearchResponse
    expect(result.items.map(hit => hit.matchCount)).toEqual([1, 2])
    expect((await (await search('public', '%_')).json() as BookSearchResponse).items.map(hit => hit.chapterId)).toEqual(['literal'])
  })
  it('私密作品不可通过搜索泄露，已授权账号可检索', async () => {
    const hidden = await search('private', '私密')
    const missing = await search('missing', '私密')
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual(await missing.json())
    expect((await search('private', '私密', { who: 'reader' })).status).toBe(200)
  })
  it('限制级作品遵守访问门禁，管理员安全模式同样不返回片段', async () => {
    expect((await search('restricted', '受限', { mode: 'adult' })).status).toBe(403)
    expect((await search('restricted', '受限', { who: 'admin', mode: 'safe' })).status).toBe(403)
    expect((await search('restricted', '受限', { who: 'admin', mode: 'adult' })).status).toBe(200)
  })
  it('大书分批检索，无命中也返回继续游标而非假装已搜索整书', async () => {
    const first = await (await search('long', '尾部命中')).json() as BookSearchResponse
    expect(first.scanned).toBe(200); expect(first.items).toEqual([]); expect(first.nextCursor).toBeTruthy()
    const next = await (await search('long', '尾部命中', { cursor: first.nextCursor! })).json() as BookSearchResponse
    expect(next.items[0]).toMatchObject({ chapterId: 'long-201', matchCount: 2 })
    expect(next.nextCursor).toBeNull(); expect(next.scanned).toBe(5)
  })
  it('相同章节序号下分页仍不重不漏', async () => {
    const first = await (await search('many', '共同')).json() as BookSearchResponse
    expect(first.items).toHaveLength(20)
    const next = await (await search('many', '共同', { cursor: first.nextCursor! })).json() as BookSearchResponse
    expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull()
    expect(new Set([...first.items, ...next.items].map(hit => hit.chapterId)).size).toBe(21)
  })
  it('拒绝空关键词、过长关键词和无效游标', async () => {
    expect((await search('public', '')).status).toBe(400)
    expect((await search('public', '猫'.repeat(81))).status).toBe(400)
    expect((await search('public', '猫', { cursor: 'not-json' })).status).toBe(400)
  })
})
