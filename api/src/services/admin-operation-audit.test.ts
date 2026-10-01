import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { listAdminOperationAudit } from './admin-operation-audit'
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await t.db.query('CREATE TABLE users (id text PRIMARY KEY, username text, display_name text, updated_at bigint)')
  await t.db.query(
    `CREATE TABLE admin_operation_audit (id text PRIMARY KEY, operation_id text, scope text, actor_user_id text, action text, target_count int, request_hash text, status text, response_status int, replay_count int, error text, created_at bigint, updated_at bigint, finished_at bigint)`,
  )
  await t.db.query(`INSERT INTO users VALUES ('u1','Admin_One','管理甲',123),('u2','admin-two','管理乙',0),('u3','percent%admin','管理丙',0)`)
  for (const [id, user, status] of [
    ['a', 'u1', 'completed'],
    ['b', 'u1', 'failed'],
    ['c', 'u2', 'completed'],
    ['d', 'u3', 'completed'],
    ['e', 'removed', 'completed'],
  ])
    await t.db.query(`INSERT INTO admin_operation_audit VALUES ($1,$1,'test',$2,'set-password',1,'hash',$3,200,0,'',100,100,100)`, [id, user, status])
}, 30000)
afterAll(async () => {
  await t.close()
})
describe('操作审计服务端用户名筛选', () => {
  it('全量筛选与分页总数一致，并同时组合结果筛选', async () => {
    const result = await listAdminOperationAudit(t.db, { username: 'ADMIN_ONE', limit: 1, offset: 0 })
    expect(result.total).toBe(2)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe('b')
    expect(result.rows[0]?.current_actor_id).toBe('u1')
    expect(Number(result.rows[0]?.actor_updated_at)).toBe(123)
    const next = await listAdminOperationAudit(t.db, { username: 'admin_one', limit: 1, offset: 1 })
    expect(next.total).toBe(2)
    expect(next.rows[0]?.id).toBe('a')
    const success = await listAdminOperationAudit(t.db, { username: 'admin_one', status: 'completed', limit: 15, offset: 0 })
    expect(success.total).toBe(1)
    expect(success.rows[0]?.id).toBe('a')
  })
  it('通配符与 SQL 字符串按字面匹配，空搜索保留已删除操作人的记录', async () => {
    expect((await listAdminOperationAudit(t.db, { username: '%', limit: 15, offset: 0 })).total).toBe(1)
    expect((await listAdminOperationAudit(t.db, { username: "' OR 1=1 --", limit: 15, offset: 0 })).total).toBe(0)
    const all = await listAdminOperationAudit(t.db, { username: ' ', limit: 15, offset: 0 })
    expect(all.total).toBe(5)
    expect(all.rows.some((row) => row.id === 'e')).toBe(true)
  })
})
