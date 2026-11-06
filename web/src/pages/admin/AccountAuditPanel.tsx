import { useState } from 'react'
import { isZhiZhouIosApp } from '@shared/device'
import { CirclePlus, RefreshCw, History } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/format'
import { UserAvatar } from '@/components/identity/UserAvatar'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DialogBody, DialogFrame } from '@/components/shared/DialogFrame'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { SearchField } from '@/components/shared/SearchField'
import SearchSelect from '@/components/shared/SearchSelect'
import { cn } from '@/lib/utils'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import Pagination from '@/components/shared/Pagination'
import { ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'

export interface LoginAudit {
  avatarUrl?: string
  id: string
  userId: string
  username: string
  displayName: string
  status: string
  reason: string
  ipAddress: string
  userAgent: string
  authMethod?: string
  createdAt: number
}
export interface AdminOperationAudit {
  accountReason?: string
  accountTarget?: string
  beforeState?: unknown
  afterState?: unknown
  actorAvatarUrl?: string
  id: string
  operationId: string
  actorUserId: string
  actorUsername: string
  actorDisplayName: string
  action: string
  targetCount: number
  status: string
  responseStatus: number
  replayCount: number
  error: string
  createdAt: number
  updatedAt: number
  finishedAt: number
}
export interface AccountRecordDetail {
  title: string
  fields: Array<[string, string | number]>
}
export function AccountRecordDetails({ detail, onClose }: { detail: AccountRecordDetail | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!detail}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogFrame>
        <DialogHeader>
          <DialogTitle>{detail?.title || '记录详情'}</DialogTitle>
          <DialogDescription>完整记录信息，供管理与问题追溯。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="account-record-detail">
            {detail?.fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  )
}
export function AccountRecordDate({ value }: { value: number }) {
  return value ? (
    <time dateTime={new Date(value).toISOString()} title={formatDateTime(value)} className="account-record-date">
      {formatDate(value)}
      <span className="account-record-secondary">{formatDateTime(value).slice(11)}</span>
    </time>
  ) : (
    <span>—</span>
  )
}
export function accountDeviceSummary(agent: string): string {
  if (!agent) return '未记录设备'
  // 原生 iOS 客户端使用 URLSession UA，不含浏览器或 iPhone 标识。
  if (isZhiZhouIosApp(agent)) {
    return 'Cat’s Library iOS App'
  }
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : '其他浏览器'
  const system = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh|Mac OS/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '其他设备'
  return `${browser} · ${system}`
}
function authMethodLabel(method?: string): string {
  return method === 'passkey' ? 'Passkey' : '密码'
}
const LOGIN_COLUMNS: readonly AdminColumn[] = [
  { key: 'user', label: '用户', width: '23%', primary: true },
  { key: 'result', label: '结果与原因', width: '24%' },
  { key: 'source', label: '访问来源', width: '24%' },
  { key: 'time', label: '时间', width: '19%' },
  { key: 'actions', label: '操作', width: '10%', actions: true },
]
const OPERATION_COLUMNS: readonly AdminColumn[] = [
  { key: 'actor', label: '操作人', width: '26%', primary: true },
  { key: 'action', label: '动作与范围', width: '30%' },
  { key: 'result', label: '结果', width: '14%' },
  { key: 'time', label: '时间', width: '20%' },
  { key: 'actions', label: '操作', width: '10%', actions: true },
]
interface Props {
  kind: 'login' | 'operation'
  records: Array<LoginAudit | AdminOperationAudit>
  total: number
  loading: boolean
  error?: string
  hasLoaded?: boolean
  status: string
  onStatus: (status: string) => void
  onRefresh: () => void
  search?: string
  onSearch?: (search: string) => void
  page: number
  limit: number
  onPage: (page: number) => void
  onLimit: (limit: number) => void
  statusLabel: (status: string) => string
  reasonLabel?: (reason: string) => string
  actionLabel?: (action: string) => string
}
export default function AccountAuditPanel({
  kind,
  records,
  total,
  loading,
  error = '',
  hasLoaded = true,
  status,
  onStatus,
  onRefresh,
  search,
  onSearch,
  page,
  limit,
  onPage,
  onLimit,
  statusLabel,
  reasonLabel = (value) => value,
  actionLabel = (value) => value,
}: Props) {
  const [detail, setDetail] = useState<AccountRecordDetail | null>(null)
  const columns = kind === 'login' ? LOGIN_COLUMNS : OPERATION_COLUMNS
  const title = kind === 'login' ? '登录记录' : '操作记录'
  const options = kind === 'login' ? ['success', 'failure', 'limited'] : ['pending', 'completed', 'failed']
  function showDetail(record: LoginAudit | AdminOperationAudit) {
    const fields: AccountRecordDetail['fields'] =
      'operationId' in record
        ? [
            ['操作人', record.actorDisplayName || record.actorUsername || '未知管理员'],
            ['用户名', record.actorUsername],
            ['动作', actionLabel(record.action)],
            ['动作标识', record.action],
            ['目标数量', record.targetCount],
            ['结果', statusLabel(record.status)],
            ['响应状态', record.responseStatus ? `HTTP ${record.responseStatus}` : '未记录'],
            ['重放次数', record.replayCount],
            ['操作 ID', record.operationId],
            ...(record.accountReason ? [
              ['操作原因', record.accountReason], ['目标账号 ID', record.accountTarget || '—'],
              ['变更前', JSON.stringify(record.beforeState)], ['变更后', JSON.stringify(record.afterState)],
            ] as Array<[string, string]> : []),
            ['错误信息', record.error],
            ['创建时间', formatDateTime(record.createdAt)],
            ['更新时间', formatDateTime(record.updatedAt)],
            ['完成时间', record.finishedAt ? formatDateTime(record.finishedAt) : '尚未完成'],
          ]
        : [
            ['用户', record.displayName || record.username || '未知用户'],
            ['用户名', record.username],
            ['结果', statusLabel(record.status)],
            ['认证方式', authMethodLabel(record.authMethod)],
            ['原因', reasonLabel(record.reason)],
            ['IP 地址', record.ipAddress],
            ['设备摘要', accountDeviceSummary(record.userAgent)],
            ['User-Agent', record.userAgent],
            ['记录 ID', record.id],
            ['发生时间', formatDateTime(record.createdAt)],
          ]
    setDetail({ title: `${title}详情`, fields })
  }
  const statusSelectOptions = [{ value: 'all', label: '全部结果' }, ...options.map((value) => ({ value, label: statusLabel(value) }))]
  return (
    <>
      <AdminToolbar layout="inline" className="admin-filter-rail account-record-filters account-audit-filters" ariaLive="polite">
        {onSearch !== undefined && (
          <SearchField
            id={`account-${kind}-search`}
            label={`搜索${kind === 'login' ? '登录' : '操作'}用户名`}
            placeholder="搜索用户名"
            value={search || ''}
            onChange={(e) => onSearch(e.target.value)}
          />
        )}
        <div className="select-filter-chips">
          <SearchSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
            aria-label={kind === 'login' ? '登录结果' : '操作结果'}
            value={status}
            onChange={onStatus}
            options={statusSelectOptions}
          />
        </div>
        <div className="account-record-filters__actions">
          <span className="account-record-filters__count">{!hasLoaded ? (error ? '读取失败' : '读取中…') : `共 ${total} 条`}</span>
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </AdminToolbar>
      {error && hasLoaded && <InlineError message={`${error}，保留上次读取的结果。`} onRetry={onRefresh} />}
      <AdminDataPanel className="account-records-panel overflow-hidden" ariaLabel={`${title}列表`} columns={columns} density="comfortable">
        <Table aria-busy={loading} className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
          <TableCaption className="sr-only">{title}列表，完整信息可在详情查看。</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead scope="col" key={c.key}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody key={limit}>
            {!records.length ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  {error && !hasLoaded ? (
                    <ErrorState message={error} onRetry={onRefresh} />
                  ) : loading ? (
                    <LoadingState label={`读取${title}`} />
                  ) : (
                    <EmptyState
                      icon={<History />}
                      message={`暂无${status !== 'all' || search?.trim() ? '匹配的' : ''}${title}`}
                      hint={status !== 'all' || search?.trim() ? '调整用户名或结果筛选，查看其他记录。' : '发生相关操作后，记录会显示在这里。'}
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              records.map((record, index) => {
                const operation = 'operationId' in record
                const name = operation ? record.actorDisplayName || record.actorUsername || '未知管理员' : record.displayName || record.username || '未知用户'
                const username = operation ? record.actorUsername : record.username
                return (
                  <TableRow key={record.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, records.length)}ms` }}>
                    <TableCell data-primary="" data-label={operation ? '操作人' : '用户'}>
                      <div className="account-user-identity">
                        <UserAvatar name={name} src={operation ? record.actorAvatarUrl : record.avatarUrl} />
                        <div>
                          <strong>{name}</strong>
                          <span className="account-record-secondary">{username ? `@${username}` : '未知账号'}</span>
                        </div>
                      </div>
                    </TableCell>
                    {operation ? (
                      <>
                        <TableCell data-label="动作与范围">
                          <div>
                            {actionLabel(record.action)}
                            <span className="account-record-secondary">目标 {record.targetCount} 个</span>
                          </div>
                        </TableCell>
                        <TableCell data-label="结果">
                          <AdminStatusBadge tone={record.status === 'completed' ? 'success' : record.status === 'failed' ? 'danger' : 'warning'}>
                            {statusLabel(record.status)}
                          </AdminStatusBadge>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell data-label="结果与原因">
                          <div>
                            <AdminStatusBadge tone={record.status === 'success' ? 'success' : record.status === 'limited' ? 'warning' : 'danger'}>
                              {statusLabel(record.status)}
                            </AdminStatusBadge>
                            {record.reason !== 'login' && record.reason !== 'success' && (
                              <span className="account-record-secondary">{record.reason ? reasonLabel(record.reason) : '未记录原因'}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell data-label="访问来源">
                          <div>
                            <code className="account-record-code">{record.ipAddress || '未记录'}</code>
                            <span className="account-record-secondary">{accountDeviceSummary(record.userAgent)}</span>
                            {record.authMethod === 'passkey' && <span className="account-record-secondary">认证：Passkey</span>}
                          </div>
                        </TableCell>
                      </>
                    )}
                    <TableCell data-label="时间">
                      <AccountRecordDate value={record.createdAt} />
                    </TableCell>
                    <TableCell data-actions="">
                      <div className="admin-cell-actions account-user-actions">
                        <Button variant="ghost" size="sm" aria-label={`查看${name}的${title}详情`} onClick={() => showDetail(record)}>
                          详情
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </AdminDataPanel>
      <Pagination
        variant="detached"
        page={page}
        totalPages={Math.max(1, Math.ceil(total / limit))}
        onPage={onPage}
        busy={loading}
        summary={hasLoaded ? `共 ${total} 条记录` : '尚未读取记录'}
        pageSize={{ value: limit, onChange: onLimit, options: ADMIN_PAGE_SIZE_OPTIONS }}
      />
      <details className="account-record-note">
        <summary>审计记录说明</summary>
        <p>
          {kind === 'login'
            ? '记录包含登录结果、原因、来源 IP 与完整 User-Agent。设备摘要仅供辅助判断，完整信息可在详情查看。'
            : '详情保留目标数量、响应码、重放次数、操作 ID 与错误信息。记录仅提供元数据，不展示密码、登录令牌或目标正文。'}
        </p>
      </details>
      <AccountRecordDetails detail={detail} onClose={() => setDetail(null)} />
    </>
  )
}
