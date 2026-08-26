/**
 * cover.ts 纯函数单测：语义题材判定的输出解析。
 * judgeGenre 本身走网络（chat），这里只测可测的 parseGenreText。
 */
import { describe, it, expect } from 'vitest'
import { buildImagePrompt, parseGenreText } from './cover'

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

describe('buildImagePrompt', () => {
  it('文本模型不可用时仍带入小说题材与简介，并输出可追溯视觉方向', async () => {
    const originalBaseUrl = process.env.AI_TEXT_BASE_URL
    const originalApiKey = process.env.AI_TEXT_API_KEY
    delete process.env.AI_TEXT_BASE_URL
    delete process.env.AI_TEXT_API_KEY

    try {
      const result = await buildImagePrompt(
        {
          title: '星际机甲战神',
          author: '某作者',
          description: '少年驾驶旧机甲穿越废土，寻找失落的母舰。',
          categories: ['科幻', '机甲'],
        },
        { novelId: 'novel-sci-fi', variationId: 'variation-a', renderTitle: false },
      )

      expect(result.metadata.genre).toBe('scifi')
      expect(result.metadata.variationId).toBe('variation-a')
      expect(result.prompt).toContain('Story categories: 科幻, 机甲')
      expect(result.prompt).toContain('少年驾驶旧机甲穿越废土')
      expect(result.prompt).toContain('avoid generic stock cover layouts')
      expect(result.prompt).not.toContain('high detail digital painting')
    } finally {
      if (originalBaseUrl === undefined) delete process.env.AI_TEXT_BASE_URL
      else process.env.AI_TEXT_BASE_URL = originalBaseUrl
      if (originalApiKey === undefined) delete process.env.AI_TEXT_API_KEY
      else process.env.AI_TEXT_API_KEY = originalApiKey
    }
  })
})
