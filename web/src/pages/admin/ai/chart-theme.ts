/**
 * AI 用量图表的主题常量。recharts 的轴、Tooltip、Legend 只接受内联 style 对象，
 * 无法读 Tailwind 类；颜色侧仍以 var(...) 引用 token（双主题自适应），字号与圆角
 * 则是字面值。原先这些值散在 AiUsagePanel 里逐处重写，两处 Tooltip 与两处 Legend
 * 配置逐字重复 —— 集中到此，改一处即全图表生效。
 *
 * 独立成文件而非并入 shared.tsx：shared.tsx 导出组件，混入非组件导出会触发
 * react-refresh/only-export-components（实测使该文件警告由 2 条增至 8 条）。
 *
 * 字号取后台紧凑档的 12px 计数/元信息档（DESIGN.md Compact Label Scale）。recharts
 * 把 tick 渲成 SVG text，跟随系统字体渲染而非 --admin-* 字号 token，故此处必须以
 * 数值给出。
 */
const CHART_LABEL_FONT_SIZE = 12
const CHART_TOOLTIP_RADIUS = '8px'

/** 轴刻度文字：统一弱化色 + 紧凑字号。 */
export const chartTick = { fontSize: CHART_LABEL_FONT_SIZE, fill: 'var(--text-muted)' }

/** 轴描边：仅保留必要的分隔线，颜色取自 token。 */
export const chartAxisLine = { stroke: 'var(--border)' }

/** 网格：只画横向线，避免竖向线与面积图叠加成网。 */
export const chartGrid = { strokeDasharray: '3 3', stroke: 'var(--border)', vertical: false }

/** Tooltip 容器：纸面底 + token 描边，与后台面板表面同源。 */
export const chartTooltipStyle = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: CHART_TOOLTIP_RADIUS,
  fontSize: `${CHART_LABEL_FONT_SIZE}px`,
  color: 'var(--text-primary)',
}

/** Tooltip 标题行：与内容同色但加重，用于区分日期行与数据行。 */
export const chartTooltipLabelStyle = { color: 'var(--text-primary)', fontWeight: 600 }

/** Legend 行：字号随轴刻度，并与图表区留出一档间距。 */
export const chartLegendStyle = {
  fontSize: `${CHART_LABEL_FONT_SIZE}px`,
  paddingTop: '8px',
}
