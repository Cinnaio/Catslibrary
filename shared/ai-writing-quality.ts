export type WritingQualityCode = 'short_chapter' | 'long_chapter' | 'output_limit' | 'upstream_incomplete' | 'chapter_boundary' | 'title_format' | 'repeated_opening'
export interface WritingQualityWarning {
  code: WritingQualityCode
  source: 'current' | 'generation'
  message: string
}
export interface WritingQualityReport {
  warnings: WritingQualityWarning[]
  bodyCharacters: number
  targetWords: number
  finishReason: string
  editedSinceGeneration: boolean
}
export interface WritingQualityInput {
  text: string
  targetWords?: number
  finishReason?: string
  upstreamIncomplete?: boolean
  titleNeedsReview?: boolean
  repeatedOpening?: boolean
  largeBoundaryTruncation?: boolean
  editedSinceGeneration?: boolean
}

/** These are review hints, not a judgement of narrative quality or a publication gate. */
export function assessWritingQuality(input: WritingQualityInput): WritingQualityReport {
  const bodyCharacters = Array.from(input.text.replace(/\s/gu, '')).length
  const targetWords = Number.isFinite(input.targetWords) ? Math.max(0, Number(input.targetWords)) : 0
  const finishReason = String(input.finishReason || '').toLowerCase()
  const editedSinceGeneration = !!input.editedSinceGeneration
  const warnings: WritingQualityWarning[] = []
  if (targetWords > 0 && bodyCharacters < targetWords * 0.6)
    warnings.push({ code: 'short_chapter', source: 'current', message: `正文约 ${bodyCharacters} 字，不足目标 ${targetWords} 字的六成，请检查内容是否完整。` })
  if (targetWords > 0 && bodyCharacters > targetWords * 1.3)
    warnings.push({ code: 'long_chapter', source: 'current', message: `正文约 ${bodyCharacters} 字，超过目标 ${targetWords} 字的三成，可按目标篇幅精简；原稿保留，不自动截断。` })
  if (finishReason === 'length' || finishReason === 'max_tokens')
    warnings.push({ code: 'output_limit', source: 'generation', message: '原始生成达到上游输出上限，结尾可能不完整；原文已保留，请检查。' })
  else if (input.upstreamIncomplete || ['content_filter', 'safety', 'refusal'].includes(finishReason))
    warnings.push({ code: 'upstream_incomplete', source: 'generation', message: '上游标记原始输出未完整返回，请检查已保留的正文。' })
  if (input.largeBoundaryTruncation)
    warnings.push({ code: 'chapter_boundary', source: 'generation', message: '原始生成按疑似后续章节边界裁剪过较多内容；截断前原文已留存，请检查分章位置。' })
  if (!editedSinceGeneration && input.titleNeedsReview)
    warnings.push({ code: 'title_format', source: 'current', message: '正文首行可能残留标题，请核对标题与正文；系统保留了原文。' })
  if (!editedSinceGeneration && input.repeatedOpening)
    warnings.push({ code: 'repeated_opening', source: 'current', message: '开头与前章片段高度重复，请检查是否重复开场或回到了旧场景。' })
  return { warnings, bodyCharacters, targetWords, finishReason, editedSinceGeneration }
}

export function detectRepeatedOpening(text: string, previous: string): boolean {
  const normalize = (value: string) => value.replace(/[\s\p{P}]/gu, '')
  const opening = normalize(text).slice(0, 120)
  const context = normalize(previous).slice(-6000)
  if (opening.length < 40) return false
  // A long exact overlap is actionable; common short dialogue cannot trigger this.
  for (let index = 0; index <= Math.min(40, opening.length - 40); index += 1) if (context.includes(opening.slice(index, index + 40))) return true
  return false
}
