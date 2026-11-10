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
}
