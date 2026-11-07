import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { AI_TASK_LEASE_MS, AI_TASK_OWNER_ID, claimInterruptedCoverPromptTask, createAiTask, failInterruptedAiTasks,
  getAiTask, isAiTaskActive, reclaimStaleAiTasks, touchAiTask, updateAiTask, cancelAiTask } from './tasks'

let t: TestDb
beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
beforeEach(async () => { await t.db.query('DELETE FROM ai_tasks') })
afterAll(async () => { await t.close() })

it('新任务有进程归属，启动与定时回收保留本进程及其它进程的有效租约', async () => {
  const local = await createAiTask(t.db, { userId: 'test', kind: 'continue' })
  const other = await createAiTask(t.db, { userId: 'test', kind: 'cover' })
  await t.db.query('UPDATE ai_tasks SET owner_id=$1,updated_at=1 WHERE id=$2', ['other-process', other.id])
  const row = (await t.db.query<{ owner_id: string; lease_expires_at: string }>('SELECT owner_id,lease_expires_at FROM ai_tasks WHERE id=$1', [local.id])).rows[0]
  expect(row?.owner_id).toBe(AI_TASK_OWNER_ID)
  expect(Number(row?.lease_expires_at)).toBeGreaterThan(Date.now() + AI_TASK_LEASE_MS - 10_000)
  expect(await failInterruptedAiTasks(t.db)).toBe(0)
  expect(await reclaimStaleAiTasks(t.db)).toBe(0)
  expect(await isAiTaskActive(t.db, local.id)).toBe(true)
  expect(await isAiTaskActive(t.db, other.id)).toBe(false)
  expect(await updateAiTask(t.db, other.id, { status: 'completed' })).toBe(false)
  expect(await touchAiTask(t.db, other.id)).toBe(false)
})

it('过期租约无法靠进展或心跳复活，回收后拒绝迟到结果', async () => {
  const task = await createAiTask(t.db, { userId: 'test', kind: 'continue' })
  await t.db.query('UPDATE ai_tasks SET lease_expires_at=1 WHERE id=$1', [task.id])
  expect(await isAiTaskActive(t.db, task.id)).toBe(false)
  expect(await touchAiTask(t.db, task.id)).toBe(false)
  expect(await updateAiTask(t.db, task.id, { status: 'completed', result: '迟到结果' })).toBe(false)
  expect(await reclaimStaleAiTasks(t.db)).toBe(1)
  expect(await updateAiTask(t.db, task.id, { status: 'running' })).toBe(false)
  expect((await getAiTask(t.db, task.id))?.status).toBe('failed')
})

it('转移归属后旧进程不能写进度；管理员取消仍可跨进程生效', async () => {
  const task = await createAiTask(t.db, { userId: 'test', kind: 'cover_prompt' })
  await t.db.query('UPDATE ai_tasks SET owner_id=$1 WHERE id=$2', ['new-owner', task.id])
  expect(await updateAiTask(t.db, task.id, { current: 1, status: 'completed' })).toBe(false)
  expect(await cancelAiTask(t.db, task.id)).toBe(true)
  expect((await getAiTask(t.db, task.id))?.status).toBe('cancelled')
})

it('恢复只领取过期提示词，超过最近 100 条的活动任务仍可被找到且只领取一次', async () => {
  await t.db.query(`INSERT INTO ai_tasks(id,user_id,kind,status,created_at,updated_at)
    SELECT 'done-'||n,'test','cover_prompt','completed',n+10,n+10 FROM generate_series(1,120) n`)
  await t.db.query("INSERT INTO ai_tasks(id,user_id,kind,status,created_at,updated_at) VALUES('old','test','cover_prompt','running',1,1)")
  await createAiTask(t.db, { userId: 'test', kind: 'cover_prompt' })
  expect(await failInterruptedAiTasks(t.db, { excludeKinds: ['cover_prompt'] })).toBe(0)
  const [a, b] = await Promise.all([claimInterruptedCoverPromptTask(t.db), claimInterruptedCoverPromptTask(t.db)])
  expect([a, b].filter(Boolean).map(task => task!.id)).toEqual(['old'])
  expect(await isAiTaskActive(t.db, 'old')).toBe(true)
  expect(await updateAiTask(t.db, 'old', { status: 'completed' })).toBe(true)
})

it('同一进程不重新领取自己过期的提示词，避免旧回调获得新租约', async () => {
  const task = await createAiTask(t.db, { userId: 'test', kind: 'cover_prompt' })
  await t.db.query('UPDATE ai_tasks SET lease_expires_at=1 WHERE id=$1', [task.id])
  expect(await claimInterruptedCoverPromptTask(t.db)).toBeUndefined()
  expect(await reclaimStaleAiTasks(t.db, { excludeKinds: ['cover_prompt'] })).toBe(1)
  expect((await getAiTask(t.db, task.id))?.status).toBe('failed')
})

it('提示词被另一进程再次领取后，旧进程不能重新领取并恢复旧回调权限', async () => {
  await t.db.query("INSERT INTO ai_tasks(id,user_id,kind,status,created_at,updated_at) VALUES('aba','test','cover_prompt','running',1,1)")
  expect((await claimInterruptedCoverPromptTask(t.db))?.id).toBe('aba')
  await t.db.query("UPDATE ai_tasks SET owner_id='newer-process',lease_expires_at=1 WHERE id='aba'")
  expect(await claimInterruptedCoverPromptTask(t.db)).toBeUndefined()
  expect(await updateAiTask(t.db, 'aba', { status: 'completed' })).toBe(false)
})

it('启动只终结无租约的旧写作任务，保留可恢复提示词与已结束任务', async () => {
  await t.db.query(`INSERT INTO ai_tasks(id,user_id,kind,status,created_at,updated_at) VALUES
    ('writing','test','continue','running',1,1),('prompt','test','cover_prompt','queued',1,1),('done','test','continue','completed',1,1)`)
  expect(await failInterruptedAiTasks(t.db, { excludeKinds: ['cover_prompt'] })).toBe(1)
  expect((await getAiTask(t.db, 'done'))?.status).toBe('completed')
  expect((await getAiTask(t.db, 'prompt'))?.status).toBe('queued')
})
