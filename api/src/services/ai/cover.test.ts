/**
 * cover.ts 纯函数单测：语义题材判定的输出解析。
 * judgeGenre 本身走网络（chat），这里只测可测的 parseGenreText。
 */
import { describe, it, expect } from 'vitest'
import { buildImagePrompt, parseGenreText } from './cover'
import { inferGenres } from './cover-styles'

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

  it('言情提示词按故事视觉 DNA 变化，不再固定情侣姿势、粉金配色和通用场景', async () => {
    const originalBaseUrl = process.env.AI_TEXT_BASE_URL
    const originalApiKey = process.env.AI_TEXT_API_KEY
    delete process.env.AI_TEXT_BASE_URL
    delete process.env.AI_TEXT_API_KEY

    try {
      const result = await buildImagePrompt(
        {
          title: '合约到期后他真香了',
          author: '某作者',
          description: '冷面投资人和独立珠宝设计师因合约婚姻展开都市博弈，戒指成为两人关系转折的证据。',
          categories: ['现代言情', '豪门总裁'],
        },
        { novelId: 'novel-romance-contract', variationId: 'variation-contract', renderTitle: false },
      )

      expect(result.metadata.genre).toBe('romance')
      expect(result.metadata.genres).toEqual(expect.arrayContaining(['romance', 'urban']))
      expect(result.metadata.romanceSubtype).toBe('contract')
      expect(result.metadata.visualAnchor).toContain('ring')
      expect(result.prompt).toContain('Story-specific romance direction')
      expect(result.prompt).not.toContain('a couple in a tender intimate interaction')
      expect(result.prompt).not.toContain('pink, warm white and light gold')
      expect(result.prompt).not.toContain('café, garden, cozy interior, sunset beach')
    } finally {
      if (originalBaseUrl === undefined) delete process.env.AI_TEXT_BASE_URL
      else process.env.AI_TEXT_BASE_URL = originalBaseUrl
      if (originalApiKey === undefined) delete process.env.AI_TEXT_API_KEY
      else process.env.AI_TEXT_API_KEY = originalApiKey
    }
  })

  it('显式参考风格会进入最终图像提示词，并覆盖为可追溯元数据', async () => {
    const originalBaseUrl = process.env.AI_TEXT_BASE_URL
    const originalApiKey = process.env.AI_TEXT_API_KEY
    delete process.env.AI_TEXT_BASE_URL
    delete process.env.AI_TEXT_API_KEY

    try {
      const result = await buildImagePrompt(
        {
          title: '月光落在你肩上',
          author: '某作者',
          description: '两个人在多年后重逢，沿着旧街寻找一段没有说完的话。',
          categories: ['现代言情'],
        },
        {
          novelId: 'novel-reference-style',
          variationId: 'variation-reference-style',
          stylePreset: 'soft_watercolor',
          composition: 'environment',
          renderTitle: false,
        },
      )

      expect(result.metadata.stylePreset).toBe('soft_watercolor')
      expect(result.metadata.composition).toBe('environment')
      expect(result.prompt).toContain('Primary visual preset (highest priority)')
      expect(result.prompt).toContain('translucent peach')
      expect(result.prompt).toContain('wide environmental storytelling')
    } finally {
      if (originalBaseUrl === undefined) delete process.env.AI_TEXT_BASE_URL
      else process.env.AI_TEXT_BASE_URL = originalBaseUrl
      if (originalApiKey === undefined) delete process.env.AI_TEXT_API_KEY
      else process.env.AI_TEXT_API_KEY = originalApiKey
    }
  })

  it('言情题材保留多标签，不把悬疑言情完全压扁成单一题材', () => {
    expect(inferGenres('雨夜玫瑰', ['悬疑言情'])).toEqual(expect.arrayContaining(['romance', 'mystery']))
  })
})
