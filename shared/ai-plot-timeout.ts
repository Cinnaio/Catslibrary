/** 情节推荐与按情节生成大纲共用的单次模型等待上限。 */
export const PLOT_TIMEOUT_DEFAULT_SECONDS = 180
export const PLOT_TIMEOUT_MIN_SECONDS = 30
export const PLOT_TIMEOUT_MAX_SECONDS = 600
export const PLOT_TIMEOUT_RESPONSE_GRACE_MS = 10_000

export function normalizePlotTimeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PLOT_TIMEOUT_DEFAULT_SECONDS
  return Math.max(PLOT_TIMEOUT_MIN_SECONDS, Math.min(PLOT_TIMEOUT_MAX_SECONDS, Math.trunc(value)))
}
