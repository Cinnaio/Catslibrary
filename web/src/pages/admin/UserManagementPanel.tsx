import { isAdministrator, canManageUser, roleLabel, USER_ROLES } from '@shared/roles'
import '@/styles/input-fields.css'
import { useEffect, useRef, useState } from 'react'
import { CirclePlus, MoreHorizontal, RefreshCw, Users } from 'lucide-react'
import { adminApi, authApi, type AdminDirectoryUser } from '@/lib/api'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { useDebouncedValue } from '@/hooks/useDebounce'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/identity/UserAvatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EmptyState from '@/components/shared/EmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DialogBody, DialogFrame } from '@/components/shared/DialogFrame'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { SearchField } from '@/components/shared/SearchField'
import SearchSelect from '@/components/shared/SearchSelect'
import { cn } from '@/lib/utils'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import Pagination from '@/components/shared/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE } from '@/lib/admin-pagination'

const COLUMNS: readonly AdminColumn[] = [
  { key: 'user', label: '用户', width: '29%', primary: true },
  { key: 'access', label: '权限与状态', width: '20%' },
  { key: 'dates', label: '注册与登录', width: '23%' },
  { key: 'thoughts', label: '想法', width: '8%' },
  { key: 'actions', label: '操作', width: '20%', actions: true },
]
interface Props {
  search: string
  onSearchChange?: (value: string) => void
  selfId?: string
  selfRole?: string
}

export default function UserManagementPanel({ search, onSearchChange, selfId, selfRole }: Props) {
  const { toast } = useToast()
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ users: AdminDirectoryUser[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const debouncedSearch = useDebouncedValue(search, 400)
  // 搜索变更先回第一页；有效筛选与页码一起更新，避免请求旧页码。
  const [appliedSearch, setAppliedSearch] = useState(debouncedSearch)
  if (appliedSearch !== debouncedSearch) {
    setAppliedSearch(debouncedSearch)
    setPage(1)
  }
  useEffect(() => {
    let current = true
    setLoading(true)
    setLoadError('')
    adminApi.users
      .directory({
        search: appliedSearch.trim(),
        role: role === 'all' ? undefined : role,
        status: status === 'all' ? undefined : status,
        limit,
        offset: (page - 1) * limit,
      })
      .then((data) => {
        if (!current) return
        const lastPage = Math.max(1, Math.ceil(data.total / limit))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setResult(data)
      })
      .catch((error) => {
        if (current) setLoadError((error as Error).message || '用户目录加载失败')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [appliedSearch, role, status, page, limit, revision])

  const [target, setTarget] = useState<AdminDirectoryUser | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [pendingUsers, setPendingUsers] = useState<Set<string>>(new Set())
  const passwordReturnFocus = useRef<HTMLButtonElement | null>(null)
  const own = !!target && target.id === selfId
  function clearDialog() {
    setTarget(null)
    setCurrentPassword('')
    setPassword('')
    setConfirmation('')
    setVisible(false)
    setError('')
  }
  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!target || savingRef.current) return
    if (own && !currentPassword) {
      setError('请输入当前密码')
      return
    }
    if (password.length < 8) {
      setError('新密码至少需要 8 位')
      return
    }
    if (password !== confirmation) {
      setError('两次输入的新密码不一致')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      if (own) await authApi.changePassword(currentPassword, password)
      else return
      clearDialog()
      toast('密码已修改，当前登录已更新', 'success')
      setRevision((value) => value + 1)
    } catch (err) {
      setError((err as Error).message || '修改失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const [operation, setOperation] = useState<{ user: AdminDirectoryUser; action: string } | null>(null)
  const [reason, setReason] = useState('')
  const [nextRole, setNextRole] = useState('reader')
  const [confirmUsername, setConfirmUsername] = useState('')
  const [operationError, setOperationError] = useState('')
  const operationBusy = useRef(false)
  function openOperation(user: AdminDirectoryUser, action: string) {
    setOperation({ user, action }); setReason(''); setConfirmUsername(''); setNextRole(user.role); setOperationError('')
  }
  const actionLabels: Record<string, string> = { 'user-role': '调整角色', 'user-status': '调整账号状态', 'reset-password': '发送密码重置邮件', 'revoke-sessions': '撤销登录会话', 'delete-user': '删除用户' }
  async function submitOperation(event: React.FormEvent) {
    event.preventDefault()
    if (!operation || operationBusy.current || !reason.trim()) return
    const { user, action } = operation
    operationBusy.current = true; setPendingUsers(new Set([user.id])); setOperationError('')
    try {
      await adminApi.users.mutateAccount(user, action, reason.trim(), {
        ...(action === 'user-role' ? { role: nextRole } : {}),
        ...(action === 'user-status' ? { status: user.status === 'disabled' ? 'active' : 'disabled' } : {}),
        ...(action === 'delete-user' ? { confirmUsername } : {}),
      })
      setOperation(null); setRevision(value => value + 1)
      toast(action === 'reset-password' ? '重置邮件已发送；用户确认后密码才会改变' : '账号操作已完成', 'success')
    } catch (error) { setOperationError((error as Error).message || '操作失败，请重试') }
    finally { operationBusy.current = false; setPendingUsers(new Set()) }
  }
  const users = result?.users || []
  const total = result?.total || 0
  const roleOptions = [
    { value: 'all', label: '全部角色' },
    { value: 'super_admin', label: '超级管理员' },
    { value: 'admin', label: '管理员' },
    { value: 'reader', label: '读者' },
  ]
  const userStatusOptions = [
    { value: 'all', label: '全部状态' },
    { value: 'active', label: '正常' },
    { value: 'disabled', label: '已禁用' },
  ]
  return (
    <>
      <AdminToolbar layout="inline" className="admin-filter-rail account-users-filters" ariaLive="polite">
        {onSearchChange !== undefined && (
          <SearchField
            id="account-user-search"
            label="搜索用户"
            placeholder="搜索昵称或用户名"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        )}
        <div className="select-filter-chips">
          <SearchSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
            aria-label="用户角色"
            value={role}
            onChange={(value) => {
              setRole(value)
              setPage(1)
            }}
            options={roleOptions}
          />
          <SearchSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
            aria-label="用户状态"
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={userStatusOptions}
          />
        </div>
        <div className="account-users-filters__actions">
          <span className="account-users-filters__count">{!result ? (loadError ? '读取失败' : '读取中…') : `共 ${total} 人`}</span>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            刷新
          </Button>
        </div>
      </AdminToolbar>
      {loadError && result && <InlineError message={`${loadError}，当前保留上次读取的数据。`} onRetry={() => setRevision((value) => value + 1)} />}
      <AdminDataPanel className="account-users-panel overflow-hidden" ariaLabel="用户列表" columns={COLUMNS} density="comfortable">
        <Table aria-busy={loading} className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
          <TableCaption className="sr-only">站点用户目录，含权限、状态、注册与登录时间、想法及账号操作</TableCaption>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead key={column.key} scope="col">
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody key={limit}>
            {!users.length ? (
              <TableRow>
                <TableCell colSpan={5}>
                  {loadError && !result ? (
                    <ErrorState message={loadError} onRetry={() => setRevision((value) => value + 1)} />
                  ) : loading ? (
                    <LoadingState label="读取用户目录" />
                  ) : (
                    <EmptyState icon={<Users />} message="没有匹配的用户" hint="调整昵称、用户名或筛选条件，查看其他用户。" />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user, index) => {
                const self = user.id === selfId
                const busy = pendingUsers.has(user.id) || (saving && target?.id === user.id)
                return (
                  <TableRow key={user.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, users.length)}ms` }}>
                    <TableCell data-primary="" data-label="用户">
                      <div className="account-user-identity">
                        <UserAvatar className="account-user-avatar" name={user.displayName || user.username} src={user.avatarUrl} />
                        <div>
                          <div className="account-user-name">
                            <strong>{user.displayName || user.username}</strong>
                            {self && <Badge variant="identity">本人</Badge>}
                          </div>
                          <span className="account-user-username">@{user.username}</span>
                          <span className="account-user-username">{user.emailVerified ? `已验证：${user.email}` : '尚未绑定邮箱'}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell data-label="权限与状态">
                      <div className="account-user-badges">
                        <AdminStatusBadge tone={isAdministrator(user.role) ? 'info' : 'neutral'}>{roleLabel(user.role)}</AdminStatusBadge>
                        <AdminStatusBadge tone={user.status === 'disabled' ? 'danger' : 'success'}>
                          {user.status === 'disabled' ? '已禁用' : '正常'}
                        </AdminStatusBadge>
                      </div>
                    </TableCell>
                    <TableCell data-label="注册与登录">
                      <div className="account-user-dates">
                        <span>
                          <em>注册</em>
                          <time dateTime={formatDate(user.createdAt) || undefined} title={formatDateTime(user.createdAt)}>
                            {formatDate(user.createdAt) || '—'}
                          </time>
                        </span>
                        <span>
                          <em>登录</em>
                          {user.lastLoginAt ? (
                            <time dateTime={new Date(user.lastLoginAt).toISOString()} title={formatDateTime(user.lastLoginAt)}>
                              {timeAgo(user.lastLoginAt)}
                            </time>
                          ) : (
                            '尚未登录'
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell data-label="想法">{user.thoughtCount || 0}</TableCell>
                    <TableCell data-actions="">
                      <div className="admin-cell-actions account-user-actions">
                        {busy ? (
                          <span className="account-record-secondary" role="status">
                            处理中…
                          </span>
                        ) : null}
                        {self ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!selfId || busy}
                            onClick={(event) => {
                              passwordReturnFocus.current = event.currentTarget
                              clearDialog()
                              setTarget(user)
                            }}
                          >
                            修改我的密码
                          </Button>
                        ) : canManageUser(selfRole, user.role) ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`更多操作：${user.username}`} disabled={!selfId || busy} onClick={event => { passwordReturnFocus.current = event.currentTarget }}><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {selfRole === 'super_admin' && <DropdownMenuItem onSelect={() => openOperation(user, 'user-role')}>调整角色</DropdownMenuItem>}
                              <DropdownMenuItem onSelect={() => openOperation(user, 'user-status')}>{user.status === 'disabled' ? '恢复账号' : '禁用账号'}</DropdownMenuItem>
                              <DropdownMenuItem disabled={!user.emailVerified || user.status !== 'active'} onSelect={() => openOperation(user, 'reset-password')}>发送密码重置邮件</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => openOperation(user, 'revoke-sessions')}>撤销登录会话</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => openOperation(user, 'delete-user')}>删除用户</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : <span className="account-record-secondary">仅超级管理员可管理</span>}
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
        busy={loading}
        onPage={setPage}
        pageSize={{
          value: limit,
          onChange: (value) => {
            setLimit(value)
            setPage(1)
          },
        }}
        summary={!result ? '尚未读取用户目录' : total ? `共 ${total} 人，显示 ${(page - 1) * limit + 1}–${Math.min(page * limit, total)}` : '共 0 人'}
      />
      <Dialog open={!!operation} onOpenChange={open => { if (!open && !operationBusy.current) setOperation(null) }}>
        <DialogFrame className="account-password-dialog" onCloseAutoFocus={event => { event.preventDefault(); passwordReturnFocus.current?.focus() }} onEscapeKeyDown={event => { if (operationBusy.current) event.preventDefault() }} onPointerDownOutside={event => { if (operationBusy.current) event.preventDefault() }}>
          <form onSubmit={event => void submitOperation(event)}>
            <DialogHeader><DialogTitle>{actionLabels[operation?.action || ''] || '账号操作'}</DialogTitle><DialogDescription>目标：@{operation?.user.username} · {roleLabel(operation?.user.role)}。提交时会重新检查账号状态。</DialogDescription></DialogHeader>
            <DialogBody>
              {operation?.action === 'user-role' && <div className="account-password-field"><Label htmlFor="account-target-role">目标角色</Label><SearchSelect id="account-target-role" value={nextRole} onChange={setNextRole} disabled={operationBusy.current} options={USER_ROLES.map(value => ({ value, label: roleLabel(value) }))} /></div>}
              <div className="account-password-field"><Label htmlFor="account-action-reason">操作原因</Label><Input id="account-action-reason" value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} disabled={operationBusy.current} /></div>
              {operation?.action === 'delete-user' && <div className="account-password-field"><Label htmlFor="account-delete-confirm">输入完整用户名确认删除</Label><Input id="account-delete-confirm" value={confirmUsername} onChange={event => setConfirmUsername(event.target.value)} required disabled={operationBusy.current} /></div>}
              <p className="account-password-impact">{operation?.action === 'reset-password' ? '邮件发送到已验证邮箱。用户打开链接设置新密码后，旧密码和全部登录会话才会失效。' : operation?.action === 'delete-user' ? '用户及其书架、书签、想法和阅读进度将永久删除，无法撤销。' : '操作会撤销目标账号的全部会话和待确认邮件链接。普通管理员管理内容及读者；超级管理员还可调整管理权和站点配置。'}</p>
              {operationError && <p role="alert" className="account-password-error">{operationError}</p>}
            </DialogBody>
            <DialogFooter><Button type="button" variant="secondary" disabled={operationBusy.current} onClick={() => setOperation(null)}>取消</Button><Button type="submit" disabled={operationBusy.current || !reason.trim() || (operation?.action === 'delete-user' && confirmUsername !== operation.user.username) || (operation?.action === 'user-role' && nextRole === operation.user.role)}>{operationBusy.current ? '处理中…' : '确认操作'}</Button></DialogFooter>
          </form>
        </DialogFrame>
      </Dialog>
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !savingRef.current) clearDialog()
        }}
      >
        <DialogFrame
          className="account-password-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            passwordReturnFocus.current?.focus()
          }}
          onEscapeKeyDown={(event) => {
            if (savingRef.current) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (savingRef.current) event.preventDefault()
          }}
        >
          <form onSubmit={(event) => void savePassword(event)}>
            <DialogHeader>
              <DialogTitle>修改我的密码</DialogTitle>
              <DialogDescription>验证当前密码后，为自己的账号设置新密码。</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="account-password-target">
                <UserAvatar className="account-user-avatar" name={target?.displayName || target?.username || ''} src={target?.avatarUrl} />
                <div>
                  <strong>{target?.displayName || target?.username}</strong>
                  <span>@{target?.username}</span>
                </div>
              </div>
              {own && (
                <div className="account-password-field">
                  <Label htmlFor="account-current-password">当前密码</Label>
                  <Input
                    id="account-current-password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={currentPassword}
                    disabled={saving}
                    aria-invalid={!!error}
                    aria-describedby={error ? 'account-password-error' : undefined}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </div>
              )}
              <div className="account-password-field">
                <Label htmlFor="account-new-password">新密码</Label>
                <Input
                  id="account-new-password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  disabled={saving}
                  aria-describedby={`account-password-policy${error ? ' account-password-error' : ''}`}
                  aria-invalid={!!error}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <span id="account-password-policy">至少 8 位，建议包含字母、数字和符号。</span>
              </div>
              <div className="account-password-field">
                <Label htmlFor="account-confirm-password">确认新密码</Label>
                <Input
                  id="account-confirm-password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmation}
                  disabled={saving}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'account-password-error' : undefined}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              <label className="account-password-visible">
                <input type="checkbox" checked={visible} disabled={saving} onChange={(event) => setVisible(event.target.checked)} />
                显示密码
              </label>
              <p className="account-password-impact">
                保存后，其他登录会话与待确认邮件链接将被清除，当前会话会更新并保持登录。
                {target?.status === 'disabled' && ' 此账号仍保持禁用状态。'}
              </p>
              {error && (
                <p id="account-password-error" className="account-password-error" role="alert">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={saving} onClick={clearDialog}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存新密码'}
              </Button>
            </DialogFooter>
          </form>
        </DialogFrame>
      </Dialog>
    </>
  )
}
