import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { setScrapeAdaptersForTest } from './scraper/sources'
import { PgScrapeStore } from './scraper/store'
import {
  ensureSourceThoughtChapter,
  storedSourceChapter,
  syncSourceThoughtStep,
  readSourceThoughtPage,
  runSourceThoughtTick,
  queueNovelSourceThoughts,
} from './source-thought-storage'
import type { SourceThought, SourceThoughtPage } from '@shared/source-thoughts'
import type { SourceParagraph, SourceThoughtContext } from './source-thoughts'

let t: TestDb
const paragraph: SourceParagraph = { index: 17, text: '窗边的雨', count: 2 }
const item = (id: string, replyCount = 0): SourceThought => ({
  id,
  displayName: '读者',
  avatarUrl: '',
  text: '评论',
  createdAt: 1,
  likeCount: 2,
  replyCount,
  images: [],
})
const page = (items: SourceThought[], cursor = '', hasMore = false): SourceThoughtPage => ({ items, total: items.length, cursor, hasMore })
const paragraphs = vi.fn(async () => [paragraph])
const comments = vi.fn(async (_context: SourceThoughtContext, _paragraph: SourceParagraph, _cursor: string) => page([item('100001')]))
const replies = vi.fn(async () => page([item('200001')]))
const install = () =>
  setScrapeAdaptersForTest([
    { id: 'fixture', name: '来源', hosts: ['source.test'], presets: {}, paragraphComments: { enabled: () => true, paragraphs, comments, replies } },
  ])
const snapshot = async () => (await storedSourceChapter(t.db, 'chapter'))!
const read = async (cursor = '', parent = '') => readSourceThoughtPage(t.db, await snapshot(), paragraph, cursor, parent)
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
})
beforeEach(async () => {
  vi.resetAllMocks()
  paragraphs.mockResolvedValue([paragraph])
  comments.mockResolvedValue(page([item('100001')]))
  replies.mockResolvedValue(page([item('200001')]))
  await t.db.query("DELETE FROM scrape_jobs WHERE id='job'")
  await t.db.query("DELETE FROM novels WHERE id='book'")
  await t.db.query("INSERT INTO novels(id,title,source_url,created_at,updated_at) VALUES('book','书','https://source.test/book',1,1)")
  await t.db.query(
    "INSERT INTO chapters(id,novel_id,title,source_url,content,sort_order,created_at) VALUES('chapter','book','章','https://source.test/chapter','窗边的雨',1,1)",
  )
  install()
  await ensureSourceThoughtChapter(t.db, 'chapter')
})
afterAll(async () => {
  setScrapeAdaptersForTest([])
  await t.close()
})
it('正文入库只登记评论任务，不等待来源；重复入库不重建任务', async () => {
  await t.db.query("DELETE FROM chapters WHERE id='chapter'")
  const store = new PgScrapeStore(t.db)
  const chapter = { id: 'chapter', title: '章', content: '窗边的雨', order: 1, wordCount: 4, sourceUrl: 'https://source.test/chapter', createdAt: 1 }
  await store.batchInsertChapters('book', [chapter])
  const initial = await snapshot()
  expect(initial.state).toBe('queued')
  expect(paragraphs).not.toHaveBeenCalled()
  await store.batchInsertChapters('book', [chapter])
  expect((await snapshot()).generation).toBe(initial.generation)
})
it('段评分页和回复均持久化，逐步执行从保存的游标继续', async () => {
  comments.mockResolvedValueOnce(page([item('100001', 1)], '20', true)).mockResolvedValueOnce(page([item('100002')]))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await read()).sync).toMatchObject({ complete: false, savedCount: 1 })
  await syncSourceThoughtStep(t.db, 'chapter')
  expect(comments.mock.calls[1]?.[2]).toBe('20')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await snapshot()).state).toBe('completed')
  expect((await read()).items.map((i) => i.id)).toEqual(['100001', '100002'])
  expect((await read('', '100001')).items[0]?.id).toBe('200001')
})
it('刷新更新已有评论且保留来源当前页未返回的旧评论', async () => {
  comments.mockResolvedValueOnce(page([item('100001'), item('100002')]))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  await t.db.query("UPDATE source_thought_chapters SET checked_at=0 WHERE chapter_id='chapter'")
  await ensureSourceThoughtChapter(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  comments.mockResolvedValueOnce(page([{ ...item('100001'), likeCount: 9 }]))
  await syncSourceThoughtStep(t.db, 'chapter')
  const result = await read()
  expect(result.items).toHaveLength(2)
  expect(result.items[0]?.likeCount).toBe(9)
})
it('失败保留内容及游标，退避期间不重复请求', async () => {
  comments.mockResolvedValueOnce(page([item('100001')], '20', true)).mockRejectedValueOnce(new Error('secret'))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await read()).items).toHaveLength(1)
  expect((await snapshot()).state).toBe('partial')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect(comments).toHaveBeenCalledTimes(2)
  await t.db.query("UPDATE source_thought_chapters SET retry_at=0 WHERE chapter_id='chapter'")
  await syncSourceThoughtStep(t.db, 'chapter')
  expect(comments.mock.calls[2]?.[2]).toBe('20')
})
it('重复游标拒绝提交，不假装已完成', async () => {
  comments.mockResolvedValueOnce(page([item('100001')], '20', true)).mockResolvedValueOnce(page([item('100002')], '20', true))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await read()).items).toHaveLength(1)
  expect((await snapshot()).state).toBe('partial')
})
it('有效租约排除重复请求，过期租约可恢复', async () => {
  await t.db.query("UPDATE source_thought_chapters SET lease_until=$1,lease_token='old' WHERE chapter_id='chapter'", [Date.now() + 60000])
  expect(await syncSourceThoughtStep(t.db, 'chapter')).toBe(false)
  expect(paragraphs).not.toHaveBeenCalled()
  await t.db.query("UPDATE source_thought_chapters SET lease_until=0 WHERE chapter_id='chapter'")
  expect(await syncSourceThoughtStep(t.db, 'chapter')).toBe(true)
})
it('网络等待期间改源，迟到响应不能写回旧书源', async () => {
  paragraphs.mockImplementationOnce(async () => {
    await t.db.query("UPDATE chapters SET source_url='https://source.test/other' WHERE id='chapter'")
    return [paragraph]
  })
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await snapshot()).paragraphs).toBeNull()
  await ensureSourceThoughtChapter(t.db, 'chapter')
  expect((await snapshot()).chapter_url).toBe('https://source.test/other')
})
it('章节删除级联清理持久评论和同步进度', async () => {
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  await t.db.query("DELETE FROM chapters WHERE id='chapter'")
  expect(await storedSourceChapter(t.db, 'chapter')).toBeUndefined()
  expect((await t.db.query('SELECT * FROM source_thought_items')).rows).toHaveLength(0)
})
it('来源暂不可用仍能读已保存内容，恢复能力后继续同步', async () => {
  comments.mockResolvedValueOnce(page([item('100001')], '20', true))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  setScrapeAdaptersForTest([])
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await read()).items).toHaveLength(1)
  expect((await snapshot()).state).toBe('unavailable')
  install()
  await t.db.query("UPDATE source_thought_chapters SET retry_at=0 WHERE chapter_id='chapter'")
  await ensureSourceThoughtChapter(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await snapshot()).state).toBe('completed')
})
it('只处理明确删除标记，不把空页当删除', async () => {
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  await t.db.query("UPDATE source_thought_chapters SET checked_at=0 WHERE chapter_id='chapter'")
  await ensureSourceThoughtChapter(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  comments.mockResolvedValueOnce({ ...page([]), deletedIds: ['100001'] })
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await read()).items).toHaveLength(0)
})
it('正文任务运行时后台评论让出请求额度', async () => {
  await t.db.query("INSERT INTO scrape_jobs(id,novel_id,status,started_at,updated_at) VALUES('job','book','running',1,1)")
  await runSourceThoughtTick(t.db)
  expect(paragraphs).not.toHaveBeenCalled()
  await t.db.query("UPDATE scrape_jobs SET status='completed' WHERE id='job'")
  await runSourceThoughtTick(t.db)
  expect(paragraphs).toHaveBeenCalledTimes(1)
})
it('本地分页稳定且回复不能冒用另一条评论', async () => {
  comments.mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => item(String(100001 + i)))))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  const first = await read()
  expect(first.items).toHaveLength(20)
  expect(first.hasMore).toBe(true)
  expect((await read(first.cursor)).items).toHaveLength(5)
  await expect(read('', '999999')).rejects.toThrow()
})

it('整书更新补登记已有章节且不重复网络拉取', async () => {
  await t.db.query('DELETE FROM source_thought_chapters')
  await queueNovelSourceThoughts(t.db, 'book')
  expect((await snapshot()).state).toBe('queued')
  expect(paragraphs).not.toHaveBeenCalled()
})

it('其它章节入库入口由持久待办登记，正文运行时也不会漏掉评论任务', async () => {
  await t.db.query('DELETE FROM source_thought_chapters')
  await t.db.query("INSERT INTO scrape_jobs(id,novel_id,status,started_at,updated_at) VALUES('job','book','running',1,1)")
  await runSourceThoughtTick(t.db)
  expect((await snapshot()).state).toBe('queued')
  expect(paragraphs).not.toHaveBeenCalled()
  expect((await t.db.query('SELECT * FROM source_thought_enrollments')).rows).toHaveLength(0)
})
it('来源被移除时清理旧来源快照，不继续显示不匹配评论', async () => {
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  await t.db.query("UPDATE chapters SET source_url='' WHERE id='chapter'")
  await runSourceThoughtTick(t.db)
  expect(await storedSourceChapter(t.db, 'chapter')).toBeUndefined()
})
it('旧请求返回前租约被新任务接管，旧响应不落库', async () => {
  paragraphs.mockImplementationOnce(async () => {
    await t.db.query("UPDATE source_thought_chapters SET lease_token='new-owner' WHERE chapter_id='chapter'")
    return [paragraph]
  })
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await snapshot()).paragraphs).toBeNull()
})

it('前页评论隐藏后，持久分页游标仍可读到全部后续条目', async () => {
  comments.mockResolvedValueOnce(page(Array.from({ length: 25 }, (_, i) => item(String(100001 + i)))))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  const first = await read()
  await t.db.query("UPDATE source_thought_items SET hidden=TRUE WHERE id='100001'")
  const next = await read(first.cursor)
  expect(next.items.map((i) => i.id)).toEqual(['100021', '100022', '100023', '100024', '100025'])
})

it('一页中后续条目无效时整页回滚，不留下半页或推进游标', async () => {
  comments.mockResolvedValueOnce(page([item('100001'), item('invalid')]))
  await syncSourceThoughtStep(t.db, 'chapter')
  await syncSourceThoughtStep(t.db, 'chapter')
  expect((await read()).items).toHaveLength(0)
  expect((await snapshot()).state).toBe('partial')
  expect((await t.db.query<{ cursor: string }>('SELECT cursor FROM source_thought_lists')).rows[0]?.cursor).toBe('')
})
