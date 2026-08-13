/**
 * cover.ts 纯函数单测：语义题材判定的输出解析。
 * judgeGenre 本身走网络（chat），这里只测可测的 parseGenreText。
 */
import { describe, it, expect } from 'vitest'
import { parseGenreText } from './cover'

describe('parseGenreText', () => {
  it('识别英文代号', () => {
    expect(parseGenreText('ancient')).toBe('ancient')
    expect(parseGenreText('  xianxia ')).toBe('xianxia')
    expect(parseGenreText('fantasy')).toBe('fantasy')
  })

  it('识别中文别名', () => {
    expect(parseGenreText('古言')).toBe('ancient')
    expect(parseGenreText('仙侠')).toBe('xianxia')
    expect(parseGenreText('现言')).toBe('romance')
  })

  it('空/未知输出返回 null（调用方回落关键词推断）', () => {
    expect(parseGenreText('')).toBe(null)
    expect(parseGenreText('我不知道')).toBe(null)
    expect(parseGenreText('随便')).toBe(null)
  })

  it('复现本站真实场景：花间淫事 语义判定为古言，不再误落 urban', () => {
    expect(parseGenreText('古言')).toBe('ancient')
    // 若模型回英文代号，同样生效
    expect(parseGenreText('ancient')).toBe('ancient')
  })
})
