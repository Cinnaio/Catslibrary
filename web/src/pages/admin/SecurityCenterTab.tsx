import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { request } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { useSession } from '@/context/SessionContext'
import { useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { DialogFrame, DialogBody } from '@/components/shared/DialogFrame'
import FormField from '@/components/shared/FormField'
import { SearchField } from '@/components/shared/SearchField'
import Pagination from '@/components/shared/Pagination'
import EmptyState from '@/components/shared/EmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  SECURITY_ACTIONS,
  SECURITY_ACTION_LABELS,
  type SecurityPolicy,
  type SecurityOverview,
  type MailRecord,
  type SecurityEvent,
  type SecurityRestriction,
} from '@shared/security'
import MailSettings from './MailSettings'
import styles from './security-center.module.css'

const views = { overview: '安全概览', service: '邮件服务', policy: '防护策略', mail: '邮件记录', events: '风控事件', restrictions: '封禁与例外' } as const
type View = keyof typeof views
const stateLabels: Record<string, string> = {
  queued: '待发送',
  sending: '发送中',
  accepted: '服务商已受理',
  delivered: '收件服务器已接收',
  unknown: '结果待核实',
  failed: '失败',
  expired: '已过期',
  cancelled: '已取消',
  bounced: '永久退信',
  complained: '投诉',
}
const outcomes: Record<string, string> = { blocked: '已拦截', observed: '观察命中', suppressed: '已停发' }
const purposeLabels: Record<string, string> = { 'verify-email': '验证邮箱', 'reset-password': '找回密码', test: '投递测试' }
const date = (n: number) => (n ? new Date(Number(n)).toLocaleString('zh-CN') : '暂无记录')
const numericFields: Array<[keyof SecurityPolicy, string, string]> = [
  ['daily', '每日总预算', '按 UTC 自然日重置，含应急额度'],
  ['monthly', '每月总预算', '按 UTC 自然月重置'],
  ['reserveDaily', '每日应急预留', '只供管理员核实后的恢复操作'],
  ['reserveMonthly', '每月应急预留', '公开申请无法使用'],
  ['hourly', '普通发送每小时上限', '限制短时间消耗'],
  ['cooldownSeconds', '账号冷却秒数', '重复请求合并，不替换有效链接'],
  ['accountQuarterHour', '账号每 15 分钟上限', '跨 IP 累计'],
  ['accountDaily', '账号每天上限', '滚动 24 小时'],
  ['recipientDaily', '收件邮箱每天上限', '跨账号累计'],
  ['newAccountDaily', '新账号每天上限', '注册后 24 小时内适用'],
  ['ipQuarterHour', 'IP 每 15 分钟请求上限', '按登录、注册与邮件用途分别计数'],
  ['identifierQuarterHour', '标识每 15 分钟请求上限', '包括不存在的账号'],
  ['retentionDays', '详细记录保留天数', '1–180 天，过期后自动清理'],
]
type Rows = { items: MailRecord[] | SecurityEvent[] | SecurityRestriction[]; total: number }
type Operation = { title: string; description: string; run: (reason: string) => Promise<unknown> }

export default function SecurityCenterTab() {
  const { user } = useSession()
  return <SecurityCenterContent key={`${user?.id}:${user?.role}`} />
}

function SecurityCenterContent() {
  const { user } = useSession(),
    superAdmin = user?.role === 'super_admin',
    { toast } = useToast()
  const [params, setParams] = useSearchParams(),
    raw = params.get('view') || 'overview'
  const view: View = Object.hasOwn(views, raw) && (superAdmin || ['mail', 'events'].includes(raw)) ? (raw as View) : superAdmin ? 'overview' : 'mail'
  const [overview, setOverview] = useState<SecurityOverview | null>(null),
    [draft, setDraft] = useState<SecurityPolicy | null>(null)
  const [rowView, setRowView] = useState<View>(view)
  const detailRevision = useRef(0)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const [serviceVisited, setServiceVisited] = useState(view === 'service')
  const [serviceBusy, setServiceBusy] = useState(false)
  useEffect(() => {
    if (view === 'service') setServiceVisited(true)
  }, [view])
  const [rows, setRows] = useState<Rows>({ items: [], total: 0 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1)
  const [operation, setOperation] = useState<Operation | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState('')
  const [restrictionForm, setRestrictionForm] = useState({ kind: 'email', value: '', action: 'all', effect: 'block', hours: 24 })
  const [reconcile, setReconcile] = useState({ daily: 0, monthly: 0 })
  const [detail, setDetail] = useState<{
    id: string
    attempts: Array<{ attempt: number; outcome: string; code: string; created_at: number }>
    events: Array<{ kind: string; occurred_at: number }>
  } | null>(null)
  const revision = useRef(0),
    draftRef = useRef(draft),
    savedRef = useRef(overview?.policy)
  draftRef.current = draft
  savedRef.current = overview?.policy
  const dirty = Boolean(draft && overview && JSON.stringify(draft) !== JSON.stringify(overview.policy))
  const listView = ['mail', 'events', 'restrictions'].includes(view)
  const visibleRows: Rows = rowView === view ? rows : { items: [], total: 0 }
  useEffect(() => {
    setDetail(null)
    setOperation(null)
    return () => {
      detailRevision.current++
    }
  }, [view])
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    setPage(1)
    setFilter('all')
    setQuery('')
    setSearch('')
    setRows({ items: [], total: 0 })
  }, [view])
  const load = useCallback(async () => {
    const id = ++revision.current
    setLoading(true)
    setError('')
    try {
      if (['mail', 'events', 'restrictions'].includes(view)) {
        const key = view === 'events' ? 'outcome' : 'state'
        const next = await request<Rows>(
          'GET',
          `/admin/security/${view}?offset=${(page - 1) * 30}&${key}=${filter === 'all' ? '' : encodeURIComponent(filter)}&q=${encodeURIComponent(search)}`,
          null,
          true,
        )
        if (id === revision.current) {
          setRows(next)
          setRowView(view)
        }
      } else {
        const next = await request<SecurityOverview>('GET', '/admin/security/overview', null, true)
        if (id !== revision.current) return
        const preserve = draftRef.current && savedRef.current && JSON.stringify(draftRef.current) !== JSON.stringify(savedRef.current)
        setOverview(next)
        if (!preserve) setDraft(next.policy)
        setReconcile((previous) => ({ daily: Math.max(previous.daily, next.today), monthly: Math.max(previous.monthly, next.month) }))
      }
    } catch (e) {
      if (id === revision.current) setError((e as Error).message)
    } finally {
      if (id === revision.current) setLoading(false)
    }
  }, [view, page, filter, search])
  useEffect(() => {
    void load()
    return () => {
      revision.current++
    }
  }, [load])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const operationTrigger = useRef<HTMLElement | null>(null)
  function ask(next: Operation) {
    operationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setReason('')
    setActionError('')
    setOperation(next)
  }
  async function execute() {
    if (!operation || busy) return
    setBusy(true)
    setActionError('')
    try {
      await operation.run(reason)
      setOperation(null)
      toast('操作已保存', 'success')
      await load()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function setValue<K extends keyof SecurityPolicy>(key: K, value: SecurityPolicy[K]) {
    setDraft((p) => p && { ...p, [key]: value })
  }
  async function showDetail(id: string) {
    detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const revision = ++detailRevision.current
    setError('')
    try {
      const d = await request<Omit<NonNullable<typeof detail>, 'id'>>('GET', `/admin/security/mail/${encodeURIComponent(id)}`, null, true)
      if (revision === detailRevision.current) setDetail({ id, ...d })
    } catch (e) {
      if (revision === detailRevision.current) setError((e as Error).message)
    }
  }
  const visibleViews = Object.entries(views).filter(([key]) => superAdmin || ['mail', 'events'].includes(key))
  return (
    <AdminPage
      title="安全与风控"
      description="管理账号操作、邮件预算与投递，查看防护决策并处理异常。"
      actions={
        <Button variant="secondary" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          刷新
        </Button>
      }
    >
      <Tabs
        value={view}
        onValueChange={(value) => {
          const next = new URLSearchParams(params)
          next.set('view', value)
          setParams(next)
        }}
      >
        <div className={styles.navigation}>
          <TabsList aria-label="安全中心分区">
            {visibleViews.map(([key, label]) => (
              <TabsTrigger key={key} value={key} disabled={busy || serviceBusy}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      {error && <InlineError message={error} />}
      {!listView && loading && !overview ? (
        <LoadingState label="读取安全状态" rows={3} />
      ) : !listView && !overview ? (
        <ErrorState message={error || '安全状态尚未载入'} onRetry={() => void load()} />
      ) : null}
      {view === 'overview' && overview && (
        <>
          <div className={styles.metrics}>
            {[
              ['今日预占与消耗', `${overview.today} / ${overview.policy.daily}`],
              ['本月预占与消耗', `${overview.month} / ${overview.policy.monthly}`],
              ['近一天拦截', overview.blocked],
              ['待发 / 结果未知', `${overview.queued} / ${overview.unknown}`],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className={styles.hint}>
            统计仅覆盖本站发起的邮件，包含已预占与结果未知的额度，不代表服务商账户剩余额度。普通日额度 {overview.ordinaryToday} /{' '}
            {overview.policy.daily - overview.policy.reserveDaily}；下次日重置 {date(overview.nextResetAt)}。
          </p>
          <Card>
            <CardHeader>
              <CardTitle>核对外部用量</CardTitle>
            </CardHeader>
            <CardContent className={styles.stack}>
              <p className={styles.hint}>
                如有其他项目共用额度或刚恢复备份，核对服务商控制台后录入包含待发与结果未知任务的保守总量。仅允许上调；核对不会自动恢复发送。
              </p>
              <div className={styles.fields}>
                <FormField label="今日已用与预占">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={overview.today}
                      value={reconcile.daily}
                      onChange={(e) => setReconcile((p) => ({ ...p, daily: Number(e.target.value) }))}
                    />
                  )}
                </FormField>
                <FormField label="本月已用与预占">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={overview.month}
                      value={reconcile.monthly}
                      onChange={(e) => setReconcile((p) => ({ ...p, monthly: Number(e.target.value) }))}
                    />
                  )}
                </FormField>
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  ask({
                    title: '确认保守用量',
                    description: '此操作增加额度账本中的消耗，并解除备份恢复核对保护。请确认已包含待发与结果未知的预占额度。',
                    run: (reason) => request('POST', '/admin/security/budget-reconcile', { ...reconcile, reason }, true),
                  })
                }
              >
                记录核对结果
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>需要关注</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.alerts.length ? (
                <ul className={styles.alerts}>
                  {overview.alerts.map((a) => (
                    <li key={a.code} data-severity={a.severity}>
                      <ShieldCheck size={16} />
                      <span>{a.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>当前没有需要处理的告警。</p>
              )}
            </CardContent>
          </Card>
          <div className={styles.columns}>
            <Card>
              <CardHeader>
                <CardTitle>运行状态</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className={styles.status}>
                  {[
                    ['发送状态', overview.policy.paused ? '已暂停' : '允许按策略发送'],
                    ['邮件服务', overview.mailReady ? '配置就绪' : '待配置'],
                    ['队列加密', overview.encryptionReady ? '就绪' : '待配置'],
                    ['人机验证', overview.turnstileReady ? '配置就绪' : '待配置'],
                    ['回调签名', overview.webhookReady ? '已配置' : '未配置'],
                    ['工作进程', date(overview.workerAt)],
                    ['最近回调', date(overview.lastWebhookAt)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Button
                  variant="secondary"
                  disabled={dirty}
                  onClick={() =>
                    ask({
                      title: overview.policy.paused ? '恢复邮件发送' : '暂停邮件发送',
                      description: '正在发送的任务可能已经提交给服务商；新任务和后续领取将遵守新状态。',
                      run: async (reason) => {
                        const p = await request<SecurityPolicy>(
                          'PUT',
                          '/admin/security/policy',
                          { policy: { ...overview.policy, paused: !overview.policy.paused }, reason },
                          true,
                        )
                        setDraft(p)
                      },
                    })
                  }
                >
                  {overview.policy.paused ? '恢复发送' : '暂停发送'}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>近两周申请趋势</CardTitle>
              </CardHeader>
              <CardContent>
                {overview.trend.length ? (
                  <div className={styles.trend}>
                    {overview.trend.map((row) => (
                      <div key={row.day}>
                        <span>{row.day.slice(5)}</span>
                        <meter
                          min={0}
                          max={Math.max(overview.policy.daily, ...overview.trend.map((x) => x.sent))}
                          value={row.sent}
                          aria-label={`${row.day} ${row.sent} 封`}
                        />
                        <span>
                          {row.sent} 封 · 失败 {row.failed}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.hint}>还没有邮件申请记录。</p>
                )}
                <p className={styles.hint}>
                  近一天：服务商已受理 {overview.accepted}，确认投递 {overview.delivered}，失败或退信 {overview.failed}。
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
      {(serviceVisited || view === 'service') && (
        <div hidden={view !== 'service'} className={styles.service}>
          <MailSettings active={view === 'service'} onBusyChange={setServiceBusy} />
          <Card>
            <CardHeader>
              <CardTitle>投递反馈与测试</CardTitle>
            </CardHeader>
            <CardContent className={styles.stack}>
              <p>SMTP 可继续发送；在防护策略中切换至 Resend API 后，可关联投递、退信与投诉事件。两种方式共用已保存的 Resend SMTP 凭据。</p>
              <p className={styles.hint}>
                回调地址：<code>/api/security/resend-webhook</code>。签名密钥由服务器的 RESEND_WEBHOOK_SECRET 提供；队列加密使用 MAIL_QUEUE_ENCRYPTION_KEY 或
                SITE_SETTINGS_ENCRYPTION_KEY。密钥不回传浏览器。服务商域名设置中应关闭账号邮件的打开与点击追踪。
              </p>
              <Button
                variant="secondary"
                disabled={serviceBusy}
                onClick={() =>
                  ask({
                    title: '发送真实投递测试',
                    description: '仅向你本人已验证的邮箱发送一封测试邮件，计入普通预算；连接测试不会发信。',
                    run: (reason) => request('POST', '/admin/security/test-mail', { reason }, true),
                  })
                }
              >
                发送到我的已验证邮箱
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      {view === 'policy' && draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask({
              title: '保存防护策略',
              description: '更改立即影响新的请求和待发任务。观察模式只记录人机验证命中，额度与请求限流始终执行。',
              run: async (reason) => {
                const p = await request<SecurityPolicy>('PUT', '/admin/security/policy', { policy: draft, reason }, true)
                setDraft(p)
              },
            })
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>额度与频率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={styles.fields}>
                {numericFields.map(([key, label, hint]) => (
                  <FormField key={key} label={label} hint={hint}>
                    {({ id }) => (
                      <Input
                        id={id}
                        type="number"
                        min={key.startsWith('reserve') ? 0 : 1}
                        max={key === 'retentionDays' ? 180 : 100000}
                        required
                        value={Number(draft[key])}
                        onChange={(e) => setValue(key, Number(e.target.value))}
                      />
                    )}
                  </FormField>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className={styles.section}>
            <CardHeader>
              <CardTitle>场景验证与投递方式</CardTitle>
            </CardHeader>
            <CardContent className={styles.fields}>
              {SECURITY_ACTIONS.map((action) => (
                <FormField key={action} label={SECURITY_ACTION_LABELS[action]}>
                  {({ id }) => (
                    <Select
                      value={draft.challenges[action]}
                      onValueChange={(value) => setValue('challenges', { ...draft.challenges, [action]: value as 'off' | 'observe' | 'enforce' })}
                    >
                      <SelectTrigger id={id}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enforce">强制验证</SelectItem>
                        <SelectItem value="observe">观察命中</SelectItem>
                        <SelectItem value="off">不要求人机验证</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              ))}
              <FormField label="投递方式" hint="Resend API 需要已保存的 smtp.resend.com 凭据及回调配置。">
                {({ id }) => (
                  <Select value={draft.transport} onValueChange={(v) => setValue('transport', v as 'smtp' | 'resend')}>
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="smtp">SMTP</SelectItem>
                      <SelectItem value="resend">Resend API · 投递回调</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="暂停邮件发送">{({ id }) => <Switch id={id} checked={draft.paused} onCheckedChange={(v) => setValue('paused', v)} />}</FormField>
            </CardContent>
          </Card>
          {dirty && (
            <AdminFloatingDock reserveSpace>
              <span>防护策略有未保存修改</span>
              <Button type="button" variant="ghost" onClick={() => setDraft(overview!.policy)}>
                撤销
              </Button>
              <Button type="submit" disabled={busy}>
                保存策略
              </Button>
            </AdminFloatingDock>
          )}
        </form>
      )}
      {view === 'restrictions' && (
        <Card>
          <CardHeader>
            <CardTitle>新增限时限制或验证例外</CardTitle>
          </CardHeader>
          <CardContent className={styles.stack}>
            <div className={styles.fields}>
              <FormField label="目标类型">
                {({ id }) => (
                  <Select value={restrictionForm.kind} onValueChange={(v) => setRestrictionForm((p) => ({ ...p, kind: v }))}>
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">收件邮箱</SelectItem>
                      <SelectItem value="account">账号 ID</SelectItem>
                      <SelectItem value="ip">IP 地址</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="目标值" hint="IP 和邮箱只保存哈希及脱敏摘要。">
                {({ id }) => (
                  <Input id={id} value={restrictionForm.value} onChange={(e) => setRestrictionForm((p) => ({ ...p, value: e.target.value }))} maxLength={254} />
                )}
              </FormField>
              <FormField label="处理方式">
                {({ id }) => (
                  <Select value={restrictionForm.effect} onValueChange={(v) => setRestrictionForm((p) => ({ ...p, effect: v }))}>
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block">阻止操作</SelectItem>
                      <SelectItem value="allow">仅豁免人机验证</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="适用场景">
                {({ id }) => (
                  <Select value={restrictionForm.action} onValueChange={(v) => setRestrictionForm((p) => ({ ...p, action: v }))}>
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部场景</SelectItem>
                      {SECURITY_ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {SECURITY_ACTION_LABELS[a]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="有效期（小时）">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={720}
                    value={restrictionForm.hours}
                    onChange={(e) => setRestrictionForm((p) => ({ ...p, hours: Number(e.target.value) }))}
                  />
                )}
              </FormField>
            </div>
            <p className={styles.hint}>
              账号验证例外仅适用于已登录的邮箱绑定，匿名入口可设置限时 IP
              例外。例外仍遵守请求限流、收件人停发和全站额度；阻止规则优先。服务商退信与投诉产生的停发记录需核实后解除。
            </p>
            <Button
              disabled={!restrictionForm.value.trim()}
              onClick={() =>
                ask({
                  title: '保存限制规则',
                  description: '规则将在指定时间自动到期，修改不会禁用账号的其他功能。',
                  run: async (reason) => {
                    await request('POST', '/admin/security/restrictions', { ...restrictionForm, reason }, true)
                    setRestrictionForm((p) => ({ ...p, value: '' }))
                  },
                })
              }
            >
              添加规则
            </Button>
          </CardContent>
        </Card>
      )}
      {listView && (
        <>
          <div className={styles.toolbar}>
            {view === 'mail' && (
              <SearchField label="搜索邮件" placeholder="脱敏邮箱、账号 ID 或任务 ID" value={query} onChange={(e) => setQuery(e.target.value)} />
            )}
            {view !== 'restrictions' && (
              <Select
                value={filter}
                onValueChange={(v) => {
                  setFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger aria-label="记录状态">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  {Object.entries(view === 'mail' ? stateLabels : outcomes).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className={styles.records} aria-busy={loading} data-transitioning={loading}>
            {loading && !visibleRows.items.length ? (
              <LoadingState label="读取记录" rows={3} />
            ) : error && !visibleRows.items.length ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : !visibleRows.items.length ? (
              <EmptyState icon={<ShieldCheck />} message="没有符合条件的记录" hint="调整筛选，或在相关操作发生后刷新。" />
            ) : (
              <AdminDataPanel
                ariaLabel={views[view]}
                columns={[
                  { key: 'target', label: '对象', primary: true },
                  { key: 'result', label: '状态' },
                  { key: 'time', label: '时间' },
                  { key: 'action', label: '操作', actions: true },
                ]}
              >
                <Table className="admin-data-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>对象与用途</TableHead>
                      <TableHead>状态与原因</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody key={`${view}:${page}:${filter}:${search}`}>
                    {view === 'mail' &&
                      (visibleRows.items as MailRecord[]).map((row, i) => (
                        <TableRow key={row.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(i, visibleRows.items.length)}ms` }}>
                          <TableCell data-label="对象" data-primary>
                            <strong>{row.recipient_hint}</strong>
                            <small>
                              {purposeLabels[row.purpose]} · {row.emergency ? '应急预算' : '普通预算'}
                            </small>
                            <small>{row.id}</small>
                          </TableCell>
                          <TableCell data-label="状态">
                            {stateLabels[row.state] || row.state}
                            <small>
                              {row.error_code || '—'} · 尝试 {row.attempts} 次
                            </small>
                          </TableCell>
                          <TableCell data-label="时间">{date(row.created_at)}</TableCell>
                          <TableCell data-label="操作" data-actions>
                            <Button variant="ghost" onClick={() => void showDetail(row.id)}>
                              查看过程
                            </Button>
                            {superAdmin && row.state === 'queued' && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  ask({
                                    title: '取消待发邮件',
                                    description: '尚未尝试发送的任务将归还预占额度；曾尝试发送的任务保守保留额度。',
                                    run: (reason) => request('POST', `/admin/security/mail/${row.id}/cancel`, { reason }, true),
                                  })
                                }
                              >
                                取消
                              </Button>
                            )}
                            {superAdmin && row.state === 'unknown' && (
                              <>
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    ask({
                                      title: '确认服务商已受理',
                                      description: '仅在核对服务商记录后确认。此操作保留额度，不会再次发送邮件。',
                                      run: (reason) => request('POST', `/admin/security/mail/${row.id}/resolve`, { state: 'accepted', reason }, true),
                                    })
                                  }
                                >
                                  已核实受理
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    ask({
                                      title: '确认投递失败',
                                      description: '此操作会废弃对应邮件链接，保守保留已占用额度。核实失败后可重新申请邮件。',
                                      run: (reason) => request('POST', `/admin/security/mail/${row.id}/resolve`, { state: 'failed', reason }, true),
                                    })
                                  }
                                >
                                  已核实失败
                                </Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    {view === 'events' &&
                      (visibleRows.items as SecurityEvent[]).map((row, i) => (
                        <TableRow key={row.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(i, visibleRows.items.length)}ms` }}>
                          <TableCell data-label="对象" data-primary>
                            {SECURITY_ACTION_LABELS[row.action as keyof typeof SECURITY_ACTION_LABELS] || purposeLabels[row.action] || row.action}
                            <small>{row.identity_hint || row.target_id || '匿名请求'}</small>
                          </TableCell>
                          <TableCell data-label="状态">
                            {outcomes[row.outcome] || row.outcome}
                            <small>
                              {row.rule} · {row.count} 次
                            </small>
                          </TableCell>
                          <TableCell data-label="时间">
                            {date(row.updated_at)}
                            <small>策略版本 {row.policy_revision}</small>
                          </TableCell>
                          <TableCell data-label="操作" data-actions>
                            {superAdmin && row.can_restrict_source ? (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  ask({
                                    title: '限制此请求来源',
                                    description: '仅限制此来源在当前场景的请求，24 小时后自动解除；不会禁用目标账号。',
                                    run: (reason) => request('POST', `/admin/security/events/${row.id}/restrict-source`, { reason }, true),
                                  })
                                }
                              >
                                限制来源 24 小时
                              </Button>
                            ) : (
                              <span>按 15 分钟聚合</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    {view === 'restrictions' &&
                      (visibleRows.items as SecurityRestriction[]).map((row, i) => (
                        <TableRow key={row.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(i, visibleRows.items.length)}ms` }}>
                          <TableCell data-label="对象" data-primary>
                            {row.hint}
                            <small>{row.action === 'all' ? '全部场景' : SECURITY_ACTION_LABELS[row.action]}</small>
                          </TableCell>
                          <TableCell data-label="状态">
                            {row.effect === 'block' ? '阻止操作' : '验证例外'}
                            <small>{row.reason}</small>
                          </TableCell>
                          <TableCell data-label="时间">到期 {date(row.expires_at)}</TableCell>
                          <TableCell data-label="操作" data-actions>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                ask({
                                  title: '解除限制',
                                  description: '请核实收件地址和请求来源；解除本站停发不会自动移除服务商的停发名单。',
                                  run: (reason) => request('POST', `/admin/security/restrictions/${row.id}/revoke`, { reason }, true),
                                })
                              }
                            >
                              解除
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </AdminDataPanel>
            )}
          </div>
          <Pagination page={page} totalPages={Math.ceil(visibleRows.total / 30)} onPage={setPage} busy={loading} summary={`共 ${visibleRows.total} 条记录`} />
        </>
      )}
      <Dialog
        open={Boolean(operation)}
        onOpenChange={(open) => {
          if (!open && !busy) setOperation(null)
        }}
      >
        <DialogFrame
          showCloseButton={!busy}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            operationTrigger.current?.focus()
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{operation?.title}</DialogTitle>
            <DialogDescription>{operation?.description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="操作原因" hint="至少 4 字，将记录到管理员操作审计。">
              {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} minLength={4} maxLength={300} disabled={busy} />}
            </FormField>
            {actionError && <InlineError message={actionError} />}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOperation(null)}>
              取消
            </Button>
            <Button disabled={busy || reason.trim().length < 4} onClick={() => void execute()}>
              {busy ? '处理中…' : '确认操作'}
            </Button>
          </DialogFooter>
        </DialogFrame>
      </Dialog>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) {
            detailRevision.current++
            setDetail(null)
          }
        }}
      >
        <DialogFrame
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            detailTrigger.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>投递过程</DialogTitle>
            <DialogDescription>{detail?.id}</DialogDescription>
          </DialogHeader>
          <DialogBody className={styles.stack}>
            {detail?.attempts.map((a) => (
              <p key={a.attempt}>
                {date(a.created_at)} · 第 {a.attempt} 次 ·{' '}
                {a.outcome === 'sending'
                  ? '发送中'
                  : a.outcome === 'accepted'
                    ? '已受理'
                    : a.outcome === 'unknown'
                      ? '结果未知'
                      : a.outcome === 'retry'
                        ? '可重试'
                        : '拒收'}{' '}
                {a.code}
              </p>
            ))}
            {detail?.events.map((e, i) => (
              <p key={i}>
                {date(e.occurred_at)} · {e.kind}
              </p>
            ))}
            {!detail?.attempts.length && !detail?.events.length && <p>尚无投递尝试或回调记录。</p>}
          </DialogBody>
        </DialogFrame>
      </Dialog>
    </AdminPage>
  )
}
