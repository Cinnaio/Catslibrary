import { describe, expect, it } from 'vitest'
import { clamp, excerptText, filterChapters, formatContent, groupChapterThoughts, hashParagraphText, sanitizeChapterHtml, thoughtQuoteRanges } from './reader-utils'
import type { ChapterMeta } from '@shared/types'
import type { Thought } from '@shared/types'

describe('formatContent', () => {
  it('纯文本按段落包裹 <p>', () => {
    const html = formatContent('第一段\n第二段')
    expect(html).toContain('<p>第一段</p>')
    expect(html).toContain('<p>第二段</p>')
  })

  it('含 HTML 标签的内容走消毒路径，剥掉危险标签', () => {
    const html = formatContent('<p>正文</p><script>alert(1)</script>')
    expect(html).toContain('<p>正文</p>')
    expect(html).not.toContain('<script>')
  })

  it('空内容回退占位文案', () => {
    expect(formatContent('')).toContain('暂无章节内容')
  })

  it('兼容 CR-only 原始段落，CRLF 与 LF 的正常分段保持一致', () => {
    const body = document.createElement('div')
    body.innerHTML = formatContent('第一段。\r\r第二段。\r第三段。')
    expect(Array.from(body.querySelectorAll('p'), (p) => p.textContent)).toEqual(['第一段。', '第二段。', '第三段。'])
    expect(body.querySelector('p')!.dataset.sourceParagraphHash).toBe(hashParagraphText('第一段。\r\r第二段。\r第三段。'))
    expect(formatContent('第一段。\r\n第二段。')).toBe(formatContent('第一段。\n第二段。'))
  })

  it('整章无分段的长正文按完整句子分段，保留原文及源段落锚点', () => {
    const raw = '山间的风吹过树林，远处的灯火渐渐亮起。'.repeat(50)
    const body = document.createElement('div')
    body.innerHTML = formatContent(raw)
    expect(body.querySelectorAll('p').length).toBeGreaterThan(1)
    expect(body.textContent).toBe(raw)
    for (const p of body.querySelectorAll('p')) {
      expect(p.dataset.sourceParagraphIndex).toBe('0')
      expect(p.dataset.sourceParagraphHash).toBe(hashParagraphText(raw))
    }
  })

  it('正常多段正文与短段不触发强制分段', () => {
    const long = '正常段落中的完整句子。'.repeat(80)
    expect(formatContent(`${long}\n第二段。`)).toBe(`<p>${long}</p>\n<p>第二段。</p>`)
    expect(formatContent(`<p>${long}</p><p>第二段。</p>`)).toBe(`<p>${long}</p><p>第二段。</p>`)
    expect(formatContent('单个短段。')).toBe('<p>单个短段。</p>')
  })

  it('保留 HTML 强调与换行，并避免在长对话引号内部断段', () => {
    const spoken = '“' + '这是一段连续的对白。'.repeat(80) + '”'
    const body = document.createElement('div')
    body.innerHTML = formatContent(`<p>开场。<em>${spoken}</em>尾声。</p>`)
    expect(body.textContent).toBe(`开场。${spoken}尾声。`)
    expect(body.querySelectorAll('em').length).toBeGreaterThan(0)
    expect(Array.from(body.querySelectorAll('p')).some((p) => p.textContent!.includes(spoken))).toBe(true)
    expect(formatContent(`<p>${spoken}<br>原有换行。</p>`)).toBe(`<p>${spoken}<br>原有换行。</p>`)
  })

  it('兜底分段后，旧想法仍按原段落哈希与引用定位到展示段落', () => {
    const raw = Array.from({ length: 60 }, (_, i) => `这是第${i}处独有的景色，山间的风吹过树林。`).join('')
    const html = formatContent(raw)
    const body = document.createElement('div')
    body.innerHTML = html
    const index = Array.from(body.querySelectorAll('p')).findIndex((p) => p.textContent!.includes('第40处独有的景色'))
    expect(index).toBeGreaterThan(0)
    const thought = { id: 'old', paragraphIndex: 0, paragraphHash: hashParagraphText(raw), selectedText: '第40处独有的景色' } as Thought
    expect(groupChapterThoughts([thought], html)[String(index)]).toEqual([thought])
    expect(groupChapterThoughts([{ ...thought, paragraphHash: '' }], html)[String(index)]?.[0]?.id).toBe('old')
  })
})

describe('sanitizeChapterHtml', () => {
  it('保留允许的标签，剥掉危险标签但保留文本', () => {
    const out = sanitizeChapterHtml('<p>正文<em>强调</em></p><img src=x onerror=alert(1)><div>div 内文本</div>')
    expect(out).toContain('<p>正文<em>强调</em></p>')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('onerror')
    expect(out).toContain('div 内文本')
    expect(out).not.toContain('<div>')
  })

  it('移除内联事件与 script 标签', () => {
    const out = sanitizeChapterHtml('<p onclick="x()">点我</p><script>alert(1)</script>')
    expect(out).toContain('<p>点我</p>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('<script>')
  })
})

describe('filterChapters', () => {
  const chapters = [
    { id: 'c1', novelId: 'n', title: '初见', order: 1 },
    { id: 'c2', novelId: 'n', title: '转折点', order: 2 },
    { id: 'c12', novelId: 'n', title: '大结局', order: 12 },
  ] as ChapterMeta[]

  it('空查询返回全部', () => {
    expect(filterChapters(chapters, '')).toHaveLength(3)
  })

  it('按章节号前缀匹配', () => {
    const hits = filterChapters(chapters, '1')
    expect(hits.map((c) => c.id)).toEqual(['c1', 'c12'])
  })

  it('按标题匹配', () => {
    expect(filterChapters(chapters, '转折')[0]!.id).toBe('c2')
  })

  it('按「第N章」形式匹配', () => {
    expect(filterChapters(chapters, '第2章')[0]!.id).toBe('c2')
  })
})

describe('hashParagraphText', () => {
  it('相同文本（含空白差异）哈希一致', () => {
    expect(hashParagraphText('你好  世界')).toBe(hashParagraphText('你好 世界'))
  })

  it('不同文本哈希不同', () => {
    expect(hashParagraphText('文本甲')).not.toBe(hashParagraphText('文本乙'))
  })
})

describe('excerptText / clamp', () => {
  it('超长文本截断到 110 字并加省略号', () => {
    const out = excerptText('长'.repeat(200))
    expect(out.length).toBe(111)
    expect(out.endsWith('…')).toBe(true)
  })

  it('clamp 钳制范围', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})

describe('thoughtQuoteRanges', () => {
  it('只标记局部引用，支持跨强调节点与空白归一化，保留原始节点', () => {
    const p = document.createElement('p')
    p.innerHTML = '段首<em>所选</em>  \n文字，段尾'
    const first = p.firstChild
    const ranges = thoughtQuoteRanges(p, ['所选 文字', '所选 文字'])
    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.toString()).toBe('所选  \n文字')
    expect(p.firstChild).toBe(first)
    expect(p.textContent).toBe('段首所选  \n文字，段尾')
  })

  it('找不到引用时不扩大为整段；重复引用只标记对应文字', () => {
    const p = document.createElement('p')
    p.textContent = '开头引用，中间引用，结尾'
    expect(thoughtQuoteRanges(p, ['不存在', ''])).toHaveLength(0)
    expect(thoughtQuoteRanges(p, ['引用']).map((range) => range.toString())).toEqual(['引用', '引用'])
  })
})
