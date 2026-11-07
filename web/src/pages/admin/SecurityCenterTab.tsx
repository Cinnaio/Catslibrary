import { MotionDetails, MotionPresence, MotionView } from '@/components/ui/motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, ShieldCheck, Mail, Plus, CirclePlus, ChevronDown, Check, Ban } from 'lucide-react'
import { request } from '@/lib/api'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { useSession } from '@/context/SessionContext'
import { useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminRowActions, { type AdminRowActionItem } from '@/components/admin/AdminRowActions'
import { PanelHeading } from '@/components/shared/PanelHeading'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { DialogFrame, DialogBody } from '@/components/shared/DialogFrame'
import FormField from '@/components/shared/FormField'
import { SearchField } from '@/components/shared/SearchField'
import SearchSelect from '@/components/shared/SearchSelect'
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
import MailSecuritySettings from './MailSecuritySettings'
import SecurityOverviewPanel from './SecurityOverviewPanel'
import SecurityPolicyEditor from './SecurityPolicyEditor'
import { SECURITY_CENTER_VIEWS as views } from './admin-registry'
import {
  mailStateLabels as stateLabels,
  outcomeLabels as outcomes,
  purposeLabels,
  targetLabels,
  callbackLabels,
  securityReason,
  statusTone,
  securityDate as date,
} from './security-center-format'
import styles from './security-center.module.css'

const viewDescriptions = {
  overview: '查看邮件额度、投递状态与需要处理的异常。',
  service: '配置邮件连接、发件身份，检查实际投递。',
  policy: '设置邮件预算、邮箱域名名单、请求频率和各场景的验证方式。',
  mail: '按收件人查看申请与投递，未知结果请核对后处理。',
  events: '查看防护决策，同一来源与规则按 15 分钟聚合。',
  restrictions: '管理生效中的限制与验证例外，规则到期后自动解除。',
} as const
type View = keyof typeof views
type Rows = { items: MailRecord[] | SecurityEvent[] | SecurityRestriction[]; total: number }
type Operation = { title: string; description: string; target?: string; run: (reason: string) => Promise<unknown> }

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
  const navigationRef = useRef<HTMLDivElement>(null)
  const [serviceVisited, setServiceVisited] = useState(view === 'service')
  const [serviceBusy, setServiceBusy] = useState(false)
  const [serviceDirty, setServiceDirty] = useState(false)
  const [securityBusy, setSecurityBusy] = useState(false)
  const [securityDirty, setSecurityDirty] = useState(false)
  const [serviceRefreshToken, setServiceRefreshToken] = useState(0)
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
  const [restrictionOpen, setRestrictionOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [restrictionForm, setRestrictionForm] = useState({ kind: 'email', value: '', action: 'all', effect: 'block', hours: 24 })
  const [reconcile, setReconcile] = useState({ daily: 0, monthly: 0 })
  const [detail, setDetail] = useState<{
    record: MailRecord
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
  const transitioning = loading || (view === 'mail' && query !== search)
  const visibleRows: Rows = rowView === view ? rows : { items: [], total: 0 }
  useEffect(() => {
    setDetail(null)
    setDetailError('')
    setDetailLoading(false)
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
  function restoreFocus(target: HTMLElement | null) {
    if (target?.isConnected && !target.closest('[hidden], [inert]')) target.focus()
    else navigationRef.current?.querySelector<HTMLElement>('[data-state="active"]')?.focus()
  }
  function ask(next: Operation, trigger?: HTMLElement | null) {
    operationTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
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
  async function showDetail(record: MailRecord, retry = false) {
    if (!retry) detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = ++detailRevision.current
    setDetail({ record, attempts: [], events: [] })
    setDetailLoading(true)
    setDetailError('')
    try {
      const result = await request<Omit<NonNullable<typeof detail>, 'record'>>('GET', `/admin/security/mail/${encodeURIComponent(record.id)}`, null, true)
      if (id === detailRevision.current) setDetail({ record, ...result })
    } catch (e) {
      if (id === detailRevision.current) setDetailError((e as Error).message)
    } finally {
      if (id === detailRevision.current) setDetailLoading(false)
    }
  }
  function navigateView(value: View) {
    const next = new URLSearchParams(params)
    next.set('view', value)
    setParams(next)
  }
  function mailActions(row: MailRecord): AdminRowActionItem[] {
    const confirm = (operation: Operation) => ask(operation, document.getElementById('mail-detail-' + row.id))
    if (!superAdmin) return []
    if (row.state === 'queued')
      return [
        {
          label: '取消待发邮件',
          icon: Ban,
          danger: true,
          onSelect: () =>
            confirm({
              title: '取消待发邮件',
              target: `${row.recipient_hint} · ${purposeLabels[row.purpose] || row.purpose}`,
              description: '尚未尝试发送的任务将归还预占额度；曾尝试发送的任务保守保留额度。',
              run: (reason) => request('POST', `/admin/security/mail/${row.id}/cancel`, { reason }, true),
            }),
        },
      ]
    if (row.state === 'unknown')
      return [
        {
          label: '已核实受理',
          icon: Check,
          onSelect: () =>
            confirm({
              title: '确认服务商已受理',
              target: row.recipient_hint,
              description: '仅在核对服务商记录后确认。此操作保留额度，不会再次发送邮件。',
              run: (reason) => request('POST', `/admin/security/mail/${row.id}/resolve`, { state: 'accepted', reason }, true),
            }),
        },
        {
          label: '已核实失败',
          icon: Ban,
          danger: true,
          onSelect: () =>
            confirm({
              title: '确认投递失败',
              target: row.recipient_hint,
              description: '此操作会废弃对应邮件链接，保守保留已占用额度。核实失败后可重新申请邮件。',
              run: (reason) => request('POST', `/admin/security/mail/${row.id}/resolve`, { state: 'failed', reason }, true),
            }),
        },
      ]
    return []
  }
  const restrictionValid =
    Boolean(restrictionForm.value.trim()) && Number.isSafeInteger(restrictionForm.hours) && restrictionForm.hours >= 1 && restrictionForm.hours <= 720
  const visibleViews = Object.entries(views).filter(([key]) => superAdmin || ['mail', 'events'].includes(key))
  return (
    <AdminPage motionKey={view}
      title={views[view]}
      description={`${viewDescriptions[view]}${!superAdmin ? ' 仅显示普通读者关联记录。' : ''}`}
      actions={
        view !== 'service' && !listView ? (
          <Button variant="secondary" disabled={loading || busy || serviceBusy} onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" />
            {loading ? '刷新中…' : '刷新'}
          </Button>
        ) : undefined
      }
    >
      <Tabs ref={navigationRef} className={styles.navigation} value={view} activationMode="manual" onValueChange={(value) => navigateView(value as View)}>
        <TabsList aria-label="安全中心分区">
          {visibleViews.map(([key, label]) => (
            <TabsTrigger key={key} value={key} disabled={busy || serviceBusy || securityBusy}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {error && (listView ? visibleRows.items.length > 0 : Boolean(overview)) && (
        <InlineError message={`刷新失败：${error}。已保留上次结果。`} onRetry={() => void load()} />
      )}
      {!listView && loading && !overview ? (
        <LoadingState label="读取安全状态" rows={3} />
      ) : !listView && !overview ? (
        <ErrorState message={error || '安全状态尚未载入'} onRetry={() => void load()} />
      ) : null}
      {view === 'overview' && overview && (
        <SecurityOverviewPanel
          overview={overview}
          dirty={dirty}
          busy={busy || loading}
          reconcile={reconcile}
          onReconcileChange={setReconcile}
          onView={navigateView}
          onReconcile={() =>
            ask({
              title: '确认保守用量',
              target: `今日 ${reconcile.daily} 封 · 本月 ${reconcile.monthly} 封`,
              description: '此操作增加额度账本中的消耗，并解除备份恢复核对保护。请确认已包含待发与结果未知的预占额度。',
              run: (reason) => request('POST', '/admin/security/budget-reconcile', { ...reconcile, reason }, true),
            })
          }
          onPause={() =>
            ask({
              title: overview.policy.paused ? '恢复邮件发送' : '暂停邮件发送',
              description: '正在发送的任务可能已经提交给服务商；新任务和后续领取将遵守新状态。',
              run: async (reason) => {
                const policy = await request<SecurityPolicy>(
                  'PUT',
                  '/admin/security/policy',
                  { policy: { ...overview.policy, paused: !overview.policy.paused }, reason },
                  true,
                )
                setDraft(policy)
              },
            })
          }
        />
      )}
      {(serviceVisited || view === 'service') && (
        <MotionView asChild><div hidden={view !== 'service'} className={styles.service}>
          <MailSettings
            active={view === 'service'}
            externalBusy={busy || securityBusy}
            externalDirty={securityDirty}
            onBusyChange={setServiceBusy}
            onDirtyChange={setServiceDirty}
            onStatusChange={() => {
              void load()
              setServiceRefreshToken((value) => value + 1)
            }}
          />
          <MailSecuritySettings
            blocked={busy || serviceBusy}
            refreshToken={serviceRefreshToken}
            onBusyChange={setSecurityBusy}
            onDirtyChange={setSecurityDirty}
            onConfirm={ask}
          />
          <Card>
            <PanelHeading
              title="投递测试"
              description="使用已保存的配置，核对邮件的实际投递。"
              status={
                overview && <AdminStatusBadge tone="neutral">当前投递：{overview.policy.transport === 'resend' ? 'Resend API' : 'SMTP'}</AdminStatusBadge>
              }
              actions={
                <Button variant="ghost" onClick={() => navigateView('mail')} disabled={serviceBusy || securityBusy || busy}>
                  查看邮件记录
                </Button>
              }
            />
            <CardContent className={styles.panelBody}>
              <div className={styles.testDelivery}>
                <div>
                  <p>发送到我的已验证邮箱</p>
                  <p className={styles.hint}>
                    {serviceDirty || securityDirty
                      ? '请先保存邮件配置，再进行真实投递测试。'
                      : !user?.emailVerified
                        ? '请先在个人中心完成邮箱验证。'
                        : overview?.policy.paused
                          ? '邮件发送已暂停，请先恢复发送。'
                          : !overview?.mailReady || !overview.encryptionReady
                            ? '请先完成邮件服务和队列加密配置。'
                            : '使用已保存配置，仅向你本人发送，计入普通邮件额度。'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={
                    serviceBusy ||
                    securityBusy ||
                    serviceDirty ||
                    securityDirty ||
                    busy ||
                    loading ||
                    !user?.emailVerified ||
                    !overview?.mailReady ||
                    !overview.encryptionReady ||
                    overview.policy.paused
                  }
                  onClick={() =>
                    ask({
                      title: '发送真实投递测试',
                      description: '仅向你本人已验证的邮箱发送一封测试邮件，计入普通预算；连接测试不会发信。',
                      run: (reason) => request('POST', '/admin/security/test-mail', { reason }, true),
                    })
                  }
                >
                  <Mail size={14} aria-hidden="true" />
                  发送测试邮件
                </Button>
              </div>
              <MotionDetails className={styles.disclosure}>
                <summary>
                  投递方式与配置说明
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className={styles.disclosureBody}>
                  <p>
                    在防护策略中选择 SMTP 或 Resend API。Resend API 使用已保存的 Resend 邮件凭据，配置回调后可关联投递、退信和投诉；普通 SMTP
                    受理不代表邮件已送达。
                  </p>
                  <dl className={styles.technical}>
                    <div>
                      <dt>回调地址</dt>
                      <dd>
                        <code>/api/security/resend-webhook</code>
                      </dd>
                    </div>
                    <div>
                      <dt>回调签名密钥</dt>
                      <dd>
                        <code>RESEND_WEBHOOK_SECRET</code>
                      </dd>
                    </div>
                    <div>
                      <dt>队列加密密钥</dt>
                      <dd>
                        <code>MAIL_QUEUE_ENCRYPTION_KEY</code>，也可使用已有的 <code>SITE_SETTINGS_ENCRYPTION_KEY</code>
                      </dd>
                    </div>
                  </dl>
                  <p>可在上方初始化队列加密、保存回调签名密钥，保存后立即生效。后台已保存的对应密钥优先于环境变量，原值不回传浏览器。</p>
                  <p>
                    配置保存在服务器私有文件 data/mail-security-config.json（可由 MAIL_SECURITY_CONFIG_FILE
                    指定），数据库备份不包含它；多实例须共享同一文件，迁移服务器时单独安全迁移。账号邮件建议在服务商控制台关闭打开与点击追踪。
                  </p>
                </div>
              </MotionDetails>
            </CardContent>
          </Card>
        </div></MotionView>
      )}
      {view === 'policy' && draft && (
        <SecurityPolicyEditor
          draft={draft}
          dirty={dirty}
          busy={busy}
          turnstileReady={Boolean(overview?.turnstileReady)}
          onChange={setValue}
          onDiscard={() => setDraft(overview!.policy)}
          onSave={() =>
            ask({
              title: '保存防护策略',
              description: '更改立即影响新的请求和待发任务。观察模式只记录人机验证命中，额度与请求限流始终执行。',
              run: async (reason) => {
                const policy = await request<SecurityPolicy>('PUT', '/admin/security/policy', { policy: draft, reason }, true)
                setDraft(policy)
              },
            })
          }
        />
      )}
      {view === 'restrictions' && restrictionOpen && (
        <Card>
          <PanelHeading title="新增规则" description="选择限制对象、场景与有效期。" />
          <MotionPresence asChild open={restrictionOpen} mode="disclosure" keepMounted><CardContent className={styles.panelBody} id="security-restriction-form">
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault()
                if (!restrictionValid) return
                ask({
                  title: '保存限制规则',
                  target: `${restrictionForm.value.trim()} · ${restrictionForm.hours} 小时`,
                  description: `${restrictionForm.effect === 'block' ? '阻止所选场景的操作' : '仅免除所选场景的人机验证'}，到期自动解除。不会禁用账号的其他功能。`,
                  run: async (reason) => {
                    await request('POST', '/admin/security/restrictions', { ...restrictionForm, reason }, true)
                    setRestrictionForm((p) => ({ ...p, value: '' }))
                    setRestrictionOpen(false)
                  },
                })
              }}
            >
              <div className={styles.fields}>
                <FormField label="目标类型">
                  {({ id }) => (
                    <Select
                      value={restrictionForm.kind}
                      onValueChange={(kind) =>
                        setRestrictionForm((p) => ({
                          ...p,
                          kind,
                          value: '',
                          effect: kind === 'email' ? 'block' : p.effect,
                          action: kind === 'account' && p.effect === 'allow' ? 'verify-email' : p.action,
                        }))
                      }
                    >
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
                    <Input
                      id={id}
                      required
                      autoComplete="off"
                      type={restrictionForm.kind === 'email' ? 'email' : 'text'}
                      placeholder={restrictionForm.kind === 'email' ? 'reader@example.com' : restrictionForm.kind === 'ip' ? '输入完整 IP 地址' : '输入账号 ID'}
                      value={restrictionForm.value}
                      onChange={(e) => setRestrictionForm((p) => ({ ...p, value: e.target.value }))}
                      maxLength={254}
                    />
                  )}
                </FormField>
                <FormField label="处理方式">
                  {({ id }) => (
                    <Select
                      value={restrictionForm.effect}
                      onValueChange={(effect) =>
                        setRestrictionForm((p) => ({ ...p, effect, action: effect === 'allow' && p.kind === 'account' ? 'verify-email' : p.action }))
                      }
                    >
                      <SelectTrigger id={id}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="block">阻止操作</SelectItem>
                        <SelectItem value="allow" disabled={restrictionForm.kind === 'email'}>
                          仅豁免人机验证
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="适用场景">
                  {({ id }) => (
                    <Select
                      disabled={restrictionForm.kind === 'account' && restrictionForm.effect === 'allow'}
                      value={restrictionForm.action}
                      onValueChange={(v) => setRestrictionForm((p) => ({ ...p, action: v }))}
                    >
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
                      step={1}
                      required
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
              <div className={styles.sectionActions}>
                <Button type="button" variant="ghost" onClick={() => setRestrictionOpen(false)}>
                  暂不添加
                </Button>
                <Button type="submit" disabled={!restrictionValid}>
                  添加规则
                </Button>
              </div>
            </form>
          </CardContent></MotionPresence>
        </Card>
      )}
      {listView && (
        <div className={styles.workspace}>
          <AdminToolbar className={`admin-filter-rail ${styles.toolbar}`} ariaLive="polite">
            {view !== 'restrictions' && (
              <>
                {view === 'mail' && (
                  <SearchField label="搜索邮件" placeholder="脱敏邮箱、账号 ID 或任务 ID" value={query} onChange={(e) => setQuery(e.target.value)} />
                )}
                <SearchSelect
                  compact
                  chip
                  filterChip
                  leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
                  aria-label="记录状态"
                  value={filter}
                  onChange={(value) => {
                    setFilter(value)
                    setPage(1)
                  }}
                  options={[
                    { value: 'all', label: '全部状态' },
                    ...Object.entries(view === 'mail' ? stateLabels : outcomes).map(([value, label]) => ({ value, label })),
                  ]}
                />
                {(filter !== 'all' || query) && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setQuery('')
                      setSearch('')
                      setFilter('all')
                      setPage(1)
                    }}
                  >
                    清除筛选
                  </Button>
                )}
              </>
            )}
            {view === 'restrictions' && (
              <Button variant="secondary" onClick={() => setRestrictionOpen(!restrictionOpen)} aria-expanded={restrictionOpen}>
                {!restrictionOpen && <Plus size={14} aria-hidden="true" />}
                {restrictionOpen ? '收起表单' : '新增规则'}
              </Button>
            )}
            <div className={styles.toolbarActions}>
              <span className={styles.hint}>{transitioning ? '正在更新…' : error ? '读取未完成' : `共 ${visibleRows.total} 条`}</span>
              <Button variant="secondary" size="sm" disabled={loading || busy} onClick={() => void load()}>
                <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
                {loading ? '刷新中…' : '刷新'}
              </Button>
            </div>
          </AdminToolbar>
          <div className={styles.records} aria-busy={transitioning}>
            <AdminDataPanel
              ariaLabel={views[view]}
              density="comfortable"
              columns={[
                { key: 'target', label: '对象', primary: true },
                { key: 'result', label: '状态', width: '30%' },
                { key: 'time', label: '时间', width: '23%' },
                { key: 'action', label: '操作', actions: true, width: '8.5rem' },
              ]}
            >
              {loading && !visibleRows.items.length ? (
                <LoadingState label="读取记录" rows={3} />
              ) : error && !visibleRows.items.length ? (
                <ErrorState message={error} onRetry={() => void load()} />
              ) : !visibleRows.items.length ? (
                <EmptyState
                  icon={view === 'mail' ? <Mail /> : <ShieldCheck />}
                  message={
                    filter !== 'all' || search
                      ? '没有符合条件的记录'
                      : view === 'mail'
                        ? '还没有邮件记录'
                        : view === 'events'
                          ? '还没有风控事件'
                          : '暂无生效中的规则'
                  }
                  hint={
                    filter !== 'all' || search
                      ? '换一个状态或搜索条件，再查看记录。'
                      : view === 'mail'
                        ? '邮箱验证、密码找回和测试邮件将在这里显示。'
                        : view === 'events'
                          ? '验证命中、请求拦截和收件人停发会记录在这里。'
                          : '需要临时限制或验证例外时，可在上方新增规则。'
                  }
                  action={
                    filter !== 'all' || search ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQuery('')
                          setSearch('')
                          setFilter('all')
                          setPage(1)
                        }}
                      >
                        清除筛选
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <Table
                  inert={transitioning || undefined}
                  className={`admin-data-table admin-data-table--animated${transitioning ? ' admin-data-table--transitioning' : ''}`}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>{view === 'events' ? '场景与来源' : view === 'mail' ? '收件人及用途' : '限制对象'}</TableHead>
                      <TableHead>{view === 'events' ? '处理结果' : view === 'mail' ? '投递状态' : '规则与原因'}</TableHead>
                      <TableHead>{view === 'restrictions' ? '到期时间' : view === 'events' ? '最近发生' : '申请时间'}</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody key={`${view}:${page}:${filter}:${search}`}>
                    {view === 'mail' &&
                      (visibleRows.items as MailRecord[]).map((row, i) => (
                        <TableRow key={row.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(i, visibleRows.items.length)}ms` }}>
                          <TableCell data-label="收件人" data-primary>
                            <strong className={styles.primary}>{row.recipient_hint}</strong>
                            <small>
                              {purposeLabels[row.purpose] || row.purpose} · {row.emergency ? '应急预算' : '普通预算'}
                            </small>
                          </TableCell>
                          <TableCell data-label="投递状态">
                            <div className={styles.cellStack}>
                              <AdminStatusBadge tone={statusTone(row.state)}>{stateLabels[row.state] || row.state}</AdminStatusBadge>
                              {row.error_code && <small>{securityReason(row.error_code)}</small>}
                              {row.attempts > 0 && <small>已尝试 {row.attempts} 次</small>}
                            </div>
                          </TableCell>
                          <TableCell data-label="申请时间">
                            <time className={styles.recordTime} dateTime={new Date(Number(row.created_at)).toISOString()}>
                              {date(row.created_at)}
                            </time>
                          </TableCell>
                          <TableCell data-label="操作" data-actions>
                            <AdminRowActions label={`${row.recipient_hint} · ${purposeLabels[row.purpose] || row.purpose}`} items={mailActions(row)}>
                              <Button id={'mail-detail-' + row.id} variant="ghost" onClick={() => void showDetail(row)}>
                                查看
                              </Button>
                            </AdminRowActions>
                          </TableCell>
                        </TableRow>
                      ))}
                    {view === 'events' &&
                      (visibleRows.items as SecurityEvent[]).map((row, i) => (
                        <TableRow key={row.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(i, visibleRows.items.length)}ms` }}>
                          <TableCell data-label="场景与来源" data-primary>
                            <strong className={styles.primary}>
                              {SECURITY_ACTION_LABELS[row.action as keyof typeof SECURITY_ACTION_LABELS] || purposeLabels[row.action] || row.action}
                            </strong>
                            <small>{row.identity_hint || row.target_id || '匿名请求'}</small>
                          </TableCell>
                          <TableCell data-label="处理结果">
                            <div className={styles.cellStack}>
                              <AdminStatusBadge tone={statusTone(row.outcome)}>{outcomes[row.outcome] || row.outcome}</AdminStatusBadge>
                              <small>
                                {securityReason(row.rule)} · {row.count} 次
                              </small>
                              <MotionDetails className={styles.recordTechnical}>
                                <summary>规则信息</summary>
                                <span>
                                  {row.rule} · 策略版本 {row.policy_revision}
                                </span>
                              </MotionDetails>
                            </div>
                          </TableCell>
                          <TableCell data-label="最近发生">
                            <time className={styles.recordTime}>{date(row.updated_at)}</time>
                          </TableCell>
                          <TableCell data-label="操作" data-actions>
                            {superAdmin && row.can_restrict_source ? (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  ask({
                                    title: '限制此请求来源',
                                    target: `${row.identity_hint || '此来源'} · ${SECURITY_ACTION_LABELS[row.action as keyof typeof SECURITY_ACTION_LABELS] || row.action}`,
                                    description: '仅限制此来源在当前场景的请求，24 小时后自动解除；不会禁用目标账号。',
                                    run: (reason) => request('POST', `/admin/security/events/${row.id}/restrict-source`, { reason }, true),
                                  })
                                }
                              >
                                限制来源
                              </Button>
                            ) : (
                              <span className={styles.hint}>{superAdmin ? '—' : '只读记录'}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    {view === 'restrictions' &&
                      (visibleRows.items as SecurityRestriction[]).map((row, i) => (
                        <TableRow key={row.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(i, visibleRows.items.length)}ms` }}>
                          <TableCell data-label="限制对象" data-primary>
                            <strong className={styles.primary}>{row.hint}</strong>
                            <small>
                              {targetLabels[row.kind]} · {row.action === 'all' ? '全部场景' : SECURITY_ACTION_LABELS[row.action]}
                            </small>
                          </TableCell>
                          <TableCell data-label="规则与原因">
                            <div className={styles.cellStack}>
                              <AdminStatusBadge tone={row.effect === 'block' ? 'warning' : 'neutral'}>
                                {row.effect === 'block' ? '阻止操作' : '验证例外'}
                              </AdminStatusBadge>
                              <small>{row.reason}</small>
                            </div>
                          </TableCell>
                          <TableCell data-label="到期时间">
                            <time className={styles.recordTime}>{date(row.expires_at)}</time>
                          </TableCell>
                          <TableCell data-label="操作" data-actions>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                ask({
                                  title: '解除限制',
                                  target: row.hint,
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
              )}
            </AdminDataPanel>
          </div>
          {visibleRows.total > 0 && (
            <Pagination
              variant="detached"
              page={page}
              totalPages={Math.ceil(visibleRows.total / 30)}
              onPage={setPage}
              busy={transitioning}
              summary={`第 ${(page - 1) * 30 + 1}–${Math.min(page * 30, visibleRows.total)} 条，共 ${visibleRows.total} 条`}
            />
          )}
        </div>
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
            restoreFocus(operationTrigger.current)
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
          <DialogBody className={styles.dialogBody}>
            {operation?.target && <p className={styles.operationTarget}>{operation.target}</p>}
            <FormField label="操作原因" hint="至少 4 字，将记录到管理员操作审计。">
              {({ id }) => (
                <Textarea
                  id={id}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={4}
                  maxLength={300}
                  disabled={busy}
                  rows={3}
                  placeholder="简要说明核对结果或调整原因"
                />
              )}
            </FormField>
            {actionError && <InlineError message={actionError} />}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOperation(null)}>
              取消
            </Button>
            <Button disabled={busy || reason.trim().length < 4} onClick={() => void execute()}>
              {busy && <Spinner size="sm" aria-hidden="true" />}
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
            restoreFocus(detailTrigger.current)
          }}
        >
          <DialogHeader>
            <DialogTitle>邮件详情</DialogTitle>
            <DialogDescription>
              {detail ? `${detail.record.recipient_hint} · ${purposeLabels[detail.record.purpose] || detail.record.purpose}` : '查看投递过程与服务商反馈。'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className={styles.dialogBody}>
            {detail && (
              <>
                <dl className={styles.status}>
                  <div>
                    <dt>投递状态</dt>
                    <dd>
                      <AdminStatusBadge tone={statusTone(detail.record.state)}>{stateLabels[detail.record.state] || detail.record.state}</AdminStatusBadge>
                    </dd>
                  </div>
                  <div>
                    <dt>使用预算</dt>
                    <dd>{detail.record.emergency ? '应急预算' : '普通预算'}</dd>
                  </div>
                  <div>
                    <dt>投递方式</dt>
                    <dd>{detail.record.transport === 'resend' ? 'Resend API' : 'SMTP'}</dd>
                  </div>
                  <div>
                    <dt>申请时间</dt>
                    <dd>{date(detail.record.created_at)}</dd>
                  </div>
                  {detail.record.error_code && (
                    <div>
                      <dt>结果说明</dt>
                      <dd>{securityReason(detail.record.error_code)}</dd>
                    </div>
                  )}
                </dl>
                <section aria-label="投递过程" className={styles.stack}>
                  <PanelHeading title="投递过程" className={styles.sectionHeading} />
                  {detailLoading ? (
                    <LoadingState label="读取投递过程" rows={3} />
                  ) : detailError ? (
                    <ErrorState message={detailError} onRetry={() => void showDetail(detail.record, true)} />
                  ) : (
                    <dl className={styles.status}>
                      {[
                        ...detail.attempts.map((a) => ({
                          key: `attempt-${a.attempt}`,
                          at: a.created_at,
                          label: `第 ${a.attempt} 次发送`,
                          title:
                            a.outcome === 'sending'
                              ? '发送中'
                              : a.outcome === 'accepted'
                                ? '已受理'
                                : a.outcome === 'unknown'
                                  ? '结果未知'
                                  : a.outcome === 'retry'
                                    ? '等待重试'
                                    : '拒收',
                          hint: securityReason(a.code),
                        })),
                        ...detail.events.map((event, i) => ({
                          key: `event-${i}`,
                          at: event.occurred_at,
                          label: '服务商反馈',
                          title: callbackLabels[event.kind] || '收到服务商反馈',
                          hint: '',
                        })),
                      ]
                        .sort((a, b) => Number(a.at) - Number(b.at))
                        .map((item) => (
                          <div key={item.key}>
                            <dt>{item.label}</dt>
                            <dd>
                              {item.title}
                              <time className={styles.hint}>{date(item.at)}</time>
                              {item.hint && <span className={styles.hint}>{item.hint}</span>}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  )}
                  {!detailLoading && !detailError && !detail.attempts.length && !detail.events.length && (
                    <p className={styles.hint}>尚无投递尝试或回调记录。</p>
                  )}
                </section>
                <p className={styles.hint}>服务商受理与收件服务器接收分别记录，不能据此判断用户是否阅读。</p>
                <MotionDetails className={styles.disclosure}>
                  <summary>
                    技术信息
                    <ChevronDown size={14} aria-hidden="true" />
                  </summary>
                  <dl className={`${styles.technical} ${styles.disclosureBody}`}>
                    <div>
                      <dt>任务 ID</dt>
                      <dd>{detail.record.id}</dd>
                    </div>
                    <div>
                      <dt>账号 ID</dt>
                      <dd>{detail.record.user_id || '未关联'}</dd>
                    </div>
                    <div>
                      <dt>服务商 ID</dt>
                      <dd>{detail.record.provider_id || '未回传'}</dd>
                    </div>
                    <div>
                      <dt>最后更新</dt>
                      <dd>{date(detail.record.updated_at)}</dd>
                    </div>
                    {detail.record.error_code && (
                      <div>
                        <dt>结果代码</dt>
                        <dd>{detail.record.error_code}</dd>
                      </div>
                    )}
                    {detail.attempts
                      .filter((a) => a.code)
                      .map((a) => (
                        <div key={a.attempt}>
                          <dt>第 {a.attempt} 次代码</dt>
                          <dd>{a.code}</dd>
                        </div>
                      ))}
                    {detail.events.map((event, i) => (
                      <div key={i}>
                        <dt>服务商事件</dt>
                        <dd>{event.kind}</dd>
                      </div>
                    ))}
                  </dl>
                </MotionDetails>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                detailRevision.current++
                setDetail(null)
              }}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogFrame>
      </Dialog>
    </AdminPage>
  )
}
