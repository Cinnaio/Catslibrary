import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fetch', () => ({
  fetchHtml: async () => ({ html: '<html><body></body></html>', encoding: 'utf-8' }),
  decodeBytes: () => '',
  FETCH_HEADERS: {},
}))

import { discoverList, extractPo18twTitles, parsePo18twChapterContent, parsePo18twChapterLinks, po18ResponseProblem, searchPo18tw, searchTitleSources } from './enrich'
import type { FetchHtmlOptions } from './fetch'

describe('PO18 榜单元数据', () => {
  const rankingHtml = `<div class="ranking_general">
    <div class="articlegeneral"><p class="p1">[言情]</p><p class="p2"><a href="/book/171348/">蜜糖表妹</a></p><p class="p3"><a href="/author/gaga鸭">gaga鸭</a></p></div>
    <div class="articlegeneral"><p class="p1">[其他]</p><p class="p2"><a href="/book/164998/">肆虐韩娱</a></p><p class="p3"><a href="/author/姬叉">姬叉</a></p></div>
    <div class="articlegeneral"><p class="p1">[其他]</p><p class="p2"><a href="/book/71126/">今天你睡了吗[快穿]</a></p><p class="p3"><a href="/author/红烧肉">红烧肉</a></p></div>
    <div class="articlegeneral"><p class="p1">[其他]</p><p class="p2"><a href="/book/79171/">我靠喂奶稳住病娇(高H 1V1)</a></p><p class="p3"><a href="/author/恶魔饭团">恶魔饭团</a></p></div>
  </div><div class="page"><a href="/top/dayvisit_2/">下页</a></div>`
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never
  const detailHtml = '<div class="intro"><span>本书简介：</span><p>这是当前作品的简介。<br>第二行 &amp; 后续内容。</p></div>'

  it('紧邻的真实榜单行应各自读取作者与分类，不能串到第一本作品', async () => {
    const result = await discoverList('https://wap.po18x.vip/top/dayvisit_1/?test=authors', {
      db,
      fetchHtml: async (url) => ({ html: url.includes('/top/') ? rankingHtml : detailHtml, encoding: 'gbk' }),
    })
    expect(result.novels.map((novel) => novel.author)).toEqual(['gaga鸭', '姬叉', '红烧肉', '恶魔饭团'])
    expect(result.novels.map((novel) => novel.categories)).toEqual([['言情'], ['其他'], ['其他'], ['其他']])
    expect(result.totalPages).toBe(2)
  })

  it('榜单没有简介时应回查详情并缓存，保留换行且不泄露 HTML 标签', async () => {
    const fetchHtml = vi.fn(async (url: string) => ({
      html: url.includes('/top/') ? rankingHtml : detailHtml.replace('当前作品', url.match(/\/book\/(\d+)/)![1]!),
      encoding: 'gbk',
    }))
    const url = 'https://wap.po18x.vip/top/dayvisit_1/?test=descriptions'
    const result = await discoverList(url, { db, fetchHtml })
    expect(result.novels.map((novel) => novel.description)).toEqual(
      ['171348', '164998', '71126', '79171'].map((id) => `这是${id}的简介。\n第二行 & 后续内容。`),
    )
    expect(fetchHtml).toHaveBeenCalledTimes(5)
    const cached = await discoverList(url, { db, fetchHtml })
    expect(cached.novels).toEqual(result.novels)
    expect(fetchHtml).toHaveBeenCalledTimes(5)
  })

  it('缺失作者不能借用相邻作者，链接文字应解码并清除标签', async () => {
    const html = `<div class="articlegeneral"><p>[其他]</p><a href="/book/1/">第一本</a><a href="/author/encoded"><b>甲 &amp; 乙</b></a></div>
      <div class="articlegeneral"><p>[言情]</p><a href="/book/2/">第二本</a></div>`
    const result = await discoverList('https://wap.po18x.vip/top/dayvisit_1/?test=missing-author', {
      db,
      fetchHtml: async (url) => ({ html: url.includes('/top/') ? html : detailHtml, encoding: 'gbk' }),
    })
    expect(result.novels.map((novel) => novel.author)).toEqual(['甲 & 乙', ''])
  })

  it('单本详情失败仍返回其他作品，重复发现只重试失败项', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.endsWith('/book/164998/')) throw new Error('HTTP 503')
      return { html: url.includes('/top/') ? rankingHtml : detailHtml, encoding: 'gbk' }
    })
    const url = 'https://wap.po18x.vip/top/dayvisit_1/?test=detail-failure'
    const result = await discoverList(url, { db, fetchHtml })
    expect(result.novels).toHaveLength(4)
    expect(result.novels.map((novel) => !!novel.description)).toEqual([true, false, true, true])
    fetchHtml.mockClear()
    fetchHtml.mockResolvedValue({ html: detailHtml, encoding: 'gbk' })
    const retried = await discoverList(url, { db, fetchHtml })
    expect(retried.novels.every((novel) => !!novel.description)).toBe(true)
    expect(fetchHtml).toHaveBeenCalledTimes(1)
    expect(fetchHtml).toHaveBeenCalledWith('https://wap.po18x.vip/book/164998/', { timeoutMs: 10000 })
  })
})

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
      results: [
        {
          site: 'po18tw',
          siteName: 'POPO',
          title: '目标小说（h）',
          author: '清阙',
          confidence: 'medium',
          matchScore: 60,
          matchReason: '书名一致（忽略括号备注）',
          status: 'ongoing',
          url: 'https://www.po18.tw/books/123456',
        },
      ],
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

  it('PO18 目录应读取全部分页，保留全局序号和付费标题，并忽略其他书籍或站点的分页', async () => {
    const base = 'https://www.po18.tw/books/123456/articles'
    const requests: string[] = []
    const pageHtml = (page: number) => {
      const end = page === 3 ? 288 : page * 100
      const rows = Array.from({ length: end - (page - 1) * 100 }, (_, index) => {
        const order = (page - 1) * 100 + index + 1
        const title = `目录标题 ${order}`
        return `<div class="c_l"><div class="l_counter">${order}</div><div class="l_chaptname">${order === 201 ? title : `<a href="${base}/${order}">${title}</a>`}</div></div>`
      }).join('')
      // 第 3 页只在第 2 页出现，模拟只提供下一页链接的目录。
      return rows + `<a href="?page=1">1</a><a href="?page=${Math.min(page + 1, 3)}">下一页</a>
        <a href="https://other.test/books/123456/articles?page=9">外站</a>
        <a href="/books/654321/articles?page=9">其他作品</a>`
    }
    const result = await extractPo18twTitles(base, async (url) => {
      requests.push(url)
      return { html: pageHtml(Number(new URL(url).searchParams.get('page') || 1)), encoding: 'utf-8' }
    })
    expect(requests).toEqual([base, `${base}?page=2`, `${base}?page=3`])
    expect(result.total).toBe(288)
    expect(result.titles.map((row) => row.order)).toEqual(Array.from({ length: 288 }, (_, index) => index + 1))
    expect(result.titles[200]).toEqual({ order: 201, title: '目录标题 201', url: `${base}#chapter-201` })
  })

  it.each(['登录页', '空目录', '重复第一页', '请求失败'])('后续分页返回%s时应报错，不能静默返回部分目录', async (failure) => {
    const base = 'https://www.po18.tw/books/123456/articles'
    const first = `<div class="c_l"><div class="l_counter">1</div><div class="l_chaptname"><a href="${base}/1">第一章</a></div></div><a href="?page=2">下一页</a>`
    await expect(extractPo18twTitles(base, async (url) => {
      if (url === base) return { html: first, encoding: 'utf-8' }
      if (failure === '请求失败') throw new Error('timeout')
      const html = failure === '登录页' ? '<form>登入<input type="password"></form>' : failure === '空目录' ? '<html></html>' : first
      return { html, encoding: 'utf-8' }
    })).rejects.toThrow(/第 2 页/)
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
      publicCount: 1,
      protectedCount: 1,
      links: [{ href: 'https://www.po18.tw/books/123456/articles/1', text: '第一章' }],
    })
  })

  it('POPO 正文应优先选择 read-txt，不能被前面的通用 content 容器截断', () => {
    const shortBlock = '章节信息占位内容，当前章节需要登录后才能继续阅读。'
    const fullContent = '真正的章节正文。'.repeat(40)
    const parsed = parsePo18twChapterContent(
      `<div class="content">${shortBlock}</div><div class="read-txt"><p>${fullContent}</p></div>`,
      '第一章',
    )

    expect(parsed.content).toContain(fullContent)
    expect(parsed.content).not.toContain(shortBlock)
  })

  it('POPO 直接正文片段不能因通用 content 容器存在而丢失正文', () => {
    const shortBlock = '章节信息占位内容，当前章节需要登录后才能继续阅读。'
    const fullContent = '真正的直接返回正文。'.repeat(40)
    const parsed = parsePo18twChapterContent(
      `<h1>第一章</h1><div class="content">${shortBlock}</div><p>${fullContent}</p>`,
      '第一章',
    )

    expect(parsed.content).toContain(fullContent)
  })

  it('POPO 应识别登录页、访问拦截页和跳转首页', () => {
    expect(po18ResponseProblem('https://members.po18.tw/apps/login.php?u=%2Fbooks%2F1', '<html></html>')).toContain('登录页')
    expect(po18ResponseProblem('https://www.po18.tw/site/alarm', '<html></html>')).toContain('拦截页')
    expect(po18ResponseProblem('https://www.po18.tw/', '<html></html>')).toContain('首页')
    expect(po18ResponseProblem('https://www.po18.tw/books/1/articles/1', '<html></html>')).toBeNull()
  })
})

describe('POPO 发现', () => {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never
  const detail = (id: string) => `<div class="book_name">作品 ${id}</div>
    <div class="book_author"><a>作者 ${id}</a></div>
    <div class="book_cover"><img src="/covers/${id}.jpg"></div>
    <div class="B_I_content"><p>作品 ${id} 的<strong>简介</strong>。</p><p>下一行 &amp; 内容。</p><span style="color:#bdc3c7">重复书名</span></div>`

  it('POPO 榜单即使已有首页封面也应回查简介，同次回查补齐封面并缓存', async () => {
    const landing = `<form id="rank-form1" action="/rank/more"><input type="hidden" name="kind"></form>
      <li class="R_cover"><a href="/books/111"><img src="/covers/first.jpg"></a></li>`
    const ranking = `<div class="row"><a class="l_bookname" href="/books/111">第一本</a><a class="l_author">甲</a></div>
      <div class="row"><a class="l_bookname" href="/books/222">第二本</a><a class="l_author">乙</a></div>`
    const fetchHtml = vi.fn(async (url: string, options?: FetchHtmlOptions) => ({
      html: url.includes('/books/') ? detail(url.match(/\/books\/(\d+)/)![1]!) : options?.method === 'POST' ? ranking : landing,
      encoding: 'utf-8',
    }))
    const url = 'https://www.po18.tw/rank/index?test=metadata'
    const options = { po18Ranking: { kind: 'pearl' as const, type: 'weekly' as const } }
    const result = await discoverList(url, { db, fetchHtml }, options)
    expect(result.novels.map((novel) => novel.author)).toEqual(['甲', '乙'])
    expect(result.novels.map((novel) => novel.description)).toEqual(['111', '222'].map((id) => `作品 ${id} 的简介。\n\n下一行 & 内容。`))
    expect(result.novels.map((novel) => novel.coverUrl)).toEqual(['https://www.po18.tw/covers/first.jpg', 'https://www.po18.tw/covers/222.jpg'])
    expect(fetchHtml).toHaveBeenCalledTimes(4)
    expect((await discoverList(url, { db, fetchHtml }, options)).novels).toEqual(result.novels)
    expect(fetchHtml).toHaveBeenCalledTimes(4)
  })

  it('POPO 首页榜单作者应兼容属性顺序并清理标签，末行不能读到榜单外作者', async () => {
    const html = `<li><a class="book_name" href="/books/111">第一本</a><a href="/users/a" class="book_author"><b>甲 &amp; 乙</b></a></li>
      <li><a class="book_name" href="/books/222">第二本</a></li><div class="book_author">无关作者</div>`
    const result = await discoverList('https://www.po18.tw/rank/index?test=homepage-metadata', {
      db, fetchHtml: async (url) => ({ html: url.includes('/books/') ? detail(url.match(/\/books\/(\d+)/)![1]!) : html, encoding: 'utf-8' }),
    })
    expect(result.novels.map((novel) => novel.author)).toEqual(['甲 & 乙', '作者 222'])
    expect(result.novels.every((novel) => !!novel.description)).toBe(true)
  })

  it('POPO 搜索简介缺失时应按各自详情补齐，携带合并会话且不串到搜索卡片外作者', async () => {
    const requests: Array<{ url: string; options?: FetchHtmlOptions }> = []
    const searchPage = '<form id="header-search-form" action="/search/index"><input name="name"><input type="hidden" name="searchtype" value="all"></form>'
    const resultPage = `<div id="BOOK"><div class="book"><div class="book_name"><a href="/books/111">第一本</a></div><div class="book_author">甲</div></div>
      <div class="book"><div class="book_name"><a href="/books/222">第二本</a></div></div><div class="book_author">无关作者</div></div>`
    const result = await searchPo18tw('作品', 'book', 1, db, 'SESSION=saved', async (url, options) => {
      requests.push({ url, options })
      return {
        html: url.includes('/books/') ? detail(url.match(/\/books\/(\d+)/)![1]!) : options?.method === 'POST' ? resultPage : searchPage,
        encoding: 'utf-8',
        setCookies: options?.method === 'POST' ? ['csrf=updated; Path=/'] : ['csrf=initial; Path=/'],
      }
    })
    expect(result.novels.map((novel) => novel.author)).toEqual(['甲', '作者 222'])
    expect(result.novels.map((novel) => novel.description)).toEqual(['111', '222'].map((id) => `作品 ${id} 的简介。\n\n下一行 & 内容。`))
    const details = requests.filter(({ url }) => url.includes('/books/'))
    expect(details).toHaveLength(2)
    for (const request of details) {
      expect(new Headers(request.options?.headers).get('Cookie')).toBe('po18Limit=1; SESSION=saved; csrf=updated')
      expect(request.options?.allowedRedirectHosts).toEqual(['po18.tw'])
    }
  })

  it.each(['请求失败', '登录页', '访问拦截页'])('POPO 单本详情返回%s时保留其他结果，重新发现可以重试', async (failure) => {
    const ranking = `<div class="row"><a class="l_bookname" href="/books/111">第一本</a><a class="l_author">甲</a></div>
      <div class="row"><a class="l_bookname" href="/books/222">第二本</a></div><a class="l_author">无关作者</a>`
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.endsWith('/books/222')) {
        if (failure === '请求失败') throw new Error('HTTP 503')
        return {
          html: '<div class="B_I_content">无关简介</div><form>登入<input type="password"></form>',
          finalUrl: failure === '登录页' ? 'https://members.po18.tw/apps/login.php' : 'https://www.po18.tw/site/alarm',
          encoding: 'utf-8',
        }
      }
      return { html: url.endsWith('/books/111') ? detail('111') : ranking, encoding: 'utf-8' }
    })
    const url = `https://www.po18.tw/rank/index?test=retry-${failure}`
    const result = await discoverList(url, { db, fetchHtml })
    expect(result.novels.map((novel) => novel.author)).toEqual(['甲', ''])
    expect(result.novels.map((novel) => !!novel.description)).toEqual([true, false])
    fetchHtml.mockClear()
    fetchHtml.mockResolvedValue({ html: detail('222'), encoding: 'utf-8' })
    const retried = await discoverList(url, { db, fetchHtml })
    expect(retried.novels[1]).toMatchObject({ author: '作者 222', description: '作品 222 的简介。\n\n下一行 & 内容。' })
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

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

    const result = await searchPo18tw('目标小说', 'book', 1, { query: vi.fn().mockResolvedValue({ rows: [] }) } as never, '', async (url, options) => {
      requests.push({
        url,
        method: options?.method || 'GET',
        cookie: new Headers(options?.headers).get('Cookie') || '',
        body: String(options?.body || ''),
      })
      return { html: options?.method === 'POST' ? resultPage : searchPage, encoding: 'utf-8' }
    })

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
      novels: [
        {
          title: '目标小说',
          author: '作者甲',
          url: 'https://www.po18.tw/books/123456',
          source: 'po18tw',
          sourceName: 'POPO',
        },
      ],
    })
  })

  it('POPO 排行榜应按卡片边界解析各自封面并保留 POPO 来源', async () => {
    const html = `<ol class="ranking">
      <li class="R_cover">
        <a class="book_cover" href="/books/123456"><img src="https://cdn0.po18.tw/bc/1/123456/M.jpg" alt="榜单小说"></a>
        <a class="book_name" href="/books/123456">榜单小说</a>
        <a class="book_author" href="/users/author">作者乙</a>
      </li>
      <li>
        <a class="book_name" href="/books/654321">第二本小说</a>
        <a class="book_author" href="/users/author-two">作者丙</a>
      </li>
    </ol>`
    const result = await discoverList('https://www.po18.tw/rank/index?test=popo', {
      db: { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      fetchHtml: async (url) => ({ html: url.includes('/books/') ? '<html></html>' : html, encoding: 'utf-8' }),
      getPreset: async () => ({ name: 'PO18.tw' }),
    })

    expect(result).toMatchObject({
      site: 'POPO',
      total: 2,
      novels: [
        {
          title: '榜单小说',
          author: '作者乙',
          url: 'https://www.po18.tw/books/123456',
          coverUrl: 'https://cdn0.po18.tw/bc/1/123456/M.jpg',
          source: 'po18tw',
          sourceName: 'POPO',
        },
        {
          title: '第二本小说',
          author: '作者丙',
          url: 'https://www.po18.tw/books/654321',
          coverUrl: '',
          source: 'po18tw',
          sourceName: 'POPO',
        },
      ],
    })
  })

  it('POPO 榜单详情应按榜单类型和周期提交官方表单，并复用首页封面', async () => {
    const requests: Array<{ url: string; method: string; cookie: string; body: string }> = []
    const landingPage = `<form id="rank-form1" action="/rank/more" method="post">
      <input type="hidden" name="_po18rf-tk001" value="csrf-token">
      <input type="hidden" name="kind" value="">
      <input type="hidden" name="type" value="weekly">
    </form>
    <div id="R2_W"><ol class="ranking">
      <li class="R_cover"><a class="book_cover" href="/books/111111"><img src="https://cdn0.po18.tw/bc/11/111111/M.jpg" alt="珍珠榜第一"></a></li>
    </ol></div>`
    const rankingPage = `<div class="table" id="R2_W">
      <div class="row">
        <div class="r1">1</div>
        <div class="r2"><a class="l_bookname" href="/books/111111">珍珠榜第一</a></div>
        <div class="r4"><a class="l_author" href="/users/author-one">作者甲</a></div>
      </div><!--row-->
      <div class="row">
        <div class="r1">2</div>
        <div class="r2"><a href="/books/222222" class="l_bookname">珍珠榜第四</a></div>
        <div class="r4"><a href="/users/author-four" class="l_author">作者丁</a></div>
      </div><!--row-->
      <div class="row">
        <div class="r1">5</div>
        <div class="r2"><a class="l_bookname" href="/books/891916">淫龙驯服手册（人外 1v1 h）</a></div>
        <div class="r4"><a class="l_author" href="/users/author-five">小甜包</a></div>
      </div><!--row-->
    </div>`
    const detailPage = `<div class="book_cover R-rated"><img src="https://cdn0.po18.tw/bc/13/891916/M20260101000000.jpg" alt="淫龙驯服手册（人外 1v1 h）"></div>`

    const result = await discoverList(
      'https://www.po18.tw/rank/index',
      {
        db: { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
        fetchHtml: async (url, options) => {
          requests.push({
            url,
            method: options?.method || 'GET',
            cookie: new Headers(options?.headers).get('Cookie') || '',
            body: String(options?.body || ''),
          })
          if (/\/books\/891916\/?$/.test(url)) return { html: detailPage, encoding: 'utf-8' }
          if (/\/books\/\d+\/?$/.test(url)) return { html: '<html><body></body></html>', encoding: 'utf-8' }
          return { html: options?.method === 'POST' ? rankingPage : landingPage, encoding: 'utf-8' }
        },
      },
      { po18Ranking: { kind: 'pearl', type: 'monthly' } },
    )

    expect(requests.slice(0, 2).map((item) => [item.url, item.method])).toEqual([
      ['https://www.po18.tw/rank/index', 'GET'],
      ['https://www.po18.tw/rank/more', 'POST'],
    ])
    expect(requests.some((item) => item.url === 'https://www.po18.tw/books/891916')).toBe(true)
    expect(requests[1]!.cookie).toBe('po18Limit=1')
    const params = new URLSearchParams(requests[1]!.body)
    expect(params.get('_po18rf-tk001')).toBe('csrf-token')
    expect(params.get('kind')).toBe('pearl')
    expect(params.get('type')).toBe('monthly')
    expect(result.novels).toMatchObject([
      { title: '珍珠榜第一', coverUrl: 'https://cdn0.po18.tw/bc/11/111111/M.jpg' },
      { title: '珍珠榜第四' },
      { title: '淫龙驯服手册（人外 1v1 h）', coverUrl: 'https://cdn0.po18.tw/bc/13/891916/M20260101000000.jpg' },
    ])

    const cachedResult = await discoverList(
      'https://www.po18.tw/rank/index',
      {
        db: { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
        fetchHtml: async () => {
          throw new Error('榜单缓存命中时不应重新请求')
        },
        getPreset: async () => ({ name: 'PO18.tw' }),
      },
      { po18Ranking: { kind: 'pearl', type: 'monthly' } },
    )

    expect(cachedResult.novels.find((novel) => novel.bookId === '891916')).toMatchObject({
      title: '淫龙驯服手册（人外 1v1 h）',
      coverUrl: 'https://cdn0.po18.tw/bc/13/891916/M20260101000000.jpg',
    })
  })

  it('POPO 榜单不把纯数字章节名当成页码', async () => {
    const landingPage = `<form id="rank-form1" action="/rank/more" method="post">
      <input type="hidden" name="kind" value="">
      <input type="hidden" name="type" value="weekly">
    </form>`
    // 章节目录标题恰好是纯数字，此前会被宽松分页正则误判为 36 页。
    const rankingPage = `<div class="table" id="R1_W">
      <div class="row">
        <div class="r1">1</div>
        <div class="r2"><a class="l_bookname" href="/books/640891">被误判的书</a></div>
        <div class="r3"><a class="l_chaptname" href="/books/640891/articles/7816525">36</a></div>
        <div class="r4"><a class="l_author" href="/users/u1">作者甲</a></div>
      </div><!--row-->
    </div>`

    const result = await discoverList(
      'https://www.po18.tw/rank/index',
      {
        db: { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
        fetchHtml: async (_url, options) => ({ html: options?.method === 'POST' ? rankingPage : landingPage, encoding: 'utf-8' }),
      },
      { po18Ranking: { kind: 'stocked', type: 'total' } },
    )

    expect(result.novels.map((novel) => novel.title)).toEqual(['被误判的书'])
    expect(result.totalPages).toBe(1)
  })
})
