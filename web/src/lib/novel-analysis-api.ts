import type { AnalysisReport, AnalysisReportSummary, AnalysisRequest, AnalysisSource } from '@shared/novel-analysis'
import { request } from './api'
const path = (novelId: string, id = '') => `/ai/analysis/${encodeURIComponent(novelId)}${id ? `/${encodeURIComponent(id)}` : ''}`
export const novelAnalysisApi = {
  list: (novelId: string, offset = 0) => request<{ reports: AnalysisReportSummary[]; hasMore: boolean }>('GET', `${path(novelId)}?offset=${offset}`, null, true),
  read: (novelId: string, id: string) => request<AnalysisReport>('GET', path(novelId, id), null, true),
  create: (novelId: string, input: AnalysisRequest, requestId: string) => request<{ reportId: string; taskId: string }>('POST', path(novelId), { request: input, requestId }, true),
  source: (novelId: string, id: string, sourceId: string) => request<AnalysisSource>('GET', `${path(novelId, id)}/sources/${encodeURIComponent(sourceId)}`, null, true),
  edit: (novelId: string, id: string, content: string, revision: number) => request('PATCH', path(novelId, id), { content, revision }, true),
  stop: (novelId: string, id: string) => request('POST', `${path(novelId, id)}/stop`, {}, true),
  resume: (novelId: string, id: string) => request('POST', `${path(novelId, id)}/resume`, {}, true),
}
