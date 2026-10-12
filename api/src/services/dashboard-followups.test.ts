import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { getDashboardFollowups } from './dashboard-followups'
let t: TestDb
const now = 1800000000000
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
async function book(
  id: string,
  overrides: { enabled?: boolean; status?: string; configured?: boolean; next?: number; result?: string; checked?: number } = {},
) {
  await t.db.query('INSERT INTO novels (id,title,status,created_at,updated_at) VALUES ($1,$1,$2,$3,$3)', [id, overrides.status || 'ongoing', now])
  await t.db.query(
    `INSERT INTO novel_followups (novel_id,enabled,user_configured,next_check_at,result,checked_at,added_count)
    VALUES ($1,$2,$3,$4,$5,$6,3)`,
    [id, overrides.enabled ?? true, overrides.configured ?? false, overrides.next ?? now - 1, overrides.result || 'idle', overrides.checked ?? 0],
  )
}
it('空书库的追更概况明确为零', async () => {
  expect(await getDashboardFollowups(t.db, now)).toEqual({ enabled: 0, waiting: 0, running: 0, attention: 0, scheduled: [], issues: [], recent: [] })
})
it('按真实调度资格计数，暂停及非手动完结书不进入安排，活跃任务不重复计入待调度或异常', async () => {
  await book('due')
  await book('later', { next: now + 1000 })
  await book('paused', { enabled: false, result: 'failed' })
  await book('finished', { status: 'completed' })
  await book('manual-finished', { status: 'completed', configured: true })
  await book('running', { result: 'failed' })
  await t.db.query("INSERT INTO scrape_jobs (id,novel_id,status,started_at,updated_at) VALUES ('job','running','starting',$1,$1)", [now])
  const summary = await getDashboardFollowups(t.db, now)
  expect(summary).toMatchObject({ enabled: 4, waiting: 2, running: 1, attention: 0 })
  expect(summary.scheduled.map((b) => b.novelId)).toEqual(['running', 'due', 'manual-finished', 'later'])
  expect(summary.scheduled[0]).toMatchObject({ result: 'running', enabled: true })
})
it('待补及受保护章节与检查失败分别保留结果，最近结果包含暂停书且不会读取时修改设置', async () => {
  for (const result of ['failed', 'partial', 'pending', 'protected']) await book(result, { result, checked: now - 10 })
  await book('paused', { enabled: false, result: 'updated', checked: now })
  await book('healthy', { result: 'no_change', checked: now - 20 })
  const summary = await getDashboardFollowups(t.db, now)
  expect(summary.attention).toBe(4)
  expect(new Set(summary.issues.map((b) => b.result))).toEqual(new Set(['failed', 'partial', 'pending', 'protected']))
  expect(summary.recent[0]).toMatchObject({ novelId: 'paused', enabled: false, nextCheckAt: 0, result: 'updated', addedCount: 3 })
  const rows = await t.db.query('SELECT enabled,next_check_at FROM novel_followups WHERE novel_id=$1', ['paused'])
  expect(rows.rows[0]).toMatchObject({ enabled: false, next_check_at: now - 1 })
})
it('列表限制六本，统计覆盖所有书籍且删除书籍后不留下记录', async () => {
  for (let i = 0; i < 8; i++) await book(`n${i}`, { result: 'failed', checked: now - i, next: now + i })
  const summary = await getDashboardFollowups(t.db, now)
  expect(summary).toMatchObject({ enabled: 8, attention: 8, waiting: 1 })
  expect(summary.issues).toHaveLength(6)
  expect(summary.scheduled).toHaveLength(6)
  expect(summary.recent).toHaveLength(6)
  await t.db.query("DELETE FROM novels WHERE id='n0'")
  const after = await getDashboardFollowups(t.db, now)
  expect(after.enabled).toBe(7)
  expect(after.issues.some((b) => b.novelId === 'n0')).toBe(false)
})
