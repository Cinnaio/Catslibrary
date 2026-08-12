/** 用量统计：成本/调用趋势与 Token 消耗趋势图表。 */
import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { aiApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UsageCell, formatCost } from './shared'

interface TrendPoint {
  date: string
  calls: number
  promptTokens: number
  completionTokens: number
  costMillicents: number
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
    })
  }
  return result
}

export default function AiUsagePanel() {
  const { toast } = useToast()
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadTrend() {
      setLoading(true)
      try {
        const res = await aiApi.audit.trend(days)
        setTrend(res.trend)
      } catch (err) {
        toast((err as Error).message || '加载趋势失败', 'error')
      } finally {
        setLoading(false)
      }
    }
    void loadTrend()
  }, [days, toast])

  const totalCalls = trend.reduce((sum, d) => sum + d.calls, 0)
  const totalCost = trend.reduce((sum, d) => sum + d.costMillicents, 0)
  const totalTokens = trend.reduce((sum, d) => sum + d.promptTokens + d.completionTokens, 0)
  const avgCost = totalCalls > 0 ? totalCost / totalCalls : 0

  // 图表数据：补齐缺失日期，让曲线连续
  const chartData = buildChartSeries(trend, days)

  return (
    <div className="space-y-4">
      {/* 总览统计卡片 */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
        <UsageCell label="总调用次数" value={totalCalls} />
        <UsageCell label="总成本" value={formatCost(totalCost)} />
        <UsageCell label="总 Token" value={totalTokens} />
        <UsageCell label="平均单次成本" value={formatCost(avgCost)} />
      </div>

      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <CardTitle className="text-base">成本与调用趋势</CardTitle>
            <p className="text-sm text-muted-foreground">每日 AI 调用次数与成本消耗</p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
                {d} 天
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {loading ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">暂无数据</div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="calls"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <YAxis
                    yAxisId="cost"
                    orientation="right"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tickFormatter={(v: number) => formatCost(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                    }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                    formatter={(value, name) => {
                      if (name === '成本') return [formatCost(Number(value)), name as string]
                      return [Number(value).toLocaleString(), name as string]
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                    iconType="circle"
                  />
                  <Bar
                    yAxisId="calls"
                    dataKey="calls"
                    name="调用次数"
                    fill="var(--color-success)"
                    radius={[3, 3, 0, 0]}
                    opacity={0.7}
                  />
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
          )}
        </CardContent>
      </Card>

      {/* Token 消耗趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token 消耗趋势</CardTitle>
          <p className="text-sm text-muted-foreground">每日输入/输出 Token 用量</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">暂无数据</div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="promptGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="completionGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                    }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                    formatter={(value, name) => [Number(value).toLocaleString(), name as string]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} iconType="circle" />
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
