import { useEffect, useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { aiApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import { Button } from '@/components/ui/button'
import { formatCost } from './shared'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import styles from '../calls.module.css'
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

/** 以服务端日期键补齐空档，并保留滚动时间范围首尾的所有真实数据。 */
function buildChartSeries(trend: TrendPoint[], days: number): TrendPoint[] {
  const map = new Map(trend.map((point) => [point.date, point]))
  const end = new Date().toISOString().slice(0, 10)
  const dates = new Set(trend.map((point) => point.date))
  for (let i = 0; i < days; i++) {
    dates.add(new Date(Date.parse(`${end}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10))
  }
  return [...dates].sort().map((date) => map.get(date) ?? {
    date, calls: 0, promptTokens: 0, completionTokens: 0, costMillicents: 0, costReportedCalls: 0,
  })
}

type Metric = 'cost' | 'calls' | 'tokens'
interface AiUsagePanelProps {
  days?: number
  refreshKey?: number
  onLoadingChange?: (loading: boolean) => void
}

export default function AiUsagePanel({ days = 30, refreshKey = 0, onLoadingChange }: AiUsagePanelProps = {}) {
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [metric, setMetric] = useState<Metric>('cost')
  const configured = useAiConfigured()
  const chartId = useId()

  useEffect(() => {
    let active = true
    setLoading(true)
    void aiApi.audit.trend(days).then((res) => {
      if (!active) return
      setTrend(res.trend)
      setError('')
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '加载用量失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [days, refreshKey, retryKey])

  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])

  const retry = () => setRetryKey((value) => value + 1)
  const totalCalls = trend.reduce((sum, point) => sum + point.calls, 0)
  const totalCost = trend.reduce((sum, point) => sum + point.costMillicents, 0)
  const totalTokens = trend.reduce((sum, point) => sum + point.promptTokens + point.completionTokens, 0)
  const reportedCalls = trend.reduce((sum, point) => sum + (point.costReportedCalls ?? point.calls), 0)
  const cacheRead = trend.reduce((sum, point) => sum + (point.cacheReadTokens ?? 0), 0)
  const cacheWrite = trend.reduce((sum, point) => sum + (point.cacheWriteTokens ?? 0), 0)
  const cacheReadReports = trend.reduce((sum, point) => sum + (point.cacheReadReportedCalls ?? 0), 0)
  const cacheWriteReports = trend.reduce((sum, point) => sum + (point.cacheWriteReportedCalls ?? 0), 0)
  const hasData = trend.length > 0
  const unavailable = !hasData && (loading || Boolean(error))
  const costMissing = totalCalls > 0 && reportedCalls === 0
  const compactCost = totalCost > 0 && totalCost < 10 ? '<0.0001' : (totalCost / 100_000).toLocaleString('en-US', { maximumFractionDigits: 4 })
  const chartData = buildChartSeries(trend, days).map((point) => ({
    ...point,
    costMillicents: point.calls > 0 && point.costReportedCalls === 0 ? null : point.costMillicents,
  }))

  return (
    <section className={styles.summary} aria-label="AI 用量概览" aria-busy={loading}>
      <div className={styles.summaryHeading}>
        <div>
          <h3>用量概览</h3>
          <p>最近 {days} 天 · 全部调用{loading && hasData ? ' · 正在更新…' : ''}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={!hasData} aria-expanded={isOpen} aria-controls={chartId} onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? '收起趋势' : '查看趋势'}
          <ChevronRight className={cn(styles.chevron, isOpen && styles.rotated)} aria-hidden="true" />
        </Button>
      </div>
      <dl className={styles.metrics}>
        <div>
          <dt>调用次数</dt>
          <dd>{unavailable ? '—' : totalCalls.toLocaleString()}<small>次</small></dd>
          <p>所选时段的全部类型</p>
        </div>
        <div>
          <dt>已回传成本</dt>
          <dd title={costMissing ? undefined : formatCost(totalCost)} aria-label={unavailable ? '暂不可用' : costMissing ? '未回传' : `已回传成本 ${formatCost(totalCost)}`}>
            {unavailable ? '—' : costMissing ? '未回传' : compactCost}
          </dd>
          <p>{unavailable ? '等待读取费用记录' : `金额已回传 ${reportedCalls} / ${totalCalls} 次`}</p>
        </div>
        <div>
          <dt>Token 消耗</dt>
          <dd title={totalTokens.toLocaleString()}>{unavailable ? '—' : formatTokenCount(totalTokens)}</dd>
          <p>输入与输出合计</p>
        </div>
      </dl>
      <p className={styles.note}>金额按上游回传值汇总，未统一币种；请在调用详情中核对币种与费用来源。</p>
      {!hasData && loading ? <LoadingState label="正在加载用量" />
        : !hasData && error ? <ErrorState message={`用量加载失败：${error}`} onRetry={retry} />
        : !hasData ? <AiPanelEmptyState configured={configured} unconfiguredMessage="尚未配置文本 AI 供应商，暂时没有用量可统计" unconfiguredHint="配置文本供应商后，这里会显示调用次数、Token 与成本趋势。" emptyMessage="所选范围内没有 AI 调用记录" hint={`最近 ${days} 天内没有调用；可切换其他时间范围。`} />
        : error ? <InlineError message={`用量更新失败，保留上次结果：${error}`} onRetry={retry} /> : null}
      <div id={chartId} hidden={!isOpen}>
        {isOpen && hasData && (
          <Tabs value={metric} onValueChange={(value) => setMetric(value as Metric)} className={styles.trend}>
            <div className={styles.trendHeading}>
              <h4>每日用量趋势</h4>
              <TabsList aria-label="用量趋势指标">
                <TabsTrigger value="cost">成本</TabsTrigger>
                <TabsTrigger value="calls">调用</TabsTrigger>
                <TabsTrigger value="tokens">Token</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value={metric}>
              <div className={styles.chart} role="group" aria-label={`最近 ${days} 天的${metric === 'cost' ? '已回传成本' : metric === 'calls' ? '调用次数' : '输入与输出 Token'}趋势图，可用键盘方向键浏览每日数据`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} accessibilityLayer margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...chartGrid} />
                    <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5).replace('-', '/')} tick={chartTick} tickLine={false} axisLine={chartAxisLine} minTickGap={28} />
                    <YAxis tick={chartTick} tickLine={false} axisLine={false} width={metric === 'cost' ? 76 : 52} allowDecimals={metric === 'cost'} tickFormatter={metric === 'cost' ? formatCost : formatTokenCount} />
                    <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} formatter={(value, name) => [metric === 'cost' ? formatCost(Number(value)) : Number(value).toLocaleString(), name as string]} />
                    {metric === 'cost' && <Area type="monotone" dataKey="costMillicents" name="已回传成本" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.08} strokeWidth={2} connectNulls={false} isAnimationActive={false} />}
                    {metric === 'calls' && <Bar dataKey="calls" name="调用次数" fill="var(--accent)" fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
                    {metric === 'tokens' && <>
                      <Legend wrapperStyle={chartLegendStyle} iconType="plainline" />
                      <Area type="monotone" dataKey="promptTokens" name="输入 Token" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
                      <Line type="monotone" dataKey="completionTokens" name="输出 Token" stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </>}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className={styles.note}>{metric === 'cost'
                ? `仅统计已回传金额，平均每次 ${reportedCalls ? formatCost(totalCost / reportedCalls) : '未回传'}；币种以单条详情为准。`
                : metric === 'tokens'
                  ? `缓存读取 ${cacheReadReports ? formatTokenCount(cacheRead) : '未回传'}（${cacheReadReports} 次回传） · 缓存写入 ${cacheWriteReports ? formatTokenCount(cacheWrite) : '未回传'}（${cacheWriteReports} 次回传）。缓存已包含在输入 Token 中。`
                  : '按日汇总全部类型调用，记录列表可进一步按类型筛选。'}</p>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </section>
  )
}
