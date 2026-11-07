import { MotionDetails } from '@/components/ui/motion'
import '@/styles/input-fields.css'
import '../../styles/admin/pages/accounts.css'
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
import { CirclePlus, Plus, RefreshCw, Ticket } from 'lucide-react'
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
import { Panel } from '@/components/ui/panel'
import FormField from '@/components/shared/FormField'
import EmptyState from '@/components/shared/EmptyState'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AdminPage from '@/components/admin/AdminPage'
import UserManagementPanel from './UserManagementPanel'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { PanelHeading } from '@/components/shared/PanelHeading'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { SearchField } from '@/components/shared/SearchField'
import SearchSelect from '@/components/shared/SearchSelect'
import { cn } from '@/lib/utils'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import Pagination from '@/components/shared/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { usePersistentState } from '@/hooks/usePersistentState'
import styles from './account-management.module.css'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTab = searchParams.get('view')

  const [userSearch, setUserSearch] = useState('')
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const settingsRequest = useRef(0)
  const settingsLoading = useRef(false)
  const [meUser, setMeUser] = useState<{ id: string; username: string; displayName: string; role: string } | null>(null)
  const [registerDraft, setRegisterDraft] = useState<SettingsData['settings']['registerMode'] | null>(null)
  const registerMode = registerDraft ?? data?.settings.registerMode
  const [registerError, setRegisterError] = useState('')
  const inviteCountRef = useRef<HTMLInputElement>(null)
  const focusInviteCount = useRef(false)
  const [inviteCount, setInviteCount] = useState('1')
  const [inviteSearch, setInviteSearch] = useState('')
  const [inviteStatus, setInviteStatus] = useState('all')
  const [invitePage, setInvitePage] = useState(1)
  const [inviteLimit, setInviteLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [inviteDetail, setInviteDetail] = useState<AccountRecordDetail | null>(null)
  const [registerSaving, setRegisterSaving] = useState(false)
  const registerSavingRef = useRef(false)
  const [inviteBusy, setInviteBusy] = useState(false)

  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null)
  const [codesExpanded, setCodesExpanded] = useState(true)
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
  const [loginAuditError, setLoginAuditError] = useState('')
  const [loginAuditLoaded, setLoginAuditLoaded] = useState(false)
  const [operationAudits, setOperationAudits] = useState<AdminOperationAudit[]>([])
  const [operationAuditTotal, setOperationAuditTotal] = useState(0)
  const [operationAuditStatus, setOperationAuditStatus] = useState('all')
  const [operationAuditUsername, setOperationAuditUsername] = useState('')
  const debouncedOperationAuditUsername = useDebouncedValue(operationAuditUsername, 400)
  const [operationAuditOffset, setOperationAuditOffset] = useState(0)
  const [operationAuditLimit, setOperationAuditLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [operationAuditLoading, setOperationAuditLoading] = useState(false)
  const [operationAuditError, setOperationAuditError] = useState('')
  const [operationAuditLoaded, setOperationAuditLoaded] = useState(false)
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
    if (registerSavingRef.current) return
    const request = ++settingsRequest.current
    settingsLoading.current = true
    setLoading(true)
    setLoadError('')
    try {
      const res = (await adminApi.users.list()) as unknown as SettingsData
      if (request !== settingsRequest.current) return
      setData(res)
    } catch (err) {
      if (request === settingsRequest.current) setLoadError((err as Error).message || '账户设置加载失败')
    } finally {
      if (request === settingsRequest.current) {
        settingsLoading.current = false
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (currentAccountTab === 'registration') void load()
  }, [currentAccountTab, load])

  useEffect(() => {
    if (currentAccountTab === 'registration' && data && !loading && !registerSaving && !settingsLoading.current && focusInviteCount.current) {
      focusInviteCount.current = false
      inviteCountRef.current?.focus()
    }
  }, [currentAccountTab, data, loading, registerSaving])

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
    void loadMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLoginAudit = useCallback(async () => {
    const request = ++loginAuditRequest.current
    setLoginAuditLoading(true)
    setLoginAuditError('')
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
      setLoginAuditLoaded(true)
    } catch (err) {
      if (request === loginAuditRequest.current) setLoginAuditError((err as Error).message || '登录审计加载失败')
    } finally {
      if (request === loginAuditRequest.current) setLoginAuditLoading(false)
    }
  }, [loginAuditOffset, loginAuditLimit, loginAuditStatus, debouncedLoginAuditUsername])

  useEffect(() => {
    if (currentAccountTab === 'audit') void loadLoginAudit()
  }, [currentAccountTab, loadLoginAudit])

  const loadOperationAudit = useCallback(async () => {
    const request = ++operationAuditRequest.current
    setOperationAuditLoading(true)
    setOperationAuditError('')
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
      setOperationAuditLoaded(true)
    } catch (err) {
      if (request === operationAuditRequest.current) setOperationAuditError((err as Error).message || '操作审计加载失败')
    } finally {
      if (request === operationAuditRequest.current) setOperationAuditLoading(false)
    }
  }, [operationAuditOffset, operationAuditLimit, operationAuditStatus, debouncedOperationAuditUsername])

  useEffect(() => {
    if (currentAccountTab === 'operation-audit') void loadOperationAudit()
  }, [currentAccountTab, loadOperationAudit])

  async function saveRegisterSettings() {
    if (registerSavingRef.current || settingsLoading.current || inviteBusy || !data || !registerMode || registerMode === data.settings.registerMode) return
    const mode = registerMode
    registerSavingRef.current = true
    setRegisterSaving(true)
    setRegisterError('')
    try {
      await adminApi.users.setRegisterMode(mode)
      setData((previous) => (previous ? { ...previous, settings: { ...previous.settings, registerMode: mode } } : previous))
      setRegisterDraft(null)
      toast('注册设置已保存', 'success')
    } catch (err) {
      setRegisterError((err as Error).message || '保存失败，请重试')
    } finally {
      registerSavingRef.current = false
      setRegisterSaving(false)
    }
  }

  async function createInvite() {
    if (inviteBusy || loading || registerSaving || !data) return
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
      setCodesExpanded(true)
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
      'initialize-site': '初始化超级管理员',
      'recover-super-admin': '服务器恢复管理权',
      'user-role': '调整账号角色',
      'user-status': '调整账号状态',
      'delete-user': '删除账号',
      'revoke-sessions': '撤销登录会话',
      'request-verify-email': '发送邮箱验证邮件',
      'request-reset-password': '发送密码重置邮件',
      'verify-email': '确认邮箱绑定',
      'reset-password': '通过邮件修改密码',
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
          <Button
            onClick={() => {
              focusInviteCount.current = true
              setSearchParams((previous) => {
                const next = new URLSearchParams(previous)
                next.set('view', 'registration')
                return next
              })
            }}
          >
            <Plus size={16} />
            生成邀请码
          </Button>
        ) : null
      }
    >
      {schemaHealth && !schemaHealth.ok && (
        <div className="account-schema-warning" role="alert">
          <strong>数据库结构检查未通过</strong>
          {schemaHealth.missing.length > 0 && <span>缺失字段：{schemaHealth.missing.join('、')}</span>}
        </div>
      )}
      {currentAccountTab === 'registration' && (
        <>
          {loadError &&
            (data ? (
              <InlineError
                message={`${loadError}，保留上次读取的数据与未保存修改。`}
                onRetry={!loading && !inviteBusy && !registerSaving ? () => void load() : undefined}
              />
            ) : (
              <ErrorState message={loadError} onRetry={!loading ? () => void load() : undefined} />
            ))}
          {!data && !loadError && <LoadingState label="读取注册设置与邀请码" />}
          {data && (
            <Panel asChild>
              <section className={styles.registration} aria-labelledby="account-registration-title">
                <PanelHeading
                  className={styles.heading}
                  title="注册方式"
                  titleId="account-registration-title"
                  description="控制新用户如何加入本站，已有用户登录不受影响。"
                  status={
                    <AdminStatusBadge tone="neutral">当前：{REGISTER_MODES.find((mode) => mode.value === data.settings.registerMode)?.label}</AdminStatusBadge>
                  }
                />
                <RadioGroup
                  value={registerMode || ''}
                  onValueChange={(value) => {
                    setRegisterDraft(value as SettingsData['settings']['registerMode'])
                    setRegisterError('')
                  }}
                  className={styles.modes}
                  aria-label="注册方式"
                  disabled={meUser?.role !== 'super_admin' || loading || registerSaving || inviteBusy}
                >
                  {REGISTER_MODES.map((mode) => (
                    <label key={mode.value} className={styles.mode} htmlFor={`register-mode-${mode.value}`}>
                      <RadioGroupItem id={`register-mode-${mode.value}`} value={mode.value} aria-label={`${mode.label} ${mode.hint}`} />
                      <span>
                        <span className={styles.modeLabel}>{mode.label}</span>
                        <span className={styles.hint}>{mode.hint}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                {registerError && (
                  <p className={styles.error} role="alert">
                    {registerError}
                  </p>
                )}
                <div className={styles.save}>
                  <span className={styles.hint} role="status">
                    {registerMode !== data.settings.registerMode ? '未保存修改' : '已与当前生效设置同步'}
                    {registerMode === 'closed' && ' · 关闭注册后，已有邀请码也不能用于注册。'}
                  </span>
                  {registerMode !== data.settings.registerMode && (
                    <Button
                      variant="secondary"
                      disabled={meUser?.role !== 'super_admin' || loading || registerSaving || inviteBusy}
                      onClick={() => {
                        setRegisterDraft(null)
                        setRegisterError('')
                      }}
                    >
                      取消修改
                    </Button>
                  )}
                  <Button
                    disabled={meUser?.role !== 'super_admin' || loading || registerSaving || inviteBusy || registerMode === data.settings.registerMode}
                    onClick={() => void saveRegisterSettings()}
                  >
                    {registerSaving ? '保存中…' : '保存设置'}
                  </Button>
                </div>
              </section>
            </Panel>
          )}
        </>
      )}

      {currentAccountTab === 'users' && (
        <UserManagementPanel
          search={userSearch}
          onSearchChange={setUserSearch}
          selfId={meUser?.id}
          selfRole={meUser?.role}
        />
      )}

      {currentAccountTab === 'audit' && (
        <AccountAuditPanel
          kind="login"
          records={loginAudits}
          total={loginAuditTotal}
          loading={loginAuditLoading}
          error={loginAuditError}
          hasLoaded={loginAuditLoaded}
          status={loginAuditStatus}
          onStatus={(value) => {
            setLoginAuditStatus(value)
            setLoginAuditOffset(0)
          }}
          search={loginAuditUsername}
          onSearch={(value) => {
            setLoginAuditUsername(value)
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
          error={operationAuditError}
          hasLoaded={operationAuditLoaded}
          status={operationAuditStatus}
          onStatus={(value) => {
            setOperationAuditStatus(value)
            setOperationAuditOffset(0)
          }}
          search={operationAuditUsername}
          onSearch={(value) => {
            setOperationAuditUsername(value)
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

      {currentAccountTab === 'registration' && data && (
        <section className={styles.invites} aria-labelledby="account-invites-title">
          <PanelHeading
            className={styles.heading}
            title="邀请码管理"
            titleId="account-invites-title"
            description="每个邀请码仅可使用一次；开放或关闭注册时，仍可提前准备邀请码。"
            actions={
              <form
                className={styles.generate}
                onSubmit={(event) => {
                  event.preventDefault()
                  void createInvite()
                }}
              >
                <FormField label="数量" htmlFor="account-invite-count" className={styles.count}>
                  <Input
                    ref={inviteCountRef}
                    id="account-invite-count"
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    required
                    value={inviteCount}
                    aria-label="生成邀请码数量"
                    disabled={loading || inviteBusy || registerSaving}
                    onChange={(event) => setInviteCount(event.target.value)}
                  />
                </FormField>
                <Button type="submit" disabled={loading || inviteBusy || registerSaving}>
                  <Plus aria-hidden="true" />
                  生成邀请码
                </Button>
              </form>
            }
          />
          <AdminToolbar layout="inline" className="admin-filter-rail account-record-filters account-invite-filters" ariaLive="polite">
            <SearchField
              id="account-invite-search"
              label="搜索邀请码"
              placeholder="搜索邀请码"
              value={inviteSearch}
              onChange={(e) => {
                setInviteSearch(e.target.value)
                setInvitePage(1)
              }}
            />
            <div className="select-filter-chips">
              <SearchSelect
                compact
                chip
                filterChip
                leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
                aria-label="邀请码状态"
                value={inviteStatus}
                onChange={(value) => {
                  setInviteStatus(value)
                  setInvitePage(1)
                }}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'available', label: '可用' },
                  { value: 'used', label: '已使用' },
                  { value: 'disabled', label: '已停用' },
                ]}
              />
            </div>
            <div className="account-record-filters__actions">
              <span className="account-record-filters__hint">
                共 {invites.length} 个 · 可用 {available} · 已使用 {invites.filter((i) => i.usedAt > 0).length} · 已停用{' '}
                {invites.filter((i) => !i.usedAt && i.disabledAt > 0).length}
              </span>
              <Button variant="secondary" size="sm" disabled={loading || inviteBusy || registerSaving} onClick={() => void load()}>
                <RefreshCw className={loading || inviteBusy ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
                刷新
              </Button>
            </div>
          </AdminToolbar>
          {generatedCodes && generatedCodes.length > 0 && (
            <div className={styles.generated}>
              <div className={styles.generatedHeader}>
                <span role="status">本次生成 {generatedCodes.length} 个邀请码</span>
                <div className={styles.generatedActions}>
                  <Button variant="secondary" size="sm" onClick={() => void copyNewInvites()}>
                    复制全部
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={codesExpanded}
                    aria-controls="account-generated-codes"
                    onClick={() => setCodesExpanded(!codesExpanded)}
                  >
                    {codesExpanded ? '收起' : '展开'}
                  </Button>
                </div>
              </div>
              {codesExpanded && (
                <div id="account-generated-codes" className={styles.codes} tabIndex={0} role="region" aria-label="本次生成的邀请码">
                  {generatedCodes.map((code) => (
                    <code key={code}>{code}</code>
                  ))}
                </div>
              )}
            </div>
          )}
          <AdminDataPanel className="account-invites-panel overflow-hidden" ariaLabel="邀请码列表" columns={INVITE_COLUMNS} density="comfortable">
            <Table aria-busy={loading} className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
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
              <TableBody key={inviteLimit}>
                {pageInvites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        icon={<Ticket />}
                        message={inviteSearch || inviteStatus !== 'all' ? '暂无匹配的邀请码' : '尚未生成邀请码'}
                        hint={inviteSearch || inviteStatus !== 'all' ? '调整搜索或状态筛选，查看其他邀请码。' : '在上方选择数量并生成，再将邀请码交给新用户。'}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  pageInvites.map((i, index) => {
                    const used = i.usedAt > 0
                    const disabled = i.disabledAt > 0
                    return (
                      <TableRow key={i.code} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, pageInvites.length)}ms` }}>
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
                                disabled={inviteBusy || loading || registerSaving}
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
          </AdminDataPanel>
          <Pagination
            variant="detached"
            page={visibleInvitePage}
            totalPages={invitePages}
            onPage={setInvitePage}
            busy={loading || inviteBusy}
            summary={`当前结果 ${filteredInvites.length} 个`}
            pageSize={{
              value: inviteLimit,
              onChange: (value) => {
                setInviteLimit(value)
                setInvitePage(1)
              },
              options: ADMIN_PAGE_SIZE_OPTIONS,
            }}
          />
          {spent > 0 && (
            <div className={styles.cleanup}>
              <span className={styles.hint}>可清理 {spent} 个已使用或已停用的邀请码，可用邀请码不受影响。</span>
              <Button
                variant="ghost"
                size="sm"
                className="account-record-danger"
                disabled={inviteBusy || loading || registerSaving}
                onClick={() => void clearInvites()}
              >
                清理失效邀请码
              </Button>
            </div>
          )}
          <MotionDetails className="account-record-note">
            <summary>注册与邀请说明</summary>
            <p>邀请码一次使用后即失效。停用不影响已有用户，清理仅处理确认时已使用或已停用的邀请码。</p>
          </MotionDetails>
          <AccountRecordDetails detail={inviteDetail} onClose={() => setInviteDetail(null)} />
        </section>
      )}
    </AdminPage>
  )
}
