import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fetch', () => ({
  fetchHtml: async () => ({ html: '<html><body></body></html>', encoding: 'utf-8' }),
  decodeBytes: () => '',
  FETCH_HEADERS: {},
}))

import { searchTitleSources } from './enrich'
import type { FetchHtmlOptions } from './fetch'

describe('标题源搜索', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PO18 搜索应复用已登录会话，而不是退回无 Cookie 的普通抓取', async () => {
    const po18Requests: Array<{ url: string; method: string; cookie: string; allowedRedirectHosts?: string[]; body: string }> = []
    const po18SearchPage = `<form id="header-search-form" action="/search/index" method="post">
      <input type="hidden" name="_po18rf-tk001" value="csrf-token">
      <input type="text" name="name">
      <input type="hidden" name="searchtype" value="all">
    </form>`
    const po18ResultsPage = '<a href="/books/123456">目标小说</a>'

    const result = await searchTitleSources('目标小说', '', {
      po18SessionCookie: 'PO18_SESSION=authenticated',
      po18FetchHtml: async (url: string, options?: FetchHtmlOptions) => {
        po18Requests.push({
          url,
          method: options?.method || 'GET',
          cookie: new Headers(options?.headers).get('Cookie') || '',
          allowedRedirectHosts: options?.allowedRedirectHosts,
          body: String(options?.body || ''),
        })
        return {
          html: options?.method === 'POST' ? po18ResultsPage : po18SearchPage,
          encoding: 'utf-8',
          ...(options?.method === 'POST' ? {} : { setCookies: ['_po18rf-tk001=csrf-cookie; Path=/'] }),
        }
      },
    })

    expect(po18Requests).toHaveLength(2)
    expect(po18Requests[0]).toMatchObject({
      url: 'https://www.po18.tw/site/alarm',
      method: 'GET',
      cookie: 'PO18_SESSION=authenticated',
      allowedRedirectHosts: ['po18.tw'],
    })
    expect(po18Requests[1]).toMatchObject({
      url: 'https://www.po18.tw/search/index',
      method: 'POST',
      allowedRedirectHosts: ['po18.tw'],
    })
    expect(po18Requests[1]!.cookie).toContain('PO18_SESSION=authenticated')
    expect(po18Requests[1]!.cookie).toContain('_po18rf-tk001=csrf-cookie')
    const params = new URLSearchParams(po18Requests[1]!.body)
    expect(params.get('name')).toBe('目标小说')
    expect(params.get('searchtype')).toBe('all')
    expect(params.get('_po18rf-tk001')).toBe('csrf-token')
    expect(result.sources.po18tw).toMatchObject({ ok: true, results: [{ title: '目标小说' }] })
  })
})
