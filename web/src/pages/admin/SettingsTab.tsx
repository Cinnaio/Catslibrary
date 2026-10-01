/**
 * 账户与注册 tab —— 当前管理员、注册设置、用户管理、邀请码管理。
 * 由 Novel-KV js/admin-users.js + admin.html #tab-settings 平移。
 * 无轮询：挂载 + 每次变更后重新拉取，无乐观更新。
 */
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi, authApi, newOperationId } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { RefreshCw } from 'lucide-react'
import AccountAuditPanel, {
  AccountRecordDate,
  AccountRecordDetails,
  type AccountRecordDetail,
  type LoginAudit,
  type AdminOperationAudit,
} from './AccountAuditPanel'
import { copyText } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import { useDebouncedValue } from '@/hooks/useDebounce'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AdminPage from '@/components/admin/AdminPage'
import UserManagementPanel from './UserManagementPanel'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, AdminSearch, type AdminColumn } from '@/components/admin/AdminWorkspace'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { usePersistentState } from '@/hooks/usePersistentState'

interface AdminUser {
  id: string
  username: string
  displayName: string
  role: string
  status: string
  createdAt: number
  updatedAt: number
  lastLoginAt: number
  bio: string
  avatarUrl: string
  thoughtCount?: number
}

interface Invite {
  code: string
  createdAt: number
  usedAt: number
  usedBy: string
  usedByName: string
  disabledAt: number
}

interface SchemaHealth {
  ok: boolean
  missing: string[]
}

interface SettingsData {
  settings: { registerMode: 'open' | 'invite' | 'closed' }
  schemaHealth?: SchemaHealth | null
  invites: Invite[]
  users: AdminUser[]
}

const REGISTER_MODES: Array<{ value: 'open' | 'invite' | 'closed'; label: string; hint: string }> = [
  { value: 'open', label: '开放注册', hint: '任何人都可以注册' },
  { value: 'invite', label: '邀请注册', hint: '注册必须使用邀请码' },
  { value: 'closed', label: '关闭注册', hint: '停止接受新用户' },
]

const ACCOUNT_TAB_META: Record<'users' | 'registration' | 'audit' | 'operation-audit', { title: string; description: string }> = {
  users: { title: '用户管理', description: '管理站点用户、角色与登录状态。' },
  registration: { title: '注册与邀请码', description: '控制新用户如何加入本站，并维护邀请码。' },
  audit: { title: '登录审计', description: '查看登录成功、失败与限流事件。' },
  'operation-audit': { title: '操作审计', description: '追踪管理员危险操作、目标数量与执行结果。' },
}

const INVITE_COLUMNS: readonly AdminColumn[] = [
  { key: 'code', label: '邀请码', width: '27%', primary: true },
  { key: 'status', label: '状态', width: '14%' },
  { key: 'usedBy', label: '使用者', width: '18%' },
  { key: 'created', label: '创建时间', width: '23%' },
  { key: 'actions', label: '操作', width: '18%', actions: true },
]

export default function SettingsTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [searchParams] = useSearchParams()
  const urlTab = searchParams.get('view')

  const [userSearch, setUserSearch] = useState('')
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [meUser, setMeUser] = useState<{ id: string; username: string; displayName: string; role: string } | null>(null)
  const [registerMode, setRegisterMode] = useState<'open' | 'invite' | 'closed'>('invite')
  const [inviteCount, setInviteCount] = useState('1')
  const [inviteSearch, setInviteSearch] = useState('')
  const [inviteStatus, setInviteStatus] = useState('all')
  const [invitePage, setInvitePage] = useState(1)
  const [inviteLimit, setInviteLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [inviteDetail, setInviteDetail] = useState<AccountRecordDetail | null>(null)
  const [registerSaving, setRegisterSaving] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)

  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null)
  const loginAuditRequest = useRef(0)
  const operationAuditRequest = useRef(0)
  const [loginAudits, setLoginAudits] = useState<LoginAudit[]>([])
  const [loginAuditTotal, setLoginAuditTotal] = useState(0)
  const [loginAuditStatus, setLoginAuditStatus] = useState('all')
  const [loginAuditUsername, setLoginAuditUsername] = useState('')
  // 防抖：搜索输入停顿 400ms 后才发请求，避免每击键打一次接口
  const debouncedLoginAuditUsername = useDebouncedValue(loginAuditUsername, 400)
  const [loginAuditOffset, setLoginAuditOffset] = useState(0)
  const [loginAuditLimit, setLoginAuditLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [loginAuditLoading, setLoginAuditLoading] = useState(false)
  const [operationAudits, setOperationAudits] = useState<AdminOperationAudit[]>([])
  const [operationAuditTotal, setOperationAuditTotal] = useState(0)
  const [operationAuditStatus, setOperationAuditStatus] = useState('all')
  const [operationAuditUsername, setOperationAuditUsername] = useState('')
  const debouncedOperationAuditUsername = useDebouncedValue(operationAuditUsername, 400)
  const [operationAuditOffset, setOperationAuditOffset] = useState(0)
  const [operationAuditLimit, setOperationAuditLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [operationAuditLoading, setOperationAuditLoading] = useState(false)
  // 子标签持久化：刷新后停留在上次选的子页
  const [accountTab, setAccountTab] = usePersistentState<string>('settings_active_tab', 'users', (v) =>
    ['users', 'registration', 'audit', 'operation-audit'].includes(v),
  )

  const currentAccountTab = (['users', 'registration', 'audit', 'operation-audit'] as const).includes(
    urlTab as 'users' | 'registration' | 'audit' | 'operation-audit',
  )
    ? (urlTab as keyof typeof ACCOUNT_TAB_META)
    : (accountTab as keyof typeof ACCOUNT_TAB_META)
  const currentAccountMeta = ACCOUNT_TAB_META[currentAccountTab] || ACCOUNT_TAB_META.users

  // 二级账户入口位于侧边栏，URL 优先于历史持久化值；旧的 overview 会自然回落到用户管理。
  useEffect(() => {
    if (urlTab && ['users', 'registration', 'audit', 'operation-audit'].includes(urlTab) && urlTab !== accountTab) {
      setAccountTab(urlTab)
    }
  }, [accountTab, setAccountTab, urlTab])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = (await adminApi.users.list()) as unknown as SettingsData
      setData(res)
      setRegisterMode(res.settings?.registerMode || 'invite')
    } catch (err) {
      setData({ settings: { registerMode: 'invite' }, invites: [], users: [] })
      toast((err as Error).message || '账户设置加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  // 当前登录管理员（用于「本人」标记与角色卡；失败仅影响标记）
  const loadMe = useCallback(async () => {
    try {
      const { user } = await authApi.me()
      if (user) setMeUser({ id: user.id, username: user.username, displayName: user.displayName, role: user.role })
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void load()
    void loadMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLoginAudit = useCallback(async () => {
    const request = ++loginAuditRequest.current
    setLoginAuditLoading(true)
    try {
      const result = await adminApi.users.loginAudit({
        status: loginAuditStatus === 'all' ? undefined : loginAuditStatus,
        username: debouncedLoginAuditUsername.trim() || undefined,
        limit: loginAuditLimit,
        offset: loginAuditOffset,
      })
      if (request !== loginAuditRequest.current) return
      setLoginAudits(result.audits)
      setLoginAuditTotal(result.total)
    } catch (err) {
      if (request === loginAuditRequest.current) toast((err as Error).message || '登录审计加载失败', 'error')
    } finally {
      if (request === loginAuditRequest.current) setLoginAuditLoading(false)
    }
  }, [loginAuditOffset, loginAuditLimit, loginAuditStatus, debouncedLoginAuditUsername, toast])

  useEffect(() => {
    void loadLoginAudit()
  }, [loadLoginAudit])

  const loadOperationAudit = useCallback(async () => {
    const request = ++operationAuditRequest.current
    setOperationAuditLoading(true)
    try {
      const result = await adminApi.operationAudit.list({
        status: operationAuditStatus === 'all' ? undefined : operationAuditStatus,
        username: debouncedOperationAuditUsername.trim() || undefined,
        limit: operationAuditLimit,
        offset: operationAuditOffset,
      })
      if (request !== operationAuditRequest.current) return
      setOperationAudits(result.operations)
      setOperationAuditTotal(result.total)
    } catch (err) {
      if (request === operationAuditRequest.current) toast((err as Error).message || '操作审计加载失败', 'error')
    } finally {
      if (request === operationAuditRequest.current) setOperationAuditLoading(false)
    }
  }, [operationAuditOffset, operationAuditLimit, operationAuditStatus, debouncedOperationAuditUsername, toast])

  useEffect(() => {
    if (currentAccountTab === 'operation-audit') void loadOperationAudit()
  }, [currentAccountTab, loadOperationAudit])

  async function saveRegisterSettings() {
    if (registerSaving || !data) return
    const mode = registerMode
    setRegisterSaving(true)
    try {
      await adminApi.users.setRegisterMode(mode)
      setData((previous) => (previous ? { ...previous, settings: { ...previous.settings, registerMode: mode } } : previous))
      toast('注册设置已保存', 'success')
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    } finally {
      setRegisterSaving(false)
    }
  }

  async function createInvite() {
    if (inviteBusy) return
    const count = Number(inviteCount)
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      toast('请输入 1–50 的整数', 'error')
      return
    }
    setInviteBusy(true)
    try {
      const res = (await adminApi.users.createInvites(count)) as { code?: string; codes?: string[] }
      const codes = res.codes || (res.code ? [res.code] : [])
      setGeneratedCodes(codes)
      setInviteSearch('')
      setInviteStatus('all')
      setInvitePage(1)
      toast('已生成 ' + codes.length + ' 个邀请码', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message || '生成失败', 'error')
    } finally {
      setInviteBusy(false)
    }
  }

  async function copyNewInvites() {
    if (!generatedCodes || generatedCodes.length === 0) return
    const ok = await copyText(generatedCodes.join('\n'))
    if (ok) toast('已复制 ' + generatedCodes.length + ' 个邀请码', 'success')
    else toast('复制失败，请手动选择复制', 'error')
  }

  async function copyInvite(code: string) {
    const ok = await copyText(code)
    if (ok) toast('已复制邀请码', 'success')
    else toast(code, 'default')
  }

  async function disableInvite(code: string) {
    if (inviteBusy) return
    setInviteBusy(true)
    try {
      const ok = await confirm({
        title: '停用邀请码',
        message: '此邀请码将无法用于新用户注册。',
        items: [code, '已注册的用户不受影响'],
        okText: '停用',
        danger: true,
      })
      if (!ok) return
      await adminApi.users.disableInvite(code)
      toast('邀请码已停用', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message || '停用失败', 'error')
    } finally {
      setInviteBusy(false)
    }
  }

  async function clearInvites() {
    if (inviteBusy) return
    const codes = invites
      .filter((invite) => invite.usedAt > 0 || invite.disabledAt > 0)
      .map((invite) => invite.code)
      .sort()
    if (!codes.length) return
    setInviteBusy(true)
    const ok = await confirm({
      title: '清理失效邀请码',
      message: `删除确认时的 ${codes.length} 个已使用或已停用邀请码？`,
      items: [`目标快照：${codes.length} 个邀请码`, '可用的邀请码不受影响'],
      okText: '清理',
      danger: true,
    })
    if (!ok) {
      setInviteBusy(false)
      return
    }
    try {
      const res = (await adminApi.users.clearInvites(codes, newOperationId('clear-invites'))) as { removed?: number }
      toast('已清理 ' + (res.removed || 0) + ' 个邀请码', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message || '清理失败', 'error')
    } finally {
      setInviteBusy(false)
    }
  }

  // ---------- 用户操作 ----------

  async function updateUserRole(u: AdminUser) {
    const promote = u.role !== 'admin'
    const ok = await confirm({
      title: promote ? '设为管理员' : '设为读者',
      message: `确认将 ${u.username} ${promote ? '提升为管理员' : '降级为读者'}？`,
      items: promote ? ['管理员拥有后台全部权限，包括管理其他用户'] : ['该用户将立即失去后台管理权限'],
      okText: promote ? '提升' : '降级',
      danger: !promote,
    })
    if (!ok) return
    try {
      await adminApi.users.setRole(u.id, promote ? 'admin' : 'reader')
      toast('已更新用户角色', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '操作失败', 'error')
    }
  }

  async function updateUserStatus(u: AdminUser) {
    const disable = u.status !== 'disabled'
    const ok = await confirm({
      title: disable ? '禁用用户' : '恢复用户',
      message: `确认${disable ? '禁用' : '恢复'} ${u.username}？`,
      items: disable ? ['该用户的所有登录会话将被立即清除', '禁用后该用户无法登录，可随时恢复'] : ['该用户将可以重新登录'],
      okText: disable ? '禁用' : '恢复',
      danger: disable,
    })
    if (!ok) return
    try {
      await adminApi.users.setStatus(u.id, disable ? 'disabled' : 'active')
      toast('已更新用户状态', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '操作失败', 'error')
    }
  }

  async function resetUserPassword(u: AdminUser) {
    const ok = await confirm({
      title: '重置密码',
      message: `为 ${u.username} 生成一个新的临时密码？`,
      items: ['旧密码立即失效，所有登录会话将被清除', '临时密码只显示一次，请复制后转交用户'],
      okText: '重置',
      danger: true,
    })
    if (!ok) return
    try {
      const res = (await adminApi.users.resetPassword(u.id)) as { tempPassword?: string; username?: string }
      void load()
      const tempPassword = res.tempPassword || ''
      if (!tempPassword) {
        toast('未获取到临时密码', 'error')
        return
      }
      const copy = await confirm({
        title: '临时密码已生成',
        message: tempPassword,
        items: [`请转交给 ${res.username || u.username}，并提醒登录后尽快修改密码`, '关闭后将无法再次查看'],
        okText: '复制并关闭',
        cancelText: '关闭',
        danger: false,
      })
      if (copy) {
        const copied = await copyText(tempPassword)
        if (copied) toast('已复制临时密码', 'success')
        else toast('复制失败，请手动复制', 'error')
      }
    } catch (err) {
      toast((err as Error).message || '重置失败', 'error')
    }
  }

  async function deleteUser(u: AdminUser) {
    const ok = await confirm({
      title: '删除用户',
      message: `确认永久删除 ${u.username}？`,
      items: ['该用户的书架、书签、想法和阅读进度将一并删除', '此操作无法撤销'],
      okText: '永久删除',
      danger: true,
    })
    if (!ok) return
    try {
      await adminApi.users.deleteUser(u.id, u.username)
      toast('用户已删除', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    }
  }

  // ---------- 派生数据 ----------

  const invites = data?.invites || []
  const schemaHealth = data?.schemaHealth

  const spent = invites.filter((i) => i.usedAt > 0 || i.disabledAt > 0).length
  const available = invites.length - spent
  const filteredInvites = invites.filter((invite) => {
    const status = invite.usedAt > 0 ? 'used' : invite.disabledAt > 0 ? 'disabled' : 'available'
    return (inviteStatus === 'all' || inviteStatus === status) && invite.code.toLowerCase().includes(inviteSearch.trim().toLowerCase())
  })
  const invitePages = Math.max(1, Math.ceil(filteredInvites.length / inviteLimit))
  const visibleInvitePage = Math.min(invitePage, invitePages)
  const pageInvites = filteredInvites.slice((visibleInvitePage - 1) * inviteLimit, visibleInvitePage * inviteLimit)
  const loginAuditPage = Math.floor(loginAuditOffset / loginAuditLimit) + 1
  const operationAuditPage = Math.floor(operationAuditOffset / operationAuditLimit) + 1

  function loginAuditStatusLabel(status: string): string {
    return status === 'success' ? '成功' : status === 'limited' ? '限流' : '失败'
  }

  function loginAuditReasonLabel(reason: string): string {
    return reason === 'invalid_credentials'
      ? '账号或密码错误'
      : reason === 'rate_limited'
        ? '尝试次数过多'
        : reason === 'login' || reason === 'success' || !reason
          ? '登录成功'
          : reason
  }

  function operationAuditStatusLabel(status: string): string {
    return status === 'completed' ? '成功' : status === 'failed' ? '失败' : '处理中'
  }

  function operationAuditActionLabel(action: string): string {
    const labels: Record<string, string> = {
      'set-password': '修改用户密码',
      'clear-invites': '清理邀请码',
      'clear-completed-scrape-jobs': '清理抓取任务',
      'cancel-scrape-job': '终止抓取任务',
      'batch-delete-novels': '批量删除小说',
      'batch-delete-chapters': '批量删除章节',
      'rename-chapters-by-order': '批量改章节名',
      'batch-delete-sources': '批量删除书源',
      'delete-unreachable-sources': '删除不可达书源',
      'source-sync-apply': '应用源站同步',
      'ai.task.cancel': '终止 AI 任务',
      'ai.task.retry': '重试 AI 任务',
      'ai.generations.batch-delete': '删除 AI 生成内容',
      'ai.cover.adopt': '采纳 AI 封面',
      'ai.cover.upload': '上传并覆盖封面',
      'ai.cover.generate': '生成 AI 封面',
      'ai.cover.prompt': '生成封面描述词',
    }
    return labels[action] || action
  }

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--settings"
      title={currentAccountMeta.title}
      description={currentAccountMeta.description}
      actions={
        currentAccountTab === 'users' ? (
          <AdminSearch
            id="account-user-search"
            label="搜索用户"
            placeholder="搜索昵称或用户名"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
        ) : currentAccountTab === 'registration' ? (
          <AdminSearch
            id="account-invite-search"
            label="搜索邀请码"
            placeholder="搜索邀请码"
            value={inviteSearch}
            onChange={(e) => {
              setInviteSearch(e.target.value)
              setInvitePage(1)
            }}
          />
        ) : currentAccountTab === 'audit' ? (
          <AdminSearch
            id="account-login-search"
            label="搜索登录用户名"
            placeholder="搜索用户名"
            value={loginAuditUsername}
            onChange={(e) => {
              setLoginAuditUsername(e.target.value)
              setLoginAuditOffset(0)
            }}
          />
        ) : (
          <AdminSearch
            id="account-operation-search"
            label="搜索操作用户名"
            placeholder="搜索用户名"
            value={operationAuditUsername}
            onChange={(e) => {
              setOperationAuditUsername(e.target.value)
              setOperationAuditOffset(0)
            }}
          />
        )
      }
    >
      {schemaHealth && !schemaHealth.ok && (
        <div className="account-schema-warning" role="alert">
          <strong>数据库结构检查未通过</strong>
          {schemaHealth.missing.length > 0 && <span>缺失字段：{schemaHealth.missing.join('、')}</span>}
        </div>
      )}
      {currentAccountTab === 'registration' && (
        <AdminDataPanel className="account-registration-panel" ariaLabel="注册设置">
          <AdminPanelHeading
            title="注册设置"
            status={
              <AdminStatusBadge tone="info">
                当前：{REGISTER_MODES.find((mode) => mode.value === data?.settings.registerMode)?.label || '读取中'}
              </AdminStatusBadge>
            }
          />
          <div className="account-registration-body">
            <RadioGroup
              value={registerMode}
              onValueChange={(value) => setRegisterMode(value as typeof registerMode)}
              className="account-register-modes"
              aria-label="注册方式"
              disabled={loading || registerSaving}
            >
              {REGISTER_MODES.map((mode) => (
                <label className="account-register-mode" key={mode.value}>
                  <RadioGroupItem value={mode.value} aria-label={`${mode.label} ${mode.hint}`} />
                  <span>
                    <strong>{mode.label}</strong>
                    <small>{mode.hint}</small>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <div className="account-register-footer">
              <span>
                {data && registerMode !== data.settings.registerMode ? '有未保存的修改。已有用户登录不受影响。' : '修改注册方式后，已有用户仍可正常登录。'}
              </span>
              <Button
                size="sm"
                disabled={!data || loading || registerSaving || registerMode === data.settings.registerMode}
                onClick={() => void saveRegisterSettings()}
              >
                {registerSaving ? '保存中…' : '保存设置'}
              </Button>
            </div>
          </div>
        </AdminDataPanel>
      )}

      {currentAccountTab === 'users' && (
        <UserManagementPanel
          search={userSearch}
          selfId={meUser?.id}
          onRole={updateUserRole}
          onStatus={updateUserStatus}
          onReset={resetUserPassword}
          onDelete={deleteUser}
        />
      )}

      {currentAccountTab === 'audit' && (
        <AccountAuditPanel
          kind="login"
          records={loginAudits}
          total={loginAuditTotal}
          loading={loginAuditLoading}
          status={loginAuditStatus}
          onStatus={(value) => {
            setLoginAuditStatus(value)
            setLoginAuditOffset(0)
          }}
          onRefresh={() => void loadLoginAudit()}
          page={loginAuditPage}
          limit={loginAuditLimit}
          onPage={(value) => setLoginAuditOffset((value - 1) * loginAuditLimit)}
          onLimit={(value) => {
            setLoginAuditLimit(value)
            setLoginAuditOffset(0)
          }}
          statusLabel={loginAuditStatusLabel}
          reasonLabel={loginAuditReasonLabel}
        />
      )}
      {currentAccountTab === 'operation-audit' && (
        <AccountAuditPanel
          kind="operation"
          records={operationAudits}
          total={operationAuditTotal}
          loading={operationAuditLoading}
          status={operationAuditStatus}
          onStatus={(value) => {
            setOperationAuditStatus(value)
            setOperationAuditOffset(0)
          }}
          onRefresh={() => void loadOperationAudit()}
          page={operationAuditPage}
          limit={operationAuditLimit}
          onPage={(value) => setOperationAuditOffset((value - 1) * operationAuditLimit)}
          onLimit={(value) => {
            setOperationAuditLimit(value)
            setOperationAuditOffset(0)
          }}
          statusLabel={operationAuditStatusLabel}
          actionLabel={operationAuditActionLabel}
        />
      )}

      {currentAccountTab === 'registration' && (
        <>
          <AdminDataPanel className="account-invites-panel overflow-hidden" ariaLabel="邀请码列表" columns={INVITE_COLUMNS} density="comfortable">
            <AdminPanelHeading
              title="邀请码目录"
              status={<span className="admin-panel-status">{filteredInvites.length} 个</span>}
              actions={
                <>
                  <Button variant="secondary" size="sm" disabled={loading || inviteBusy} onClick={() => void load()}>
                    <RefreshCw aria-hidden="true" />
                    刷新
                  </Button>
                  <span className="account-record-secondary">数量</span>
                  <Input
                    disabled={inviteBusy}
                    type="number"
                    className="admin-input--invite-count"
                    min={1}
                    max={50}
                    value={inviteCount}
                    aria-label="生成邀请码数量"
                    onChange={(e) => setInviteCount(e.target.value)}
                  />
                  <Button size="sm" disabled={loading || inviteBusy} onClick={() => void createInvite()}>
                    生成邀请码
                  </Button>
                </>
              }
            />
            <AdminToolbar className="account-record-filters">
              <span className="account-record-secondary">状态</span>
              <Select
                value={inviteStatus}
                onValueChange={(value) => {
                  setInviteStatus(value)
                  setInvitePage(1)
                }}
              >
                <SelectTrigger aria-label="邀请码状态">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="available">可用</SelectItem>
                  <SelectItem value="used">已使用</SelectItem>
                  <SelectItem value="disabled">已停用</SelectItem>
                </SelectContent>
              </Select>
              <span className="account-record-filters__hint">
                可用 {available} · 已使用 {invites.filter((i) => i.usedAt > 0).length} · 已停用 {invites.filter((i) => !i.usedAt && i.disabledAt > 0).length}
              </span>
            </AdminToolbar>
            {generatedCodes && generatedCodes.length > 0 && (
              <div id="tokenStatus" className="account-invites-generated" role="status">
                <div className="account-invites-generated__codes">
                  {generatedCodes.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </div>
                <Button variant="secondary" size="sm" onClick={() => void copyNewInvites()}>
                  复制全部
                </Button>
              </div>
            )}
            <Table>
              <TableCaption className="sr-only">邀请码列表，含状态、使用者与创建时间</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">邀请码</TableHead>
                  <TableHead scope="col">状态</TableHead>
                  <TableHead scope="col">使用者</TableHead>
                  <TableHead scope="col">创建时间</TableHead>
                  <TableHead scope="col">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !data ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                      加载中…
                    </TableCell>
                  </TableRow>
                ) : pageInvites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                      暂无匹配的邀请码
                    </TableCell>
                  </TableRow>
                ) : (
                  pageInvites.map((i) => {
                    const used = i.usedAt > 0
                    const disabled = i.disabledAt > 0
                    return (
                      <TableRow key={i.code}>
                        <TableCell data-primary="" data-label="邀请码">
                          <code className="account-record-code">{i.code}</code>
                        </TableCell>
                        <TableCell data-label="状态">
                          {used ? (
                            <AdminStatusBadge tone="neutral">已使用</AdminStatusBadge>
                          ) : disabled ? (
                            <AdminStatusBadge tone="neutral">已停用</AdminStatusBadge>
                          ) : (
                            <AdminStatusBadge tone="success">可用</AdminStatusBadge>
                          )}
                        </TableCell>
                        <TableCell data-label="使用者">{i.usedByName || i.usedBy || '—'}</TableCell>
                        <TableCell data-label="创建时间" className="text-sm text-muted-foreground">
                          <AccountRecordDate value={i.createdAt} />
                        </TableCell>
                        <TableCell data-actions="">
                          <div className="admin-cell-actions flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => void copyInvite(i.code)}>
                              复制
                            </Button>
                            {(used || disabled) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setInviteDetail({
                                    title: '邀请码详情',
                                    fields: [
                                      ['邀请码', i.code],
                                      ['状态', used ? '已使用' : '已停用'],
                                      ['使用者', i.usedByName || i.usedBy || '—'],
                                      ['创建时间', formatDateTime(i.createdAt)],
                                      ['使用时间', formatDateTime(i.usedAt)],
                                      ['停用时间', formatDateTime(i.disabledAt)],
                                    ],
                                  })
                                }
                              >
                                详情
                              </Button>
                            )}
                            {!used && !disabled && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="account-record-danger"
                                disabled={inviteBusy}
                                onClick={() => void disableInvite(i.code)}
                              >
                                停用
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
            <div className="account-settings-panel__footer">
              <span id="inviteStats">{invites.length ? `共 ${invites.length} 个 · 可用 ${available} · 失效 ${spent}` : '暂无邀请码'}</span>
              {spent > 0 && (
                <Button variant="ghost" size="sm" className="account-record-danger" disabled={inviteBusy} onClick={() => void clearInvites()}>
                  清理失效邀请码
                </Button>
              )}
            </div>
          </AdminDataPanel>
          <Pagination
            variant="detached"
            page={visibleInvitePage}
            totalPages={invitePages}
            onPage={setInvitePage}
            busy={loading || inviteBusy}
            summary={`共 ${filteredInvites.length} 个邀请码`}
            pageSize={{
              value: inviteLimit,
              onChange: (value) => {
                setInviteLimit(value)
                setInvitePage(1)
              },
              options: ADMIN_PAGE_SIZE_OPTIONS,
            }}
          />
          <details className="account-record-note">
            <summary>注册与邀请说明</summary>
            <p>邀请码一次使用后即失效。停用不影响已有用户，清理仅处理确认时已使用或已停用的邀请码。</p>
          </details>
          <AccountRecordDetails detail={inviteDetail} onClose={() => setInviteDetail(null)} />
        </>
      )}
    </AdminPage>
  )
}
