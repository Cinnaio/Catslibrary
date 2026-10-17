import { useEffect, useRef, useState } from 'react'
import { CirclePlus, MoreHorizontal, RefreshCw } from 'lucide-react'
import { adminApi, authApi, type AdminDirectoryUser } from '@/lib/api'
import { formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { useDebouncedValue } from '@/hooks/useDebounce'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/ui/user-avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AdminDialogBody, AdminDialogContent } from '@/components/admin/AdminDialog'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { AdminDataPanel, AdminToolbar, AdminSearch, type AdminColumn } from '@/components/admin/AdminWorkspace'
import CustomSelect from '@/components/admin/CustomSelect'
import { cn } from '@/lib/utils'
import Pagination from '@/components/admin/Pagination'
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
  onRole: (user: AdminDirectoryUser) => Promise<void>
  onStatus: (user: AdminDirectoryUser) => Promise<void>
  onReset: (user: AdminDirectoryUser) => Promise<void>
  onDelete: (user: AdminDirectoryUser) => Promise<void>
}

export default function UserManagementPanel({ search, onSearchChange, selfId, onRole, onStatus, onReset, onDelete }: Props) {
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
      else await adminApi.users.setPassword(target.id, password)
      clearDialog()
      toast(own ? '密码已修改，当前登录已更新' : '密码已修改，该用户需要重新登录', 'success')
      setRevision((value) => value + 1)
    } catch (err) {
      setError((err as Error).message || '修改失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  async function runAction(action: Props['onRole'], user: AdminDirectoryUser) {
    await action(user)
    setRevision((value) => value + 1)
  }
  const users = result?.users || []
  const total = result?.total || 0
  const roleOptions = [
    { value: 'all', label: '全部角色' },
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
          <AdminSearch
            id="account-user-search"
            label="搜索用户"
            placeholder="搜索昵称或用户名"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        )}
        <div className="admin-filter-chips">
          <CustomSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
            aria-label="用户角色"
            value={role}
            onChange={(value) => {
              setRole(value)
              setPage(1)
            }}
            options={roleOptions}
          />
          <CustomSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--admin-filter-chip-icon-size)]" />}
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
          <span className="account-users-filters__count">
            {!result && loading ? '读取中…' : `共 ${total} 人`}
          </span>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            刷新
          </Button>
        </div>
      </AdminToolbar>
      {loadError && (
        <div className="account-users-error" role="alert">
          {loadError}
          {result ? '，当前保留上次读取的数据。' : ''}
          <Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
            重试
          </Button>
        </div>
      )}
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
          <TableBody>
            {!users.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  {loading ? '加载中…' : loadError ? '用户目录暂时无法读取' : '没有匹配的用户，请调整搜索或筛选条件'}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
                const self = user.id === selfId
                return (
                  <TableRow key={user.id}>
                    <TableCell data-primary="" data-label="用户">
                      <div className="account-user-identity">
                        <UserAvatar className="account-user-avatar" name={user.displayName || user.username} src={user.avatarUrl} />
                        <div>
                          <div className="account-user-name">
                            <strong>{user.displayName || user.username}</strong>
                            {self && <Badge variant="identity">本人</Badge>}
                          </div>
                          <span className="account-user-username">@{user.username}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell data-label="权限与状态">
                      <div className="account-user-badges">
                        <AdminStatusBadge tone={user.role === 'admin' ? 'info' : 'neutral'}>{user.role === 'admin' ? '管理员' : '读者'}</AdminStatusBadge>
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
                          {user.lastLoginAt ? timeAgo(user.lastLoginAt) : '尚未登录'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell data-label="想法">{user.thoughtCount || 0}</TableCell>
                    <TableCell data-actions="">
                      <div className="admin-cell-actions account-user-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-full h-7 px-3 text-xs"
                          disabled={!selfId}
                          onClick={() => {
                            clearDialog()
                            setTarget(user)
                          }}
                        >
                          {self ? '修改我的密码' : '修改密码'}
                        </Button>
                        {!self && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="rounded-full size-7" aria-label={`更多操作：${user.username}`} disabled={!selfId}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => void runAction(onRole, user)}>
                                {user.role === 'admin' ? '设为读者' : '设为管理员'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void runAction(onReset, user)}>生成临时密码</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void runAction(onStatus, user)}>
                                {user.status === 'disabled' ? '恢复账号' : '禁用账号'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => void runAction(onDelete, user)}>
                                删除用户
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
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
        summary={total ? `共 ${total} 人，显示 ${(page - 1) * limit + 1}–${Math.min(page * limit, total)}` : '共 0 人'}
      />
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !savingRef.current) clearDialog()
        }}
      >
        <AdminDialogContent
          className="account-password-dialog"
          onEscapeKeyDown={(event) => {
            if (savingRef.current) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (savingRef.current) event.preventDefault()
          }}
        >
          <form onSubmit={(event) => void savePassword(event)}>
            <DialogHeader>
              <DialogTitle>{own ? '修改我的密码' : '修改用户密码'}</DialogTitle>
              <DialogDescription>{own ? '验证当前密码后，为自己的账号设置新密码。' : '直接设置新密码，无需用户提供原密码。'}</DialogDescription>
            </DialogHeader>
            <AdminDialogBody>
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
                  aria-describedby="account-password-policy"
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
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              <label className="account-password-visible">
                <input type="checkbox" checked={visible} disabled={saving} onChange={(event) => setVisible(event.target.checked)} />
                显示密码
              </label>
              <p className="account-password-impact">
                {own
                  ? '保存后，其他登录会话将被清除，当前会话会更新并保持登录。'
                  : '保存后，旧密码立即失效，该用户的所有登录会话将被清除，需要使用新密码重新登录。'}
                {target?.status === 'disabled' && ' 此账号仍保持禁用状态。'}
              </p>
              {error && (
                <p className="account-password-error" role="alert">
                  {error}
                </p>
              )}
            </AdminDialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={saving} onClick={clearDialog}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存新密码'}
              </Button>
            </DialogFooter>
          </form>
        </AdminDialogContent>
      </Dialog>
    </>
  )
}
