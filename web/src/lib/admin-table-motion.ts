const ADMIN_TABLE_ROW_STAGGER_WINDOW_MS = 240
const ADMIN_TABLE_ROW_STAGGER_BASE_COUNT = 8

/** 沿用 240ms 错峰窗口，按当前页实际行数平均分配入场延迟。 */
export function getAdminTableRowStaggerDelay(index: number, rowCount: number): number {
  return Math.round(((index + 1) * ADMIN_TABLE_ROW_STAGGER_WINDOW_MS) / Math.max(rowCount, ADMIN_TABLE_ROW_STAGGER_BASE_COUNT))
}
