/**
 * 运营提示词的编译期重写 —— 对应 dsh-purge 的 pattern → replace 补丁层。
 *
 * 为什么不是「覆盖声明」：`ai_settings.writingSystemPrompt` 是管理员维护的系统层
 * 文字。旧做法留下一段「本条不适用于本档位」的声明去压它，等于让模型在两条系统层
 * 规则之间做裁量；实测这类声明会被读成「存在争议」，结果倾向保守侧。
 * 正确做法是在编译期把已知抑制条款替换掉，并回报被删条款供审计。
 *
 * 只在露骨档 + 虚构题材分级下启用：严格档本来就该保留同意规则与篇幅约束，
 * 无条件改写会让「宁多拦」的默认立场失效。
 */
import type { WritingContentPreferencesV1 } from './writing-preferences'

export interface OperatorPromptRule {
  id: string
  desc: string
  /** 每条正则必须带 g：先 match 收集命中，再 replace 删除。 */
  markers: RegExp[]
  replace: string
}

export interface OperatorPromptHit {
  id: string
  desc: string
  hit: string
}

export interface OperatorPromptPatchResult {
  text: string
  removed: OperatorPromptHit[]
  /** 是否应用了补丁；false 时 removed 必为空，代表运营提示词原样进入系统层。 */
  applied: boolean
}

const MAX_HIT_CHARS = 200

/**
 * 已知抑制条款。markers 用 `[^。\n]{0,40}` 限制跨度，避免跨句误删——
 * 运营提示词是长句结构，一条规则通常止于句号。
 */
export const OPERATOR_PROMPT_RULES: readonly OperatorPromptRule[] = [
  {
    id: 'consent-scene-suppression',
    desc: '禁止对强迫/下药/迷醉/睡眠情境作直接描写的条款',
    markers: [
      /[^。\n]*不得[^。\n]{0,40}(?:强迫|下药|迷醉|睡眠|非自愿)[^。\n]{0,40}(?:描写|呈现|叙述|展开)[^。\n]*[。]?/gu,
      /[^。\n]*(?:强迫|下药|迷醉|睡眠|非自愿)[^。\n]{0,40}不得[^。\n]*[。]?/gu,
      /[^。\n]*(?:强迫|下药|迷醉|睡眠|非自愿)[^。\n]{0,40}(?:淡化|跳过|转场|概述)[^。\n]*[。]?/gu,
    ],
    replace: '',
  },
  {
    id: 'length-quota-suppression',
    desc: '把亲密内容权重降级为「叙事强调程度」、禁止为权重加场景的篇幅约束',
    markers: [
      /[^。\n]*权重只表示叙事强调程度[^。\n]*[。]?/gu,
      /[^。\n]*不代表固定字数[^。\n]*[。]?/gu,
      /[^。\n]*不得为了满足权重[^。\n]*[。]?/gu,
      /[^。\n]*不为凑比例[^。\n]*[。]?/gu,
    ],
    replace: '',
  },
]

/** 只有露骨档 + 虚构题材分级才解除运营提示词里的抑制条款。 */
export function shouldPatchOperatorPrompt(preferences?: WritingContentPreferencesV1): boolean {
  return preferences?.adultContentMode === 'explicit' && preferences.consentRuleTier === 'fictional_nonconsent'
}

/**
 * 按规则重写运营提示词。返回被删条款供 `params_json` 审计——
 * 管理员改了后台提示词却不知道它被静默削过，是这类改写最危险的失败模式。
 *
 * 刻意不重排剩余条目的序号：运营提示词里可能存在「按第 8 条处理」这类交叉引用，
 * 自动重编号会让引用指向错误条款。删条目后留下的序号空缺可见且无害，
 * 缺了哪几条由 `removed` 如实回报。
 */
export function patchOperatorPrompt(
  raw: string,
  preferences?: WritingContentPreferencesV1,
  rules: readonly OperatorPromptRule[] = OPERATOR_PROMPT_RULES,
): OperatorPromptPatchResult {
  const source = String(raw || '')
  if (!shouldPatchOperatorPrompt(preferences)) return { text: source.trim(), removed: [], applied: false }

  let text = source
  const removed: OperatorPromptHit[] = []
  for (const rule of rules) {
    for (const marker of rule.markers) {
      const hits = text.match(marker)
      if (!hits?.length) continue
      for (const hit of hits) {
        const trimmed = hit.trim()
        if (trimmed) removed.push({ id: rule.id, desc: rule.desc, hit: trimmed.slice(0, MAX_HIT_CHARS) })
      }
      text = text.replace(marker, rule.replace)
    }
  }
  return {
    text: text.replace(/\n{3,}/gu, '\n\n').trim(),
    removed,
    applied: true,
  }
}
