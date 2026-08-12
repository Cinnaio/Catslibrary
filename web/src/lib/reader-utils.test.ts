import { describe, expect, it } from 'vitest'
import { clamp, excerptText, filterChapters, formatContent, hashParagraphText, sanitizeChapterHtml } from './reader-utils'
import type { ChapterMeta } from '@shared/types'

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
