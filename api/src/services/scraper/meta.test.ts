import { describe, expect, it } from 'vitest'
import { detectMeta, extractMetaWithPreset } from './meta'
import { presetForUrl } from './presets'

describe('详情元数据', () => {
  it('小说狂人结构化状态也应识别未完结', () => {
    const novel = extractMetaWithPreset(
      '<div class="state">連載狀態：未完結<br>分類：都市</div>',
      presetForUrl('https://czbooks.net')!, 'https://czbooks.net/n/test',
    )
    expect(novel.status).toBe('ongoing')
  })

  it.each([
    ['未完結', 'ongoing'], ['連載中', 'ongoing'], ['已完結', 'completed'], ['完美旅途', undefined], ['状态未知', undefined],
  ])('通用状态选择器读取「%s」时不应凭单个完字误判', (text, expected) => {
    const novel = extractMetaWithPreset(
      `<div class="ratitle">${text}</div>`,
      { name: '示例', encoding: 'utf-8', meta: { status: '.ratitle' } }, 'https://example.com/book/1',
    )
    expect(novel.status).toBe(expected)
  })

  it('通用站点没有受保护章节的概念，该计数恒为 0', async () => {
    const listPage = `<div class="chapter-list"><a href="/b/1/c/1">第一章</a></div>`
    const result = await detectMeta('https://example.com/book/1', {
      store: null,
      fetchHtml: async (url) => ({
        html: url.includes('/c/') ? listPage : '<h1>通用小说</h1>',
        encoding: 'utf-8',
      }),
    })

    expect(result.protectedChapterCount).toBe(0)
  })
})
