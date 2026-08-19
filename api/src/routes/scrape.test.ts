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

  it('管理员可以保存开发代理，Docker 环境代理优先并可测试', async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'zhi-zhou-proxy-'))
    const previousRuntimeDir = process.env.RUNTIME_CONFIG_DIR
    const previousProxyBase = process.env.PROXY_BASE
    const previousProxyDomains = process.env.PROXY_DOMAINS
    const previousHttpProxy = process.env.HTTP_PROXY
    const previousHttpsProxy = process.env.HTTPS_PROXY
    const previousNoProxy = process.env.NO_PROXY
    process.env.RUNTIME_CONFIG_DIR = runtimeDir
    delete process.env.PROXY_BASE
    delete process.env.PROXY_DOMAINS
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY
    try {
      const invalid = await req(
        '/api/scrape',
        json('POST', { action: 'save-proxy-config', proxyBase: 'ftp://proxy.example.com', proxyDomains: 'example.com' }, adminToken),
      )
      expect(invalid.status).toBe(400)

      const saved = await req(
        '/api/scrape',
        json(
          'POST',
          {
            action: 'save-proxy-config',
            proxyBase: 'http://127.0.0.1:7890',
            proxyDomains: 'czbooks.net, example.com',
          },
          adminToken,
        ),
      )
      expect(saved.status).toBe(200)
      const savedData = await jsonOf<{ configured: boolean; effectiveHost: string; config: { proxyDomains: string } }>(saved)
      expect(savedData.configured).toBe(true)
      expect(savedData.effectiveHost).toBe('127.0.0.1:7890')
      expect(savedData.config.proxyDomains).toBe('czbooks.net,example.com')

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
        const tested = await req(
          '/api/scrape',
          json('POST', { action: 'proxy-test', sourceUrl: 'https://target.example.org/book/1' }, adminToken),
        )
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
    } finally {
      if (previousRuntimeDir === undefined) delete process.env.RUNTIME_CONFIG_DIR
      else process.env.RUNTIME_CONFIG_DIR = previousRuntimeDir
      if (previousProxyBase === undefined) delete process.env.PROXY_BASE
      else process.env.PROXY_BASE = previousProxyBase
      if (previousProxyDomains === undefined) delete process.env.PROXY_DOMAINS
      else process.env.PROXY_DOMAINS = previousProxyDomains
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
    const firstPageData = await jsonOf<{ sources: Array<{ host: string }>; page: number; pageSize: number; matchedTotal: number; totalPages: number }>(firstPage)
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

    const batchToggle = await req('/api/scrape', json('POST', { action: 'batch-toggle-sources', hosts: ['legado.example.com', 'another.example.com'], enabled: false }, adminToken))
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
