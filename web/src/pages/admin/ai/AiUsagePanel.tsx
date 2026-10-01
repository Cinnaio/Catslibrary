/** 用量统计：成本/调用趋势与 Token 消耗趋势图表。 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { aiApi } from '@/lib/api'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import { AdminDataPanel, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import { Button } from '@/components/ui/button'
import { formatCost } from './shared'
import { chartAxisLine, chartGrid, chartLegendStyle, chartTick, chartTooltipLabelStyle, chartTooltipStyle } from './chart-theme'

interface TrendPoint {
  date: string
  calls: number
  promptTokens: number
  completionTokens: number
  costMillicents: number
  costReportedCalls?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheReadReportedCalls?: number
  cacheWriteReportedCalls?: number
}

/** 补齐缺失日期，让趋势曲线连续；按 days 范围生成完整日期序列。 */
function buildChartSeries(trend: TrendPoint[], days: number): TrendPoint[] {
  const map = new Map(trend.map((d) => [d.date, d]))
  const result: TrendPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const existing = map.get(dateStr)
    result.push({
      date: dateStr,
      calls: existing?.calls || 0,
      promptTokens: existing?.promptTokens || 0,
      completionTokens: existing?.completionTokens || 0,
      costMillicents: existing?.costMillicents || 0,
      costReportedCalls: existing?.costReportedCalls ?? existing?.calls ?? 0,
    })
  }
  return result
}

export default function AiUsagePanel({ days: selectedDays }: { days?: number } = {}) {
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [localDays, setDays] = useState(30)
  const days = selectedDays ?? localDays
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const configured = useAiConfigured()

  const loadTrend = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.audit.trend(days)
      setTrend(res.trend)
      setError('')
    } catch (err) {
      setError((err as Error).message || '加载趋势失败')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void loadTrend()
  }, [loadTrend])

  const totalCalls = trend.reduce((sum, d) => sum + d.calls, 0)
  const totalCost = trend.reduce((sum, d) => sum + d.costMillicents, 0)
  const totalTokens = trend.reduce((sum, d) => sum + d.promptTokens + d.completionTokens, 0)
  const costReportedCalls = trend.reduce((sum, d) => sum + (d.costReportedCalls ?? d.calls), 0)
  const totalCacheRead = trend.reduce((sum, d) => sum + (d.cacheReadTokens ?? 0), 0)
  const totalCacheWrite = trend.reduce((sum, d) => sum + (d.cacheWriteTokens ?? 0), 0)
  const cacheReadReportedCalls = trend.reduce((sum, d) => sum + (d.cacheReadReportedCalls ?? 0), 0)
  const cacheWriteReportedCalls = trend.reduce((sum, d) => sum + (d.cacheWriteReportedCalls ?? 0), 0)
  const avgCost = costReportedCalls > 0 ? totalCost / costReportedCalls : 0

  // 图表数据：补齐缺失日期，让曲线连续
  const chartData = buildChartSeries(trend, days).map((point) => ({
    ...point,
    // 有调用但没有金额回传时留空，避免画出代表免费调用的零成本曲线。
    costMillicents: point.calls > 0 && point.costReportedCalls === 0 ? null : point.costMillicents,
  }))

  return (
    <div className="calls-trend-grid">
      {/* 合计读数贴在它汇总的那张图上：这是数字唯一的去处，切到别的天数区间它就会
          跟着变。原先它被抬成独立的 AdminMetricStrip，与这张图的标题各说一遍同一
          件事（见 DESIGN.md 的 The No-Third-Pass Rule）。 */}
      <AdminDataPanel className="ai-usage-card" ariaLabel="成本与调用趋势">
        <AdminPanelHeading
          title="成本与调用趋势"
          actions={
            selectedDays == null ? (
              <div className="flex gap-2">
                {[7, 30, 90].map((d) => (
                  <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
                    {d} 天
                  </Button>
                ))}
              </div>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => void loadTrend()} disabled={loading} aria-label="刷新用量趋势" title="刷新用量趋势">
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            )
          }
        />
        {!(trend.length === 0 && (loading || error)) && (
          <span className="ai-usage-totals">
            <span>
              总调用 <strong>{totalCalls.toLocaleString()}</strong>
            </span>
            <span>
              {costReportedCalls < totalCalls ? '已回传成本' : '总成本'}{' '}
              <strong>{totalCalls > 0 && costReportedCalls === 0 ? '未回传' : formatCost(totalCost)}</strong>
            </span>
            <span>
              平均单次 <strong>{totalCalls > 0 && costReportedCalls === 0 ? '未回传' : formatCost(avgCost)}</strong>
            </span>
            {costReportedCalls < totalCalls && (
              <span>
                金额已回传 {costReportedCalls} / {totalCalls} 次
              </span>
            )}
          </span>
        )}
        <div className="calls-chart-body">
          {loading && trend.length === 0 ? (
            <LoadingState label="正在加载用量趋势" className="calls-chart-state" />
          ) : error && trend.length === 0 ? (
            <ErrorState message={`用量趋势加载失败：${error}`} className="calls-chart-state" />
          ) : trend.length === 0 ? (
            <AiPanelEmptyState
              configured={configured}
              unconfiguredMessage="尚未配置文本 AI 供应商，暂时没有用量可统计"
              unconfiguredHint="配置文本供应商后，这里会显示调用次数、Token 与成本趋势。"
              emptyMessage="所选范围内没有 AI 调用记录"
              hint={`最近 ${days} 天内没有调用；可切换到 90 天再看看。`}
            />
          ) : (
            <>
              {error && <InlineError message={error} onRetry={() => void loadTrend()} className="mb-3" />}
              <div className="calls-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...chartGrid} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date: string) => date.slice(5).replace('-', '/')}
                      tick={chartTick}
                      tickLine={false}
                      axisLine={chartAxisLine}
                      minTickGap={24}
                    />
                    <YAxis yAxisId="calls" orientation="right" tick={chartTick} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                    <YAxis yAxisId="cost" tick={chartTick} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => formatCost(v)} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      formatter={(value, name) => {
                        if (name === '成本') return [formatCost(Number(value)), name as string]
                        return [Number(value).toLocaleString(), name as string]
                      }}
                    />
                    <Legend wrapperStyle={chartLegendStyle} iconType="circle" />
                    <Bar yAxisId="calls" dataKey="calls" name="调用次数" fill="var(--accent)" radius={[3, 3, 0, 0]} opacity={0.2} />
                    <Area
                      yAxisId="cost"
                      type="monotone"
                      dataKey="costMillicents"
                      name="成本"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      fill="url(#costGradient)"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </AdminDataPanel>

      {/* Token 消耗趋势 */}
      <AdminDataPanel className="ai-usage-card" ariaLabel="Token 消耗趋势">
        <AdminPanelHeading title="Token 消耗趋势" />
        {!(trend.length === 0 && (loading || error)) && (
          <span className="ai-usage-totals">
            <span>
              总 Token <strong>{totalTokens.toLocaleString()}</strong>
            </span>
            <span>
              缓存读取 <strong>{cacheReadReportedCalls === 0 && totalCalls > 0 ? '未回传' : totalCacheRead.toLocaleString()}</strong>
            </span>
            <span>
              缓存写入 <strong>{cacheWriteReportedCalls === 0 && totalCalls > 0 ? '未回传' : totalCacheWrite.toLocaleString()}</strong>
            </span>
            {totalCalls > 0 && (
              <span title="仅汇总已回传字段的调用，缓存计数已包含在输入 Token 中">
                读取已回传 {cacheReadReportedCalls} / {totalCalls} 次 · 写入已回传 {cacheWriteReportedCalls} / {totalCalls} 次
              </span>
            )}
          </span>
        )}
        <div className="calls-chart-body">
          {loading && trend.length === 0 ? (
            <LoadingState label="正在加载 Token 趋势" className="calls-chart-state" />
          ) : error && trend.length === 0 ? (
            <ErrorState message={`用量统计加载失败：${error}`} onRetry={() => void loadTrend()} className="calls-chart-state" />
          ) : trend.length === 0 ? (
            <AiPanelEmptyState
              configured={configured}
              unconfiguredMessage="尚未配置文本 AI 供应商，暂时没有 Token 用量"
              unconfiguredHint="配置文本供应商后，这里会显示输入/输出 Token 消耗。"
              emptyMessage="所选范围内没有 Token 用量记录"
              hint={`最近 ${days} 天内没有消耗；可切换到 90 天再看看。`}
            />
          ) : (
            <>
              {error && <InlineError message={error} onRetry={() => void loadTrend()} className="mb-3" />}
              <div className="calls-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="promptGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="completionGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...chartGrid} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date: string) => date.slice(5).replace('-', '/')}
                      tick={chartTick}
                      tickLine={false}
                      axisLine={chartAxisLine}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={chartTick}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                      tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      formatter={(value, name) => [Number(value).toLocaleString(), name as string]}
                    />
                    <Legend wrapperStyle={chartLegendStyle} iconType="circle" />
                    <Area
                      type="monotone"
                      dataKey="promptTokens"
                      name="输入 Token"
                      stroke="var(--color-success)"
                      strokeWidth={2}
                      fill="url(#promptGradient)"
                      stackId="tokens"
                    />
                    <Area
                      type="monotone"
                      dataKey="completionTokens"
                      name="输出 Token"
                      stroke="var(--color-info)"
                      strokeWidth={2}
                      fill="url(#completionGradient)"
                      stackId="tokens"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </AdminDataPanel>
    </div>
  )
}
