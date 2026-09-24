/**
 * 成人向分类标签 —— 精确匹配，绝不做子串匹配。
 *
 * 这份集合同时服务两处，语义一致：
 *   1. 作品判级（tag 判定）：书籍的分类里含任一标签 → restricted
 *   2. 分类栏过滤：安全模式下不展示这些分类名
 * 各留一份会导致「判级结果」与「分类栏可见项」出现两套口径。
 *
 * 为什么是精确枚举而不是正则：
 *   - 分类是**封闭集合**（本库实测 43 个），枚举比正则更准、更可审计
 *   - `h` 若做子串匹配会命中任何含 h 的词（英文名、拼音、`高h`…），
 *     这是这里最容易写错的地方
 *   - 正则匹配分类名会误伤相邻项（如 /肉/ 会连带影响 `肉文`/`多肉`）
 *
 * 标签来源与依据：
 *   - 实测自真实库 398 本的分类分布（`h` 171、`np` 84、`兄妹` 78、`强制` 41…）
 *   - `h` / `np` 跨源站语义一致，已验证 czbooks.net（非成人定位站）上的
 *     同名标签仍指向成人内容
 *
 * 注意：这是枚举法，同样不完备。新增标签应在此处追加并在测试中锁定。
 */
export const RESTRICTED_CATEGORY_TAGS: ReadonlySet<string> = new Set([
  // 明确无歧义
  'h',
  'np',
  '肉',
  '肉文',
  '纯肉',
  'sm',
  '双处',
  '调教',
  '强取豪夺',
  '高h', // 全角「高Ｈ」经归一化后落在此处
  'futa',
  // 同时是题材标签，但在本库语境下均伴随成人内容；按「宁多拦、人工再审」处理
  '兄妹',
  '强制',
  '囚禁',
  '父女',
])

/**
 * 归一化分类名：全角转半角 + 去空白 + 小写。
 *
 * 全角是真实存在的漏网来源：本库有标签 `高Ｈ`（全角 Ｈ），
 * 若不做转换就会与半角 `h` 分属两个不同的键。
 */
export function normalizeCategoryTag(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    // 全角 ASCII（U+FF01–U+FF5E）转半角
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
}

/** 单个分类名是否为成人向标签。 */
export function isRestrictedCategoryTag(name: string | null | undefined): boolean {
  const key = normalizeCategoryTag(name)
  return key !== '' && RESTRICTED_CATEGORY_TAGS.has(key)
}

/** 一组分类中是否含任一成人向标签。 */
export function hasRestrictedCategoryTag(categories: readonly string[] | null | undefined): boolean {
  if (!categories?.length) return false
  return categories.some((c) => isRestrictedCategoryTag(c))
}

/** 从一组分类中筛掉成人向标签（分类栏在安全模式下使用）。 */
export function filterVisibleCategories(categories: readonly string[]): string[] {
  return categories.filter((c) => !isRestrictedCategoryTag(c))
}
