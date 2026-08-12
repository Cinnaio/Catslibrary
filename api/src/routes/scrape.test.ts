import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
    fetchMock.mockRestore()

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
