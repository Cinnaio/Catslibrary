import { canonicalCategory } from '@shared/category-aliases'

const COMMON_CATEGORIES = ['现代', '古言', '校园', '言情', '玄幻', '仙侠', '重生', '快穿', '甜文', '百合', '甜', '轻松', '爽文', '1v1']
const CATEGORY_GROUPS = [
  {
    label: '题材背景',
    tags: ['现代', '古言', '校园', '言情', '玄幻', '仙侠', '快穿', '末世', '都市', '现言', '穿越', '民国', '星际', '奇幻', '武侠', '悬疑', '科幻'],
  },
  {
    label: '情节氛围',
    tags: [
      '甜',
      '甜文',
      '轻松',
      '爽文',
      '虐',
      '虐文',
      '暗黑',
      '狗血',
      '重生',
      '青梅竹马',
      '青梅竹馬',
      '先婚后爱',
      '破镜重圆',
      '强取豪夺',
      '强制',
      '囚禁',
      '包养',
    ],
  },
  {
    label: '关系属性',
    tags: [
      '1v1',
      '百合',
      'BG',
      'bg',
      '女牲向',
      '女性向',
      '兄妹',
      '父女',
      '男处',
      '双处',
      '人外',
      'np',
      'h',
      '肉',
      '纯肉',
      '肉文',
      '粗口',
      '道具',
      '调教',
      '高Ｈ',
      '高h',
      'sm',
      'futa',
    ],
  },
]

export function homeCategoryOptions(categories: string[]) {
  const all = [...new Set(categories.map(canonicalCategory))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const common = COMMON_CATEGORIES.filter((tag) => all.includes(tag)).slice(0, 10)
  const assigned = new Set(CATEGORY_GROUPS.flatMap((group) => group.tags))
  const groups = CATEGORY_GROUPS.map((group) => ({ label: group.label, tags: all.filter((tag) => group.tags.includes(tag)) }))
  groups.push({ label: '其他标签', tags: all.filter((tag) => !assigned.has(tag)) })
  return { common, groups: groups.filter((group) => group.tags.length > 0), hasMore: all.some((tag) => !common.includes(tag)) }
}
