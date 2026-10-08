export type BatchFollowupMode = 'enable' | 'pause' | 'frequency'
export const FOLLOWUP_INTERVAL_HOURS = [1, 3, 6, 12, 24] as const
export const MAX_BATCH_FOLLOWUPS = 500
export interface BatchFollowupResult {
  results: Array<{ novelId: string; title: string; status: 'saved' | 'skipped'; reason: string }>
  saved: number
  skipped: number
}
