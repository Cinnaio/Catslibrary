import { describe, expect, it } from 'vitest'
import { detectMeta, extractMetaWithPreset } from './meta'
import { PO18TW_SELECTORS, SITE_PRESETS } from './presets'

describe('PO18 详情元数据', () => {
  it('应从详情结构提取干净的书名、作者、简介、标签、封面和状态', () => {
    const preset = SITE_PRESETS['po18.tw']
    expect(preset).toBeDefined()
    if (!preset) return

    const html = `
      <title>嫡兄的禁脔（h）(清阙)｜PO18情愛原創</title>
      <meta name="description" content="页面标题和站点公共文案，不应作为作品简介">
      <div class="book_cover R-rated"><img src="https://cdn0.po18.tw/bc/83/742867/O20250904235700.jpg" alt="嫡兄的禁脔（h）"></div>
      <div class="book_info">
        <h1 class="book_name">嫡兄的禁脔（h）</h1>
        <dl class="book_info_list">
          <dt>作者</dt><dd class="author"><h2><a class="book_author" href="/users/author">清阙</a></h2></dd>
          <dt>狀態</dt><dd class="statu">已完結<span>(目前68章回)</span></dd>
        </dl>
      </div>
      <div class="book_intro"><h3>內容簡介</h3><div class="B_I_content">第一段简介。<br /><br />第二段简介。<span style="color:#bdc3c7;"><span style="font-size:11px;">嫡兄的禁脔（h）</span></span></div></div>
      <div class="book_intro_tags"><a class="tag" href="/tags/1">骨科</a><a class="tag" href="/tags/2">高H</a><a class="tag" href="/tags/3">1V1</a></div>`

    const novel = extractMetaWithPreset(html, preset, 'https://www.po18.tw/books/742867')

    expect(novel).toMatchObject({
      title: '嫡兄的禁脔（h）',
      author: '清阙',
      description: '第一段简介。\n\n第二段简介。',
      coverUrl: 'https://cdn0.po18.tw/bc/83/742867/O20250904235700.jpg',
      category: '骨科',
      categories: ['骨科', '高H', '1V1'],
      status: 'completed',
    })
  })

  it('POPO 探测应返回 articles 目录地址、专用选择器和章节数', async () => {
    const listPage = `<div class="c_l"><div class="l_counter">0001</div><div class="l_chaptname">第一章</div><div class="l_btn"><a href="/books/901935/articles/101">免費閱讀</a></div></div>`
    const result = await detectMeta('https://www.po18.tw/books/901935', {
      store: null,
      fetchHtml: async (url) => ({
        html: url.endsWith('/articles') ? listPage : '<h1 class="book_name">POPO 测试小说</h1>',
        encoding: 'utf-8',
      }),
    })

    expect(result.chapterListUrl).toBe('https://www.po18.tw/books/901935/articles')
    expect(result.chapterCount).toBe(1)
    expect(result.selectors).toEqual(PO18TW_SELECTORS)
  })
})
