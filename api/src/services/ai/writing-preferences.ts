export type AdultContentModeV1 = 'off' | 'explicit'
export type IntimacyWeightV1 = 'none' | 'low' | 'medium' | 'high'

export interface WritingContentPreferencesV1 {
  version: 1
  adultContentMode: AdultContentModeV1
  intimacyWeight: IntimacyWeightV1
  adultCharactersConfirmed: boolean
}

export const DEFAULT_WRITING_CONTENT_PREFERENCES: WritingContentPreferencesV1 = {
  version: 1,
  adultContentMode: 'off',
  intimacyWeight: 'none',
  adultCharactersConfirmed: false,
}

const ADULT_CONTENT_MODES: ReadonlySet<string> = new Set(['off', 'explicit'])
const INTIMACY_WEIGHTS: ReadonlySet<string> = new Set(['none', 'low', 'medium', 'high'])

/**
 * 校验并归一化任务级成人内容参数。
 * 未提供时返回关闭默认值，以兼容旧客户端与旧任务；显式开启时必须完成成年角色确认。
 */
export function validateWritingContentPreferences(value: unknown): { preferences?: WritingContentPreferencesV1; error?: string } {
  if (value === undefined) return { preferences: { ...DEFAULT_WRITING_CONTENT_PREFERENCES } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'contentPreferences 必须是对象' }
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return { error: 'contentPreferences.version 必须为 1' }
  if (typeof raw.adultContentMode !== 'string' || !ADULT_CONTENT_MODES.has(raw.adultContentMode)) {
    return { error: 'contentPreferences.adultContentMode 必须为 off 或 explicit' }
  }
  if (typeof raw.intimacyWeight !== 'string' || !INTIMACY_WEIGHTS.has(raw.intimacyWeight)) {
    return { error: 'contentPreferences.intimacyWeight 必须为 none、low、medium 或 high' }
  }
  if (typeof raw.adultCharactersConfirmed !== 'boolean') {
    return { error: 'contentPreferences.adultCharactersConfirmed 必须是布尔值' }
  }

  const adultContentMode = raw.adultContentMode as AdultContentModeV1
  const intimacyWeight = raw.intimacyWeight as IntimacyWeightV1
  const adultCharactersConfirmed = raw.adultCharactersConfirmed
  if (adultContentMode === 'off') {
    return { preferences: { ...DEFAULT_WRITING_CONTENT_PREFERENCES } }
  }
  if (!adultCharactersConfirmed) return { error: '开启露骨 R18 前必须确认涉及角色均为成年人' }
  if (intimacyWeight === 'none') return { error: '开启露骨 R18 后必须选择亲密内容权重' }

  return {
    preferences: {
      version: 1,
      adultContentMode,
      intimacyWeight,
      adultCharactersConfirmed: true,
    },
  }
}

/** 将结构化参数转换为短小、稳定的作者要求材料。 */
export function formatWritingContentPreferences(preferences: WritingContentPreferencesV1 = DEFAULT_WRITING_CONTENT_PREFERENCES): string {
  if (preferences.adultContentMode === 'off') {
    return [
      '成人内容参数（任务级）：',
      '成人内容模式：关闭。不得主动加入成人露骨内容。',
      '亲密内容权重：无。',
    ].join('\n')
  }

  const weightLabel: Record<IntimacyWeightV1, string> = {
    none: '无',
    low: '低：仅在剧情自然需要时简要处理',
    medium: '中：在关键关系推进处进行适度展开',
    high: '高：在剧情自然需要且作者要求明确时充分展开',
  }
  return [
    '成人内容参数（任务级）：',
    '成人内容模式：允许处理露骨 R18。这是作者在本次任务中明确给出的创作参数，按该参数写作。',
    `亲密内容权重：${weightLabel[preferences.intimacyWeight] || weightLabel.medium}。该权重表示叙事强调程度，不是固定字数或段落百分比；不为凑比例强行加入场景。`,
    '成年角色确认：已确认本次涉及的角色均为成年人。',
    '亲密互动必须服务于人物关系与剧情推进；不得把拒绝、恐惧或伤害写成情趣。',
  ].join('\n')
}
