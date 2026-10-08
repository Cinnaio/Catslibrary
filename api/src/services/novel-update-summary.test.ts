import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { getPendingChapterCounts, type SourceChapterCandidate } from './novel-update-summary'
import { PgScrapeStore } from './scraper/store'
import { runScrapeJob } from './scraper/engine'
import { enqueueFollowup, finishFollowup, getFollowup } from './novel-followup'

let t: TestDb
let store: PgScrapeStore
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  store = new PgScrapeStore(t.db)
})
afterAll(async () => {
  await t.close()
})
async function novel(id: string) {
  await t.db.query('INSERT INTO novels (id,title,created_at,updated_at) VALUES ($1,$1,1,1)', [id])
}
async function local(id: string, title: string, url: string, order: number) {
  await t.db.query('INSERT INTO chapters (id,novel_id,title,source_url,sort_order,created_at) VALUES ($1,$2,$3,$4,$5,1)', [
    `${id}-${order}`,
    id,
    title,
    url,
    order,
  ])
}
async function counts(id: string) {
  return (await getPendingChapterCounts(t.db, [id])).get(id)
}
it('旧数据只有总数时保护数量保持未知', async () => {
  await novel('legacy')
  await store.saveCheckResult('legacy', 4)
  expect(await counts('legacy')).toMatchObject({ pendingChapterCount: null, pendingProtectedChapterCount: null })
})
it('逐章排除已入库的受保护章节，并在入库后实时减少数量', async () => {
  await novel('mixed')
  const entries: SourceChapterCandidate[] = [
    { url: 'https://example.com/1', title: '一', order: 1, access: 'protected' },
    { url: 'https://example.com/2', title: '二', order: 2, access: 'public' },
    { url: 'https://example.com/book#chapter-3', title: '三', order: 3, access: 'protected' },
    { url: 'https://example.com/book#chapter-4', title: '三', order: 4, access: 'protected' },
  ]
  await local('mixed', '一', entries[0]!.url, 1)
  await local('mixed', '三', 'https://example.com/real-3', 3)
  await store.saveCheckResult('mixed', 4, entries)
  expect(await counts('mixed')).toMatchObject({
    pendingChapterCount: 2,
    pendingProtectedChapterCount: 1,
    pendingPublicChapterCount: 1,
    pendingUnknownChapterCount: 0,
  })
  await local('mixed', '二', entries[1]!.url, 2)
  expect(await counts('mixed')).toMatchObject({ pendingChapterCount: 1, pendingProtectedChapterCount: 1, pendingPublicChapterCount: 0 })
  await store.saveCheckResult('mixed', 5)
  expect(await counts('mixed')).toMatchObject({ pendingProtectedChapterCount: null })
})
it('没有保护状态解析的书源保持未知，不推断可抓取', async () => {
  await novel('unknown')
  await store.saveCheckResult('unknown', 1, [{ url: 'https://example.com/new', title: '新章', order: 1, access: 'unknown' }])
  expect(await counts('unknown')).toMatchObject({
    pendingChapterCount: 1,
    pendingProtectedChapterCount: 0,
    pendingUnknownChapterCount: 1,
    pendingPublicChapterCount: 0,
  })
})
it('目录全为受保护章节时检查成功，权限变化后重新分类并正常入库', async () => {
  await novel('protected-only')
  await store.upsertScrapeConfig({
    novelId: 'protected-only',
    sourceUrl: 'https://www.po18.tw/books/123/articles',
    selectors: { chapterList: '@po18tw:chapter-list', chapterTitle: '@po18tw:chapter-title', chapterContent: '@po18tw:chapter-content' },
  })
  let purchased = false
  const fetches: string[] = []
  const deps = {
    store,
    log: () => {},
    fetchHtml: async (url: string) => {
      fetches.push(url)
      return {
        encoding: 'utf-8',
        html: url.includes('articlescontent')
          ? `<div class="read_chapter"><p>${'这是可以读取的章节正文。'.repeat(15)}</p></div>`
          : `<div class="c_l"><div class="l_counter">1</div><div class="l_chaptname">第一章</div><div class="l_btn"><a href="/books/123/articles/1">${purchased ? '閱讀' : '訂購'}</a></div></div>`,
      }
    },
  }
  const first = await enqueueFollowup(t.db, 'protected-only')
  await runScrapeJob(first.jobId, deps)
  await finishFollowup(t.db, first.jobId)
  expect((await store.loadJob(first.jobId))?.status).toBe('completed')
  expect(await getFollowup(t.db, 'protected-only')).toMatchObject({ result: 'protected', pendingChapterCount: 1, pendingProtectedChapterCount: 1 })
  expect(fetches).toHaveLength(1)
  purchased = true
  const second = await enqueueFollowup(t.db, 'protected-only')
  await runScrapeJob(second.jobId, deps)
  await finishFollowup(t.db, second.jobId)
  expect(await getFollowup(t.db, 'protected-only')).toMatchObject({ result: 'updated', pendingChapterCount: 0, pendingProtectedChapterCount: 0 })
  expect(fetches.some((url) => url.includes('articlescontent'))).toBe(true)
})

it('换源后废弃旧的目录与保护状态', async () => {
  await novel('changed-source')
  await store.upsertScrapeConfig({ novelId: 'changed-source', sourceUrl: 'https://example.com/old', selectors: { chapterList: 'a' } })
  await store.saveCheckResult('changed-source', 1, [{ url: 'https://example.com/locked', title: '旧章', order: 1, access: 'protected' }])
  expect(await counts('changed-source')).toMatchObject({ pendingProtectedChapterCount: 1 })
  await store.upsertScrapeConfig({ novelId: 'changed-source', sourceUrl: 'https://example.com/new', selectors: { chapterList: 'a' } })
  expect(await counts('changed-source')).toMatchObject({ pendingChapterCount: null, pendingProtectedChapterCount: null })
})

it('分页未完整解析时不保存看似完整的目录明细', async () => {
  await novel('incomplete')
  await store.upsertScrapeConfig({
    novelId: 'incomplete',
    sourceUrl: 'https://example.com/book',
    selectors: { chapterList: '.chapters a', chapterContent: '.body', nextPage: '.page a' },
  })
  const job = await enqueueFollowup(t.db, 'incomplete')
  await runScrapeJob(job.jobId, {
    store,
    log: () => {},
    fetchHtml: async (url) => ({
      encoding: 'utf-8',
      html: url.endsWith('/book') ? '<div class="chapters"><a href="/chapter-1">第一章</a></div><div class="page"><a href="/page-2">下一页</a></div>' : '<p>访问受限</p>',
    }),
  })
  expect((await store.loadJob(job.jobId))?.status).toBe('failed')
  expect(await counts('incomplete')).toMatchObject({ pendingChapterCount: null, pendingProtectedChapterCount: null })
})
