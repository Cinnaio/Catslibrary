export const ANALYSIS_KINDS = {
  plot: '情节分析',
  characters: '人物分析',
  relationships: '关系分析',
  style: '文风分析',
  custom: '自定义分析',
} as const
export type AnalysisKind = keyof typeof ANALYSIS_KINDS
/** Pin a reviewed report revision for a single writing request. */
export interface AnalysisReferenceSelection {
  reportId: string
  revision: number
}
export interface WritingAnalysisReference {
  id: string
  revision: number
  kind: AnalysisKind
  content: string
  edited: boolean
  question?: string
  createdAt?: number
  startChapter: { id: string; title: string }
  endChapter: { id: string; title: string }
  sources: Omit<AnalysisSource, 'text'>[]
  review?: AnalysisReferenceReview
}
export interface AnalysisRequest {
  kind: AnalysisKind
  startChapterId: string
  endChapterId: string
  question: string
}
export interface AnalysisSource {
  id: string
  chapterId: string
  chapterTitle: string
  chapterOrdinal: number
  part: number
  offset: number
  endOffset: number
  revision: string
  text: string
}
export interface AnalysisNote {
  sourceIds: string[]
  content: string
}
export interface AnalysisReportSummary {
  id: string
  novelId: string
  request: AnalysisRequest
  taskId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  step: string
  error: string
  processed: number
  total: number
  chapterCount: number
  revision: number
  edited: boolean
  createdAt: number
  updatedAt: number
}
export interface AnalysisReport extends AnalysisReportSummary {
  originalContent: string
  content: string
  sourceChanged: boolean
  sources: Omit<AnalysisSource, 'text'>[]
  notes: AnalysisNote[]
  checkedSourceIds: string[]
  evidence?: AnalysisEvidenceCheck
  reviews?: AnalysisReview[]
}

export interface AnalysisEvidenceMatch {
  sourceIds: string[]
  chapterId: string
  chapterTitle: string
  /** UTF-16 offsets in the frozen normalized chapter. */
  start: number
  end: number
  quote: string
}
export interface AnalysisEvidenceItem {
  id: string
  start: number
  end: number
  quote: string
  citedSourceIds: string[]
  status: 'matched' | 'wrong_source' | 'not_found' | 'ambiguous' | 'uncertain' | 'missing_source'
  matches: AnalysisEvidenceMatch[]
}
export interface AnalysisEvidenceCheck {
  checkerVersion: string
  contentHash: string
  sourceFingerprint: string
  coverage: 'complete' | 'partial'
  scannedQuotes: number
  totalQuotes: number
  items: AnalysisEvidenceItem[]
}
export interface AnalysisReviewSegment {
  id: string
  start: number
  end: number
  text: string
  sourceIds: string[]
}
export interface AnalysisReviewCoverage {
  segments: AnalysisReviewSegment[]
  skipped: number
  sourceChars: number
  sourceIds?: string[]
}
export interface AnalysisFactFinding {
  id: string
  segmentId: string
  start: number
  end: number
  original: string
  kind: 'conflict' | 'inference' | 'insufficient' | 'citation'
  explanation: string
  suggestion: string
  evidence: AnalysisEvidenceMatch[]
}
export interface AnalysisFactResult {
  items: AnalysisFactFinding[]
  partial: boolean
  rejected: number
  checkedSegmentIds: string[]
}
export interface AnalysisReview {
  id: string
  reportId: string
  reportRevision: number
  contentHash: string
  sourceFingerprint: string
  checkerVersion: string
  taskId: string
  status: AnalysisReportSummary['status']
  error: string
  stale: boolean
  createdAt: number
  coverage: AnalysisReviewCoverage
  result?: AnalysisFactResult
}
/** Bounded, version-bound context; old writing snapshots need no backfill. */
export interface AnalysisReferenceReview {
  contentHash: string
  sourceFingerprint: string
  checkerVersion: string
  quoteIssues: number
  factIssues: number
  checkedSegments: number
  partial: boolean
  issues: Array<{ original: string; kind: string; explanation: string; evidence: AnalysisEvidenceMatch[] }>
}
