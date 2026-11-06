import { url } from './api'

/** 已入库小说统一走当前封面端点，避免列表直接展示旧的源站/入库封面 URL。 */
export function coverUrl(novel: { id: string; updatedAt?: number }, size: 320 | 1024 | 'original' = 320): string {
  if (!novel.id || novel.id.startsWith('demo_')) return ''
  return url(`/cover/${encodeURIComponent(novel.id)}?v=${encodeURIComponent(novel.updatedAt || 0)}&cover=5&size=${size}`)
}
