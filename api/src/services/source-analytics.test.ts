import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { getSourceAnalytics } from './source-analytics'
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.query('DELETE FROM novels')
})
async function book(id: string, status = 'ongoing', url = '') {
  await t.db.query('INSERT INTO novels(id,title,author,status,source_url,created_at,updated_at) VALUES($1,$1,$2,$3,$4,1,1)', [id, '作者', status, url])
}
async function config(id: string, url = 'https://www.site.example/book', valid = true) {
  await t.db.query('INSERT INTO scrape_configs(novel_id,source_url,selectors,updated_at) VALUES($1,$2,$3,1)', [
    id,
    url,
    JSON.stringify(valid ? { chapterList: 'a', chapterContent: '.body' } : { chapterList: 'a' }),
  ])
}
async function follow(id: string, enabled: boolean, manual: boolean, result = 'idle', checked = 0) {
  await t.db.query('INSERT INTO novel_followups(novel_id,enabled,user_configured,result,checked_at,next_check_at,failures) VALUES($1,$2,$3,$4,$5,1000,2)', [
    id,
    enabled,
    manual,
    result,
    checked,
  ])
}
async function binding(id: string, key: string, url: string, primary = 1) {
  await t.db.query('INSERT INTO novel_source_bindings(id,novel_id,source_url,is_primary,created_at,updated_at) VALUES($1,$2,$3,$4,1,1)', [
    key,
    id,
    url,
    primary,
  ])
}
it('空库显示零统计和空明细，分页参数有边界', async () => {
  const data = await getSourceAnalytics(t.db, { page: '999', limit: '-1' }, 100)
  expect(data).toMatchObject({ total: 0, withSource: 0, configured: 0, attention: 0, groups: [], books: [], page: 1, totalPages: 1, limit: 1, snapshotAt: 100 })
})
it('主要来源优先抓取配置，每书只计一次；全部来源按每书每站去重', async () => {
  await book('multi', 'ongoing', 'https://original.example/book')
  await config('multi', 'https://www.actual.example/book')
  await binding('multi', 'b1', 'https://www.actual.example/other')
  await binding('multi', 'b2', 'https://canonical.example/book')
  const primary = await getSourceAnalytics(t.db, {})
  expect(primary.groups.map((g) => [g.site, g.total])).toEqual([['actual.example', 1]])
  expect(primary.books[0]).toMatchObject({ sourceCategory: 'configured', site: 'actual.example', sourceUrl: 'https://www.actual.example/book' })
  const all = await getSourceAnalytics(t.db, { view: 'all' })
  expect(all.total).toBe(1)
  expect(all.groups).toHaveLength(3)
  expect(all.groups.every((g) => g.total === 1)).toBe(true)
  expect((await getSourceAnalytics(t.db, { view: 'all', site: 'canonical.example' })).filteredTotal).toBe(1)
  expect((await getSourceAnalytics(t.db, { site: 'canonical.example' })).filteredTotal).toBe(0)
})
it('作品与绑定来源可回退；无效协议、带凭据URL和不完整规则不计为完整配置', async () => {
  await book('linked', 'ongoing', 'https://www.site.example/b')
  await book('bound')
  await binding('bound', 'b', 'https://bound.example/b')
  await book('invalid', 'ongoing', 'javascript:alert(1)')
  await config('invalid', 'https://user:pass@site.example/b')
  await book('incomplete')
  await config('incomplete', 'https://site.example/incomplete', false)
  const data = await getSourceAnalytics(t.db, {})
  expect(data).toMatchObject({ total: 4, withSource: 3, configured: 0 })
  expect(data.books.find((b) => b.id === 'invalid')).toMatchObject({ sourceCategory: 'none', sources: [] })
  expect(data.books.find((b) => b.id === 'bound')).toMatchObject({ sourceCategory: 'link', site: 'bound.example' })
  expect(data.books.find((b) => b.id === 'incomplete')).toMatchObject({ sourceCategory: 'link', followupCategory: 'unconfigured' })
})
it('区分暂停、完结默认关闭、配置不足和可追更未开启，手动开启完结书仍计开启', async () => {
  for (const id of ['enabled', 'paused', 'available', 'unconfigured']) await book(id)
  for (const id of ['completed', 'manual-completed']) await book(id, 'completed')
  for (const id of ['enabled', 'paused', 'available', 'manual-completed']) await config(id)
  await follow('enabled', true, false)
  await follow('paused', false, true)
  await follow('manual-completed', true, true)
  const data = await getSourceAnalytics(t.db, {})
  expect(data.followups).toEqual({ enabled: 2, paused: 1, completed: 1, unconfigured: 1, available: 1 })
  expect(Object.values(data.followups).reduce((a, b) => a + b, 0)).toBe(data.total)
  // 读取统计不会初始化默认追更或覆盖手动选择。
  expect((await t.db.query('SELECT COUNT(*)::int AS count FROM novel_followups')).rows[0]).toEqual({ count: 3 })
})
it('异常覆盖失败、受保护、待补和配置缺失，活跃任务不重复当作异常', async () => {
  for (const id of ['failed', 'protected', 'pending', 'partial', 'missing', 'running']) {
    await book(id)
    await follow(id, true, false, id === 'missing' ? 'idle' : id === 'running' ? 'failed' : id, 100)
    if (id !== 'missing') await config(id)
  }
  await t.db.query("INSERT INTO scrape_jobs(id,novel_id,status,started_at,updated_at) VALUES('active','running','starting',1,1)")
  const data = await getSourceAnalytics(t.db, { followup: 'attention' })
  expect(data.attention).toBe(5)
  expect(data.filteredTotal).toBe(5)
  expect(data.books.some((b) => b.id === 'running')).toBe(false)
  expect((await getSourceAnalytics(t.db, { result: 'running' })).books[0]).toMatchObject({ id: 'running', active: true, result: 'running', attention: false })
})
it('搜索与组合筛选、排序、翻页不截断统计，删除后不存在残留', async () => {
  for (let i = 0; i < 7; i++) {
    await book(`书${i}`)
    await config(`书${i}`)
    await follow(`书${i}`, true, false, 'no_change', i + 1)
  }
  const data = await getSourceAnalytics(t.db, {
    site: 'site.example',
    source: 'configured',
    followup: 'enabled',
    status: 'ongoing',
    search: '作者',
    limit: '2',
    page: '2',
  })
  expect(data).toMatchObject({ total: 7, filteredTotal: 7, page: 2, totalPages: 4 })
  expect(data.books.map((b) => b.id)).toEqual(['书4', '书3'])
  expect(data.groups[0]?.total).toBe(7)
  expect((await getSourceAnalytics(t.db, { search: '书1' })).filteredTotal).toBe(1)
  expect((await getSourceAnalytics(t.db, { limit: '2', page: '999' })).page).toBe(4)
  await t.db.query("DELETE FROM novels WHERE id='书6'")
  expect((await getSourceAnalytics(t.db, {})).total).toBe(6)
})
it('真实章节缺口来自目录与入库对照，无目录快照显示未知', async () => {
  await book('known')
  await book('unknown')
  await t.db.query('UPDATE novels SET source_chapter_snapshot=$1::jsonb WHERE id=$2', [
    JSON.stringify([{ url: 'https://site.example/c1', title: '第一章', order: 1, access: 'protected' }]),
    'known',
  ])
  const data = await getSourceAnalytics(t.db, { sort: 'pending' })
  expect(data.books[0]).toMatchObject({ id: 'known', pending: 1, protected: 1 })
  expect(data.books[1]).toMatchObject({ id: 'unknown', pending: null, protected: null })
})
