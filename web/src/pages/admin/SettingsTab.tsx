/**
 * 账户与注册 tab —— 当前管理员、注册设置、用户管理、邀请码管理。
 * 由 Novel-KV js/admin-users.js + admin.html #tab-settings 平移。
 * 无轮询：挂载 + 每次变更后重新拉取，无乐观更新。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi, authApi } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { copyText } from '../../lib/admin'
import { useConfirm, useToast } from '../../components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
    const ok = await confirm({
      title: '清理失效邀请码',
      message: '删除所有已使用或已停用的邀请码？',
      items: ['邀请码的使用记录将一并删除', '可用的邀请码不受影响'],
      okText: '清理',
      danger: true,
    })
    if (!ok) return
    try {
      const res = (await adminApi.users.clearInvites()) as { removed?: number }
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

  return (
    <section className="tab-content account-admin">
      <div className="admin-page-intro dashboard-hero account-hero">
        <div>
          <p className="detail-kicker">ACCOUNTS</p>
          <h2 className="section-title">账户与注册</h2>
          <p className="text-secondary text-sm">管理站点用户、注册方式与邀请码。</p>
        </div>
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
      </div>

      <div className="account-overview-grid">
        <div className="card admin-panel-card account-card account-card--identity">
          <div className="section-header admin-card-header account-card__header">
            <div>
              <h3 className="admin-card-title">当前管理员</h3>
              <p className="text-sm text-muted" id="adminCurrentUser">
                {meUser ? (
                  <>
                    <strong>{meUser.displayName || meUser.username}</strong>
                    <span>{roleLabel(meUser.role)}</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
              退出登录
            </Button>
          </div>
          <div id="userStats" className="account-stats admin-stat-strip">
            <span>
              用户 <strong>{users.length}</strong>
            </span>
            <span>
              活跃 <strong>{activeCount}</strong>
            </span>
            <span>
              禁用 <strong>{users.length - activeCount}</strong>
            </span>
            <span>
              管理员 <strong>{adminCount}</strong>
            </span>
          </div>
        </div>

        <div className="card admin-panel-card account-card account-card--register">
          <h3 className="admin-card-title">注册设置</h3>
          <p className="text-sm text-muted admin-card-desc">控制新用户如何加入本站。</p>
          <div className="admin-register-modes" id="registerModeGroup">
            {REGISTER_MODES.map((m) => (
              <label className="admin-register-mode" key={m.value}>
                <input
                  type="radio"
                  name="registerMode"
                  value={m.value}
                  checked={registerMode === m.value}
                  onChange={() => setRegisterMode(m.value)}
                />
                <span>{m.label}</span>
                <span className="admin-register-mode__hint">{m.hint}</span>
              </label>
            ))}
          </div>
          <div className="action-row admin-action-row account-save-row">
            <Button size="sm" onClick={() => void saveRegisterSettings()}>
              保存设置
            </Button>
          </div>
        </div>
      </div>

      <section className="account-section account-section--users">
        <div className="section-header admin-section-header--spaced account-section__header">
          <div>
            <p className="detail-kicker">MEMBERS</p>
            <h2 className="section-title">用户</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            刷新
          </Button>
        </div>
        <div className="table-wrapper account-table-wrapper">
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
                  <TableCell colSpan={7} className="table-empty">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="table-empty">
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
                        <span className="text-sm text-muted">{u.username}</span>
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
                      <TableCell className="text-sm text-muted">{timeAgo(u.createdAt)}</TableCell>
                      <TableCell className="text-sm text-muted">{timeAgo(u.lastLoginAt)}</TableCell>
                      <TableCell>{u.thoughtCount || 0}</TableCell>
                      <TableCell className="admin-user-actions">
                        {!self && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => void updateUserRole(u)}>
                              {admin ? '设为读者' : '设为管理员'}
                            </Button>{' '}
                            <Button variant="outline" size="sm" onClick={() => void resetUserPassword(u)}>
                              重置密码
                            </Button>{' '}
                            <Button variant="outline" size="sm" onClick={() => void updateUserStatus(u)}>
                              {disabled ? '恢复' : '禁用'}
                            </Button>{' '}
                            <Button variant="destructive" size="sm" onClick={() => void deleteUser(u)}>
                              删除
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="account-section account-section--invites">
        <div className="section-header admin-section-header--spaced account-section__header">
          <div>
            <p className="detail-kicker">INVITES</p>
            <h2 className="section-title">邀请码</h2>
          </div>
          <div className="admin-toolbar__group account-invite-tools">
            <Input
              type="number"
              className="admin-input--compact admin-input--number"
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
          <div id="tokenStatus" className="admin-status-slot">
            <div className="scrape-ready-note admin-invite-result">
              <div className="admin-invite-result__codes">
                {generatedCodes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </div>
              <Button variant="secondary" size="sm" onClick={() => void copyNewInvites()}>
                复制全部
              </Button>
            </div>
          </div>
        )}
        <div className="table-wrapper account-table-wrapper">
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
                  <TableCell colSpan={5} className="table-empty">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : invites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="table-empty">
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
                      <TableCell className="text-sm text-muted">{timeAgo(i.createdAt)}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => void copyInvite(i.code)}>
                          复制
                        </Button>
                        {!used && !disabled && (
                          <>
                            {' '}
                            <Button variant="outline" size="sm" onClick={() => void disableInvite(i.code)}>
                              停用
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        <div className="admin-table-meta-row account-table-meta-row">
          <span className="text-xs text-muted" id="inviteStats">
            {invites.length ? `共 ${invites.length} 个 · 可用 ${available} · 失效 ${spent}` : ''}
          </span>
          {spent > 0 && (
            <Button variant="destructive" size="sm" onClick={() => void clearInvites()}>
              清理失效邀请码
            </Button>
          )}
        </div>
      </section>
    </section>
  )
}
