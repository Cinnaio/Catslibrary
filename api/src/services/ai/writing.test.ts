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

  // —— 以下是自定义提示词下模型实际产出过的格式（2026-08-16 线上数据） ——

  it('章节号行不是标题：跳过「第 88 章」取下一行的【标题】', () => {
    const parsed = parseContinuationTitle('第 88 章\n【哥哥未说出口的话】HH\n\n第二天早上我是被热醒的。')
    expect(parsed.title).toBe('哥哥未说出口的话 HH')
    expect(parsed.body).toBe('第二天早上我是被热醒的。')
  })

  it('跳过带 # 前缀的章节号行（## 第 6 章）', () => {
    const parsed = parseContinuationTitle('## 第 6 章\n【哥哥午后的画框】HHH\n\n浴室门打开的时候。')
    expect(parsed.title).toBe('哥哥午后的画框 HHH')
    expect(parsed.body).toBe('浴室门打开的时候。')
  })

  it('章节号行自带尾巴时尾巴是标题：「第 3 章 锁孔里的光」', () => {
    const parsed = parseContinuationTitle('第 3 章 锁孔里的光\n\n正文开始。')
    expect(parsed.title).toBe('锁孔里的光')
    expect(parsed.body).toBe('正文开始。')
  })

  it('无章节号行时识别【标题】HH 并保留 H 评级标记', () => {
    const parsed = parseContinuationTitle('【旧账与往事】HH\n\n我整个人是被钉在床沿的。')
    expect(parsed.title).toBe('旧账与往事 HH')
    expect(parsed.body).toBe('我整个人是被钉在床沿的。')
  })

  it('章节号行后没有标题行时原样返回，不误剥正文', () => {
    const text = '第 88 章\n\n第二天早上我是被热醒的。\n\n他攥紧了剑柄。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('全文任意位置有空行但标题行后无空行时，不当作裸标题', () => {
    const text = '雨夜断剑少年拾起断剑\n他攥紧了剑柄。\n\n次日清晨。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('剥离后正文为空时不当作标题行（如单行短文本），原样返回', () => {
    expect(parseContinuationTitle('第一章开篇之也')).toEqual({ title: '', body: '第一章开篇之也' })
    expect(parseContinuationTitle('【笼中雀】')).toEqual({ title: '', body: '【笼中雀】' })
  })

  it('识别单次输出中混入的第二章标题', () => {
    const parsed = parseContinuationTitle('【笼门】HHHH\n\n第一章正文。\n\n【心甘情愿】HHH\n\n第二章正文。')
    expect(parsed.body).toBe('第一章正文。')
  })
})
