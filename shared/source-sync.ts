/** 后端给出更新类型，前端只负责解释，不再次解析标题。 */
export const TITLE_UPDATE_REASON_LABELS = {
  'import-prefix': '清理导入编号',
  'promo-cleanup': '清理推广水印',
  'rating-marker': '同步源站章节标记',
  typography: '统一标点、空白与全半角',
  'split-title': '补全拆分章节名',
  'source-title': '同步源站标题',
} as const

export type TitleUpdateReason = keyof typeof TITLE_UPDATE_REASON_LABELS
