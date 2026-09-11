/** 提示词材料边界与上游内容拒绝的窄范围策略。 */

const STANDALONE_ADULT_LABEL = /(?:^|[\s,，;；|/])(?:r18|18\+|18禁|成人向|成人内容)(?=$|[\s,，;；|/])/giu
const BRACKETED_ADULT_LABEL = /[\[【(（]\s*(?:r18|18\+|18禁|成人向|成人内容)\s*[\]】)）]/giu
const BRACKETED_ADULT_LABEL_SINGLE = /[\[【(（]\s*(?:r18|18\+|18禁|成人向|成人内容)\s*[\]】)）]/iu
const REFUSAL_CODES = new Set([
  'content_filter',
  'content_policy',
  'content_refused',
  'policy_violation',
  'safety',
  'safety_violation',
  'blocked_content',
  'blocked_prompt',
])

/**
 * 只移除独立的分级标签副本，不改数据库原文，也不改书名文字层。
 * 自由文本中的成人主题不由此函数做同义词替换或隐式改写。
 */
export function stripStandaloneAdultLabels(value: unknown): string {
  return String(value ?? '')
    .replace(BRACKETED_ADULT_LABEL, ' ')
    .replace(STANDALONE_ADULT_LABEL, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[,，;；|/\s]+|[,，;；|/\s]+$/gu, '')
    .trim()
}

export function isStandaloneAdultLabel(value: unknown): boolean {
  const clean = String(value ?? '').trim()
  return /^(?:r18|18\+|18禁|成人向|成人内容)$/iu.test(clean) || BRACKETED_ADULT_LABEL_SINGLE.test(clean)
}

export function filterMetadataCategories(values: readonly unknown[]): string[] {
  return values
    .map((value) => stripStandaloneAdultLabels(value))
    .filter((value) => value.length > 0)
}

export interface ContentRefusal {
  reason: 'content_refused'
  providerCode?: string
  message?: string
}

/**
 * 只识别供应商给出的结构化 refusal / finish_reason / error code。
 * 不用“抱歉”等普通词做判断，避免把正常小说正文误判为拒绝。
 */
export function detectStructuredContentRefusal(value: unknown): ContentRefusal | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const refusal = typeof obj.refusal === 'string' ? obj.refusal.trim() : ''
  if (refusal) return { reason: 'content_refused', message: refusal.slice(0, 240) }

  const finishReason = String(obj.finish_reason || obj.finishReason || '').toLowerCase()
  if (finishReason === 'content_filter' || finishReason === 'content-filter' || finishReason === 'safety' || finishReason === 'refusal') {
    return { reason: 'content_refused', providerCode: finishReason }
  }

  const code = String(obj.code || obj.type || '').toLowerCase()
  if (REFUSAL_CODES.has(code) || code.includes('content_filter') || code.includes('safety')) {
    const message = typeof obj.message === 'string' ? obj.message.trim() : ''
    return { reason: 'content_refused', providerCode: code, message: message.slice(0, 240) || undefined }
  }

  if (obj.error && obj.error !== obj) {
    const nested = detectStructuredContentRefusal(obj.error)
    if (nested) return nested
  }
  if (obj.message && typeof obj.message === 'object') {
    const nested = detectStructuredContentRefusal(obj.message)
    if (nested) return nested
  }
  if (Array.isArray(obj.choices)) {
    for (const choice of obj.choices) {
      const nested = detectStructuredContentRefusal(choice)
      if (nested) return nested
      const message = choice && typeof choice === 'object' ? (choice as Record<string, unknown>).message : undefined
      const messageRefusal = message && typeof message === 'object' ? detectStructuredContentRefusal(message) : null
      if (messageRefusal) return messageRefusal
      const delta = choice && typeof choice === 'object' ? (choice as Record<string, unknown>).delta : undefined
      const deltaRefusal = delta && typeof delta === 'object' ? detectStructuredContentRefusal(delta) : null
      if (deltaRefusal) return deltaRefusal
    }
  }
  return null
}

export function detectStructuredContentRefusalFromDetail(detail: string): ContentRefusal | null {
  const raw = String(detail || '').trim()
  if (!raw) return null
  try {
    return detectStructuredContentRefusal(JSON.parse(raw))
  } catch {
    return null
  }
}

export function contentRefusalMessage(refusal: ContentRefusal): string {
  return refusal.message
    ? `本次生成要求被上游拒绝：${refusal.message}`
    : '本次生成要求被上游内容策略拒绝，请调整为非露骨表达后重新发起'
}
