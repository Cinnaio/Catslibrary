import { syncSourceThoughtStep } from '../services/source-thought-storage'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { setScrapeAdaptersForTest } from '../services/scraper/sources'
import type { SourceThoughtPage } from '@shared/source-thoughts'
import type { SourceThoughtContext, SourceParagraph } from '../services/source-thoughts'
import { hashParagraphText } from '@shared/thought-anchor'
let t: TestDb
const paragraphs = vi.fn(async () => [{ index: 17, text: '窗边的雨', count: 3 }])
const comments = vi.fn(async (_context: SourceThoughtContext, _paragraph: SourceParagraph, _cursor: string): Promise<SourceThoughtPage> => ({
  items: [],
  total: 0,
  cursor: '',
  hasMore: false,
}))
const replies = vi.fn(async () => ({ items: [], total: 0, cursor: '', hasMore: false }))
const get = (query = '') => app.request('/api/source-thoughts?chapterId=source-chapter' + query)
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test/test')
  vi.stubEnv('COVER_FETCH_ENABLED', '0')
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  await t.db.query("INSERT INTO novels(id,title,author,source_url,created_at,updated_at) VALUES('source-book','测试','作者','https://source.test/book',0,0)")
  await t.db.query(
    "INSERT INTO chapters(id,novel_id,title,content,source_url,sort_order,created_at) VALUES('source-chapter','source-book','章节','窗边的雨','https://source.test/chapter',1,0)",
  )
})
beforeEach(async () => {
  vi.resetAllMocks()
  paragraphs.mockResolvedValue([{ index: 17, text: '窗边的雨', count: 3 }])
  comments.mockResolvedValue({ items: [], total: 0, cursor: '', hasMore: false })
  replies.mockResolvedValue({ items: [], total: 0, cursor: '', hasMore: false })
  await t.db.query('DELETE FROM source_thought_chapters')
  await t.db.query("UPDATE novels SET visibility='public',content_rating='general' WHERE id='source-book'")
  setScrapeAdaptersForTest([
    { id: 'test', name: '来源', hosts: ['source.test'], presets: {}, paragraphComments: { enabled: () => true, paragraphs, comments, replies } },
  ])
})
afterAll(async () => {
  vi.unstubAllEnvs()
  setScrapeAdaptersForTest([])
  setDbForTests(null)
  await t.close()
})
it('通过当前章节确定来源，并返回本站段落哈希', async () => {
  const res = await get()
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('private, no-store')
  expect(await res.json()).toMatchObject({ available: true, paragraphs: [{ paragraphIndex: 0, paragraphHash: hashParagraphText('窗边的雨'), count: 3 }] })
})
it('私有作品在任何上游请求之前拒绝', async () => {
  await t.db.query("UPDATE novels SET visibility='admin' WHERE id='source-book'")
  expect((await get()).status).toBe(404)
  expect(paragraphs).not.toHaveBeenCalled()
})
it('受限作品不能通过来源评论绕过阅读权限', async () => {
  await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id='source-book'")
  expect((await get()).status).toBe(403)
  expect(paragraphs).not.toHaveBeenCalled()
})
it('正文变化后拒绝旧锚点且不获取评论', async () => {
  expect((await get('&action=comments&paragraphIndex=0&paragraphHash=stale')).status).toBe(409)
  expect(comments).not.toHaveBeenCalled()
})
it('来源错误返回可重试状态，不伪装成零条', async () => {
  paragraphs.mockRejectedValueOnce(new Error('upstream secret'))
  const res = await get()
  expect(res.status).toBe(502)
  expect(await res.text()).not.toContain('secret')
})
it('未安装能力可读本站想法并隐藏来源入口', async () => {
  setScrapeAdaptersForTest([])
  const res = await get()
  expect(await res.json()).toMatchObject({ available: false })
})
it('合法段落请求使用来源编号，拒绝非法分页', async () => {
  expect((await get('&action=comments&paragraphIndex=0&paragraphHash=' + hashParagraphText('窗边的雨'))).status).toBe(200)
  expect(comments.mock.calls[0]?.[1]).toMatchObject({ index: 17 })
  expect((await get('&cursor=https://invalid')).status).toBe(400)
})

const savedComment = { id: '123456', displayName: '读者', avatarUrl: '', text: '保存的评论', createdAt: 1, likeCount: 2, replyCount: 1, images: [] }
const commentQuery = '&action=comments&paragraphIndex=0&paragraphHash=' + hashParagraphText('窗边的雨')
it('已保存来源评论在适配器不可用时仍可读取，不再请求上游', async () => {
  comments.mockResolvedValueOnce({ items: [savedComment], total: 1, cursor: '', hasMore: false })
  await get()
  await get(commentQuery)
  const calls = comments.mock.calls.length
  setScrapeAdaptersForTest([])
  const res = await get(commentQuery)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ items: [savedComment] })
  expect(comments).toHaveBeenCalledTimes(calls)
})
it('持久化快照仍受当前作品可见范围限制', async () => {
  comments.mockResolvedValueOnce({ items: [savedComment], total: 1, cursor: '', hasMore: false })
  await get()
  await get(commentQuery)
  await t.db.query("UPDATE novels SET visibility='admin' WHERE id='source-book'")
  expect((await get(commentQuery)).status).toBe(404)
  await t.db.query("UPDATE novels SET visibility='public',content_rating='restricted' WHERE id='source-book'")
  expect((await get(commentQuery)).status).toBe(403)
})
it('未完成的空页返回同步状态，失败不抹掉已有快照', async () => {
  await get()
  comments.mockRejectedValueOnce(new Error('secret'))
  await syncSourceThoughtStep(t.db, 'source-chapter')
  const res = await get(commentQuery)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ items: [], sync: { state: 'partial', complete: false } })
})
it('回复必须属于当前段落已经保存的父评论', async () => {
  await get()
  const res = await get(commentQuery.replace('action=comments', 'action=replies') + '&commentId=999999')
  expect(res.status).toBe(404)
  expect(replies).not.toHaveBeenCalled()
})

it('等待来源期间作品改为私密，不能返回评论统计', async () => {
  paragraphs.mockImplementationOnce(async () => {
    await t.db.query("UPDATE novels SET visibility='admin' WHERE id='source-book'")
    return [{ index: 17, text: '窗边的雨', count: 3 }]
  })
  expect((await get()).status).toBe(404)
})
it('等待评论页期间作品改为受限，不能返回迟到的评论', async () => {
  await get()
  comments.mockImplementationOnce(async () => {
    await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id='source-book'")
    return { items: [savedComment], total: 1, cursor: '', hasMore: false }
  })
  expect((await get(commentQuery)).status).toBe(403)
})
