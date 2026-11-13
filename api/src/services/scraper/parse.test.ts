import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import {
  cleanHtml,
  cleanTitle,
  extractContent,
  extractInnerHtml,
  extractLinks,
  extractText,
  extractTextSmart,
} from './parse'
import { decodeBytes } from './fetch'
import { buildCoverUrl } from './presets'
import { removeAdPatterns } from '@shared/ad-cleaner'

describe('scraper parse 基础', () => {
  it('extractLinks 提取 .html 章节链接', () => {
    const html = `<div class="list"><li><a href="/novel/1.html">第一章</a></li><li><a href="/novel/2.html">第二章</a></li></div>`
    const links = extractLinks(html, '.list li a', 'https://example.com/')
    expect(links.map((l) => l.text)).toEqual(['第一章', '第二章'])
    expect(links[0]!.href).toBe('https://example.com/novel/1.html')
  })

  it('extractLinks 过滤 /book/ 等非章节链接', () => {
    const html = `<a href="/book/123.html">book</a><a href="/novel/c1.html">章节</a>`
    const links = extractLinks(html, 'a', 'https://example.com/')
    expect(links.map((l) => l.text)).toEqual(['章节'])
  })

  it('extractContent 保留段落与换行（script 内文不属于其职责）', () => {
    const html = `<div id="content"><p>第一段</p><p>第二段<br>换行</p></div>`
    const content = extractContent(html, '#content')
    expect(content).toContain('第一段')
    expect(content).toContain('第二段')
    expect(content).toContain('\n')
  })

  it('extractInnerHtml 提取最外层元素内部；extractTextSmart 处理后代选择器', () => {
    const html = `<div class="cataloginfo"><h3>书名</h3><p>作者</p></div>`
    expect(extractInnerHtml(html, '.cataloginfo')).toBe('<h3>书名</h3><p>作者</p>')
    expect(extractTextSmart(html, '.cataloginfo h3')).toBe('书名')
    // extractText 剥标签后取全部文本
    expect(extractText(html, '.cataloginfo')).toBe('书名作者')
  })

  it('cleanHtml 去除脚本/导航标签', () => {
    const html = `<p>正文</p><script>evil</script><div class="novelbutton"><a href="/x">上一章</a></div>`
    const cleaned = cleanHtml(html)
    expect(cleaned).toContain('正文')
    expect(cleaned).not.toContain('evil')
    expect(cleaned).not.toContain('novelbutton')
  })

  it('cleanTitle 剥离站点尾巴', () => {
    expect(cleanTitle('第一章 相遇 - 笔趣阁最新章节')).toBe('第一章 相遇')
    expect(cleanTitle('第一章 相遇_xx小说网')).toBe('第一章 相遇')
  })

  it('removeAdPatterns 协同清洗正文', () => {
    const text = '他说道。po18.com 继续。'
    expect(removeAdPatterns(text)).not.toContain('po18')
  })
})

describe('scraper fetch/presets', () => {
  it('decodeBytes gb18030 解码', () => {
    const buf = iconv.encode('中文', 'gbk')
    expect(decodeBytes(new Uint8Array(buf), 'gbk')).toBe('中文')
  })

  it('decodeBytes utf-8 解码', () => {
    const buf = Buffer.from('你好', 'utf8')
    expect(decodeBytes(new Uint8Array(buf), 'utf-8')).toBe('你好')
  })

  it('buildCoverUrl 使用预设中的封面规则', () => {
    const preset = { name: '示例', encoding: 'utf-8', coverRule: (id: string) => `https://img.example.com/${id}.jpg` }
    expect(buildCoverUrl('https://example.com/book/1234/', preset)).toBe('https://img.example.com/1234.jpg')
  })
})
