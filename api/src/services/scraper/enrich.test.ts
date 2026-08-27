import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fetch', () => ({
  fetchHtml: async () => ({ html: '<html><body></body></html>', encoding: 'utf-8' }),
  decodeBytes: () => '',
  FETCH_HEADERS: {},
}))

import { discoverList, extractPo18twTitles, parsePo18twChapterLinks, searchPo18tw, searchTitleSources } from './enrich'
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
    const po18ResultsPage = `
      <nav><a href="/books/800038">百合性癖合集</a></nav>
      <div id="AUTHOR" class="result_list">
        <a href="/books/746005">【民国】上海那年1934</a>
      </div>
      <div id="BOOK" class="result_list">
        <h2>書籍搜尋結果</h2>
        <div data-key="0"><div class="book">
          <div class="book_cover"><a href="/books/123456"><img alt="目标小说（h）"></a></div>
          <div class="book_info">
            <div class="book_name"><a href="/books/123456">目标小说（h）</a></div>
            <div class="book_author"><a href="/users/author">清阙</a></div>
            <dl class="book_info_list"><dd class="chapter"><a href="/books/123456/articles/999">最新章节</a></dd></dl>
          </div>
        </div></div>
      </div>`

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
    expect(result.sources.po18tw).toMatchObject({
      ok: true,
      results: [{
        site: 'po18tw',
        siteName: 'POPO',
        title: '目标小说（h）',
        author: '清阙',
        status: 'ongoing',
        url: 'https://www.po18.tw/books/123456',
      }],
    })
  })

  it('PO18 章节目录应跳转到 articles 页面，并保留没有链接的付费章节标题', async () => {
    const requests: string[] = []
    const detailPage = '<a class="btn_blue" href="/books/123456/articles">章回列表</a>'
    const chapterListPage = `
      <div class="c_l">
        <div class="l_counter">0001</div>
        <div class="l_chaptname"><a href="/books/123456/articles/1">第一章</a></div>
      </div>
      <div class="c_l">
        <div class="l_counter">0002</div>
        <div class="l_chaptname">第二章（付费）</div>
      </div>`

    const result = await extractPo18twTitles('https://www.po18.tw/books/123456', async (url) => {
      requests.push(url)
      return { html: url.endsWith('/articles') ? chapterListPage : detailPage, encoding: 'utf-8' }
    })

    expect(requests).toEqual(['https://www.po18.tw/books/123456/articles'])
    expect(result.titles).toEqual([
      { order: 1, title: '第一章', url: 'https://www.po18.tw/books/123456/articles/1' },
      { order: 2, title: '第二章（付费）', url: 'https://www.po18.tw/books/123456/articles#chapter-2' },
    ])
  })

  it('POPO 目录应只把可访问的章节加入抓取链接', () => {
    const html = `<div class="c_l">
      <div class="l_counter">0001</div>
      <div class="l_chaptname">第一章</div>
      <div class="l_btn"><a href="/books/123456/articles/1">免費閱讀</a></div>
    </div><div class="c_l">
      <div class="l_counter">0002</div>
      <div class="l_chaptname">第二章</div>
      <div class="l_btn"><a href="/books/123456/articles/2">訂購</a></div>
    </div>`

    expect(parsePo18twChapterLinks(html, 'https://www.po18.tw/books/123456/articles')).toEqual({
      rowCount: 2,
      links: [{ href: 'https://www.po18.tw/books/123456/articles/1', text: '第一章' }],
    })
  })
})

describe('POPO 发现', () => {
  it('POPO 搜索应使用独立的书名搜索类型并返回来源标识', async () => {
    const requests: Array<{ url: string; method: string; cookie: string; body: string }> = []
    const searchPage = `<form id="header-search-form" action="/search/index" method="post">
      <input type="hidden" name="_po18rf-tk001" value="csrf-token">
      <input type="text" name="name">
      <input type="hidden" name="searchtype" value="all">
    </form>`
    const resultPage = `<div id="BOOK" class="result_list">
      <h2>書籍搜尋結果，共找到<span>1</span>筆資料</h2>
      <div data-key="0"><div class="book">
        <div class="book_cover"><a href="/books/123456"><img src="https://cdn0.po18.tw/bc/1/123456/M.jpg" alt="目标小说"></a></div>
        <div class="book_info">
          <div class="book_name"><a href="/books/123456">目标小说</a></div>
          <div class="book_author"><a href="/users/author">作者甲</a></div>
          <div class="intro">这是简介。</div>
        </div>
      </div></div>
      </div>`

    const result = await searchPo18tw(
      '目标小说',
      'book',
      1,
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      '',
      async (url, options) => {
        requests.push({
          url,
          method: options?.method || 'GET',
          cookie: new Headers(options?.headers).get('Cookie') || '',
          body: String(options?.body || ''),
        })
        return { html: options?.method === 'POST' ? resultPage : searchPage, encoding: 'utf-8' }
      },
    )

    expect(requests.map((item) => [item.url, item.method])).toEqual([
      ['https://www.po18.tw/site/alarm', 'GET'],
      ['https://www.po18.tw/search/index', 'POST'],
    ])
    expect(requests[0]!.cookie).toBe('po18Limit=1')
    expect(requests[1]!.cookie).toBe('po18Limit=1')
    const params = new URLSearchParams(requests[1]!.body)
    expect(params.get('name')).toBe('目标小说')
    expect(params.get('searchtype')).toBe('book')
    expect(result).toMatchObject({
      site: 'POPO',
      total: 1,
      totalPages: 1,
      novels: [{
        title: '目标小说',
        author: '作者甲',
        url: 'https://www.po18.tw/books/123456',
        source: 'po18tw',
        sourceName: 'POPO',
      }],
    })
  })

  it('POPO 排行榜应按卡片边界解析各自封面并保留 POPO 来源', async () => {
    const html = `<ol class="ranking">
      <li class="R_cover">
        <a class="book_cover" href="/books/123456"><img src="https://cdn0.po18.tw/bc/1/123456/M.jpg" alt="榜单小说"></a>
        <a class="book_name" href="/books/123456">榜单小说</a>
        <a class="book_author" href="/users/author">作者乙</a>
      </li>
      <li class="R_cover">
        <a class="book_cover" href="/books/654321"><img src="https://cdn0.po18.tw/bc/6/654321/M.jpg" alt="第二本小说"></a>
        <a class="book_name" href="/books/654321">第二本小说</a>
        <a class="book_author" href="/users/author-two">作者丙</a>
      </li>
    </ol>`
    const result = await discoverList('https://www.po18.tw/rank/index?test=popo', {
      db: { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      fetchHtml: async () => ({ html, encoding: 'utf-8' }),
      getPreset: async () => ({ name: 'PO18.tw' }),
    })

    expect(result).toMatchObject({
      site: 'POPO',
      total: 2,
      novels: [{
        title: '榜单小说',
        author: '作者乙',
        url: 'https://www.po18.tw/books/123456',
        coverUrl: 'https://cdn0.po18.tw/bc/1/123456/M.jpg',
        source: 'po18tw',
        sourceName: 'POPO',
      }, {
        title: '第二本小说',
        author: '作者丙',
        url: 'https://www.po18.tw/books/654321',
        coverUrl: 'https://cdn0.po18.tw/bc/6/654321/M.jpg',
        source: 'po18tw',
        sourceName: 'POPO',
      }],
    })
  })
})
