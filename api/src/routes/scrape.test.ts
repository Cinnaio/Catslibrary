import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('scrape 路由（免网络动作）', () => {
  let adminToken = ''

  it('bootstrap 管理员（爬虫动作均为 admin-only）', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
    adminToken = (await jsonOf<{ token: string }>(boot)).token
  })

  it('detect：静态预设命中 czbooks，未命中返回 false', async () => {
    const hit = await req('/api/scrape', json('POST', { action: 'detect', sourceUrl: 'https://www.czbooks.net/n/123/' }, adminToken))
    expect(hit.status).toBe(200)
    const hitData = await jsonOf<{ detected: boolean; source: string; preset: { name: string } }>(hit)
    expect(hitData.detected).toBe(true)
    expect(hitData.source).toBe('preset')
    expect(hitData.preset.name).toBe('小說狂人')

    const miss = await req('/api/scrape', json('POST', { action: 'detect', sourceUrl: 'https://unknown-site.example.com/book/1' }, adminToken))
    const missData = await jsonOf<{ detected: boolean }>(miss)
    expect(missData.detected).toBe(false)
  })

  it('PO18 账号只回传状态，不回传密码或 Cookie，并支持清除', async () => {
    const previousKey = process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY
    process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = 'scrape-route-test-key'
    try {
      const saved = await req(
        '/api/scrape',
        json(
          'POST',
          { action: 'po18-account-save', username: 'author-account', password: 'secret-pass', sessionCookie: 'PHPSESSID=abc==; theme=dark' },
          adminToken,
        ),
      )
      expect(saved.status).toBe(200)
      const savedData = await jsonOf<{ username: string; hasSession: boolean; status: string; password?: string; sessionCookie?: string }>(saved)
      expect(savedData).toMatchObject({ username: 'author-account', hasSession: true, status: 'session_saved' })
      expect(savedData.password).toBeUndefined()
      expect(savedData.sessionCookie).toBeUndefined()
      const stored = await t.db.query<{ password_ciphertext: string; session_ciphertext: string }>(
        'SELECT password_ciphertext, session_ciphertext FROM source_accounts WHERE site = $1',
        ['po18tw'],
      )
      expect(stored.rows[0]?.password_ciphertext).toBeTruthy()
      expect(stored.rows[0]?.session_ciphertext).toBeTruthy()
      expect(stored.rows[0]?.password_ciphertext).not.toContain('secret-pass')
      expect(stored.rows[0]?.session_ciphertext).not.toContain('PHPSESSID')

      const status = await req('/api/scrape?action=po18-account', json('GET', undefined, adminToken))
      expect(status.status).toBe(200)
      await expect(status.json()).resolves.toMatchObject({ username: 'author-account', hasSession: true })

      const cleared = await req('/api/scrape', json('POST', { action: 'po18-account-clear' }, adminToken))
      expect(cleared.status).toBe(200)
      const empty = await req('/api/scrape?action=po18-account', json('GET', undefined, adminToken))
      await expect(empty.json()).resolves.toMatchObject({ configured: false, hasSession: false })
    } finally {
      if (previousKey === undefined) delete process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY
      else process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = previousKey
    }
  })

  it('POPO 会话测试应携带成年确认 Cookie，并允许验证实际书源链接', async () => {
    const previousKey = process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY
    process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = 'scrape-route-test-key'
    const popoList = `<div class="c_l">
      <div class="l_counter">0001</div>
      <div class="l_chaptname">第一章</div>
      <div class="l_btn"><a href="/books/123456/articles/1">免費閱讀</a></div>
    </div>`
    const popoContent = `<h1>第一章</h1><div class="article-content"><p>${'章节正文内容。'.repeat(20)}</p></div>`
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      return new Response(url.includes('/articlescontent/') ? popoContent : popoList, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    })
    try {
      await req('/api/scrape', json('POST', { action: 'po18-account-save', username: 'author-account', sessionCookie: 'PHPSESSID=authenticated' }, adminToken))
      const checked = await req(
        '/api/scrape',
        json('POST', { action: 'po18-account-test', sourceUrl: 'https://www.po18.tw/books/123456/articles' }, adminToken),
      )
      expect(checked.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const request = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
      expect(String(request?.[0])).toContain('/articlescontent/')
      const requestInit = request?.[1] as RequestInit
      const cookie = new Headers(requestInit?.headers).get('Cookie') || ''
      expect(cookie).toContain('po18Limit=1')
      expect(cookie).toContain('PHPSESSID=authenticated')
    } finally {
      fetchMock.mockRestore()
      await req('/api/scrape', json('POST', { action: 'po18-account-clear' }, adminToken))
      if (previousKey === undefined) delete process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY
      else process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = previousKey
    }
  })

  it('POPO 详情分析应携带已保存会话并限制站内重定向', async () => {
    const previousKey = process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY
    process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = 'scrape-route-test-key'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        `<div class="book_name">测试书名</div>
         <div class="book_author"><a>作者甲</a></div>
         <div class="B_I_content">这是一本测试小说。</div>
         <div class="book_cover"><img src="https://cdn0.po18.tw/bc/1/123456/M.jpg"></div>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      ),
    )
    try {
      await req(
        '/api/scrape',
        json('POST', { action: 'po18-account-save', username: 'author-account', sessionCookie: 'PHPSESSID=authenticated' }, adminToken),
      )
      const detected = await req(
        '/api/scrape',
        json('POST', { action: 'detect-meta', sourceUrl: 'https://www.po18.tw/books/123456' }, adminToken),
      )
      expect(detected.status).toBe(200)
      await expect(detected.json()).resolves.toMatchObject({
        novel: { title: '测试书名', author: '作者甲', coverUrl: 'https://cdn0.po18.tw/bc/1/123456/M.jpg' },
      })
      const request = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
      const requestInit = request?.[1] as RequestInit
      expect(new Headers(requestInit?.headers).get('Cookie')).toContain('PHPSESSID=authenticated')
      expect(new Headers(requestInit?.headers).get('Cookie')).toContain('po18Limit=1')
    } finally {
      fetchMock.mockRestore()
      await req('/api/scrape', json('POST', { action: 'po18-account-clear' }, adminToken))
      if (previousKey === undefined) delete process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY
      else process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = previousKey
    }
  })

  it('管理员可以保存开发代理，Docker 环境代理优先并可测试', async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'zhi-zhou-proxy-'))
    const previousRuntimeDir = process.env.RUNTIME_CONFIG_DIR
    const previousProxyBase = process.env.PROXY_BASE
    const previousProxyBypass = process.env.PROXY_BYPASS
    const previousHttpProxy = process.env.HTTP_PROXY
    const previousHttpsProxy = process.env.HTTPS_PROXY
    const previousNoProxy = process.env.NO_PROXY
    process.env.RUNTIME_CONFIG_DIR = runtimeDir
    delete process.env.PROXY_BASE
    delete process.env.PROXY_BYPASS
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY
    try {
      const invalid = await req(
        '/api/scrape',
        json('POST', { action: 'save-proxy-config', proxyBase: 'ftp://proxy.example.com', proxyBypass: 'example.com' }, adminToken),
      )
      expect(invalid.status).toBe(400)

      const saved = await req(
        '/api/scrape',
        json(
          'POST',
          {
            action: 'save-proxy-config',
            proxyBase: 'http://127.0.0.1:7890',
            proxyBypass: 'localhost, .internal.example.com',
          },
          adminToken,
        ),
      )
      expect(saved.status).toBe(200)
      const savedData = await jsonOf<{ configured: boolean; effectiveHost: string; config: { proxyBypass: string } }>(saved)
      expect(savedData.configured).toBe(true)
      expect(savedData.effectiveHost).toBe('127.0.0.1:7890')
      expect(savedData.config.proxyBypass).toBe('localhost,.internal.example.com')

      const runtimeRoute = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://service.example.com/v1' }, adminToken))
      const runtimeRouteData = await jsonOf<{ usesProxy: boolean; source: string; proxyHost: string; bypassed: boolean }>(runtimeRoute)
      expect(runtimeRouteData).toMatchObject({ usesProxy: true, source: 'runtime', proxyHost: '127.0.0.1:7890', bypassed: false })

      const runtimeBypass = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://svc.internal.example.com/health' }, adminToken))
      const runtimeBypassData = await jsonOf<{ usesProxy: boolean; bypassed: boolean; bypassRule: string }>(runtimeBypass)
      expect(runtimeBypassData).toMatchObject({ usesProxy: false, bypassed: true, bypassRule: '.internal.example.com' })

      const loaded = await req('/api/scrape?action=proxy-config', json('GET', undefined, adminToken))
      expect(loaded.status).toBe(200)
      const loadedData = await jsonOf<{ source: string; config: { proxyBase: string } }>(loaded)
      expect(loadedData.source).toBe('runtime')
      expect(loadedData.config.proxyBase).toBe('http://127.0.0.1:7890')

      process.env.HTTPS_PROXY = 'http://172.18.0.1:7890'
      const environmentLoaded = await req('/api/scrape?action=proxy-config', json('GET', undefined, adminToken))
      const environmentData = await jsonOf<{ source: string; effectiveHost: string; effective: { proxyBase: string } }>(environmentLoaded)
      expect(environmentData).toMatchObject({ source: 'environment', effectiveHost: '172.18.0.1:7890' })
      expect(environmentData.effective.proxyBase).toBe('')

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<html><body>proxy ok</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      )
      process.env.ALLOW_PRIVATE_FETCH = '1'
      try {
        const tested = await req('/api/scrape', json('POST', { action: 'proxy-test', sourceUrl: 'https://target.example.org/book/1' }, adminToken))
        expect(tested.status).toBe(200)
        const testedData = await jsonOf<{ ok: boolean; proxyHost: string; targetHost: string }>(tested)
        expect(testedData).toMatchObject({ ok: true, proxyHost: '172.18.0.1:7890', targetHost: 'target.example.org' })
        const requestedUrl = String(fetchMock.mock.calls[0]?.[0])
        expect(requestedUrl).toBe('https://target.example.org/book/1')
        expect((fetchMock.mock.calls[0]?.[1] as { dispatcher?: unknown }).dispatcher).toBeTruthy()
      } finally {
        delete process.env.ALLOW_PRIVATE_FETCH
        fetchMock.mockRestore()
      }

      const envRoute = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://target.example.org/book/1' }, adminToken))
      const envRouteData = await jsonOf<{ usesProxy: boolean; source: string; proxyHost: string; bypassed: boolean }>(envRoute)
      expect(envRouteData).toMatchObject({ usesProxy: true, source: 'environment', proxyHost: '172.18.0.1:7890', bypassed: false })

      process.env.NO_PROXY = 'target.example.org'
      try {
        const envBypass = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: 'https://target.example.org/book/1' }, adminToken))
        const envBypassData = await jsonOf<{ usesProxy: boolean; bypassed: boolean; bypassRule: string }>(envBypass)
        expect(envBypassData).toMatchObject({ usesProxy: false, bypassed: true, bypassRule: 'target.example.org' })
      } finally {
        delete process.env.NO_PROXY
      }

      const invalidRoute = await req('/api/scrape', json('POST', { action: 'proxy-route', sourceUrl: '不是网址' }, adminToken))
      expect(invalidRoute.status).toBe(400)
    } finally {
      if (previousRuntimeDir === undefined) delete process.env.RUNTIME_CONFIG_DIR
      else process.env.RUNTIME_CONFIG_DIR = previousRuntimeDir
      if (previousProxyBase === undefined) delete process.env.PROXY_BASE
      else process.env.PROXY_BASE = previousProxyBase
      if (previousProxyBypass === undefined) delete process.env.PROXY_BYPASS
      else process.env.PROXY_BYPASS = previousProxyBypass
      if (previousHttpProxy === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = previousHttpProxy
      if (previousHttpsProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = previousHttpsProxy
      if (previousNoProxy === undefined) delete process.env.NO_PROXY
      else process.env.NO_PROXY = previousNoProxy
      rmSync(runtimeDir, { recursive: true, force: true })
    }
  })

  it('import-legado：解析文本导入书源，支持站点名搜索与批量操作', async () => {
    const legadoText = JSON.stringify([
      {
        bookSourceUrl: 'https://legado.example.com',
        bookSourceName: '测试源',
        encoding: 1,
        ruleToc: { chapterList: '@css:.list a' },
        ruleContent: { content: '@css:#content' },
      },
      {
        bookSourceUrl: 'https://another.example.com',
        bookSourceName: '另一个站点',
        encoding: 1,
        ruleToc: { chapterList: '@css:.chapters a' },
        ruleContent: { content: '@css:.content' },
      },
    ])
    const imp = await req('/api/scrape', json('POST', { action: 'import-legado', text: legadoText }, adminToken))
    expect(imp.status).toBe(200)
    const impData = await jsonOf<{ success: boolean; imported: number; bySupport: Record<string, number> }>(imp)
    expect(impData.success).toBe(true)
    expect(impData.imported).toBe(2)
    expect(impData.bySupport.full).toBe(2)

    const list = await req('/api/scrape', json('POST', { action: 'list-sources' }, adminToken))
    const listData = await jsonOf<{ sources: Array<{ host: string; chapterList: string; chapterContent: string; enabled: boolean }>; total: number }>(list)
    expect(listData.total).toBe(2)
    const src = listData.sources.find((source) => source.host === 'legado.example.com')!
    expect(src.host).toBe('legado.example.com')
    expect(src.chapterList).toBe('.list a')
    expect(src.chapterContent).toBe('#content')
    expect(src.enabled).toBe(true)

    const firstPage = await req('/api/scrape', json('POST', { action: 'list-sources', page: 1, pageSize: 1 }, adminToken))
    const firstPageData = await jsonOf<{ sources: Array<{ host: string }>; page: number; pageSize: number; matchedTotal: number; totalPages: number }>(
      firstPage,
    )
    expect(firstPageData.sources).toHaveLength(1)
    expect(firstPageData.page).toBe(1)
    expect(firstPageData.pageSize).toBe(1)
    expect(firstPageData.matchedTotal).toBe(2)
    expect(firstPageData.totalPages).toBe(2)

    const lastPage = await req('/api/scrape', json('POST', { action: 'list-sources', page: 99, pageSize: 1 }, adminToken))
    const lastPageData = await jsonOf<{ sources: Array<{ host: string }>; page: number }>(lastPage)
    expect(lastPageData.page).toBe(2)
    expect(lastPageData.sources).toHaveLength(1)

    const search = await req('/api/scrape', json('POST', { action: 'list-sources', host: '另一个站点' }, adminToken))
    const searchData = await jsonOf<{ sources: Array<{ host: string }> }>(search)
    expect(searchData.sources.map((source) => source.host)).toEqual(['another.example.com'])

    const batchToggle = await req(
      '/api/scrape',
      json('POST', { action: 'batch-toggle-sources', hosts: ['legado.example.com', 'another.example.com'], enabled: false }, adminToken),
    )
    const batchToggleData = await jsonOf<{ updated: number }>(batchToggle)
    expect(batchToggle.status).toBe(200)
    expect(batchToggleData.updated).toBe(2)

    const disabled = await req('/api/scrape', json('POST', { action: 'list-sources', enabled: 0 }, adminToken))
    const disabledData = await jsonOf<{ sources: Array<{ host: string }> }>(disabled)
    expect(disabledData.sources).toHaveLength(2)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('another.example.com')) throw new Error('站点不可访问')
      return new Response('<html><body>ok</body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    })
    // 测试域名不可真实解析：跳过 SSRF 层的 DNS 校验，让请求落到上面的 fetch 桩
    process.env.ALLOW_PRIVATE_FETCH = '1'
    try {
      const connectivity = await req('/api/scrape', json('POST', { action: 'check-source-connectivity' }, adminToken))
      const connectivityData = await jsonOf<{ reachable: number; unreachable: number }>(connectivity)
      expect(connectivity.status).toBe(200)
      expect(connectivityData.reachable).toBe(1)
      expect(connectivityData.unreachable).toBe(1)
      const unreachable = await req('/api/scrape', json('POST', { action: 'list-sources', connectivity: 'unreachable' }, adminToken))
      const unreachableData = await jsonOf<{ sources: Array<{ host: string }> }>(unreachable)
      expect(unreachableData.sources.map((source) => source.host)).toEqual(['another.example.com'])
      const cleanup = await req('/api/scrape', json('POST', { action: 'delete-unreachable-sources' }, adminToken))
      expect((await jsonOf<{ deleted: number }>(cleanup)).deleted).toBe(1)
    } finally {
      delete process.env.ALLOW_PRIVATE_FETCH
      fetchMock.mockRestore()
    }

    const toggle = await req('/api/scrape', json('POST', { action: 'toggle-source', host: 'legado.example.com', enabled: false }, adminToken))
    expect(toggle.status).toBe(200)
    const del = await req('/api/scrape', json('POST', { action: 'batch-delete-sources', hosts: ['legado.example.com', 'another.example.com'] }, adminToken))
    const delData = await jsonOf<{ deleted: number }>(del)
    expect(del.status).toBe(200)
    expect(delData.deleted).toBe(1)
    const after = await req('/api/scrape', json('POST', { action: 'list-sources' }, adminToken))
    const afterData = await jsonOf<{ total: number }>(after)
    expect(afterData.total).toBe(0)
  })

  it('未登录访问 scrape 返回 401', async () => {
    const res = await req('/api/scrape', json('POST', { action: 'detect', sourceUrl: 'https://www.czbooks.net/n/1/' }))
    expect(res.status).toBe(401)
  })
})
