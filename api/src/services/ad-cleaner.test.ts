import { describe, it, expect } from 'vitest'
import { removeAdPatterns } from '@shared/ad-cleaner'

describe('shared ad-cleaner', () => {
  it('清洗 PO18 域名与同形字变体', () => {
    expect(removeAdPatterns('正文开始 po18.com 继续正文').trim()).toBe('正文开始继续正文')
    expect(removeAdPatterns('免费精彩在线：「po18home」这是正文').trim()).toBe('这是正文')
    expect(removeAdPatterns('24.那么远ρó18ρóг.ｃóм').trim()).toBe('24.那么远')
  })

  it('清洗加空格的域名', () => {
    expect(removeAdPatterns('他说道。y u w a n g k o n g j i a n . c o m 第二段。').trim()).toBe('他说道。第二段。')
    expect(removeAdPatterns('64.那很上火了 dao han g.w ork').trim()).toBe('64.那很上火了')
  })

  it('清洗首发标记', () => {
    expect(removeAdPatterns('首-发：那么远').trim()).toBe('那么远')
  })

  it('保留普通文本', () => {
    const text = '普通文本，不含广告。'
    expect(removeAdPatterns(text)).toBe(text)
  })

  it('缺少后缀的空白分隔字母不会触发灾难性回溯', () => {
    const text = 'a '.repeat(25) + '!'
    const start = performance.now()
    expect(removeAdPatterns(text)).toBe(text)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('保留非广告后缀并继续清洗后续域名', () => {
    expect(removeAdPatterns('保留 abc.invalid，清除 xyz.com。')).toBe('保留 abc.invalid，清除。')
    expect(removeAdPatterns('保留 a . b，清除 ａｂ．ｃｏｍ。')).toBe('保留 a . b，清除。')
  })

  it('清理空括号与孤悬括号', () => {
    expect(removeAdPatterns('（）空括号（ ，、 ）也清理')).not.toMatch(/[（(]\s*[）)]/)
  })

  it('空/undefined 输入返回空串', () => {
    expect(removeAdPatterns('')).toBe('')
    expect(removeAdPatterns(null)).toBe('')
    expect(removeAdPatterns(undefined)).toBe('')
  })
})
