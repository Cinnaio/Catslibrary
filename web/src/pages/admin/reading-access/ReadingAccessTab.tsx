import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  READING_ACCESS_SUBJECTS, READING_ACCESS_WINDOWS,
  type ReadingAccessHour, type ReadingAccessPolicy, type ReadingAccessSubject, type ReadingAccessSummary, type ReadingAccessWindow,
} from '@shared/reading-access'
import { useSession } from '@/context/SessionContext'
import { adminApi } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { PanelHeading } from '@/components/shared/PanelHeading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MotionDetails } from '@/components/ui/motion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import ReadingAccessSettingsDialog from './ReadingAccessSettingsDialog'
import { displayCount, displayTime, HOUR_MS, MODE_LABEL, SUBJECT_LABEL, WINDOW_LABEL } from './reading-access-ui'
import traffic from '../site-traffic.module.css'
import styles from './reading-access.module.css'

const RANGES = [6, 24, 48]
const METRICS = {
  requests: '正文请求',
  rateLimited: '分钟拒绝',
  flagged: '小时额度异常',
  blocked: '小时额度拦截',
} as const
type Metric = keyof typeof METRICS
const TABLE_FIELDS = {
  requests: METRICS.requests,
  uniqueChapterReads: '不同章节',
  uniqueNovelReads: '不同书籍',
  rateLimited: METRICS.rateLimited,
  flagged: METRICS.flagged,
  blocked: METRICS.blocked,
} as const
const TABLE_KEYS = Object.keys(TABLE_FIELDS) as Array<keyof typeof TABLE_FIELDS>
const METRIC_KEYS = Object.keys(METRICS) as Metric[]
const SUBJECT_HINT = {
  guest: '未登录请求按可信 IP 分桶。',
  account: '同一账号跨会话和 IP 共用额度。',
  ip: '同一可信 IP 下的游客与登录请求共用额度。',
}
const ZERO_HOUR = { requests: 0, uniqueChapterReads: 0, uniqueNovelReads: 0, rateLimited: 0, flagged: 0, blocked: 0 }

export default function ReadingAccessTab() {
  const [params, setParams] = useSearchParams()
  const requestedHours = Number(params.get('hours'))
  const hours = RANGES.includes(requestedHours) ? requestedHours : 24
  const subject = READING_ACCESS_SUBJECTS.find(value => value === params.get('subject')) ?? 'guest'
  const { user } = useSession()
  const [data, setData] = useState<ReadingAccessSummary | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [request, setRequest] = useState<{ hours: number; refresh: number; error: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const active = data?.hours === hours ? data : null
  const pending = request?.hours !== hours || request.refresh !== refresh
  const error = pending ? '' : request.error
  const load = () => setRefresh(value => value + 1)

  useEffect(() => {
    let current = true
    void adminApi.readingAccess.summary(hours).then(result => {
      if (!current) return
      if (!result.minuteLimits || !Number.isFinite(result.generatedAt)) throw new Error('当前 API 版本缺少阅读防护面板所需数据。')
      setData(result)
      setRequest({ hours, refresh, error: '' })
    }).catch((err: Error) => {
      if (current) setRequest({ hours, refresh, error: err.message || '阅读防护统计加载失败。' })
    })
    return () => { current = false }
  }, [hours, refresh])

  function select(key: 'hours' | 'subject', value: string) {
    setParams(current => {
      const next = new URLSearchParams(current)
      next.set(key, value)
      return next
    })
  }

  return <AdminPage title="阅读防护" actions={
      <div className={styles.pageActions}>
        <Select value={String(hours)} onValueChange={value => select('hours', value)}>
          <SelectTrigger aria-label="统计时段"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map(value => <SelectItem key={value} value={String(value)}>近 {value} 小时</SelectItem>)}</SelectContent>
        </Select>
        <Select value={subject} onValueChange={value => select('subject', value)}>
          <SelectTrigger aria-label="统计对象"><SelectValue /></SelectTrigger>
          <SelectContent>{READING_ACCESS_SUBJECTS.map(value => <SelectItem key={value} value={value}>{SUBJECT_LABEL[value]}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={pending} onClick={load}><RefreshCw aria-hidden="true" />{pending ? '刷新中…' : '刷新'}</Button>
        {user?.role === 'super_admin' && <ReadingAccessSettingsDialog subject={subject} onSave={() => { setSaved(true); load() }} />}
      </div>
    }>
    {saved && <p className={styles.note} role="status">防护配置已保存。</p>}
    <div className={traffic.content} aria-busy={pending}>
      {pending && active && <p role="status" className={styles.note}>正在刷新，暂时显示上次统计。</p>}
      {error && active && <InlineError message={`${error} 当前显示上次统计。`} onRetry={load} />}
      {active ? <ReadingAccessResults data={active} subject={subject} pending={pending} />
        : <Card><CardContent>{pending ? <LoadingState label="正在读取阅读防护统计" /> : <ErrorState message={error} onRetry={load} />}</CardContent></Card>}
    </div>
  </AdminPage>
}

function ReadingAccessResults({ data, subject, pending }: { data: ReadingAccessSummary; subject: ReadingAccessSubject; pending: boolean }) {
  const [metric, setMetric] = useState<Metric>('requests')
  const [window, setWindow] = useState<ReadingAccessWindow>(10)
  const rows = data.byHour.filter(row => row.subjectKind === subject)
  const totals = rows.reduce<Pick<ReadingAccessHour, Metric>>((total, row) => ({
    requests: total.requests + row.requests, rateLimited: total.rateLimited + row.rateLimited,
    flagged: total.flagged + row.flagged, blocked: total.blocked + row.blocked,
  }), ZERO_HOUR)
  const latestHour = Math.floor(data.generatedAt / HOUR_MS) * HOUR_MS
  const byHour = new Map(rows.map(row => [Number(row.hour), row]))
  const trend = Array.from({ length: data.hours }, (_, index) => {
    const hour = latestHour - (data.hours - index - 1) * HOUR_MS
    return byHour.get(hour) ?? { ...ZERO_HOUR, hour }
  })
  const signals = data.signals.filter(row => row.subjectKind === subject && row.windowMinutes === window)
  const batch = `${data.hours}:${subject}`

  return <>
    <Card className={styles.panel}>
      <PanelHeading title="请求概览" className={styles.panelHeading} description={`北京时间 ${displayTime(data.generatedAt)} 更新`} status={<span className={styles.mode}>{MODE_LABEL[data.mode]}</span>} />
      <CardContent className={styles.panelContent}>
        <dl className={styles.metrics}>
          {METRIC_KEYS.map(key => <div key={key}>
            <dt>{METRICS[key]}</dt><dd className={traffic.metricValue}>{displayCount(totals[key])}</dd>
          </div>)}
        </dl>
        <ReadingAccessLimits policy={data} subject={subject} />
        {rows.length ? <section className={styles.trend} aria-label="小时趋势">
          <div className={styles.subheading}>
            <h4>小时趋势</h4>
            <Select value={metric} onValueChange={(value: Metric) => setMetric(value)}>
              <SelectTrigger aria-label="趋势指标"><SelectValue /></SelectTrigger>
              <SelectContent>{METRIC_KEYS.map(key => <SelectItem key={key} value={key}>{METRICS[key]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className={styles.chart} role="group" aria-label={`${SUBJECT_LABEL[subject]}的${METRICS[metric]}趋势，完整数值见小时明细`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart accessibilityLayer data={trend} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" minTickGap={40} tickFormatter={displayTime} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis allowDecimals={false} width={56} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as ReadingAccessHour | undefined
                  return active && row ? <div className={traffic.tooltip}><strong>{displayTime(Number(row.hour))}</strong><p>{METRICS[metric]} {displayCount(row[metric])}</p></div> : null
                }} />
                <Line type="linear" name={METRICS[metric]} dataKey={metric} stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <MotionDetails>
            <summary className={styles.summary}>小时明细</summary>
            <p className={styles.note}>含当前小时。不同章节和书籍按单个对象去重，达到上限后停止累计新条目。各对象可能统计同一次请求。</p>
            <AdminDataPanel ariaLabel="小时明细">
              <Table className={tableClass(pending)}>
                <TableCaption className="sr-only">正文访问小时明细</TableCaption>
                <TableHeader><TableRow><TableHead scope="col">小时（北京时间）</TableHead>{TABLE_KEYS.map(key => <TableHead scope="col" key={key}>{TABLE_FIELDS[key]}</TableHead>)}</TableRow></TableHeader>
                <TableBody key={batch}>
                  {[...trend].reverse().map((row, index) => <TableRow key={row.hour} style={stagger(index, trend.length)}>
                    <TableCell>{displayTime(Number(row.hour))}</TableCell>
                    {TABLE_KEYS.map(key => <TableCell key={key}>{displayCount(row[key])}</TableCell>)}
                  </TableRow>)}
                </TableBody>
              </Table>
            </AdminDataPanel>
          </MotionDetails>
        </section> : <p className={styles.note}>所选时段暂无{SUBJECT_LABEL[subject]}正文请求记录。</p>}
      </CardContent>
    </Card>
    <Card className={styles.panel}>
      <PanelHeading title="异常窗口" className={styles.panelHeading} actions={
        <Select value={String(window)} onValueChange={value => setWindow(Number(value) as ReadingAccessWindow)}>
          <SelectTrigger aria-label="异常窗口时长"><SelectValue /></SelectTrigger>
          <SelectContent>{READING_ACCESS_WINDOWS.map(value => <SelectItem key={value} value={String(value)}>{WINDOW_LABEL[value]}</SelectItem>)}</SelectContent>
        </Select>
      } />
      <CardContent className={styles.panelContent}>
        {signals.length ? <>
          <p className={styles.note}>按窗口起点列出。异常次数包含已拦截的请求。</p>
          <AdminDataPanel ariaLabel="异常窗口明细">
          <Table className={tableClass(pending)}>
            <TableHeader><TableRow><TableHead scope="col">开始时间（北京时间）</TableHead><TableHead scope="col">命中主体</TableHead><TableHead scope="col">异常次数</TableHead><TableHead scope="col">拦截次数</TableHead></TableRow></TableHeader>
            <TableBody key={`${batch}:${window}`}>
              {signals.map((row, index) => <TableRow key={row.windowStart} style={stagger(index, signals.length)}>
                <TableCell>{displayTime(Number(row.windowStart))}</TableCell>
                <TableCell>{displayCount(row.subjects)}</TableCell>
                <TableCell>{displayCount(row.flagged)}</TableCell>
                <TableCell>{displayCount(row.blocked)}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
          </AdminDataPanel>
        </> : <p className={styles.note}>所选时段没有对应的异常窗口。</p>}
      </CardContent>
    </Card>
  </>
}

function ReadingAccessLimits({ policy, subject }: { policy: ReadingAccessPolicy; subject: ReadingAccessSubject }) {
  return <section className={styles.limitStrip} aria-label="当前生效阈值">
    <div>
      <h4>生效阈值 <span>· {SUBJECT_LABEL[subject]}</span></h4>
      <p className={styles.note}>{SUBJECT_HINT[subject]}</p>
    </div>
    <dl className={styles.limits}>
      <div><dt>每分钟</dt><dd>{displayCount(policy.minuteLimits[subject])} 次</dd></div>
      {policy.limits[subject].map(({ minutes, chapters, novels }) => (
        <div key={minutes}>
          <dt>{WINDOW_LABEL[minutes]}</dt>
          <dd>{displayCount(chapters)} 章 <span>· {displayCount(novels)} 本</span></dd>
        </div>
      ))}
    </dl>
  </section>
}

const tableClass = (pending: boolean) => `admin-data-table admin-data-table--animated${pending ? ' admin-data-table--transitioning' : ''}`
const stagger = (index: number, count: number) => ({ animationDelay: `${getAdminTableRowStaggerDelay(index, count)}ms` })
