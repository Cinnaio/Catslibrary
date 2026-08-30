/**
 * 账户与注册 tab —— 当前管理员、注册设置、用户管理、邀请码管理。
 * 由 Novel-KV js/admin-users.js + admin.html #tab-settings 平移。
 * 无轮询：挂载 + 每次变更后重新拉取，无乐观更新。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi, authApi, newOperationId } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { copyText } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import { useDebouncedValue } from '@/hooks/useDebounce'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AdminPage from '@/components/admin/AdminPage'
import { AdminMetricStrip } from '@/components/admin/AdminWorkspace'
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

interface LoginAudit {
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

interface AdminOperationAudit {
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

const REGISTER_MODES: Array<{ value: 'open' | 'invite' | 'closed'; label: string; hint: string }> = [
  { value: 'open', label: '开放注册', hint: '任何人都可以注册' },
  { value: 'invite', label: '邀请注册', hint: '注册必须使用邀请码' },
  { value: 'closed', label: '关闭注册', hint: '停止接受新用户' },
]

function roleLabel(role: string): string {
  return role === 'admin' ? '管理员' : '读者'
}

export default function SettingsTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const navigate = useNavigate()

  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [meUser, setMeUser] = useState<{ id: string; username: string; displayName: string; role: string } | null>(null)
  const [registerMode, setRegisterMode] = useState<'open' | 'invite' | 'closed'>('invite')
  const [inviteCount, setInviteCount] = useState('1')
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null)
  const [loginAudits, setLoginAudits] = useState<LoginAudit[]>([])
  const [loginAuditTotal, setLoginAuditTotal] = useState(0)
  const [loginAuditStatus, setLoginAuditStatus] = useState('all')
  const [loginAuditUsername, setLoginAuditUsername] = useState('')
  // 防抖：搜索输入停顿 400ms 后才发请求，避免每击键打一次接口
  const debouncedLoginAuditUsername = useDebouncedValue(loginAuditUsername, 400)
  const [loginAuditOffset, setLoginAuditOffset] = useState(0)
  const [loginAuditLoading, setLoginAuditLoading] = useState(false)
  const [operationAudits, setOperationAudits] = useState<AdminOperationAudit[]>([])
  const [operationAuditTotal, setOperationAuditTotal] = useState(0)
  const [operationAuditStatus, setOperationAuditStatus] = useState('all')
  const [operationAuditOffset, setOperationAuditOffset] = useState(0)
  const [operationAuditLoading, setOperationAuditLoading] = useState(false)
  // 子标签持久化：刷新后停留在上次选的子页
  const [accountTab, setAccountTab] = usePersistentState<string>('settings_active_tab', 'overview', (v) =>
    ['overview', 'users', 'registration', 'audit', 'operation-audit'].includes(v),
  )

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
    setLoginAuditLoading(true)
    try {
      const result = await adminApi.users.loginAudit({
        status: loginAuditStatus === 'all' ? undefined : loginAuditStatus,
        username: debouncedLoginAuditUsername.trim() || undefined,
        limit: 20,
        offset: loginAuditOffset,
      })
      setLoginAudits(result.audits)
      setLoginAuditTotal(result.total)
    } catch (err) {
      toast((err as Error).message || '登录审计加载失败', 'error')
    } finally {
      setLoginAuditLoading(false)
    }
  }, [loginAuditOffset, loginAuditStatus, debouncedLoginAuditUsername, toast])

  useEffect(() => {
    void loadLoginAudit()
  }, [loadLoginAudit])

  const loadOperationAudit = useCallback(async () => {
    setOperationAuditLoading(true)
    try {
      const result = await adminApi.operationAudit.list({
        status: operationAuditStatus === 'all' ? undefined : operationAuditStatus,
        limit: 20,
        offset: operationAuditOffset,
      })
      setOperationAudits(result.operations)
      setOperationAuditTotal(result.total)
    } catch (err) {
      toast((err as Error).message || '操作审计加载失败', 'error')
    } finally {
      setOperationAuditLoading(false)
    }
  }, [operationAuditOffset, operationAuditStatus, toast])

  useEffect(() => {
    if (accountTab === 'operation-audit') void loadOperationAudit()
  }, [accountTab, loadOperationAudit])

  // ---------- 当前管理员 / 注册设置 ----------

  async function handleLogout() {
    await authApi.logout()
    navigate('/')
  }

  async function saveRegisterSettings() {
    try {
      await adminApi.users.setRegisterMode(registerMode)
      toast('注册设置已保存', 'success')
    } catch (err) {
      toast((err as Error).message || '保存失败', 'error')
    }
  }

  // ---------- 邀请码 ----------

  async function createInvite() {
    try {
      const count = parseInt(inviteCount, 10) || 1
      const res = (await adminApi.users.createInvites(count)) as { code?: string; codes?: string[] }
      const codes = res.codes || (res.code ? [res.code] : [])
      setGeneratedCodes(codes)
      toast('已生成 ' + codes.length + ' 个邀请码', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '生成失败', 'error')
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
    try {
      await adminApi.users.disableInvite(code)
      void load()
    } catch (err) {
      toast((err as Error).message || '停用失败', 'error')
    }
  }

  async function clearInvites() {
    const codes = invites
      .filter((invite) => invite.usedAt > 0 || invite.disabledAt > 0)
      .map((invite) => invite.code)
      .sort()
    if (!codes.length) return
    const ok = await confirm({
      title: '清理失效邀请码',
      message: `删除确认时的 ${codes.length} 个已使用或已停用邀请码？`,
      items: [`目标快照：${codes.length} 个邀请码`, '可用的邀请码不受影响'],
      okText: '清理',
      danger: true,
    })
    if (!ok) return
    try {
      const res = (await adminApi.users.clearInvites(codes, newOperationId('clear-invites'))) as { removed?: number }
      toast('已清理 ' + (res.removed || 0) + ' 个邀请码', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '清理失败', 'error')
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
      items: disable
        ? ['该用户的所有登录会话将被立即清除', '禁用后该用户无法登录，可随时恢复']
        : ['该用户将可以重新登录'],
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

  const users = data?.users || []
  const invites = data?.invites || []
  const schemaHealth = data?.schemaHealth

  const activeCount = users.filter((u) => u.status !== 'disabled').length
  const adminCount = users.filter((u) => u.role === 'admin').length
  const spent = invites.filter((i) => i.usedAt > 0 || i.disabledAt > 0).length
  const available = invites.length - spent
  const loginAuditPages = Math.max(1, Math.ceil(loginAuditTotal / 20))
  const loginAuditPage = Math.floor(loginAuditOffset / 20) + 1
  const operationAuditPages = Math.max(1, Math.ceil(operationAuditTotal / 20))
  const operationAuditPage = Math.floor(operationAuditOffset / 20) + 1

  function loginAuditStatusLabel(status: string): string {
    return status === 'success' ? '成功' : status === 'limited' ? '限流' : '失败'
  }

  function loginAuditReasonLabel(reason: string): string {
    return reason === 'invalid_credentials' ? '账号或密码错误' : reason === 'rate_limited' ? '尝试次数过多' : '登录成功'
  }

  function operationAuditStatusLabel(status: string): string {
    return status === 'completed' ? '成功' : status === 'failed' ? '失败' : '处理中'
  }

  function operationAuditActionLabel(action: string): string {
    const labels: Record<string, string> = {
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
    <AdminPage className="admin-redesign-page admin-redesign-page--settings" title="账户与注册" description="管理站点用户、注册方式与邀请码。" actions={
          <span id="schemaHealth">
            {schemaHealth &&
              (schemaHealth.ok ? (
                <Badge className="bg-success/10 text-success">数据库正常</Badge>
              ) : (
                <Badge className="bg-destructive/10 text-destructive">
                  数据库缺失 {(schemaHealth.missing || []).join('、')}
                </Badge>
              ))}
          </span>
        }
      >
      <Tabs value={accountTab} onValueChange={setAccountTab} className="account-settings-tabs min-w-0">
        <TabsList className="account-settings-tabs__list w-full max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="users">用户管理</TabsTrigger>
          <TabsTrigger value="registration">注册与邀请码</TabsTrigger>
          <TabsTrigger value="audit">登录审计</TabsTrigger>
          <TabsTrigger value="operation-audit">操作审计</TabsTrigger>
        </TabsList>

        {accountTab === 'overview' && <div className="grid gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">当前管理员</CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground" id="adminCurrentUser">
                {meUser ? (
                  <>
                    <strong className="font-medium text-foreground">{meUser.displayName || meUser.username}</strong>
                    <span> · {roleLabel(meUser.role)}</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
              退出登录
            </Button>
          </CardHeader>
          <CardContent>
            <AdminMetricStrip
              className="admin-metric-strip--account"
              ariaLabel="用户统计"
              items={[
                { label: '用户', value: users.length },
                { label: '活跃', value: activeCount },
                { label: '禁用', value: users.length - activeCount },
                { label: '管理员', value: adminCount },
              ]}
            />
          </CardContent>
        </Card>

        </div>}

        {accountTab === 'registration' && <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">注册设置</CardTitle>
            <p className="text-sm text-muted-foreground">控制新用户如何加入本站。</p>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={registerMode}
              onValueChange={(v) => setRegisterMode(v as typeof registerMode)}
              className="grid gap-3 sm:grid-cols-3"
              id="registerModeGroup"
            >
              {REGISTER_MODES.map((m) => (
                <label
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card p-3.5 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
                  key={m.value}
                >
                  <RadioGroupItem value={m.value} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{m.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{m.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => void saveRegisterSettings()}>
                保存设置
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>}

        {accountTab === 'users' && <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="account-settings-panel__header flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">用户</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">管理站点用户、角色与登录状态</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          刷新
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>注册</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead>想法</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                    暂无用户
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const disabled = u.status === 'disabled'
                  const admin = u.role === 'admin'
                  const self = meUser ? u.id === meUser.id : false
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <strong>{u.displayName || u.username}</strong>
                        {self && (
                          <Badge variant="outline" className="ml-1.5">
                            本人
                          </Badge>
                        )}
                        <br />
                        <span className="text-sm text-muted-foreground">{u.username}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={admin ? 'bg-info/10 text-info' : ''}>
                          {roleLabel(u.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={disabled ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}>
                          {disabled ? '已禁用' : '正常'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{timeAgo(u.createdAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{timeAgo(u.lastLoginAt)}</TableCell>
                      <TableCell>{u.thoughtCount || 0}</TableCell>
                      <TableCell>
                        {!self && (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => void updateUserRole(u)}>
                              {admin ? '设为读者' : '设为管理员'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void resetUserPassword(u)}>
                              重置密码
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void updateUserStatus(u)}>
                              {disabled ? '恢复' : '禁用'}
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => void deleteUser(u)}>
                              删除
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
      </div>
        </div>}

      {accountTab === 'audit' && <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="account-settings-panel__header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">登录审计</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">记录登录成功、失败与限流事件，不保存密码或登录令牌</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadLoginAudit()} disabled={loginAuditLoading}>
            刷新
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Select
            value={loginAuditStatus}
            onValueChange={(value) => {
              setLoginAuditStatus(value)
              setLoginAuditOffset(0)
            }}
          >
            <SelectTrigger className="h-9 w-[124px] bg-background" aria-label="登录结果">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectItem value="all">全部结果</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failure">失败</SelectItem>
              <SelectItem value="limited">限流</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="h-9 w-48"
            value={loginAuditUsername}
            placeholder="搜索用户名"
            aria-label="搜索登录用户名"
            onChange={(event) => {
              setLoginAuditUsername(event.target.value)
              setLoginAuditOffset(0)
            }}
          />
        </div>
        <div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>IP 地址</TableHead>
                  <TableHead>User-Agent</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loginAuditLoading && loginAudits.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">加载中…</TableCell></TableRow>
                ) : loginAudits.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-20 text-center text-sm text-muted-foreground">暂无登录审计记录</TableCell></TableRow>
                ) : loginAudits.map((audit) => (
                  <TableRow key={audit.id}>
                    <TableCell>
                      <strong>{audit.displayName || audit.username || '未知用户'}</strong>
                      <div className="text-xs text-muted-foreground">{audit.username || '未知用户名'}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={audit.status === 'success' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
                        {loginAuditStatusLabel(audit.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{loginAuditReasonLabel(audit.reason)}</TableCell>
                    <TableCell><code className="text-xs">{audit.ipAddress || '未记录'}</code></TableCell>
                    <TableCell className="max-w-[260px]">
                      <code className="block truncate text-xs text-muted-foreground" title={audit.userAgent}>{audit.userAgent || '未记录'}</code>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {audit.createdAt ? new Date(audit.createdAt).toLocaleString('zh-CN') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span>共 {loginAuditTotal} 条记录</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={loginAuditPage <= 1 || loginAuditLoading} onClick={() => setLoginAuditOffset(loginAuditOffset - 20)}>上一页</Button>
            <span>{loginAuditPage} / {loginAuditPages}</span>
            <Button variant="outline" size="sm" disabled={loginAuditPage >= loginAuditPages || loginAuditLoading} onClick={() => setLoginAuditOffset(loginAuditOffset + 20)}>下一页</Button>
          </div>
        </div>
      </section>}

      {accountTab === 'operation-audit' && <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="account-settings-panel__header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">管理员操作审计</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">记录危险操作的发起人、目标数量、结果与重放次数，不保存目标正文或原始内容。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadOperationAudit()} disabled={operationAuditLoading}>
            刷新
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Select
            value={operationAuditStatus}
            onValueChange={(value) => {
              setOperationAuditStatus(value)
              setOperationAuditOffset(0)
            }}
          >
            <SelectTrigger className="h-9 w-[124px] bg-background" aria-label="操作结果">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectItem value="all">全部结果</SelectItem>
              <SelectItem value="pending">处理中</SelectItem>
              <SelectItem value="completed">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>操作人</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>目标数量</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>重放</TableHead>
                <TableHead>操作 ID</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operationAuditLoading && operationAudits.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">加载中…</TableCell></TableRow>
              ) : operationAudits.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">暂无管理员操作记录</TableCell></TableRow>
              ) : operationAudits.map((operation) => (
                <TableRow key={operation.id}>
                  <TableCell>
                    <strong>{operation.actorDisplayName || operation.actorUsername || '未知管理员'}</strong>
                    <div className="text-xs text-muted-foreground">{operation.actorUsername || '未知账号'}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{operationAuditActionLabel(operation.action)}</TableCell>
                  <TableCell>{operation.targetCount}</TableCell>
                  <TableCell>
                    <Badge className={operation.status === 'completed' ? 'bg-success/10 text-success' : operation.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}>
                      {operationAuditStatusLabel(operation.status)}
                    </Badge>
                    {operation.status === 'failed' && operation.error && <div className="mt-1 text-xs text-destructive">{operation.error}</div>}
                  </TableCell>
                  <TableCell>{operation.replayCount}</TableCell>
                  <TableCell className="max-w-[260px]">
                    <code className="block truncate text-xs text-muted-foreground" title={operation.operationId}>{operation.operationId}</code>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {operation.createdAt ? new Date(operation.createdAt).toLocaleString('zh-CN') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span>共 {operationAuditTotal} 条记录</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={operationAuditPage <= 1 || operationAuditLoading} onClick={() => setOperationAuditOffset(operationAuditOffset - 20)}>上一页</Button>
            <span>{operationAuditPage} / {operationAuditPages}</span>
            <Button variant="outline" size="sm" disabled={operationAuditPage >= operationAuditPages || operationAuditLoading} onClick={() => setOperationAuditOffset(operationAuditOffset + 20)}>下一页</Button>
          </div>
        </div>
      </section>}

      {accountTab === 'registration' && <>
      <div className="account-settings-toolbar mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">邀请码</h2>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className="h-8 w-[92px]"
            min={1}
            max={50}
            value={inviteCount}
            onChange={(e) => setInviteCount(e.target.value)}
          />
          <Button size="sm" onClick={() => void createInvite()}>
            生成邀请码
          </Button>
        </div>
      </div>
        {generatedCodes && generatedCodes.length > 0 && (
          <div id="tokenStatus" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              {generatedCodes.map((c) => (
                <code key={c} className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-xs text-foreground">
                  {c}
                </code>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => void copyNewInvites()}>
              复制全部
            </Button>
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邀请码</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>使用者</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : invites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    暂无邀请码
                  </TableCell>
                </TableRow>
              ) : (
                invites.map((i) => {
                  const used = i.usedAt > 0
                  const disabled = i.disabledAt > 0
                  return (
                    <TableRow key={i.code}>
                      <TableCell>
                        <code>{i.code}</code>
                      </TableCell>
                      <TableCell>
                        {used ? (
                          <Badge className="bg-success/10 text-success">已使用</Badge>
                        ) : disabled ? (
                          <Badge variant="secondary">已停用</Badge>
                        ) : (
                          <Badge className="bg-info/10 text-info">可用</Badge>
                        )}
                      </TableCell>
                      <TableCell>{i.usedByName || i.usedBy || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{timeAgo(i.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => void copyInvite(i.code)}>
                            复制
                          </Button>
                          {!used && !disabled && (
                            <Button variant="outline" size="sm" onClick={() => void disableInvite(i.code)}>
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
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground" id="inviteStats">
            {invites.length ? `共 ${invites.length} 个 · 可用 ${available} · 失效 ${spent}` : ''}
          </span>
          {spent > 0 && (
            <Button variant="destructive" size="sm" onClick={() => void clearInvites()}>
              清理失效邀请码
            </Button>
          )}
        </div>
      </>}
      </Tabs>
    </AdminPage>
  )
}
