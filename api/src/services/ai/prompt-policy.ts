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

/** 上游判定「生成中途被策略截断」时常用的 finish_reason 取值。 */
const CANCELLED_FINISH_REASONS = new Set(['content_filter', 'content-filter', 'safety', 'refusal', 'sensitive'])

/**
 * 上游把已生成内容标记为被策略截断，但正文仍然回传了。
 *
 * 实测某 OpenAI 兼容网关：finish_reason=content_filter 时 message.content 里
 * 仍有完整的分析正文，只是尾部被替换成一句英文拒绝语。这既不是「模型拒绝回复」
 * （那种情况 content 为空），也不是正常完成——调用方应保留正文并按截断处理：
 * 记检查点、提示降批或重试，而不是丢整包结果。
 */
export function detectContentCancellation(text: string, finishReason: string): boolean {
  if (!String(text || '').trim()) return false
  return CANCELLED_FINISH_REASONS.has(String(finishReason || '').toLowerCase())
}

/** 截断响应尾部常见的英文/中文拒绝话术，用于清理已回传正文。 */
const CANCELLATION_TAIL =
  /(?:\s*(?:sorry|i'm sorry|i am sorry|sorry,)[^\n]{0,120}(?:can't|cannot|can not|won't|will not|unable to)[^\n]{0,120}\.?|\s*(?:抱歉|对不起)[^\n]{0,80}(?:无法|不能)[^\n]{0,80}[。.]?)\s*$/i

/** 去掉截断响应尾部的拒绝语，保留真正生成的分析正文。 */
export function stripCancellationTail(text: string): string {
  let value = String(text || '')
  for (let i = 0; i < 4; i++) {
    const next = value.replace(CANCELLATION_TAIL, '').trimEnd()
    if (next === value) break
    value = next
  }
  return value.trim()
}
