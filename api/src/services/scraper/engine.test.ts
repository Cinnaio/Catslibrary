import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PgScrapeStore, type JobData, type ScrapeStore } from './store'
import { runScrapeJob, testSelectors, type ScrapeDeps } from './engine'
import type { FetchHtmlOptions } from './fetch'
import { createTestDb, type TestDb } from '../../test/db'
import { setDbForTests } from '../../db/pool'

// 模拟源站 HTML（czbooks 预设选择器：#chapter-list / .chapter-title / .content）
const LIST_PAGE = `<html><head><meta charset="utf-8"><title>测试小说</title></head><body>
<div id="chapter-list">
  <li><a href="https://site.com/n/1/1?chapterNumber=1">第一章</a></li>
  <li><a href="https://site.com/n/1/2?chapterNumber=2">第二章</a></li>
</div>
</body></html>`

const CHAPTER_TEMPLATE = (title: string, body: string) => `<html><body>
<h1 class="chapter-title">${title}</h1>
<div class="content"><p>${body}</p></div>
</body></html>`

const LONG_BODY =
  '这里是章节正文内容，写得比较长，足够通过内容长度检查，超过五十个字符肯定没有问题。我们继续写下去让这段文字更长更饱满，用来验证抓取入库的完整流程是否正常运作，确保清洗与字数统计都符合预期。'

describe('scraper engine 端到端（pglite + mock fetch）', () => {
  let t: TestDb
  let store: ScrapeStore

  beforeAll(async () => {
    t = await createTestDb()
    await t.applyMigrations()
    setDbForTests(t.db)
    process.env.DATABASE_URL = 'postgres://test/test'
    store = new PgScrapeStore(t.db)
  })

  afterAll(async () => {
    setDbForTests(null)
    delete process.env.DATABASE_URL
    await t.close()
  })

  function makeDeps(): ScrapeDeps & { logs: string[] } {
    const logs: string[] = []
    const fetchHtml = async (url: string) => {
      // 章节目录页（novel URL）返回 LIST_PAGE；章节页（含 chapterNumber）返回章节内容
      if (url.includes('chapterNumber')) {
        return { html: CHAPTER_TEMPLATE(url.includes('chapterNumber=1') ? '第一章' : '第二章', LONG_BODY), encoding: 'utf-8' }
      }
      return { html: LIST_PAGE, encoding: 'utf-8' }
    }
    return {
      store,
      fetchHtml,
      log: (_job, message) => logs.push(message),
      logs,
    }
  }

  it('完整抓取：目录→章节→入库→completed', async () => {
    // 建小说 + 爬虫配置 + 任务
    await t.db.query("INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ('n1', '测试小说', '作者', $1, $1)", [Date.now()])
    await store.upsertScrapeConfig({
      novelId: 'n1',
      sourceUrl: 'https://site.com/book/1/',
      selectors: {
        chapterList: '#chapter-list li a[href*="chapterNumber"]',
        chapterTitle: '.chapter-title',
        chapterContent: '.content',
      },
      encoding: 'utf-8',
    })
    const job: JobData = {
      id: 'job_test1',
      novelId: 'n1',
      status: 'starting',
      progress: 0,
      current: 0,
      total: 0,
      chapterCount: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await store.saveJob(job)

    const deps = makeDeps()
    await runScrapeJob('job_test1', deps)

    const done = await store.loadJob('job_test1')
    expect(done?.status).toBe('completed')
    expect(done?.chapterCount).toBe(2)

    // 章节已入库
    const { rows: chapters } = await t.db.query<{ id: string; title: string; word_count: number }>(
      'SELECT id, title, word_count FROM chapters WHERE novel_id = $1 ORDER BY sort_order',
      ['n1'],
    )
    expect(chapters.length).toBe(2)
    expect(chapters[0]!.title).toBe('第一章')
    expect(chapters[0]!.word_count).toBeGreaterThan(20)

    // 任务项状态
    const summary = await store.getJobSummary('job_test1')
    expect(summary.successCount).toBe(2)
    expect(summary.failedCount).toBe(0)

    // 小说 chapter_count 已更新
    const novel = await t.db.query<{ chapter_count: number }>('SELECT chapter_count FROM novels WHERE id = $1', ['n1'])
    expect(novel.rows[0]!.chapter_count).toBe(2)
  })

  it('目录无链接 → 任务 failed', async () => {
    const badDeps: ScrapeDeps = {
      store,
      fetchHtml: async () => ({ html: '<html><body>empty</body></html>', encoding: 'utf-8' }),
      log: () => {},
    }
    const job: JobData = { id: 'job_fail', novelId: 'n1', status: 'starting', startedAt: Date.now(), updatedAt: Date.now() }
    await store.saveJob(job)
    await runScrapeJob('job_fail', badDeps)
    const done = await store.loadJob('job_fail')
    expect(done?.status).toBe('failed')
  })

  it('增量更新：已有章节被跳过', async () => {
    // 增量任务指向同一小说；第一章 source_url 已存在应跳过
    const job: JobData = {
      id: 'upd_test1',
      novelId: 'n1',
      updateMode: true,
      status: 'starting',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await store.saveJob(job)
    const deps = makeDeps()
    await runScrapeJob('upd_test1', deps)

    const done = await store.loadJob('upd_test1')
    expect(done?.status).toBe('completed')
    // 增量不应插入重复章节：章节数保持 2
    const count = await t.db.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM chapters WHERE novel_id = $1', ['n1'])
    expect(count.rows[0]!.c).toBe(2)
  })

  it('目录分页：通过 nextPage 翻页收集全部章节', async () => {
    // 第一页含 2 章 + 下一页链接；第二页含 2 章（PO18 风格：每页若干章，多页目录）
    const PAGE1 = `<html><body>
<div class="chapters">
  <ul>
    <li><a href="https://site.com/chapter/1.html">第一章</a></li>
    <li><a href="https://site.com/chapter/2.html">第二章</a></li>
  </ul>
</div>
<div class="page"><a href="https://site.com/page/2">下一页</a></div>
</body></html>`
    const PAGE2 = `<html><body>
<div class="chapters">
  <ul>
    <li><a href="https://site.com/chapter/3.html">第三章</a></li>
    <li><a href="https://site.com/chapter/4.html">第四章</a></li>
  </ul>
</div>
<div class="page"><a href="https://site.com/page/1">上一页</a></div>
</body></html>`

    await t.db.query("INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ('n2', '分页小说', '作者', $1, $1)", [Date.now()])
    await store.upsertScrapeConfig({
      novelId: 'n2',
      sourceUrl: 'https://site.com/page/1',
      selectors: {
        chapterList: '.chapters li a',
        chapterTitle: '.chapter-title',
        chapterContent: '.content',
        nextPage: '.page a',
      },
      encoding: 'utf-8',
    })
    const job: JobData = {
      id: 'job_paged',
      novelId: 'n2',
      status: 'starting',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await store.saveJob(job)

    const pagedDeps: ScrapeDeps = {
      store,
      fetchHtml: async (url) => {
        if (url.includes('/page/2')) return { html: PAGE2, encoding: 'utf-8' }
        if (url.includes('.html')) {
          const num = url.match(/chapter\/(\d+)\.html/)?.[1] || 'X'
          return { html: CHAPTER_TEMPLATE(`第${num}章`, LONG_BODY), encoding: 'utf-8' }
        }
        return { html: PAGE1, encoding: 'utf-8' }
      },
      log: () => {},
    }
    await runScrapeJob('job_paged', pagedDeps)

    const done = await store.loadJob('job_paged')
    expect(done?.status).toBe('completed')
    // 两页共 4 章应全部入库，而非只抓第一页 2 章
    const count = await t.db.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM chapters WHERE novel_id = $1', ['n2'])
    expect(count.rows[0]!.c).toBe(4)
  })

  it('POPO 专用目录应提取可读章节并请求 articlescontent 正文', async () => {
    const requests: string[] = []
    let contentOptions: FetchHtmlOptions | undefined
    const popoList = `<html><body><div id="w0">
      <div>
        <div class="l_counter">0001</div>
        <div class="l_chaptname">第一章</div>
        <div class="l_btn"><a href="/books/901935/articles/101">免費閱讀</a></div>
      </div>
    </div></body></html>`
    const popoContent = `<html><body><h1>第一章</h1><div class="article-content"><p>${LONG_BODY}</p></div></body></html>`

    await t.db.query("INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ('n3', 'POPO 测试小说', '作者', $1, $1)", [Date.now()])
    await store.upsertScrapeConfig({
      novelId: 'n3',
      sourceUrl: 'https://www.po18.tw/books/901935/articles',
      selectors: {
        chapterList: '@po18tw:chapter-list',
        chapterTitle: '@po18tw:chapter-title',
        chapterContent: '@po18tw:chapter-content',
      },
      encoding: 'utf-8',
    })
    const job: JobData = {
      id: 'job_popo',
      novelId: 'n3',
      status: 'starting',
      progress: 0,
      current: 0,
      total: 0,
      chapterCount: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await store.saveJob(job)

    const deps: ScrapeDeps = {
      store,
      fetchHtml: async (url, options) => {
        requests.push(url)
        if (url.includes('/articlescontent/')) {
          contentOptions = options
          return { html: popoContent, encoding: 'utf-8' }
        }
        return { html: popoList, encoding: 'utf-8' }
      },
      log: () => {},
    }
    await runScrapeJob('job_popo', deps)

    const done = await store.loadJob('job_popo')
    expect(done?.status).toBe('completed')
    expect(done?.chapterCount).toBe(1)
    expect(requests).toContain('https://www.po18.tw/books/901935/articlescontent/101')
    expect(new Headers(contentOptions?.headers).get('Referer')).toBe('https://www.po18.tw/books/901935/articles/101')
    expect(new Headers(contentOptions?.headers).get('X-Requested-With')).toBe('XMLHttpRequest')
    const chapters = await t.db.query<{ title: string; content: string }>('SELECT title, content FROM chapters WHERE novel_id = $1', ['n3'])
    expect(chapters.rows).toHaveLength(1)
    expect(chapters.rows[0]!.title).toBe('第一章')
    expect(chapters.rows[0]!.content).toContain('章节正文内容')

    const preview = await testSelectors(
      'https://www.po18.tw/books/901935',
      { chapterList: '@po18tw:chapter-list', chapterTitle: '@po18tw:chapter-title', chapterContent: '@po18tw:chapter-content' },
      'utf-8',
      deps,
    )
    expect(preview.totalLinks).toBe(1)
    expect((preview.sampleChapters as Array<{ ok: boolean }>)[0]?.ok).toBe(true)
  })

  it('POPO 正文被重定向到登录页时不得把登录页保存为章节', async () => {
    const popoList = `<html><body><div class="c_l">
      <div class="l_counter">0001</div>
      <div class="l_chaptname">第一章</div>
      <div class="l_btn"><a href="/books/901936/articles/101">免費閱讀</a></div>
    </div></body></html>`
    const loginPage = `<html><head><title>登入</title></head><body>
      <form action="/login" method="post"><input type="password" name="password"></form>
      <p>請先登入後閱讀本章</p>
    </body></html>`

    await t.db.query("INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ('n4', 'POPO 登录测试小说', '作者', $1, $1)", [Date.now()])
    await store.upsertScrapeConfig({
      novelId: 'n4',
      sourceUrl: 'https://www.po18.tw/books/901936/articles',
      selectors: {
        chapterList: '@po18tw:chapter-list',
        chapterTitle: '@po18tw:chapter-title',
        chapterContent: '@po18tw:chapter-content',
      },
      encoding: 'utf-8',
    })
    await store.saveJob({
      id: 'job_popo_login',
      novelId: 'n4',
      status: 'starting',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    })

    const runtimeLogs: string[] = []
    const deps: ScrapeDeps = {
      store,
      fetchHtml: async (url) => ({
        html: url.includes('/articlescontent/') ? loginPage : popoList,
        encoding: 'utf-8',
        finalUrl: url.includes('/articlescontent/') ? 'https://members.po18.tw/apps/login.php' : url,
      }),
      log: (_job, message) => runtimeLogs.push(message),
    }
    await runScrapeJob('job_popo_login', deps)

    const done = await store.loadJob('job_popo_login')
    expect(done?.status).toBe('failed')
    expect(done?.step).toContain('登录页')
    expect(runtimeLogs.some((message) => message.includes('抓取结束：抓取失败') && message.includes('登录页'))).toBe(true)
    expect(runtimeLogs.some((message) => message.includes('抓取完成，成功 0 章'))).toBe(false)
    const summary = await store.getJobSummary('job_popo_login')
    expect(summary.successCount).toBe(0)
    expect(summary.failedCount).toBe(1)
    const chapters = await t.db.query<{ id: string }>('SELECT id FROM chapters WHERE novel_id = $1', ['n4'])
    expect(chapters.rows).toHaveLength(0)
  })
})
