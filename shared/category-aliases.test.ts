import { describe, expect, it } from 'vitest'
import { canonicalCategory, categoryAliases } from './category-aliases'
import { isRestrictedCategoryTag } from './restricted-categories'

describe('标签显示与查询共用明确别名', () => {
  it.each([
    ['1V1', '1v1'], ['１Ｖ１', '1v1'], ['np', 'NP'], ['h', 'H'],
    ['高Ｈ', '高H'], ['系統', '系统'], ['人獸', '人兽'], ['娛樂圈', '娱乐圈'],
  ])('%s 统一显示为 %s，标准名和别名都能查回原写法', (raw, standard) => {
    expect(canonicalCategory(raw)).toBe(standard)
    expect(categoryAliases(standard)).toContain(raw)
    expect(categoryAliases(raw)).toEqual(categoryAliases(standard))
    expect(canonicalCategory(standard)).toBe(standard)
    expect(new Set(categoryAliases(raw)).size).toBe(categoryAliases(raw).length)
  })

  it('不合并相近语义，不截断复合或未知标签', () => {
    for (const tag of ['甜', '甜文', '虐', '虐文', '古代', '古言', '玄幻', '仙侠', '系统流', '校园H', '未知Tag']) {
      expect(canonicalCategory(tag)).toBe(tag)
      expect(categoryAliases(tag)).toEqual([tag])
    }
  })

  it('受限标签的所有明确别名继续服从安全模式', () => {
    for (const tag of ['H', '高H', 'NP', 'SM', '调教', '纯肉', '双处', '强制', '强取豪夺']) {
      for (const alias of categoryAliases(tag)) {
        expect(isRestrictedCategoryTag(alias), alias).toBe(true)
        expect(isRestrictedCategoryTag(canonicalCategory(alias)), alias).toBe(true)
      }
    }
  })
})
