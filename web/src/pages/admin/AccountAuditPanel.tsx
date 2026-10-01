import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/format'
import { InitialAvatar } from '@/components/ui/initial-avatar'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'

export interface LoginAudit {
  id: string
  userId: string
  username: string
  displayName: string
  status: string
  reason: string
  ipAddress: string
  userAgent: string
  createdAt: number
}
export interface AdminOperationAudit {
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
      <AdminDialogContent>
        <DialogHeader>
          <DialogTitle>{detail?.title || '记录详情'}</DialogTitle>
          <DialogDescription>完整记录信息，供管理与问题追溯。</DialogDescription>
        </DialogHeader>
        <AdminDialogBody>
          <dl className="account-record-detail">
            {detail?.fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        </AdminDialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </AdminDialogContent>
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
const LOGIN_COLUMNS: readonly AdminColumn[] = [
  { key: 'user', label: '用户', width: '23%', primary: true },
  { key: 'result', label: '结果与原因', width: '24%' },
  { key: 'source', label: '访问来源', width: '24%' },
  { key: 'time', label: '时间', width: '19%' },
  { key: 'actions', label: '操作', width: '10%', actions: true },
]
const OPERATION_COLUMNS: readonly AdminColumn[] = [
  { key: 'actor', label: '操作人', width: '20%', primary: true },
  { key: 'action', label: '动作与范围', width: '23%' },
  { key: 'result', label: '结果', width: '11%' },
  { key: 'id', label: '操作标识', width: '20%' },
  { key: 'time', label: '时间', width: '16%' },
  { key: 'actions', label: '操作', width: '10%', actions: true },
]
interface Props {
  kind: 'login' | 'operation'
  records: Array<LoginAudit | AdminOperationAudit>
  total: number
  loading: boolean
  status: string
  onStatus: (status: string) => void
  onRefresh: () => void
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
  status,
  onStatus,
  onRefresh,
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
            ['错误信息', record.error],
            ['创建时间', formatDateTime(record.createdAt)],
            ['更新时间', formatDateTime(record.updatedAt)],
            ['完成时间', record.finishedAt ? formatDateTime(record.finishedAt) : '尚未完成'],
          ]
        : [
            ['用户', record.displayName || record.username || '未知用户'],
            ['用户名', record.username],
            ['结果', statusLabel(record.status)],
            ['原因', reasonLabel(record.reason)],
            ['IP 地址', record.ipAddress],
            ['设备摘要', accountDeviceSummary(record.userAgent)],
            ['User-Agent', record.userAgent],
            ['记录 ID', record.id],
            ['发生时间', formatDateTime(record.createdAt)],
          ]
    setDetail({ title: `${title}详情`, fields })
  }
  return (
    <>
      <AdminDataPanel className="account-records-panel overflow-hidden" ariaLabel={`${title}列表`} columns={columns} density="comfortable">
        <AdminPanelHeading
          title={title}
          status={<span className="admin-panel-status">{loading && !records.length ? '读取中' : `${total} 条`}</span>}
          actions={
            <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw aria-hidden="true" />
              刷新
            </Button>
          }
        />
        <AdminToolbar className="account-record-filters">
          <span className="account-record-secondary">结果</span>
          <Select value={status} onValueChange={onStatus}>
            <SelectTrigger aria-label={kind === 'login' ? '登录结果' : '操作结果'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">全部结果</SelectItem>
              {options.map((value) => (
                <SelectItem key={value} value={value}>
                  {statusLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="account-record-filters__hint">按最新{kind === 'login' ? '登录' : '操作'}时间排序</span>
        </AdminToolbar>
        <Table>
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
          <TableBody>
            {!records.length ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="account-record-empty">
                  {loading ? '加载中…' : `暂无匹配的${title}`}
                </TableCell>
              </TableRow>
            ) : (
              records.map((record) => {
                const operation = 'operationId' in record
                const name = operation ? record.actorDisplayName || record.actorUsername || '未知管理员' : record.displayName || record.username || '未知用户'
                const username = operation ? record.actorUsername : record.username
                return (
                  <TableRow key={record.id}>
                    <TableCell data-primary="" data-label={operation ? '操作人' : '用户'}>
                      <div className="account-user-identity">
                        <InitialAvatar name={name} />
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
                            <span className="account-record-secondary">
                              目标 {record.targetCount} 个{record.replayCount > 0 ? ` · 重放 ${record.replayCount} 次` : ''}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell data-label="结果">
                          <AdminStatusBadge tone={record.status === 'completed' ? 'success' : record.status === 'failed' ? 'danger' : 'warning'}>
                            {statusLabel(record.status)}
                          </AdminStatusBadge>
                        </TableCell>
                        <TableCell data-label="操作标识">
                          <div>
                            <code className="account-record-code account-record-code--truncate" title={record.operationId}>
                              {record.operationId}
                            </code>
                            <span className="account-record-secondary">{record.responseStatus ? `HTTP ${record.responseStatus}` : '未记录响应'}</span>
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell data-label="结果与原因">
                          <div>
                            <AdminStatusBadge tone={record.status === 'success' ? 'success' : record.status === 'limited' ? 'warning' : 'danger'}>
                              {statusLabel(record.status)}
                            </AdminStatusBadge>
                            <span className="account-record-secondary">{reasonLabel(record.reason)}</span>
                          </div>
                        </TableCell>
                        <TableCell data-label="访问来源">
                          <div>
                            <code className="account-record-code">{record.ipAddress || '未记录'}</code>
                            <span className="account-record-secondary">{accountDeviceSummary(record.userAgent)}</span>
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
        summary={`共 ${total} 条记录`}
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
