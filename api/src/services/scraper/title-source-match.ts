import OpenCC from 'opencc-js'

const simplify = OpenCC.Converter({ from: 'tw', to: 'cn' })

export interface TitleSourceMatch {
  confidence: 'high' | 'medium' | 'low'
  matchScore: number
  matchReason: string
}

function normalize(value: string): string {
  return simplify(value.normalize('NFKC')).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function withoutNotes(value: string): string {
  return value.normalize('NFKC').trim().replace(/(?:\s*(?:\([^()]*\)|\[[^\[\]]*\]|【[^【】]*】))+$/u, '')
}

/** 规则匹配等级，并非统计概率；作者冲突时不能列为高置信候选。 */
export function matchTitleSource(candidate: { title: string; author: string }, title: string, author: string): TitleSourceMatch {
  const queryTitle = normalize(title)
  const queryAuthor = normalize(author)
  const candidateTitle = normalize(candidate.title)
  const candidateAuthor = normalize(candidate.author)
  const exactTitle = Boolean(queryTitle && queryTitle === candidateTitle)
  const baseTitle = normalize(withoutNotes(title))
  const candidateBase = normalize(withoutNotes(candidate.title))
  const annotatedTitle = Boolean(baseTitle && baseTitle === candidateBase)
  const relatedTitle = Boolean(queryTitle && candidateTitle && Math.min(queryTitle.length, candidateTitle.length) >= 2 &&
    Math.min(queryTitle.length, candidateTitle.length) / Math.max(queryTitle.length, candidateTitle.length) >= 0.5 &&
    (queryTitle.includes(candidateTitle) || candidateTitle.includes(queryTitle)))
  const exactAuthor = Boolean(queryAuthor && queryAuthor === candidateAuthor)
  const titleScore = exactTitle ? 70 : annotatedTitle ? 60 : relatedTitle ? 35 : 0
  const matchScore = titleScore + (exactAuthor ? 30 : 0)
  const strongTitle = exactTitle || annotatedTitle
  const confidence = strongTitle && (queryAuthor ? exactAuthor : exactTitle) ? 'high'
    : strongTitle || relatedTitle || exactAuthor ? 'medium' : 'low'
  const reasons: string[] = []
  if (exactTitle) reasons.push('书名一致')
  else if (annotatedTitle) reasons.push('书名一致（忽略括号备注）')
  else if (relatedTitle) reasons.push('书名部分匹配')
  else if (queryTitle) reasons.push('书名不一致')
  if (exactAuthor) reasons.push('作者一致')
  else if (queryAuthor) reasons.push(candidateAuthor ? '作者不一致' : '作者未识别')
  return { confidence, matchScore, matchReason: reasons.join(' · ') || '缺少匹配信息' }
}

export function rankTitleSources<T extends { title: string; author: string }>(candidates: T[], title: string, author: string): Array<T & TitleSourceMatch> {
  const priority = { high: 2, medium: 1, low: 0 }
  return candidates.map(candidate => ({ ...candidate, ...matchTitleSource(candidate, title, author) }))
    .sort((a, b) => priority[b.confidence] - priority[a.confidence] || b.matchScore - a.matchScore)
}
