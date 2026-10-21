import { matchRestrictedBodyKeywordGroups } from '@shared/restricted-patterns'
import type { GenerationRow } from './generations'
import { validateWritingContentPreferences, type WritingContentPreferencesV1 } from './writing-preferences'

/** 章节来源值：与抓取章节的 source_url 分开，便于后台追溯 AI 发布链路。 */
export const AI_PUBLISH_SOURCE = 'ai'

export type WritingPublishPolicyCode =
  | 'content_rating_required'
  | 'content_preferences_invalid'
  | 'adult_body_requires_restricted'

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
 * 正文成人信号检测。
 *
 * 只看 strong 档：`RESTRICTED_BODY_KEYWORDS` 的 strong 部分是性器官、性行为与体液，
 * 几乎只出现在成人向正文；weak 档（胸口／湿了／腰肢／高潮）在武侠、医疗、宫斗里
 * 同样常见，拿它当发布拦截依据会把正常章节挡在门外。同一套强弱分层在分级采样
 * 链路里已经验证过，这里沿用同一口径。
 */
export function detectRestrictedBodyKeywords(content: string): string[] {
  return matchRestrictedBodyKeywordGroups(String(content || '')).strong
}

/**
 * AI 草稿的发布策略。两道条件独立成立，任一不过即拒绝：
 *
 * 1. 参数级：草稿生成时开启了显式成人模式（`adultContentMode === 'explicit'`），
 *    目标作品必须已明确标记为 restricted。
 * 2. 正文级：草稿正文命中强成人信号词，目标作品必须已明确标记为 restricted。
 *
 * 第二道是必需的：`adultContentMode` 只记录「作者本次有没有打开开关」，不记录
 * 「这次产出了什么」。创作要求是指令层材料，作者完全可以在开关关闭时写下露骨
 * 要求并得到露骨正文；旧草稿更是连该字段都没有，按关闭处理即等于放行。
 * 只看参数会让闸门检查的是一份意图声明，而不是即将写入数据库的那段正文。
 */
export function evaluateWritingPublishPolicy(
  row: Pick<GenerationRow, 'params_json'>,
  novelContentRating: unknown,
  /** 即将发布的正文（已剥离标题行）。省略时跳过正文检测，仅按冻结参数判定。 */
  content?: string,
): WritingPublishPolicyResult {
  const frozen = readFrozenWritingPublishMetadata(row.params_json)
  if ('error' in frozen) {
    return {
      ok: false,
      code: 'content_preferences_invalid',
      httpStatus: 409,
      message: `AI 草稿的内容参数无效或已损坏，无法安全发布：${frozen.error}。请重新生成草稿。`,
    }
  }

  const rating = String(novelContentRating || 'unknown')

  if (frozen.metadata.explicitAdult && novelContentRating !== 'restricted') {
    return {
      ok: false,
      code: 'content_rating_required',
      httpStatus: 409,
      message: `该 AI 草稿使用了显式成人内容模式，目标作品当前为 ${rating}。请先将作品明确标记为限制级（restricted）后再发布。`,
    }
  }

  if (content !== undefined && novelContentRating !== 'restricted') {
    const strong = detectRestrictedBodyKeywords(content)
    if (strong.length) {
      return {
        ok: false,
        code: 'adult_body_requires_restricted',
        httpStatus: 409,
        message:
          `该 AI 草稿正文含成人向露骨描写（命中 ${strong.length} 类：${strong.slice(0, 3).join('、')}` +
          `${strong.length > 3 ? ' 等' : ''}），但目标作品当前为 ${rating}。` +
          '请先将作品标记为限制级（restricted）后再发布，或改写该段后再发布。',
      }
    }
  }

  return { ok: true, metadata: frozen.metadata }
}
