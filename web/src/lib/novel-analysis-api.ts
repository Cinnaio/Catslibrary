import type { AnalysisReport, AnalysisReportSummary, AnalysisRequest, AnalysisReview, AnalysisSource } from '@shared/novel-analysis'
import { request } from './api'
const path = (novelId: string, id = '') => `/ai/analysis/${encodeURIComponent(novelId)}${id ? `/${encodeURIComponent(id)}` : ''}`
export type AnalysisReviewPreview = AnalysisReview['coverage'] & { revision: number; availableSegments?: AnalysisReview['coverage']['segments'] }
export const novelAnalysisApi = {
  list: (novelId: string, offset = 0) => request<{ reports: AnalysisReportSummary[]; hasMore: boolean }>('GET', `${path(novelId)}?offset=${offset}`, null, true),
  read: (novelId: string, id: string) => request<AnalysisReport>('GET', path(novelId, id), null, true),
  create: (novelId: string, input: AnalysisRequest, requestId: string) => request<{ reportId: string; taskId: string }>('POST', path(novelId), { request: input, requestId }, true),
  source: (novelId: string, id: string, sourceId: string) => request<AnalysisSource>('GET', `${path(novelId, id)}/sources/${encodeURIComponent(sourceId)}`, null, true),
  edit: (novelId: string, id: string, content: string, revision: number) => request('PATCH', path(novelId, id), { content, revision }, true),
  stop: (novelId: string, id: string) => request('POST', `${path(novelId, id)}/stop`, {}, true),
  resume: (novelId: string, id: string) => request('POST', `${path(novelId, id)}/resume`, {}, true),
  reviewPreview: (novelId: string, id: string, paragraphStarts?: number[]) => request<AnalysisReviewPreview>('GET', `${path(novelId, id)}/review-preview${paragraphStarts ? `?paragraphStarts=${paragraphStarts.join(',')}` : ''}`, null, true),
  review: (novelId: string, id: string, input: { requestId: string; revision: number; paragraphStarts?: number[] }) => request<{ reviewId: string; taskId: string; created: boolean }>('POST', `${path(novelId, id)}/reviews`, input, true),
  stopReview: (novelId: string, id: string, reviewId: string) => request('POST', `${path(novelId, id)}/reviews/${encodeURIComponent(reviewId)}/stop`, {}, true),
  applyReview: (novelId: string, id: string, reviewId: string, findingId: string, revision: number) => request('POST', `${path(novelId, id)}/reviews/${encodeURIComponent(reviewId)}/apply`, { findingId, revision }, true),
}
