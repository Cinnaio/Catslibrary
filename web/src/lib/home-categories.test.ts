import { describe, expect, it } from 'vitest'
import { homeCategoryOptions, matchesCategorySearch } from './home-categories'
import { categoryAliases } from '@shared/category-aliases'

describe('首页分类展示契约', () => {
  it('常用标签顺序不受接口返回顺序影响且最多十项，展开区不丢失标签', () => {
    const tags = ['现代', '古言', '校园', '言情', '玄幻', '仙侠', '重生', '快穿', '甜文', '百合', '甜', '轻松', '新标签']
    const options = homeCategoryOptions(tags)
    expect(options.common).toHaveLength(10)
    expect(homeCategoryOptions([...tags].reverse()).common).toEqual(options.common)
    expect(options.groups.flatMap((group) => group.tags).sort()).toEqual([...tags].sort())
    expect(options.hasMore).toBe(true)
  })

  it('简繁别名合并入口并可完整查询，语义相近的甜和甜文仍各自保留', () => {
    const options = homeCategoryOptions(['校园', '校園', '现代', '現代', '青梅竹馬', '轻松', '輕鬆', '甜', '甜文'])
    expect(options.groups.flatMap((group) => group.tags).sort()).toEqual(['校园', '现代', '青梅竹马', '轻松', '甜', '甜文'].sort())
    expect(categoryAliases('校園')).toEqual(['校园', '校園'])
    expect(categoryAliases('现代')).toEqual(['现代', '現代'])
    expect(categoryAliases('甜文')).toEqual(['甜文'])
  })

  it('归一后各标签只在一个完整分组出现，情节、关系、内容和版本各归其位', () => {
    const options = homeCategoryOptions(['系統', '系统', '人獸', '人兽', '1V1', '1v1', '高Ｈ', '高H', '重生', '穿越', '简体版', '新标签', ''])
    const group = (name: string) => options.groups.find((item) => item.label === name)
    expect(group('情节设定')?.tags).toEqual(expect.arrayContaining(['系统', '重生', '穿越']))
    expect(group('人物与关系')?.tags).toEqual(expect.arrayContaining(['1v1', '人兽']))
    expect(group('内容特征')?.tags).toEqual(['高H'])
    expect(group('版本信息')).toMatchObject({ tags: ['简体版'], collapsed: true })
    expect(group('更多标签')).toMatchObject({ tags: ['新标签'], collapsed: true })
    const tags = options.groups.flatMap((item) => item.tags)
    expect(tags).toHaveLength(8)
    expect(new Set(tags).size).toBe(tags.length)
    expect(options.common).not.toContain('简体版')
  })

  it('标签搜索支持简繁、大小写和全角，空查询保留全部', () => {
    expect(matchesCategorySearch('系统', ' 系統 ')).toBe(true)
    expect(matchesCategorySearch('高H', '高Ｈ')).toBe(true)
    expect(matchesCategorySearch('1v1', '1V1')).toBe(true)
    expect(matchesCategorySearch('新标签', '')).toBe(true)
    expect(matchesCategorySearch('系统', '未命中')).toBe(false)
  })

})
