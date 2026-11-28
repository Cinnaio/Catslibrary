import { canonicalCategory, categoryAliases } from '@shared/category-aliases'

const COMMON_CATEGORIES = ['现代', '古言', '校园', '玄幻', '仙侠', '重生', '快穿', '甜文', '百合', '言情', '轻松', '爽文', '1v1']
export interface HomeCategoryGroup {
  label: string
  tags: string[]
  collapsed?: boolean
}
const CATEGORY_GROUPS: HomeCategoryGroup[] = [
  {
    label: '背景与题材',
    tags: ['现代', '古代', '古言', '古代言情', '现代言情', '校园', '言情', '玄幻', '仙侠', '末世', '都市', '都会', '现言', '民国', '星际', '奇幻', '武侠', '悬疑', '科幻', '娱乐圈', '规则怪谈'],
  },
  {
    label: '情节设定',
    tags: ['重生', '穿越', '快穿', '系统', '先婚后爱', '破镜重圆', '强取豪夺', '强制', '囚禁', '包养', '宫斗', '宅斗', '真假千金', '豪门世家', '豪门总裁', '灵魂互换', '追妻', '追妻火葬场', '双向奔赴', '角色扮演'],
  },
  {
    label: '风格氛围',
    tags: ['甜', '甜文', '轻松', '爽文', '虐', '虐文', '暗黑', '狗血', '喜剧', '治愈', '团宠'],
  },
  {
    label: '人物与关系',
    tags: ['1v1', '1vN', '百合', 'BG', '女性向', '兄妹', '父女', '人外', '人兽', 'NP', '年上', '年下', '强强', '双女主', '青梅竹马', '欢喜冤家', '暗恋', '伪骨', '男女通吃'],
  },
  {
    label: '内容特征',
    tags: ['男处', '双处', 'H', '肉', '纯肉', '肉文', '粗口', '道具', '调教', '高H', 'SM', 'futa', '人外高H', '校园H'],
  },
  { label: '版本信息', tags: ['简体版', '繁体版', '简体', '繁体'], collapsed: true },
]

export function homeCategoryOptions(categories: string[]) {
  const all = [...new Set(categories.filter((tag) => tag.trim()).map(canonicalCategory))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const common = COMMON_CATEGORIES.filter((tag) => all.includes(tag)).slice(0, 10)
  const assigned = new Set(CATEGORY_GROUPS.flatMap((group) => group.tags))
  const groups = CATEGORY_GROUPS.map((group) => ({ ...group, tags: all.filter((tag) => group.tags.includes(tag)) }))
  groups.push({ label: '更多标签', tags: all.filter((tag) => !assigned.has(tag)), collapsed: true })
  return { common, groups: groups.filter((group) => group.tags.length > 0), hasMore: all.some((tag) => !common.includes(tag)) }
}

/** Search spelling aliases as well as the displayed label; unknown tags keep their identity. */
export function matchesCategorySearch(tag: string, query: string): boolean {
  const normalized = query.trim().normalize('NFKC').toLowerCase()
  return categoryAliases(tag).some((alias) => alias.normalize('NFKC').toLowerCase().includes(normalized))
}
