export const FOLLOWUP_LABELS = {
  enabled: '已开启',
  paused: '手动暂停',
  completed: '完结默认关闭',
  unconfigured: '配置不足',
  available: '可追更未开启',
} as const
export const SOURCE_LABELS = { configured: '配置完整', link: '仅有来源链接', none: '无有效来源' } as const
export type FollowupCategory = keyof typeof FOLLOWUP_LABELS
export type SourceCategory = keyof typeof SOURCE_LABELS
export interface SourceAnalyticsBook {
  id: string
  title: string
  author: string
  status: string
  chapterCount: number
  coverUrl?: string | null
  sourceUrl: string
  sources: Array<{ url: string; host: string; kind: string }>
  site: string
  sourceCategory: SourceCategory
  followupCategory: FollowupCategory
  attention: boolean
  active: boolean
  intervalHours: number
  checkedAt: number
  nextCheckAt: number
  result: string
  message: string
  failures: number | null
  pending: number | null
  protected: number | null
  updatedAt: number
}
export interface SourceAnalyticsGroup {
  site: string
  total: number
  configured: number
  link: number
  none: number
  followups: Record<FollowupCategory, number>
  attention: number
}
export interface SourceAnalyticsResponse {
  snapshotAt: number
  view: 'primary' | 'all'
  total: number
  withSource: number
  configured: number
  attention: number
  followups: Record<FollowupCategory, number>
  groups: SourceAnalyticsGroup[]
  books: SourceAnalyticsBook[]
  filteredTotal: number
  page: number
  totalPages: number
  limit: number
}
