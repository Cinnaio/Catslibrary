import { ANALYSIS_OUTPUT_TOKENS, type AnalysisPhase } from '@shared/novel-analysis'
import type { AiSettings } from './settings'
import { readConsolidationState, type ConsolidationState } from './novel-analysis-consolidation'

export interface AnalysisOutputLimits { reading: number; condensing: number; report: number }
export const analysisOutputLimits = (settings: AiSettings): AnalysisOutputLimits => ({
  reading: settings.novelAnalysisReadingMaxTokens,
  condensing: settings.novelAnalysisCondenseMaxTokens,
  report: settings.novelAnalysisReportMaxTokens,
})
export function readAnalysisOutputLimits(params: string, settings: AiSettings): AnalysisOutputLimits {
  const fallback = analysisOutputLimits(settings)
  try {
    const value = JSON.parse(params).outputLimits
    if (!value || typeof value !== 'object') return fallback
    for (const key of ['reading', 'condensing', 'report'] as const) {
      if (!Number.isSafeInteger(value[key]) || value[key] < ANALYSIS_OUTPUT_TOKENS.min || value[key] > ANALYSIS_OUTPUT_TOKENS.max) return fallback
    }
    return { reading: value.reading, condensing: value.condensing, report: value.report }
  } catch { return fallback }
}
export function readAnalysisProgress(result?: string): { phase?: AnalysisPhase; consolidation: ConsolidationState; reportRequests: number } {
  try {
    const value = JSON.parse(result || '{}')
    return { phase: ['reading', 'condensing', 'report'].includes(value?.phase) ? value.phase : undefined,
      consolidation: readConsolidationState(value?.consolidation),
      reportRequests: Number.isSafeInteger(value?.reportRequests) && value.reportRequests >= 0 ? value.reportRequests : 0 }
  } catch { return { consolidation: readConsolidationState(null), reportRequests: 0 } }
}
