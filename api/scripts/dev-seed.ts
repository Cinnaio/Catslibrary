/**
 * 临时开发种子服务器 —— 用 pglite（WASM PG）起一个可用的 API，用于浏览器冒烟。
 * 用法：npx tsx scripts/dev-seed.ts （仅本机开发验证用，不入库）。
 */
import { serve } from '@hono/node-server'
import { setDbForTests } from '../src/db/pool'
import { createTestDb } from '../src/test/db'

async function main() {
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'

  const t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)

  // 延迟到 setDbForTests 之后导入 app（config 在导入时读取 env）
  const { app } = await import('../src/app')

  // 种子：管理员 + 一本小说 + 两章 + 一条评论
  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const boot = await app.request('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
  const { token } = (await boot.json()) as { token: string }

  const novel = await app.request('/api/novels', { ...json('POST', { title: '知舟冒烟书', author: '测试作者', categories: ['现言', '古言'], status: 'ongoing' }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
  const { novel: n } = (await novel.json()) as { novel: { id: string } }
  await app.request('/api/chapters', { ...json('POST', { novelId: n.id, title: '第一章 初见', content: '正文内容一', order: 1 }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
  await app.request('/api/chapters', { ...json('POST', { novelId: n.id, title: '第二章 转折', content: '正文内容二', order: 2 }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })

  await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['SMOKE-INVITE', Date.now()])
  const reg = await app.request('/api/auth/register', json('POST', { username: 'reader', password: 'readerpass1', invite: 'SMOKE-INVITE' }))
  const { token: readerToken } = (await reg.json()) as { token: string }
  const comment = await app.request('/api/comments', { ...json('POST', { novelId: n.id, text: '这是一条待审核的评论' }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` } })
  const { comment: c } = (await comment.json()) as { comment: { id: string } }
  await app.request(`/api/comments/${c.id}/report`, { ...json('POST', { reason: 'spam', note: '冒烟举报' }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readerToken}` } })

  console.log('[seed] admin=admin/adminpass123 reader=reader/readerpass1 novel=', n.id)
  console.log('[seed] admin token:', token.slice(0, 12) + '…')

  serve({ fetch: app.fetch, port: 8787 }, () => {
    console.log('[seed] API ready on http://127.0.0.1:8787')
  })
}

main().catch((err) => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
