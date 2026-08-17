import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  await t.close()
})

async function req(path: string, init?: RequestInit) {
  return app.request(path, init)
}
async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}
function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

describe('管理 API 端到端（pglite）', () => {
  let adminToken = ''
  let readerToken = ''
  let novelId = ''
  let chapterId = ''
  let thoughtId = ''
  let commentId = ''
  let reportId = ''

  it('准备数据：管理员、读者、小说、章节、评论、想法', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['ADMIN-INVITE', Date.now()])
    const reg = await req('/api/auth/register', json('POST', { username: 'reader', password: 'readerpass1', invite: 'ADMIN-INVITE' }))
    readerToken = (await jsonOf<{ token: string }>(reg)).token

    const created = await req('/api/novels', json('POST', { title: '管理测试书', author: '某作者', categories: ['现言'], sourceUrl: 'https://example.com/book/123/' }, adminToken))
    novelId = (await jsonOf<{ novel: { id: string } }>(created)).novel.id
    const chapter = await req('/api/chapters', json('POST', { novelId, title: '第一章', content: '正文内容' }, adminToken))
    chapterId = (await jsonOf<{ chapter: { id: string } }>(chapter)).chapter.id

    const c = await req('/api/comments', json('POST', { novelId, text: '需要审核的评论' }, readerToken))
    commentId = (await jsonOf<{ comment: { id: string } }>(c)).comment.id
    const th = await req('/api/thoughts', json('POST', { novelId, chapterId, paragraphIndex: 0, paragraphHash: 'h', selectedText: '选中', thoughtText: '一段想法' }, readerToken))
    thoughtId = (await jsonOf<{ thought: { id: string } }>(th)).thought.id
  })

  it('非管理员访问 admin 接口返回 403', async () => {
    const res = await req('/api/admin/stats', json('GET', undefined, readerToken))
    expect(res.status).toBe(403)
  })

  it('content-policy：公开读取，管理员可切换成人内容总开关', async () => {
    const initial = await req('/api/content-policy')
    expect(initial.status).toBe(200)
    expect((await jsonOf<{ adultContentEnabled: boolean }>(initial)).adultContentEnabled).toBe(true)

    const forbidden = await req('/api/admin/content-policy', json('PUT', { adultContentEnabled: false }, readerToken))
    expect(forbidden.status).toBe(403)

    const invalid = await req('/api/admin/content-policy', json('PUT', { adultContentEnabled: 'false' }, adminToken))
    expect(invalid.status).toBe(400)

    const updated = await req('/api/admin/content-policy', json('PUT', { adultContentEnabled: false }, adminToken))
    expect(updated.status).toBe(200)
    expect((await jsonOf<{ adultContentEnabled: boolean }>(updated)).adultContentEnabled).toBe(false)

    const publicAfter = await req('/api/content-policy')
    expect((await jsonOf<{ adultContentEnabled: boolean }>(publicAfter)).adultContentEnabled).toBe(false)

    await req('/api/admin/content-policy', json('PUT', { adultContentEnabled: true }, adminToken))
  })

  it('admin/stats：总数 + 最近任务/小说', async () => {
    const res = await req('/api/admin/stats', json('GET', undefined, adminToken))
    expect(res.status).toBe(200)
    const data = await jsonOf<{ totals: Record<string, number>; jobStatus: Record<string, number>; recentJobs: unknown[]; recentNovels: unknown[] }>(res)
    expect(data.totals.novels).toBeGreaterThanOrEqual(1)
    expect(data.totals.chapters).toBeGreaterThanOrEqual(1)
    expect(data.totals.users).toBeGreaterThanOrEqual(2)
    expect(data.totals.dbSize).toBeGreaterThanOrEqual(0)
    expect(data.recentNovels.length).toBeGreaterThanOrEqual(1)
    expect(data.recentNovels[0]).toMatchObject({ id: novelId, title: '管理测试书' })
  })

  it('admin/novel-index：全量索引 + q 搜索', async () => {
    const all = await req('/api/admin/novel-index', json('GET', undefined, adminToken))
    const data = await jsonOf<{ novels: Array<{ id: string; title: string }>; capped: boolean }>(all)
    expect(data.novels.some((n) => n.id === novelId)).toBe(true)

    const search = await req('/api/admin/novel-index?q=管理测试', json('GET', undefined, adminToken))
    const sdata = await jsonOf<{ novels: Array<{ id: string; title: string }> }>(search)
    expect(sdata.novels.some((n) => n.id === novelId)).toBe(true)
  })

  it('admin/comments：列表过滤 + 状态切换 + 硬删除', async () => {
    const list = await req('/api/admin/comments?status=visible', json('GET', undefined, adminToken))
    const data = await jsonOf<{ comments: Array<{ id: string; novelTitle: string; userDisplayName: string }>; total: number }>(list)
    expect(data.total).toBeGreaterThanOrEqual(1)
    expect(data.comments.some((c) => c.id === commentId && c.novelTitle === '管理测试书')).toBe(true)

    const hide = await req('/api/admin/comments', json('PUT', { id: commentId, status: 'hidden' }, adminToken))
    expect(hide.status).toBe(200)
    const hidden = await req('/api/admin/comments?status=hidden', json('GET', undefined, adminToken))
    expect((await jsonOf<{ total: number }>(hidden)).total).toBeGreaterThanOrEqual(1)

    const del = await req(`/api/admin/comments?id=${commentId}`, json('DELETE', undefined, adminToken))
    expect((await jsonOf<{ success: boolean; deleted: boolean }>(del)).deleted).toBe(true)
  })

  it('admin/comment-reports：列表 + 处理（隐藏并解决）', async () => {
    // 独立评论 + 举报（评论审核测试会硬删掉那条评论，级联清掉举报）
    const c = await req('/api/comments', json('POST', { novelId, text: '被举报的评论' }, readerToken))
    const repCommentId = (await jsonOf<{ comment: { id: string } }>(c)).comment.id
    const rp = await req(`/api/comments/${encodeURIComponent(repCommentId)}/report`, json('POST', { reason: 'spam', note: '垃圾' }, readerToken))
    expect(rp.status).toBe(201)

    const list = await req('/api/admin/comment-reports', json('GET', undefined, adminToken))
    const data = await jsonOf<{ reports: Array<{ id: string; reason: string; commentText: string; novelTitle: string }>; total: number }>(list)
    expect(data.total).toBeGreaterThanOrEqual(1)
    const report = data.reports.find((r) => r.commentText === '被举报的评论')!
    reportId = report.id
    expect(report.reason).toBe('spam')
    expect(report.novelTitle).toBe('管理测试书')

    const done = await req('/api/admin/comment-reports', json('PUT', { id: reportId, status: 'resolved', action: 'hide' }, adminToken))
    expect((await jsonOf<{ status: string }>(done)).status).toBe('resolved')
    const resolved = await req('/api/admin/comment-reports?status=resolved', json('GET', undefined, adminToken))
    expect((await jsonOf<{ total: number }>(resolved)).total).toBeGreaterThanOrEqual(1)
    // action=hide 同步隐藏评论
    const hidden = await req('/api/admin/comments?status=hidden', json('GET', undefined, adminToken))
    expect((await jsonOf<{ total: number }>(hidden)).total).toBeGreaterThanOrEqual(1)
  })

  it('admin-users：概览 + 邀请码 + 注册设置', async () => {
    const overview = await req('/api/admin-users', json('GET', undefined, adminToken))
    const data = await jsonOf<{ settings: { registerMode: string }; schemaHealth: { ok: boolean; missing: string[] }; invites: unknown[]; users: unknown[] }>(overview)
    expect(data.schemaHealth.ok).toBe(true)
    expect(data.users.length).toBeGreaterThanOrEqual(2)

    const created = await req('/api/admin-users', json('POST', { action: 'invite', count: 2 }, adminToken))
    expect(created.status).toBe(201)
    const { codes } = await jsonOf<{ codes: string[] }>(created)
    expect(codes.length).toBe(2)

    await req('/api/admin-users', json('POST', { action: 'settings', registerMode: 'closed' }, adminToken))
    const after = await req('/api/admin-users', json('GET', undefined, adminToken))
    expect((await jsonOf<{ settings: { registerMode: string } }>(after)).settings.registerMode).toBe('closed')
    // 关闭注册后注册失败
    const reg = await req('/api/auth/register', json('POST', { username: 'blocked', password: 'password1' }))
    expect(reg.status).toBe(403)

    await req('/api/admin-users', json('POST', { action: 'disable-invite', code: codes[0] }, adminToken))
    await req('/api/admin-users', json('POST', { action: 'clear-invites' }, adminToken))
  })

  it('admin-users：用户状态/角色/重置密码', async () => {
    const overview = await req('/api/admin-users', json('GET', undefined, adminToken))
    const data = await jsonOf<{ users: Array<{ id: string; username: string; role: string; status: string }> }>(overview)
    const reader = data.users.find((u) => u.username === 'reader')!
    expect(reader).toBeTruthy()

    const disabled = await req('/api/admin-users', json('POST', { action: 'user-status', id: reader.id, status: 'disabled' }, adminToken))
    expect((await jsonOf<{ success: boolean }>(disabled)).success).toBe(true)
    // 禁用后旧 token 失效
    const me = await req('/api/auth/me', json('GET', undefined, readerToken))
    expect(me.status).toBe(401)

    const enabled = await req('/api/admin-users', json('POST', { action: 'user-status', id: reader.id, status: 'active' }, adminToken))
    expect((await jsonOf<{ success: boolean }>(enabled)).success).toBe(true)

    const promoted = await req('/api/admin-users', json('POST', { action: 'user-role', id: reader.id, role: 'admin' }, adminToken))
    expect((await jsonOf<{ role: string }>(promoted)).role).toBe('admin')
    const demoted = await req('/api/admin-users', json('POST', { action: 'user-role', id: reader.id, role: 'reader' }, adminToken))
    expect((await jsonOf<{ role: string }>(demoted)).role).toBe('reader')

    const reset = await req('/api/admin-users', json('POST', { action: 'reset-password', id: reader.id }, adminToken))
    const { tempPassword } = await jsonOf<{ tempPassword: string }>(reset)
    expect(tempPassword).toBeTruthy()
  })

  it('admin-users：不能禁用/删除自己', async () => {
    const overview = await req('/api/admin-users', json('GET', undefined, adminToken))
    const data = await jsonOf<{ users: Array<{ id: string; username: string }> }>(overview)
    const admin = data.users.find((u) => u.username === 'admin')!
    const dis = await req('/api/admin-users', json('POST', { action: 'user-status', id: admin.id, status: 'disabled' }, adminToken))
    expect(dis.status).toBe(400)
    const del = await req('/api/admin-users', json('POST', { action: 'delete-user', id: admin.id, confirmUsername: 'admin' }, adminToken))
    expect(del.status).toBe(400)
  })

  it('admin-users：删除用户需确认用户名，级联清理', async () => {
    const overview = await req('/api/admin-users', json('GET', undefined, adminToken))
    const data = await jsonOf<{ users: Array<{ id: string; username: string }> }>(overview)
    const reader = data.users.find((u) => u.username === 'reader')!
    const wrong = await req('/api/admin-users', json('POST', { action: 'delete-user', id: reader.id, confirmUsername: 'not-reader' }, adminToken))
    expect(wrong.status).toBe(400)
    const ok = await req('/api/admin-users', json('POST', { action: 'delete-user', id: reader.id, confirmUsername: 'reader' }, adminToken))
    expect((await jsonOf<{ success: boolean }>(ok)).success).toBe(true)
    // 级联：想法也被删
    const th = await t.db.query('SELECT id FROM thoughts WHERE id = $1', [thoughtId])
    expect(th.rows.length).toBe(0)
  })

  it('download-logs：创建 + 列表', async () => {
    const created = await req('/api/download-logs', json('POST', { type: 'scrape_configs', targetId: '', targetTitle: '爬虫配置', itemCount: 3 }, adminToken))
    expect(created.status).toBe(201)
    const list = await req('/api/download-logs?limit=10', json('GET', undefined, adminToken))
    const { logs } = await jsonOf<{ logs: Array<{ type: string; targetTitle: string; itemCount: number }> }>(list)
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0]).toMatchObject({ type: 'scrape_configs', targetTitle: '爬虫配置', itemCount: 3 })
  })
})
