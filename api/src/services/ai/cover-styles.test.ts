/**
 * cover-styles 知识库单测：题材推断规则与优先级、平台守卫。
 */
import { describe, it, expect } from 'vitest'
import {
  COVER_COMPOSITION_OPTIONS,
  COVER_STYLE_OPTIONS,
  GENRE_STYLES,
  PLATFORM_STYLES,
  inferGenre,
  inferGenres,
  isCoverComposition,
  isCoverPlatform,
  isCoverStylePreset,
  resolveCoverDirection,
} from './cover-styles'

describe('inferGenre', () => {
  it('单题材命中直接采用', () => {
    expect(inferGenre('剑道独尊')).toBe('xianxia')
    expect(inferGenre('都市医仙')).toBe('xianxia') // 「仙」优先级高于「都市」
    expect(inferGenre('契约替嫁的甜宠日常', ['现言'])).toBe('romance')
    expect(inferGenre('诡案追凶')).toBe('mystery')
    expect(inferGenre('星际机甲战神')).toBe('scifi')
  })

  it('零命中回落 urban', () => {
    expect(inferGenre('平平无奇的一本书')).toBe('urban')
    expect(inferGenre('')).toBe('urban')
  })

  it('多题材命中按优先级取一（仙侠 > 西幻 > 古言 > 现言 > 都市）', () => {
    // 同时命中 xianxia(剑) 与 fantasy(龙)：取 xianxia
    expect(inferGenre('屠龙剑客')).toBe('xianxia')
    // 命中 fantasy(魔法) 与 romance(甜宠)：取 fantasy
    expect(inferGenre('魔法学院的甜宠日常')).toBe('fantasy')
    // 命中 ancient(宫) 与 urban(重生)：取 ancient
    expect(inferGenre('重生之宫斗为后')).toBe('ancient')
  })

  it('分类参与推断', () => {
    expect(inferGenre('无名之书', ['悬疑', '推理'])).toBe('mystery')
    expect(inferGenre('无名之书', ['轻小说'])).toBe('light')
    expect(inferGenre('月光落在你肩上', ['现代言情'])).toBe('romance')
    expect(inferGenres('雨夜玫瑰', ['悬疑言情'])).toEqual(expect.arrayContaining(['romance', 'mystery']))
  })

  it('所有题材都有完整风格定义', () => {
    for (const genre of Object.keys(GENRE_STYLES) as Array<keyof typeof GENRE_STYLES>) {
      const s = GENRE_STYLES[genre]
      expect(s.tag).toBeTruthy()
      expect(s.figure).toBeTruthy()
      expect(s.background).toBeTruthy()
      expect(s.color).toBeTruthy()
      expect(s.light).toBeTruthy()
      expect(s.titleFont).toBeTruthy()
      expect(s.authorFont).toBeTruthy()
    }
  })

  it('自动视觉方向对同一本书稳定、换 variation 后会产生不同方向', () => {
    const first = resolveCoverDirection({ novelId: 'novel-001', genre: 'urban', variationId: 'variation-a' })
    const repeat = resolveCoverDirection({ novelId: 'novel-001', genre: 'urban', variationId: 'variation-a' })
    const next = resolveCoverDirection({ novelId: 'novel-001', genre: 'urban', variationId: 'variation-b' })

    expect(repeat).toEqual(first)
    expect(next.stylePreset !== first.stylePreset || next.composition !== first.composition).toBe(true)
    expect(first.stylePrompt).toBeTruthy()
    expect(first.compositionPrompt).toBeTruthy()
  })

  it('显式风格与构图会覆盖自动选择', () => {
    const direction = resolveCoverDirection({
      novelId: 'novel-002',
      genre: 'mystery',
      stylePreset: 'ink',
      composition: 'symbolic',
      variationId: 'variation-a',
    })

    expect(direction.stylePreset).toBe('ink')
    expect(direction.composition).toBe('symbolic')
    expect(direction.stylePrompt).toContain('ink')
    expect(direction.compositionPrompt).toContain('object')
  })

  it('视觉方向选项与非法值守卫完整', () => {
    expect(COVER_STYLE_OPTIONS.some((option) => option.value === 'auto')).toBe(true)
    expect(COVER_COMPOSITION_OPTIONS.some((option) => option.value === 'auto')).toBe(true)
    expect(isCoverStylePreset('cinematic')).toBe(true)
    expect(isCoverStylePreset('unknown')).toBe(false)
    expect(isCoverComposition('off_center')).toBe(true)
    expect(isCoverComposition('unknown')).toBe(false)
  })
})

describe('isCoverPlatform', () => {
  it('识别合法平台', () => {
    expect(isCoverPlatform('default')).toBe(true)
    expect(isCoverPlatform('fanqie')).toBe(true)
    expect(isCoverPlatform('jinjiang')).toBe(true)
  })
  it('拒绝非法值', () => {
    expect(isCoverPlatform('unknown')).toBe(false)
    expect(isCoverPlatform('')).toBe(false)
    expect(isCoverPlatform(null)).toBe(false)
    expect(isCoverPlatform(123)).toBe(false)
  })
  it('default 平台不叠加专属风格串', () => {
    expect(PLATFORM_STYLES.default).toBe('')
    expect(PLATFORM_STYLES.fanqie).toBeTruthy()
  })
})
