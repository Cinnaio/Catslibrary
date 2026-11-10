import { ANALYSIS_KINDS, type AnalysisRequest } from '@shared/novel-analysis'
import { getStorageScope } from '@/lib/storage'

export interface PendingAnalysis { id: string; request: AnalysisRequest }
export function analysisPendingKey(novelId: string) {
  const scope = getStorageScope()
  return scope.startsWith('user:') ? `novel-analysis:${JSON.stringify([scope, novelId])}` : ''
}
export function readPendingAnalysis(key: string): PendingAnalysis | null {
  try {
    const value = JSON.parse(key ? sessionStorage.getItem(key) || 'null' : 'null')
    const r = value?.request
    return value && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{8,160}$/.test(value.id)
      && r && Object.hasOwn(ANALYSIS_KINDS, r.kind) && typeof r.startChapterId === 'string'
      && typeof r.endChapterId === 'string' && typeof r.question === 'string' && r.question.length <= 2000 ? value : null
  } catch { return null }
}
export function savePendingAnalysis(key: string, value: PendingAnalysis | null) {
  if (!key) return
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
  } catch { /* Keep the in-memory request when browser storage is unavailable. */ }
}

export interface AnalysisDraft { content: string; revision: number }
export function readAnalysisDraft(key: string): AnalysisDraft | null {
  try {
    const value = JSON.parse(key ? sessionStorage.getItem(key) || 'null' : 'null')
    return value && typeof value.content === 'string' && value.content.length <= 50000 && Number.isSafeInteger(value.revision) ? value : null
  } catch { return null }
}
export function saveAnalysisDraft(key: string, value: AnalysisDraft | null) {
  if (!key) return
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
  } catch { /* The editor still retains the current input in memory. */ }
}
