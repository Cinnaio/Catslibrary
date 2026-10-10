import { afterAll, beforeAll, expect, it } from 'vitest'
import { app } from '../app'
import { createTestDb, type TestDb } from '../test/db'
import { setDbForTests } from '../db/pool'
import { createSession } from '../services/sessions'
import { loadConfig } from '../config'
import { applyReadingData, previewReadingData } from '../services/reading-data'
import type { ReadingDataPreview, ReadingDataResult, LegacyReadingData } from '@shared/reading-data'

let t: TestDb, token: string, userId: string, otherToken: string, otherId: string
const call = (path: string, method = 'GET', body?: unknown, auth = token) =>
  app.request(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
const confirm = (preview: ReadingDataPreview, operationId: string, data?: LegacyReadingData) => ({
  confirmedUserId: preview.userId,
  operationId,
  previewToken: preview.previewToken,
  expiresAt: preview.expiresAt,
  ...(data ? { data } : {}),
})
async function seedLegacy(user: string, suffix: string) {
  // Simulate pre-042 data. Re-enable guards before any API is exercised.
  await t.db.query('ALTER TABLE user_bookmarks DISABLE TRIGGER bookmarks_chapter_guard')
  await t.db.query('ALTER TABLE reading_progress DISABLE TRIGGER reading_progress_chapter_guard')
  try {
    await t.db.query(
      `INSERT INTO user_bookmarks(id,user_id,novel_id,novel_title,chapter_id,chapter_title,chapter_order,note,created_at,updated_at) VALUES
      ($1,$2,'n','陈旧书名','c','旧章名',99,'保留备注',1,1),
      ($3,$2,'n','错配书名','secret-c','隐私旧标题',1,'错配备注',1,1),
      ($4,$2,'gone','已删私密书','missing','私密旧章',1,'孤儿备注',1,1),
      ($5,$2,'secret','受限旧标题','secret-c','受限章节',1,'受限备注',1,1)`,
      [`refresh-${suffix}`, user, `wrong-${suffix}`, `orphan-${suffix}`, `restricted-${suffix}`],
    )
    await t.db.query(
      "INSERT INTO reading_progress(id,user_id,novel_id,chapter_id,scroll_percent,updated_at) VALUES($1,$2,'p','secret-c',0.5,1),($3,$2,'range','range-c',2,1)",
      [`invalid-${suffix}`, user, `range-${suffix}`],
    )
  } finally {
    await t.db.query('ALTER TABLE user_bookmarks ENABLE TRIGGER bookmarks_chapter_guard')
    await t.db.query('ALTER TABLE reading_progress ENABLE TRIGGER reading_progress_chapter_guard')
  }
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const admin = (await (await call('/auth/bootstrap-admin', 'POST', { username: 'reading-admin', password: 'password123' }, '')).json()) as any
  token = admin.token
  userId = admin.user.id
  otherId = 'reading-other'
  await t.db.query("INSERT INTO users(id,username,password_hash,password_salt,role,created_at,updated_at) VALUES($1,$1,'test','test','reader',1,1)", [otherId])
  otherToken = await createSession(t.db, otherId, 'reading-data-test', loadConfig().sessionHashSalt)
  expect(otherToken).toBeTruthy()
  for (const id of ['n', 'p', 'range', 'secret', 'new', 'shelf', 'deleted']) {
    await t.db.query("INSERT INTO novels(id,title,author,content_rating,created_at,updated_at) VALUES($1,$2,'作者',$3,1,1)", [
      id,
      id === 'secret' ? '受限真实书名' : `作品-${id}`,
      id === 'secret' ? 'restricted' : 'general',
    ])
    await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,'正文',3,1)", [
      id === 'n' ? 'c' : `${id}-c`,
      id,
      `${id}-章节`,
    ])
  }
  await seedLegacy(userId, 'a')
  await seedLegacy(otherId, 'b')
})
afterAll(async () => {
  setDbForTests(null)
  await t.close()
  delete process.env.DATABASE_URL
})
it('未登录不能检查、预览或修复，非法载荷与错账号确认不会写入', async () => {
  for (const [path, method] of [
    ['/reading-data/check', 'GET'],
    ['/reading-data/restore/preview', 'POST'],
    ['/reading-data/repair', 'POST'],
  ] as const)
    expect((await call(path, method, {}, '')).status).toBe(401)
  expect((await call('/reading-data/restore/preview', 'POST', { data: { bookmarks: [{}], progress: [], bookshelf: [] } })).status).toBe(400)
  const preview = (await (await call('/reading-data/check?contentMode=safe')).json()) as ReadingDataPreview
  expect((await call('/reading-data/repair?contentMode=safe', 'POST', { ...confirm(preview, 'wrong-account'), confirmedUserId: otherId })).status).toBe(400)
  expect((await t.db.query('SELECT * FROM reading_data_operations')).rows).toHaveLength(0)
})
it('只读预览不写数据，安全模式不回显受限或错配章节标题', async () => {
  const before = (await t.db.query('SELECT * FROM user_bookmarks ORDER BY id')).rows
  const preview = (await (await call('/reading-data/check?contentMode=safe')).json()) as ReadingDataPreview
  expect(preview.items).toHaveLength(5)
  expect(preview.items.map((item) => item.action).sort()).toEqual(['clear', 'normalize', 'refresh', 'remove', 'remove'])
  expect(JSON.stringify(preview)).not.toMatch(/受限真实书名|受限旧标题|secret-章节|隐私旧标题|已删私密书/)
  expect((await t.db.query('SELECT * FROM user_bookmarks ORDER BY id')).rows).toEqual(before)
  expect((await t.db.query('SELECT * FROM reading_data_operations')).rows).toHaveLength(0)
})
it('日常书签与最近阅读隐藏历史错配关系，并读取真实章节名称', async () => {
  const bookmarks = (await (await call('/bookmarks?contentMode=safe')).json()) as any
  expect(bookmarks.bookmarks).toHaveLength(1)
  expect(bookmarks.bookmarks[0]).toMatchObject({ novelTitle: '作品-n', chapterTitle: 'n-章节', chapterOrder: 3, note: '保留备注' })
  expect(((await (await call('/progress?novelId=p')).json()) as any).progress).toBeNull()
  const recent = (await (await call('/progress?recent=1&contentMode=safe')).json()) as any
  expect(recent.progress.some((row: any) => row.novelId === 'p')).toBe(false)
  const shelf = (await (await call('/bookshelf?contentMode=safe')).json()) as any
  expect(shelf.recent.some((row: any) => row.novelId === 'p')).toBe(false)
})
it('预览过期、内容模式变化、预览后备注变化或跨账号令牌均拒绝修复', async () => {
  const preview = (await (await call('/reading-data/check?contentMode=safe')).json()) as ReadingDataPreview
  expect((await call('/reading-data/repair?contentMode=safe', 'POST', { ...confirm(preview, 'expired'), expiresAt: Date.now() - 1 })).status).toBe(409)
  expect((await call('/reading-data/repair', 'POST', confirm(preview, 'mode-change'))).status).toBe(409)
  expect(
    (await call('/reading-data/repair?contentMode=safe', 'POST', { ...confirm(preview, 'cross-user'), confirmedUserId: otherId }, otherToken)).status,
  ).toBe(409)
  await t.db.query("UPDATE user_bookmarks SET note='用户刚刚修改的备注' WHERE id='refresh-a'")
  expect((await call('/reading-data/repair?contentMode=safe', 'POST', confirm(preview, 'stale-note'))).status).toBe(409)
  expect((await t.db.query<{ note: string }>("SELECT note FROM user_bookmarks WHERE id='refresh-a'")).rows[0]).toEqual({ note: '用户刚刚修改的备注' })
})
it('确认后原子修复，进度生成较新墓碑，备注和另一账号均保留，重试返回同一回执', async () => {
  const otherBefore = (await t.db.query('SELECT * FROM user_bookmarks WHERE user_id=$1 ORDER BY id', [otherId])).rows
  const preview = (await (await call('/reading-data/check?contentMode=safe')).json()) as ReadingDataPreview
  const payload = confirm(preview, 'repair-confirmed')
  const response = await call('/reading-data/repair?contentMode=safe', 'POST', payload)
  expect(response.status).toBe(200)
  const result = (await response.json()) as ReadingDataResult
  expect(result.changed).toBe(5)
  expect((await t.db.query("SELECT note,novel_title,chapter_order,updated_at FROM user_bookmarks WHERE id='refresh-a'")).rows[0]).toEqual({
    note: '用户刚刚修改的备注',
    novel_title: '作品-n',
    chapter_order: 3,
    updated_at: 1,
  })
  const cleared = (await t.db.query("SELECT chapter_id,deleted_at,updated_at FROM reading_progress WHERE id='invalid-a'")).rows[0] as any
  expect(cleared.chapter_id).toBe('')
  expect(Number(cleared.deleted_at)).toBeGreaterThan(1)
  expect(cleared.deleted_at).toBe(cleared.updated_at)
  expect(Number((await t.db.query<{ scroll_percent: number }>("SELECT scroll_percent FROM reading_progress WHERE id='range-a'")).rows[0]!.scroll_percent)).toBe(
    1,
  )
  expect((await t.db.query('SELECT * FROM user_bookmarks WHERE user_id=$1 ORDER BY id', [otherId])).rows).toEqual(otherBefore)
  expect(await (await call('/reading-data/repair?contentMode=safe', 'POST', payload)).json()).toEqual(result)
  expect((await t.db.query('SELECT * FROM reading_data_operations WHERE user_id=$1', [userId])).rows).toHaveLength(1)
  expect((await call('/reading-data/repair?contentMode=safe', 'POST', { ...payload, expiresAt: payload.expiresAt + 1 })).status).toBe(409)
  expect(((await (await call('/reading-data/check?contentMode=safe')).json()) as ReadingDataPreview).items).toHaveLength(0)
})
const legacy: LegacyReadingData = {
  bookmarks: [
    { novelId: 'n', chapterId: 'c', note: '不能覆盖已有备注' },
    { novelId: 'new', chapterId: 'new-c', note: '恢复旧备注', timestamp: 5 },
    { novelId: 'secret', chapterId: 'secret-c' },
    { novelId: 'n', chapterId: 'secret-c' },
  ],
  progress: [
    { novelId: 'p', chapterId: 'p-c', scrollPercent: 0.7 },
    { novelId: 'range', chapterId: 'range-c', scrollPercent: 0.2 },
    { novelId: 'new', chapterId: 'new-c', scrollPercent: 0.6, timestamp: 8 },
  ],
  bookshelf: [{ novelId: 'shelf' }, { novelId: 'missing' }],
}
it('旧数据预览逐项显示添加与跳过，恢复不覆盖已有备注、进度或墓碑', async () => {
  const preview = (await (await call('/reading-data/restore/preview?contentMode=safe', 'POST', { data: legacy })).json()) as ReadingDataPreview
  expect(preview.items.filter((item) => item.action === 'restore')).toHaveLength(3)
  expect(JSON.stringify(preview)).not.toContain('受限真实书名')
  const response = await call('/reading-data/restore?contentMode=safe', 'POST', confirm(preview, 'restore-confirmed', legacy))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ changed: 3, skipped: 6 })
  expect((await t.db.query<{ note: string }>("SELECT note FROM user_bookmarks WHERE user_id=$1 AND novel_id='n'", [userId])).rows[0]!.note).toBe(
    '用户刚刚修改的备注',
  )
  expect(
    Number((await t.db.query<{ deleted_at: number }>("SELECT deleted_at FROM reading_progress WHERE id='invalid-a'")).rows[0]!.deleted_at),
  ).toBeGreaterThan(0)
  expect(Number((await t.db.query<{ scroll_percent: number }>("SELECT scroll_percent FROM reading_progress WHERE id='range-a'")).rows[0]!.scroll_percent)).toBe(
    1,
  )
  expect((await t.db.query("SELECT note,novel_title FROM user_bookmarks WHERE user_id=$1 AND novel_id='new'", [userId])).rows[0]).toEqual({
    note: '恢复旧备注',
    novel_title: '作品-new',
  })
  expect(
    Number(
      (await t.db.query<{ scroll_percent: number }>("SELECT scroll_percent FROM reading_progress WHERE user_id=$1 AND novel_id='new'", [userId])).rows[0]!
        .scroll_percent,
    ),
  ).toBeCloseTo(0.6)
  expect((await t.db.query("SELECT * FROM user_bookshelf WHERE user_id=$1 AND novel_id='shelf'", [userId])).rows).toHaveLength(1)
  expect(((await (await call('/reading-data/operations', 'GET', undefined, otherToken)).json()) as any).operations).toEqual([])
  expect(((await (await call('/reading-data/operations')).json()) as any).operations).toHaveLength(2)
})
it('恢复前新增云端记录会使预览失效，整批不写入；记录回执失败也回滚业务变更', async () => {
  const data: LegacyReadingData = { bookmarks: [], progress: [{ novelId: 'deleted', chapterId: 'deleted-c' }], bookshelf: [{ novelId: 'n' }] }
  const preview = await previewReadingData(t.db, userId, false, data)
  await t.db.query("INSERT INTO user_bookshelf(user_id,novel_id,created_at,updated_at) VALUES($1,'n',1,1)", [userId])
  await expect(applyReadingData(t.db, userId, false, { ...confirm(preview, 'cloud-changed', data), data })).rejects.toThrow('数据已变化')
  expect((await t.db.query("SELECT * FROM reading_progress WHERE user_id=$1 AND novel_id='deleted'", [userId])).rows).toHaveLength(0)
  const next = await previewReadingData(t.db, userId, false, data)
  const failing = {
    ...t.db,
    connect: async () => {
      const client = await t.db.connect()
      return {
        ...client,
        query: (async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('INSERT INTO reading_data_operations')) throw new Error('fixture receipt failure')
          return client.query(sql, params)
        }) as typeof client.query,
      }
    },
  }
  await expect(applyReadingData(failing, userId, false, { ...confirm(next, 'receipt-failure', data), data })).rejects.toThrow('fixture receipt failure')
  expect((await t.db.query("SELECT * FROM reading_progress WHERE user_id=$1 AND novel_id='deleted'", [userId])).rows).toHaveLength(0)
})
it('500 条旧书架记录可完整预览，超过上限拒绝且预览不写入', async () => {
  await t.db.query(
    "INSERT INTO novels(id,title,content_rating,created_at,updated_at) SELECT 'bulk-'||i,'批量作品-'||i,'general',1,1 FROM generate_series(1,500) i",
  )
  const data = { bookmarks: [], progress: [], bookshelf: Array.from({ length: 500 }, (_, i) => ({ novelId: `bulk-${i + 1}` })) }
  const response = await call('/reading-data/restore/preview?contentMode=safe', 'POST', { data })
  expect(response.status).toBe(200)
  const preview = (await response.json()) as ReadingDataPreview
  expect(preview.items).toHaveLength(500)
  expect(preview.items.every((item) => item.action === 'restore')).toBe(true)
  expect((await t.db.query("SELECT * FROM user_bookshelf WHERE user_id=$1 AND novel_id LIKE 'bulk-%'", [userId])).rows).toHaveLength(0)
  expect(
    (await call('/reading-data/restore/preview?contentMode=safe', 'POST', { data: { ...data, bookshelf: [...data.bookshelf, { novelId: 'extra' }] } })).status,
  ).toBe(400)
})
