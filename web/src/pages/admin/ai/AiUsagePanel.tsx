import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { aiApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
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

/** 紧凑格式化 Token 数量（K / M / B），千以内保留完整数值。 */
export function formatTokenCount(n: number): string {
  if (n == null || isNaN(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}B`
  }
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.?0+$/, '')}K`
  }
  return n.toLocaleString()
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
  const [localDays] = useState(30)
  const days = selectedDays ?? localDays
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(true)
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
    costMillicents: point.calls > 0 && point.costReportedCalls === 0 ? null : point.costMillicents,
  }))

  const hasData = trend.length > 0
  const isInitialFailed = !hasData && Boolean(error)
  const isInitialLoading = !hasData && loading

  return (
    <section className="calls-summary-card" aria-label="用量趋势与消耗总账">
      {/* 暖纸总账卡卡头：支持整行轻触展开/折叠，右侧聚合大盘读数胶囊 */}
      <div
        className="calls-summary-card__header"
        onClick={() => setIsOpen((prev) => !prev)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls="calls-summary-body"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsOpen((prev) => !prev)
          }
        }}
      >
        <div className="calls-summary-card__title-group">
          <ChevronRight className={cn('calls-summary-card__chevron', isOpen && 'is-open')} aria-hidden="true" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="calls-summary-card__title">用量趋势与消耗</h3>
              <span className="text-[11px] text-muted-foreground">
                {isOpen ? '点击收起' : '点击展开'}
              </span>
            </div>
            <p className="calls-summary-card__subtitle">最近 {days} 天大盘消耗分析与支出总账</p>
          </div>
        </div>

        <div
          className="calls-summary-badges"
          onClick={(e) => {
            // 点击读数与操作区域阻止冒泡，避免误触卡片折叠
            e.stopPropagation()
          }}
        >
          {hasData && (
            <>
              <span className="calls-summary-badge">
                调用 <strong>{totalCalls.toLocaleString()}</strong>
              </span>
              <span className="calls-summary-badge">
                成本 <strong>{totalCalls > 0 && costReportedCalls === 0 ? '未回传' : formatCost(totalCost)}</strong>
              </span>
              <span className="calls-summary-badge" title={`${totalTokens.toLocaleString()} Token`}>
                Token <strong>{formatTokenCount(totalTokens)}</strong>
              </span>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            onClick={(e) => {
              e.stopPropagation()
              void loadTrend()
            }}
            disabled={loading}
            aria-label="刷新用量趋势"
            title="刷新用量趋势"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {isOpen && (
        <div id="calls-summary-body" className="calls-summary-card__body">
          {isInitialLoading ? (
            <LoadingState label="正在加载用量趋势" className="calls-chart-state" />
          ) : isInitialFailed ? (
            <ErrorState message={`用量趋势加载失败：${error}`} onRetry={() => void loadTrend()} className="calls-chart-state" />
          ) : !hasData ? (
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
              <div className="calls-trend-grid">
                {/* 成本与调用趋势 */}
                <div className="calls-sub-card">
                  <div className="calls-sub-card__header">
                    <h4 className="calls-sub-card__title">成本与调用趋势</h4>
                  </div>
                  <div className="ai-usage-totals">
                    <span>
                      总调用次数 <strong>{totalCalls.toLocaleString()}</strong>
                    </span>
                    <span>
                      {costReportedCalls < totalCalls ? '已回传成本' : '总预估成本'}{' '}
                      <strong>{totalCalls > 0 && costReportedCalls === 0 ? '未回传' : formatCost(totalCost)}</strong>
                    </span>
                    <span>
                      平均单次成本 <strong>{totalCalls > 0 && costReportedCalls === 0 ? '未回传' : formatCost(avgCost)}</strong>
                    </span>
                    {costReportedCalls < totalCalls && (
                      <span className="ai-usage-totals__note">金额已回传 {costReportedCalls} / {totalCalls} 次</span>
                    )}
                  </div>
                  <div className="calls-chart-body">
                    <div className="calls-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                          <Bar yAxisId="calls" dataKey="calls" name="调用次数" fill="var(--admin-accent, #d97757)" radius={[3, 3, 0, 0]} opacity={0.16} />
                          <Line yAxisId="cost" type="monotone" dataKey="costMillicents" name="成本" stroke="var(--admin-accent, #d97757)" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Token 消耗趋势 */}
                <div className="calls-sub-card">
                  <div className="calls-sub-card__header">
                    <h4 className="calls-sub-card__title">Token 消耗趋势</h4>
                  </div>
                  <div className="ai-usage-totals">
                    <span>
                      总 Token <strong title={`${totalTokens.toLocaleString()} Token`}>{formatTokenCount(totalTokens)}</strong>
                    </span>
                    <span>
                      缓存读取{' '}
                      <strong title={totalCacheRead > 0 ? `${totalCacheRead.toLocaleString()} Token` : undefined}>
                        {cacheReadReportedCalls === 0 && totalCalls > 0 ? '未回传' : formatTokenCount(totalCacheRead)}
                      </strong>
                    </span>
                    <span>
                      缓存写入{' '}
                      <strong title={totalCacheWrite > 0 ? `${totalCacheWrite.toLocaleString()} Token` : undefined}>
                        {cacheWriteReportedCalls === 0 && totalCalls > 0 ? '未回传' : formatTokenCount(totalCacheWrite)}
                      </strong>
                    </span>
                    {totalCalls > 0 && (
                      <span className="ai-usage-totals__note" title="仅汇总已回传字段的调用，缓存计数已包含在输入 Token 中">
                        读取已回传 {cacheReadReportedCalls} / {totalCalls} 次 · 写入已回传 {cacheWriteReportedCalls} / {totalCalls} 次
                      </span>
                    )}
                  </div>
                  <div className="calls-chart-body">
                    <div className="calls-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="promptGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#4F7A52" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#4F7A52" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="completionGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#D97757" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#D97757" stopOpacity={0} />
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
                            tickFormatter={formatTokenCount}
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
                            stroke="#4F7A52"
                            strokeWidth={2}
                            fill="url(#promptGradient)"
                            stackId="tokens"
                          />
                          <Area
                            type="monotone"
                            dataKey="completionTokens"
                            name="输出 Token"
                            stroke="#D97757"
                            strokeWidth={2}
                            fill="url(#completionGradient)"
                            stackId="tokens"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

