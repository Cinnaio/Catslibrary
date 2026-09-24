/**
 * 判级规则 —— 「标签 OR 文本」的组合判定。
 *
 * 分层关系：
 *   - `restricted-categories.ts`：成人向**分类标签**的精确枚举
 *   - `restricted-patterns.ts`：限制级**文本特征**正则（标题/简介）
 *   - 本文件：把两者组合成唯一入口，供写入侧使用
 *
 * 谁用它：**写入侧**（创建/更新/预填）。读取侧不再调用——读取只认
 * `novels.content_rating` 字段，见 `web/src/context/ContentPolicyContext.tsx`。
 *
 * 为什么必须是唯一入口：如果创建、更新、预填各自组合一次，三处口径迟早发散，
 * 而「同一本书在不同路径下判级不同」正是这套方案要消除的不可验证状态。
 *
 * 红线：本函数只能产出 'restricted' 或 'unknown'，**永不产出 'general'**。
 * 理由：标签与正则都是枚举法，认不出的一律是「没判定」，不是「安全」。
 * `general` 只能由人工给出（系统不替运营做「这本书安全」的承诺）。
 */
import { hasRestrictedCategoryTag } from './restricted-categories'
import { hasRestrictedText } from './restricted-patterns'
import type { ContentRating } from './types'

export interface RatingSource {
  title?: string
  description?: string
  categories?: readonly string[]
}

/** 命中标签或文本特征即为限制级。 */
export function isRestrictedByRules(source: RatingSource | null | undefined): boolean {
  if (!source) return false
  // 标签优先：它是源站/运营给出的显式标记，比正文里的词更可靠。
  if (hasRestrictedCategoryTag(source.categories as string[] | undefined)) return true
  // Category names are checked only as complete tags above. Running substring
  // regexes over them would quietly reintroduce a second, fuzzy tag rule.
  return hasRestrictedText({ title: source.title, description: source.description })
}

/**
 * 由规则推导分级。命中 → 'restricted'，未命中 → 'unknown'（**不是 'general'**）。
 */
export function ratingFromRules(source: RatingSource | null | undefined): ContentRating {
  return isRestrictedByRules(source) ? 'restricted' : 'unknown'
}
