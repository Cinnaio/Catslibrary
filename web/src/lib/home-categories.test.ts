import { describe, expect, it } from 'vitest'
import { homeCategoryOptions } from './home-categories'
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
})
