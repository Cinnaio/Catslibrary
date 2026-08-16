/**
 * writing.ts 纯函数单测：续写输出的首行标题解析。
 * generateWriting 本身走 AI/DB，这里只测可测的 parseContinuationTitle。
 */
import { describe, it, expect } from 'vitest'
import { parseContinuationTitle } from './writing'

describe('parseContinuationTitle', () => {
  it('识别「标题：xxx」前缀并剥离标题行', () => {
    const parsed = parseContinuationTitle('标题：雨夜断剑\n\n少年在雨夜捡到一柄断剑。\n他攥紧了剑柄。')
    expect(parsed.title).toBe('雨夜断剑')
    expect(parsed.body).toBe('少年在雨夜捡到一柄断剑。\n他攥紧了剑柄。')
  })

  it('识别「章节标题:」与「Title:」前缀（大小写不敏感）', () => {
    expect(parseContinuationTitle('章节标题: 巷口灯笼\n\n正文开始。').title).toBe('巷口灯笼')
    expect(parseContinuationTitle('Title: The Rainy Night\n\nBody here.').title).toBe('The Rainy Night')
  })

  it('识别 # 与《》包裹的首行标题', () => {
    expect(parseContinuationTitle('# 雨夜断剑\n\n正文开始。').title).toBe('雨夜断剑')
    expect(parseContinuationTitle('《雨夜断剑》\n\n正文开始。').title).toBe('雨夜断剑')
  })

  it('识别裸首行标题：2-30 字、不以句末标点结尾、其后有空行', () => {
    const parsed = parseContinuationTitle('雨夜断剑\n\n少年在雨夜捡到一柄断剑。')
    expect(parsed.title).toBe('雨夜断剑')
    expect(parsed.body).toBe('少年在雨夜捡到一柄断剑。')
  })

  it('清洗标题包裹符号并截断到 40 字', () => {
    expect(parseContinuationTitle('标题：「雨夜断剑」\n\n正文。').title).toBe('雨夜断剑')
    const longTitle = '标题：' + '长'.repeat(50) + '\n\n正文。'
    expect(parseContinuationTitle(longTitle).title).toHaveLength(40)
  })

  it('以句末标点结尾的首行不是裸标题，原样返回', () => {
    const text = '少年在雨夜捡到一柄断剑，被巡夜人盯上。\n\n他攥紧了剑柄。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('首行后无空行时不当作裸标题，原样返回', () => {
    const text = '雨夜断剑\n少年在雨夜捡到一柄断剑。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('空输入 / 空首行返回空标题与原文', () => {
    expect(parseContinuationTitle('')).toEqual({ title: '', body: '' })
    expect(parseContinuationTitle('\n\n正文。')).toEqual({ title: '', body: '正文。' })
  })

  it('兼容 CRLF 换行', () => {
    const parsed = parseContinuationTitle('标题：雨夜断剑\r\n\r\n少年在雨夜捡到一柄断剑。')
    expect(parsed.title).toBe('雨夜断剑')
    expect(parsed.body).toBe('少年在雨夜捡到一柄断剑。')
  })
})
