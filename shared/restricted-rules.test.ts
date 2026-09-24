import { describe, expect, it } from 'vitest'
import {
  RESTRICTED_CATEGORY_TAGS,
  filterVisibleCategories,
  hasRestrictedCategoryTag,
  isRestrictedCategoryTag,
  normalizeCategoryTag,
} from './restricted-categories'
import { isRestrictedByRules, ratingFromRules } from './restricted-rules'

describe('成人分类标签（精确枚举）', () => {
  it('归一化：全角转半角、去空白、小写', () => {
    expect(normalizeCategoryTag('  高Ｈ  ')).toBe('高h')
    expect(normalizeCategoryTag('SM')).toBe('sm')
    expect(normalizeCategoryTag(null)).toBe('')
    expect(normalizeCategoryTag(undefined)).toBe('')
  })

  it('精确匹配标签集合', () => {
    expect(isRestrictedCategoryTag('h')).toBe(true)
    expect(isRestrictedCategoryTag('np')).toBe(true)
    expect(isRestrictedCategoryTag('H')).toBe(true) // 大小写不敏感
    expect(isRestrictedCategoryTag('高Ｈ')).toBe(true) // 全角经归一化后命中
    expect(isRestrictedCategoryTag('兄妹')).toBe(true)
    expect(isRestrictedCategoryTag('强制')).toBe(true)
  })

  it('非成人标签不命中（清水题材）', () => {
    for (const c of ['1v1', '校园', '古言', '言情', '甜', '百合', '快穿', 'BG', '重生', '末世', '玄幻']) {
      expect(isRestrictedCategoryTag(c)).toBe(false)
    }
  })

  it('关键：不做子串匹配，只认整词', () => {
    // `h` 若用子串会命中任何含 h 的词——这是此实现最容易写错的地方
    expect(isRestrictedCategoryTag('high')).toBe(false)
    expect(isRestrictedCategoryTag('sh')).toBe(false)
    expect(isRestrictedCategoryTag('h文')).toBe(false) // 不是枚举里的键
    expect(isRestrictedCategoryTag('np文')).toBe(false)
  })

  it('空值为假，不误判', () => {
    expect(isRestrictedCategoryTag('')).toBe(false)
    expect(isRestrictedCategoryTag('   ')).toBe(false)
    expect(hasRestrictedCategoryTag([])).toBe(false)
    expect(hasRestrictedCategoryTag(null)).toBe(false)
    expect(hasRestrictedCategoryTag(undefined)).toBe(false)
  })

  it('一组分类中任一命中即为真', () => {
    expect(hasRestrictedCategoryTag(['1v1', '校园'])).toBe(false)
    expect(hasRestrictedCategoryTag(['1v1', 'h'])).toBe(true)
    expect(hasRestrictedCategoryTag(['校园', '兄妹'])).toBe(true)
  })

  it('分类栏过滤：剔除成人标签，保留其余', () => {
    expect(filterVisibleCategories(['1v1', 'h', '校园', 'np'])).toEqual(['1v1', '校园'])
    expect(filterVisibleCategories(['古言', '言情'])).toEqual(['古言', '言情'])
  })

  it('枚举集合非空且不含空白键', () => {
    expect(RESTRICTED_CATEGORY_TAGS.size).toBeGreaterThan(0)
    for (const t of RESTRICTED_CATEGORY_TAGS) {
      expect(t).toBe(t.trim().toLowerCase())
      expect(t.length).toBeGreaterThan(0)
    }
  })
})

describe('判级规则（标签 OR 文本）', () => {
  it('成人标签命中即受限', () => {
    expect(isRestrictedByRules({ title: '某文', categories: ['h'] })).toBe(true)
    expect(isRestrictedByRules({ categories: ['np', '校园'] })).toBe(true)
  })

  it('分类只按完整标签判定，不让文本正则对子串补漏', () => {
    expect(isRestrictedByRules({ title: '普通书', categories: ['h文'] })).toBe(false)
    expect(isRestrictedByRules({ title: '普通书', categories: ['肉梗讨论'] })).toBe(false)
  })

  it('标题/简介文本特征命中即受限', () => {
    expect(isRestrictedByRules({ title: '成人向未删减作品' })).toBe(true)
    expect(isRestrictedByRules({ description: '前期剧情后期肉，含进身体' })).toBe(true)
  })

  it('两类都不命中则未判定', () => {
    expect(isRestrictedByRules({ title: '雾城来信', description: '一段简介', categories: ['玄幻', '悬疑'] })).toBe(false)
    expect(isRestrictedByRules(null)).toBe(false)
    expect(isRestrictedByRules(undefined)).toBe(false)
    expect(isRestrictedByRules({})).toBe(false)
  })

  it('红线：规则只产出 restricted 或 unknown，绝不产出 general', () => {
    const samples = [
      { title: '成人向未删减作品', categories: ['h'] },
      { title: '普通小说', categories: ['玄幻'] },
      { title: '', description: '', categories: [] },
      {},
    ]
    for (const s of samples) {
      expect(['restricted', 'unknown']).toContain(ratingFromRules(s))
      expect(ratingFromRules(s)).not.toBe('general')
    }
    // 未命中 → unknown（不是 general）：general 只能由人工给出
    expect(ratingFromRules({ title: '雾城来信', categories: ['言情'] })).toBe('unknown')
    expect(ratingFromRules({ categories: ['h'] })).toBe('restricted')
  })
})
