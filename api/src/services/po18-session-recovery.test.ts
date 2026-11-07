import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { fetchHtml } from './scraper/fetch'
import { guardPo18SessionFetch, withPo18Session } from './po18-fetch'
import { createPo18Captcha, getPo18AccountStatus, getPo18Session, loginPo18Account, savePo18Account, testPo18Account } from './source-account'
import { PO18_SESSION_REQUIRED } from './po18-session-policy'
import { enqueueFollowup, finishFollowup, getFollowup, runFollowupTick } from './novel-followup'
import { getDashboardFollowups } from './dashboard-followups'
import { PgScrapeStore } from './scraper/store'
import { runScrapeJob, SCRAPE_CONCURRENCY } from './scraper/engine'

describe('PO18 会话失效、调度阻断与恢复', () => {
  let t: TestDb
  const url = 'https://www.po18.tw/books/123/articles'
  beforeAll(async () => { t = await createTestDb(); await t.applyMigrations() })
  afterAll(async () => { await t.close() })
  beforeEach(async () => {
    await t.db.query('DELETE FROM scrape_jobs')
    await t.db.query('DELETE FROM novels')
    await t.db.query('DELETE FROM source_accounts')
    vi.stubEnv('ALLOW_PRIVATE_FETCH', '1')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    await savePo18Account(t.db, { username: 'fixture', sessionCookie: 'authtoken1=old; authtoken2=old' })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  async function book(id: string, source = url, enabled = true) {
    await t.db.query("INSERT INTO novels(id,title,status,created_at,updated_at) VALUES($1,$1,'ongoing',1,1)", [id])
    await new PgScrapeStore(t.db).upsertScrapeConfig({ novelId: id, sourceUrl: source, selectors: { chapterList: 'a', chapterContent: '.content' } })
    await t.db.query(`INSERT INTO novel_followups(novel_id,enabled,user_configured,next_check_at,result,checked_at) VALUES($1,$2,TRUE,1,'no_change',1)
      ON CONFLICT(novel_id) DO UPDATE SET enabled=$2,user_configured=TRUE,next_check_at=1,result='no_change',checked_at=1`, [id, enabled])
  }

  it('生产同型的退出登录循环只请求第一跳，关闭响应并将账号失效', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
      status: 302, headers: { location: 'https://members.po18.tw/apps/logout.php', 'Set-Cookie': 'authtoken1=; Max-Age=0' },
    })
    const request = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', request)
    const fetch = withPo18Session(t.db, fetchHtml)
    await expect(fetch(url)).rejects.toThrow(PO18_SESSION_REQUIRED)
    await expect(fetch('https://www.po18.tw/books/456/articles')).rejects.toThrow(PO18_SESSION_REQUIRED)
    expect(request).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledOnce()
    expect(await getPo18AccountStatus(t.db)).toMatchObject({ status: 'invalid', hasSession: false, lastError: PO18_SESSION_REQUIRED })
  })

  it('代理请求也保留明确的会话错误类型和文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: '/apps/logout.php' } })))
    await expect(withPo18Session(t.db, fetchHtml)(url, { httpsProxy: 'http://127.0.0.1:7890' })).rejects.toMatchObject({ name: 'Po18SessionExpiredError', message: PO18_SESSION_REQUIRED })
  })

  it('手动账号检测同样识别失效，不会跟随退出登录后误报可用', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://members.po18.tw/apps/logout.php' } }))
    vi.stubGlobal('fetch', request)
    await expect(testPo18Account(t.db, url)).rejects.toThrow(PO18_SESSION_REQUIRED)
    expect(request).toHaveBeenCalledOnce()
    expect(await getPo18AccountStatus(t.db)).toMatchObject({ status: 'invalid', hasSession: false })
  })

  it('HTTP 200 登录表单也失效会话；404 即使附带清 Cookie 仍保留链接错误', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404, headers: { 'Set-Cookie': 'authtoken1=; Max-Age=0' } }))
      .mockResolvedValueOnce(new Response('<form>会员登录<input type="password" name="password"></form>'))
    vi.stubGlobal('fetch', request)
    await expect(withPo18Session(t.db, fetchHtml)(url)).rejects.toThrow('HTTP 404')
    expect((await getPo18AccountStatus(t.db)).hasSession).toBe(true)
    await expect(withPo18Session(t.db, fetchHtml)(url)).rejects.toThrow(PO18_SESSION_REQUIRED)
    expect((await getPo18AccountStatus(t.db)).hasSession).toBe(false)
  })

  it('旧请求的失效响应不能清除刚保存的新会话', async () => {
    let resolve!: (value: Response) => void
    let started!: () => void
    const ready = new Promise<void>(done => { started = done })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { started(); return new Promise<Response>(done => { resolve = done }) }))
    const pending = withPo18Session(t.db, fetchHtml)(url).catch(error => error)
    await ready
    await savePo18Account(t.db, { sessionCookie: 'authtoken1=new; authtoken2=new' })
    resolve(new Response(null, { status: 302, headers: { location: '/apps/logout.php' } }))
    expect(await pending).toMatchObject({ name: 'Po18SessionExpiredError' })
    expect((await getPo18Session(t.db)).cookie).toBe('authtoken1=new; authtoken2=new')
    expect(await getPo18AccountStatus(t.db)).toMatchObject({ status: 'session_saved', hasSession: true })
  })

  it('普通跳转保持可用，额外 CSRF Cookie 不丢失且不会携带过时的重复令牌', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '?page=2' } }))
      .mockResolvedValueOnce(new Response('<p>目录</p>'))
    vi.stubGlobal('fetch', request)
    await expect(withPo18Session(t.db, fetchHtml)(url, { headers: { Cookie: 'authtoken1=stale; csrf=fixture' } })).resolves.toMatchObject({ html: '<p>目录</p>' })
    const sent = new Headers(request.mock.calls[0]![1].headers).get('cookie')!
    expect(sent).toContain('csrf=fixture')
    expect(sent).toContain('authtoken1=old')
    expect(sent).not.toContain('stale')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('失效后不再创建任务，不挤占其他站点；恢复只唤醒已开启的追更', async () => {
    for (const id of ['p1', 'p2', 'p3', 'p4']) await book(id)
    await book('paused', url, false)
    await book('other', 'https://po18.tw.evil.example/book')
    await t.db.query("UPDATE source_accounts SET status='invalid'")
    await expect(enqueueFollowup(t.db, 'p1')).rejects.toThrow(PO18_SESSION_REQUIRED)
    const started: string[] = []
    await runFollowupTick(t.db, id => started.push(id))
    await runFollowupTick(t.db, id => started.push(id))
    expect(started).toHaveLength(1)
    expect((await t.db.query('SELECT novel_id FROM scrape_jobs')).rows).toEqual([{ novel_id: 'other' }])
    const dashboard = await getDashboardFollowups(t.db, Date.now())
    expect(dashboard).toMatchObject({ enabled: 5, waiting: 0, running: 1, attention: 4 })
    expect(dashboard.issues[0]).toMatchObject({ nextCheckAt: 0, blockedReason: PO18_SESSION_REQUIRED })
    expect(dashboard.recent.find(item => item.novelId === 'p1')).toMatchObject({ result: 'no_change' })
    expect(await getFollowup(t.db, 'p1')).toMatchObject({ enabled: true, nextCheckAt: 0, blockedReason: PO18_SESSION_REQUIRED })
    await t.db.query("UPDATE novel_followups SET next_check_at=$1 WHERE novel_id LIKE 'p%'", [Date.now() + 86400000])
    await savePo18Account(t.db, { sessionCookie: 'authtoken1=renewed' })
    await runFollowupTick(t.db, id => started.push(id))
    expect(started).toHaveLength(3)
    expect((await t.db.query("SELECT id FROM scrape_jobs WHERE novel_id='paused'")).rows).toHaveLength(0)
    expect((await getFollowup(t.db, 'paused'))?.enabled).toBe(false)
  })

  it('正式任务保存明确原因并停止安排重试，404 历史在受阻提示中保留', async () => {
    await book('failed')
    const job = await enqueueFollowup(t.db, 'failed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: '/apps/logout.php' } })))
    await runScrapeJob(job.jobId, { store: new PgScrapeStore(t.db), fetchHtml: withPo18Session(t.db, fetchHtml), log: () => {} })
    await finishFollowup(t.db, job.jobId)
    expect((await t.db.query('SELECT result,next_check_at,failures FROM novel_followups WHERE novel_id=$1', ['failed'])).rows[0]).toMatchObject({ result: 'failed', next_check_at: 0, failures: 1 })
    await runFollowupTick(t.db, () => { throw new Error('不应创建新任务') })
    expect((await t.db.query('SELECT id FROM scrape_jobs')).rows).toHaveLength(1)
    await t.db.query("UPDATE novel_followups SET message='HTTP 404 — book missing' WHERE novel_id='failed'")
    expect((await getFollowup(t.db, 'failed'))?.message).toContain('HTTP 404')
    expect((await getDashboardFollowups(t.db, Date.now())).issues[0]!.message).toContain('HTTP 404')
  })

  it('章节中途失效会停止工作队列，保留失效前已取得的章节', async () => {
    await book('midway')
    const job = await enqueueFollowup(t.db, 'midway')
    await t.db.query('UPDATE scrape_jobs SET local_mode=1 WHERE id=$1', [job.jobId])
    const longBody = '这是正常章节内容，足够通过字数校验。'.repeat(20)
    let fetchedChapters = 0
    const requests = vi.fn().mockImplementation(async (target: string) => {
      if (target === url) return new Response(Array.from({ length: 20 }, (_, i) => `<a href="/chapter/${i + 1}">第${i + 1}章</a>`).join(''))
      fetchedChapters++
      return target.endsWith('/1')
        ? new Response(`<h1>第一章</h1><div class="content">${longBody}</div>`)
        : new Response(null, { status: 302, headers: { location: '/apps/logout.php' } })
    })
    vi.stubGlobal('fetch', requests)
    const store = new PgScrapeStore(t.db)
    await runScrapeJob(job.jobId, { store, fetchHtml: withPo18Session(t.db, fetchHtml), log: () => {} })
    expect(fetchedChapters).toBeLessThanOrEqual(SCRAPE_CONCURRENCY)
    expect(await store.loadJob(job.jobId)).toMatchObject({ status: 'partial', chapterCount: 1, error: PO18_SESSION_REQUIRED })
    expect((await t.db.query("SELECT id FROM chapters WHERE novel_id='midway'")).rows).toHaveLength(1)
  })

  it('搜索保留表单刷新后的 Cookie，并拒绝把会话发给其他主机', async () => {
    const session = await getPo18Session(t.db)
    const request = vi.fn().mockResolvedValue(new Response('<p>搜索结果</p>'))
    vi.stubGlobal('fetch', request)
    const fetch = guardPo18SessionFetch(t.db, session, fetchHtml)
    await fetch(url, { headers: { Cookie: 'authtoken1=rotated; csrf=new' } })
    expect(new Headers(request.mock.calls[0]![1].headers).get('cookie')).toBe('authtoken1=rotated; csrf=new')
    await expect(fetch('https://po18.tw.evil.example/')).rejects.toThrow('官方站点')
    expect(request).toHaveBeenCalledOnce()
  })

  it('完成账号登录后恢复已有追更，保留用户主动暂停的作品', async () => {
    await book('login-enabled')
    await book('login-paused', url, false)
    await savePo18Account(t.db, { password: 'fixture-password' })
    await t.db.query('UPDATE novel_followups SET next_check_at=$1', [Date.now() + 86400000])
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('<form action="/apps/login.php" method="post"><input name="account"><input type="password" name="password"></form>'))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://www.po18.tw/', 'Set-Cookie': 'authtoken1=logged-in; Path=/; Domain=.po18.tw' } }))
      .mockResolvedValueOnce(new Response('<p>登入成功</p>'))
    vi.stubGlobal('fetch', request)
    const challenge = await createPo18Captcha()
    expect(await loginPo18Account(t.db, { challengeId: challenge.challengeId })).toMatchObject({ status: 'authenticated', hasSession: true })
    const started: string[] = []
    await runFollowupTick(t.db, id => started.push(id))
    expect(started).toHaveLength(1)
    expect((await t.db.query('SELECT novel_id FROM scrape_jobs')).rows).toEqual([{ novel_id: 'login-enabled' }])
  })

  it('旧任务在新登录之后结束时，下一轮即可用新会话重查', async () => {
    await book('old-job')
    const job = await enqueueFollowup(t.db, 'old-job')
    await savePo18Account(t.db, { sessionCookie: 'authtoken1=renewed' })
    await t.db.query("UPDATE scrape_jobs SET status='failed',error=$2 WHERE id=$1", [job.jobId, PO18_SESSION_REQUIRED])
    await finishFollowup(t.db, job.jobId)
    const started: string[] = []
    await runFollowupTick(t.db, id => started.push(id))
    expect(started).toHaveLength(1)
    expect(started[0]).not.toBe(job.jobId)
  })
})
