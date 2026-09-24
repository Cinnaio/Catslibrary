import type { GenerationRow } from './generations'
import { validateWritingContentPreferences, type WritingContentPreferencesV1 } from './writing-preferences'

/** 章节来源值：与抓取章节的 source_url 分开，便于后台追溯 AI 发布链路。 */
export const AI_PUBLISH_SOURCE = 'ai'

export type WritingPublishPolicyCode = 'content_rating_required' | 'content_preferences_invalid'

export interface FrozenWritingPublishMetadata {
  sourceType: typeof AI_PUBLISH_SOURCE
  aiTaskId: string
  contentPreferences: WritingContentPreferencesV1
  explicitAdult: boolean
}

export interface WritingPublishPolicyFailure {
  ok: false
  code: WritingPublishPolicyCode
  httpStatus: 409
  message: string
}

export interface WritingPublishPolicySuccess {
  ok: true
  metadata: FrozenWritingPublishMetadata
}

export type WritingPublishPolicyResult = WritingPublishPolicySuccess | WritingPublishPolicyFailure

interface ParsedGenerationParams {
  params?: Record<string, unknown>
  error?: string
}

function parseGenerationParams(paramsJson: string): ParsedGenerationParams {
  try {
    const parsed: unknown = JSON.parse(paramsJson || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'params_json 必须是对象' }
    return { params: parsed as Record<string, unknown> }
  } catch {
    return { error: 'params_json 不是有效 JSON' }
  }
}

/**
 * 读取生成时冻结的任务参数。
 *
 * 旧草稿没有 contentPreferences 时按关闭处理，以兼容历史数据；但只要字段存在却
 * 损坏，就必须拒绝发布，不能把无法确认的成人模式降级成安全模式。
 */
export function readFrozenWritingPublishMetadata(paramsJson: string): { metadata: FrozenWritingPublishMetadata } | { error: string } {
  const parsed = parseGenerationParams(paramsJson)
  if (parsed.error || !parsed.params) return { error: parsed.error || 'params_json 无法读取' }

  const params = parsed.params
  const hasPreferences = Object.prototype.hasOwnProperty.call(params, 'contentPreferences')
  const checked = validateWritingContentPreferences(hasPreferences ? params.contentPreferences : undefined)
  if (!checked.preferences) return { error: checked.error || 'contentPreferences 无法校验' }

  return {
    metadata: {
      sourceType: AI_PUBLISH_SOURCE,
      aiTaskId: typeof params.taskId === 'string' ? params.taskId.trim() : '',
      contentPreferences: checked.preferences,
      explicitAdult: checked.preferences.adultContentMode === 'explicit',
    },
  }
}

/**
 * AI 草稿只能发布到已经明确标记为 restricted 的作品。
 * 这是发布时的第二道闸门：即使草稿生成时作品还是 unknown，发布前也必须重新复核。
 */
export function evaluateWritingPublishPolicy(row: Pick<GenerationRow, 'params_json'>, novelContentRating: unknown): WritingPublishPolicyResult {
  const frozen = readFrozenWritingPublishMetadata(row.params_json)
  if ('error' in frozen) {
    return {
      ok: false,
      code: 'content_preferences_invalid',
      httpStatus: 409,
      message: `AI 草稿的内容参数无效或已损坏，无法安全发布：${frozen.error}。请重新生成草稿。`,
    }
  }

  if (frozen.metadata.explicitAdult && novelContentRating !== 'restricted') {
    return {
      ok: false,
      code: 'content_rating_required',
      httpStatus: 409,
      message: `该 AI 草稿使用了显式成人内容模式，目标作品当前为 ${String(novelContentRating || 'unknown')}。请先将作品明确标记为限制级（restricted）后再发布。`,
    }
  }

  return { ok: true, metadata: frozen.metadata }
}
