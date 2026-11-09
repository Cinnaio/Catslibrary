import type { AgentSummaryContent, AgentSummaryDiagnostic } from '@shared/ai-agent'
import { AiError, type AiChatResult } from './client'

export class AgentSummaryValidationError extends AiError {
  constructor(
    readonly reason: AgentSummaryDiagnostic['reason'],
    readonly field?: keyof AgentSummaryContent,
    readonly observed?: number,
    readonly limit?: number,
  ) {
    super('invalid', '对话摘要校验未通过，原始记录已保留', 422)
  }
}

export class AgentSummaryError extends AiError {
  constructor(
    error: unknown,
    readonly diagnostic: AgentSummaryDiagnostic,
  ) {
    const descriptions: Partial<Record<AgentSummaryDiagnostic['reason'], string>> = {
      timeout: '早前对话整理超时',
      cancelled: '早前对话整理已停止',
      request_failed: '早前对话整理请求失败',
      refusal: '模型未提供对话摘要',
      incomplete: '对话摘要输出未完成',
      usage_failed: '对话摘要用量保存失败',
      persist_failed: '对话摘要保存失败',
    }
    const message =
      diagnostic.reason === 'input_too_long'
        ? '早前消息过长，无法完整整理；原始记录已保留，请新建对话并保存必要的作品记忆'
        : `${descriptions[diagnostic.reason] || (diagnostic.stage === 'validate' ? '对话摘要格式校验未通过' : '早前对话整理失败')}；原始记录已保留，可再次发送“继续”重试`
    super(error instanceof AiError ? error.code : 'upstream', message, error instanceof AiError ? error.status : 502)
    this.name = 'AgentSummaryError'
    // Do not copy partialResult: summary usage was attempted here, never as chat usage.
  }
}

export function summaryFailure(
  error: unknown,
  details: Omit<AgentSummaryDiagnostic, 'reason' | 'responseCharacters' | 'finishReason'>,
  response?: AiChatResult,
) {
  const reason =
    error instanceof AgentSummaryValidationError
      ? error.reason
      : error instanceof AiError && error.code === 'cancelled'
        ? 'cancelled'
        : error instanceof AiError && error.code === 'timeout'
          ? 'timeout'
          : details.stage === 'request'
            ? 'request_failed'
            : details.stage === 'usage'
              ? 'usage_failed'
              : details.stage === 'persist'
                ? 'persist_failed'
                : 'internal'
  const finishReason: AgentSummaryDiagnostic['finishReason'] = !response?.finishReason
    ? 'missing'
    : ['stop', 'length', 'tool_calls', 'content_filter'].includes(response.finishReason)
      ? (response.finishReason as AgentSummaryDiagnostic['finishReason'])
      : 'other'
  return new AgentSummaryError(error, {
    ...details,
    reason,
    ...(response ? { responseCharacters: response.text.length, finishReason } : {}),
    ...(error instanceof AgentSummaryValidationError
      ? {
          ...(error.field ? { field: error.field } : {}),
          ...(error.observed !== undefined ? { observed: error.observed } : {}),
          ...(error.limit !== undefined ? { limit: error.limit } : {}),
        }
      : {}),
  })
}
