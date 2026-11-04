import { Spinner } from '@/components/ui/spinner'
import '@/styles/account-content.css'
import '@/styles/input-fields.css'
import { Button } from '@/components/ui/button'
import styles from './account.module.css'
/**
 * Profile 页 —— 头像、资料编辑、密码、会话管理、退出（由 Novel-KV js/profile.js 平移）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, type PasskeyItem } from '../lib/api'
import { UserAvatar } from "@/components/identity/UserAvatar"
import { useSession } from '../context/SessionContext'
import { useConfirm } from '../components/feedback'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate, timeAgo } from '../lib/format'
import { ImagePlus, KeyRound, Monitor, Smartphone, Trash2 } from 'lucide-react'
import { ReadingDataPanel } from '../components/ReadingDataPanel'
import { ReadingStatsPanel } from '../components/ReadingStatsPanel'
import { useContentPolicy } from '../context/ContentPolicyContext'

interface SessionItem {
  id: string
  deviceName: string
  current: boolean
  createdAt: number
  expiresAt: number
}

function roleText(role: string): string {
  return role === 'admin' ? '管理员' : '读者'
}

export default function Profile() {
  const navigate = useNavigate()
  const { user, refresh, loading } = useSession()
  const { safeMode } = useContentPolicy()
  const { confirm } = useConfirm()
  useDocumentTitle('个人中心')

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [passkeyEnabled, setPasskeyEnabled] = useState(false)
  const [passkeyRegistrationEnabled, setPasskeyRegistrationEnabled] = useState(false)
  const [passkeyPassword, setPasskeyPassword] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [editingPasskeyId, setEditingPasskeyId] = useState('')
  const [editingPasskeyName, setEditingPasskeyName] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [msg, setMsg] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSettings = ['details', 'security', 'sessions', 'reading', 'stats'].includes(searchParams.get('tab') || '') ? searchParams.get('tab')! : 'details'
  function setActiveSettings(tab: string) {
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('tab', tab); return next })
  }

  function message(text: string) {
    if (messageTimer.current) clearTimeout(messageTimer.current)
    setMsg(text || '')
    if (text) messageTimer.current = setTimeout(() => setMsg(''), 2000)
  }

  const loadSessions = useCallback(async () => {
    try {
      const data = await authApi.sessions()
      setSessions((data.sessions || []) as SessionItem[])
    } catch {
      setSessions([])
    }
  }, [])

  const loadPasskeys = useCallback(async () => {
    try {
      const data = await authApi.passkeys()
      setPasskeys(data.passkeys || [])
    } catch {
      setPasskeys([])
    }
  }, [])

  const loadPasskeySettings = useCallback(async () => {
    try {
      const settings = await authApi.passkeyConfig()
      setPasskeyEnabled(settings.enabled)
      setPasskeyRegistrationEnabled(settings.registrationEnabled)
      if (settings.enabled) await loadPasskeys()
      else setPasskeys([])
    } catch {
      setPasskeyEnabled(false)
      setPasskeyRegistrationEnabled(false)
      setPasskeys([])
    }
  }, [loadPasskeys])

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true, state: { from: '/profile' } })
      return
    }
    if (user) {
      setDisplayName(user.displayName || '')
      setBio(user.bio || '')
      void loadSessions()
      void loadPasskeySettings()
    }
  }, [user, loading, navigate, loadSessions, loadPasskeySettings])

  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current)
    }
  }, [])

  if (loading || !user) {
    return (
      <div className="loading-center" style={{ minHeight: '50vh' }}>
        <Spinner size="lg"  />
      </div>
    )
  }

  const name = user.displayName || user.username
  const displayAvatar = avatarPreview || user.avatarUrl

  async function saveProfile() {
    try {
      const r = await authApi.update({ displayName: displayName.trim(), bio: bio.trim() })
      await refresh()
      setDisplayName(r.user.displayName)
      message('已保存')
    } catch (err) {
      message((err as Error).message || '保存失败')
    }
  }

  async function changePassword() {
    try {
      await authApi.changePassword(currentPassword, newPassword)
      await refresh()
      await loadSessions()
      setCurrentPassword('')
      setNewPassword('')
      message('密码已修改')
    } catch (err) {
      message((err as Error).message || '修改失败')
    }
  }

  async function registerPasskey() {
    if (!passkeyPassword.trim()) { message('请先输入当前密码'); return }
    setPasskeyBusy(true)
    try {
      await authApi.registerPasskey(passkeyPassword, passkeyName.trim())
      setPasskeyPassword('')
      setPasskeyName('')
      await loadPasskeys()
      message('Passkey 已注册')
    } catch (err) {
      message((err as Error).message || 'Passkey 注册失败')
    } finally {
      setPasskeyBusy(false)
    }
  }

  function beginRenamePasskey(item: PasskeyItem) {
    setEditingPasskeyId(item.id)
    setEditingPasskeyName(item.name)
  }

  async function savePasskeyName(id: string) {
    if (!editingPasskeyName.trim()) { message('名称不能为空'); return }
    setPasskeyBusy(true)
    try {
      await authApi.renamePasskey(id, editingPasskeyName.trim())
      await loadPasskeys()
      setEditingPasskeyId('')
      message('Passkey 名称已更新')
    } catch (err) {
      message((err as Error).message || '名称更新失败')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function deletePasskey(id: string) {
    const ok = await confirm({ title: '移除 Passkey', message: '移除后，这个设备将不能再用该 Passkey 登录当前账户。确定继续？', okText: '移除', danger: true })
    if (!ok) return
    setPasskeyBusy(true)
    try {
      await authApi.deletePasskey(id)
      await loadPasskeys()
      message('Passkey 已移除')
    } catch (err) {
      message((err as Error).message || 'Passkey 移除失败')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function uploadAvatar() {
    if (!avatarFile) {
      message('请选择头像')
      return
    }
    try {
      setAvatarUploading(true)
      await authApi.uploadAvatar(avatarFile)
      setAvatarFile(null)
      setAvatarPreview('')
      if (avatarInputRef.current) avatarInputRef.current.value = ''
      await refresh()
      message('头像已上传')
    } catch (err) {
      message((err as Error).message || '上传失败')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function deleteAvatar() {
    const ok = await confirm({ title: '删除头像', message: '确定删除当前头像？删除后将显示昵称首字作为头像。', okText: '删除', danger: true })
    if (!ok) return
    try {
      await authApi.deleteAvatar()
      await refresh()
      message('头像已删除')
    } catch (err) {
      message((err as Error).message || '删除失败')
    }
  }

  async function deleteSession(id: string) {
    const ok = await confirm({
      title: '移除登录设备',
      message: '确定移除这台设备的登录状态？该设备需要重新登录后才能继续访问账户。',
      okText: '移除',
      danger: true,
    })
    if (!ok) return
    try {
      await authApi.deleteSession(id)
      await loadSessions()
      message('会话已移除')
    } catch (err) {
      message((err as Error).message || '移除失败')
    }
  }

  async function logout() {
    await authApi.logout()
    await refresh()
    navigate('/')
  }

  async function logoutAll() {
    const ok = await confirm({
      title: '退出所有设备',
      message: '确定退出所有设备？当前账户在其他设备上的登录状态也会被清除。',
      okText: '全部退出',
      danger: true,
    })
    if (!ok) return
    try {
      await authApi.logoutAll()
      await refresh()
      navigate('/')
    } catch (err) {
      message((err as Error).message || '退出所有设备失败，请重试')
    }
  }

  return (
    <main className={`${styles.profile} profile-page`}>
      <div className="container profile-shell">
        <div className="profile-heading">
          <div className="account-page-heading">
            <h1>个人中心</h1>
            <p>管理你的资料与账户安全。</p>
            <p className="profile-message" id="profileMessage" role="status" aria-live="polite">
              {msg}
            </p>
          </div>

          {/* Account identity */}
          <section className="profile-hero" aria-label="账户摘要">
            <div className="profile-hero__main">
              <div className="profile-avatar profile-avatar--hero">
                <UserAvatar src={user.avatarUrl} name={name || '我'} size="inherit" />
              </div>
              <div className="profile-hero__identity">
                <h2 className="profile-hero__name" id="profileName">
                  {name}
                </h2>
                <p className="profile-meta" id="profileMeta">
                  @{user.username}
                </p>
                <div className="profile-badges">
                  <span className="profile-pill profile-pill--role">{roleText(user.role)}</span>
                  <span className={`profile-pill profile-pill--status profile-pill--${user.status === 'disabled' ? 'disabled' : 'active'}`}>
                    {user.status === 'disabled' ? '已停用' : '已启用'}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="profile-settings-sheet">
          <nav className="profile-tabs" aria-label="个人中心设置">
            {[
              { id: 'details', label: '个人资料' },
              { id: 'security', label: '账户安全' },
              { id: 'sessions', label: '登录设备' },
              { id: 'stats', label: '阅读统计' },
              { id: 'reading', label: '阅读数据' },
            ].map((item) => (
              <button type="button" className="profile-tab" key={item.id} aria-pressed={activeSettings === item.id} onClick={() => setActiveSettings(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="profile-edit-grid" data-settings={activeSettings}>
            {activeSettings === 'stats' && <ReadingStatsPanel key={`${user.id}:${safeMode}`} />}
            {activeSettings === 'reading' && <ReadingDataPanel key={`${user.id}:${safeMode}`} userId={user.id} username={user.username} />}
            <section className="profile-section profile-details-card" aria-label="个人资料" hidden={activeSettings !== 'details'}>
              <div className="profile-edit-panel__head">
                <h2 className="profile-section-heading">个人资料</h2>
              </div>
              <div className="profile-avatar-picker">
                <div className="profile-avatar profile-avatar--preview">
                  <UserAvatar src={displayAvatar} name={name || '我'} size="inherit" />
                </div>
                <div className="profile-avatar-controls">
                  <div className="profile-action-group">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      id="avatarInput"
                      tabIndex={-1}
                      className="profile-file-input"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setAvatarFile(file)
                        if (file) {
                          const reader = new FileReader()
                          reader.onload = () => setAvatarPreview(String(reader.result))
                          reader.readAsDataURL(file)
                        } else {
                          setAvatarPreview('')
                        }
                      }}
                    />
                    <Button variant="secondary" type="button"  onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
                      <ImagePlus size={16} aria-hidden="true" />
                      更换头像
                    </Button>
                    {(avatarFile || avatarUploading) && (
                      <Button variant="default" type="button"  onClick={() => void uploadAvatar()} disabled={!avatarFile || avatarUploading}>
                        {avatarUploading ? '上传中…' : '上传头像'}
                      </Button>
                    )}
                    <Button variant="ghost" type="button"  onClick={() => void deleteAvatar()} disabled={avatarUploading}>
                      <Trash2 size={16} aria-hidden="true" />
                      移除头像
                    </Button>
                  </div>
                  <p className="profile-avatar-note">支持 JPG、PNG、WebP、GIF，最大 1 MB。头像以圆形显示。</p>
                </div>
              </div>
              <div className="profile-settings">
                <label className="profile-field">
                  <span>昵称</span>
                  <input
                    type="text"
                    className="form-input"
                    id="displayNameInput"
                    maxLength={20}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </label>
                <label className="profile-field">
                  <span>邮箱</span>
                  <input type="email" className="form-input" id="emailInput" placeholder="暂未开放邮箱绑定" disabled />
                </label>
                <label className="profile-field">
                  <span>个人简介</span>
                  <textarea className="form-input" id="bioInput" maxLength={80} rows={3} value={bio} onChange={(e) => setBio(e.target.value)}></textarea>
                </label>
              </div>
              <div className="profile-edit-panel__actions">
                <Button variant="default"  onClick={() => void saveProfile()}>
                  保存修改
                </Button>
              </div>
            </section>

            {/* 密码 */}
            <section className="profile-section profile-security-section" hidden={activeSettings !== 'security' || !passkeyEnabled}>
              <div className="profile-edit-panel profile-passkey-panel">
                <div className="profile-edit-panel__head">
                  <div>
                    <h2 className="profile-section-heading">Passkey</h2>
                    <p className="profile-section-note">使用设备解锁、指纹或面容快速登录；私钥只保留在你的设备或密码管理器中。</p>
                  </div>
                </div>
                <div className="profile-passkey-list">
                  {passkeys.length === 0 ? <p className="profile-empty-note">还没有注册 Passkey</p> : passkeys.map(item => (
                    <div className="profile-passkey-item" key={item.id}>
                      <div className="profile-session-icon" aria-hidden="true"><KeyRound size={17} /></div>
                      <div className="profile-session-meta">
                        {editingPasskeyId === item.id ? <input className="form-input profile-passkey-name-input" aria-label="Passkey 名称" value={editingPasskeyName} maxLength={80} onChange={e => setEditingPasskeyName(e.target.value)} /> : <strong className="profile-session-title">{item.name}</strong>}
                        <span className="profile-session-detail">注册于 {formatDate(item.createdAt)}{item.lastUsedAt ? ` · 最近使用 ${timeAgo(item.lastUsedAt)}` : ''}{item.deviceName ? ` · ${item.deviceName}` : ''}</span>
                      </div>
                      {editingPasskeyId === item.id ? <div className="profile-passkey-actions"><Button variant="secondary" size="sm"  disabled={passkeyBusy} onClick={() => void savePasskeyName(item.id)}>保存</Button><Button variant="ghost" size="sm"  disabled={passkeyBusy} onClick={() => setEditingPasskeyId('')}>取消</Button></div> : <div className="profile-passkey-actions"><Button variant="ghost" size="sm"  disabled={passkeyBusy} onClick={() => beginRenamePasskey(item)}>改名</Button><Button variant="ghost" size="sm" className="profile-passkey-remove" disabled={passkeyBusy} onClick={() => void deletePasskey(item.id)}>移除</Button></div>}
                    </div>
                  ))}
                </div>
                {passkeyRegistrationEnabled ? <>
                  <div className="profile-settings profile-passkey-form">
                    <label className="profile-field">
                      <span>当前密码</span>
                      <input type="password" className="form-input" id="passkeyPasswordInput" autoComplete="current-password" value={passkeyPassword} disabled={passkeyBusy} onChange={e => setPasskeyPassword(e.target.value)} />
                    </label>
                    <label className="profile-field">
                      <span>设备名称</span>
                      <input type="text" className="form-input" id="passkeyNameInput" maxLength={80} placeholder="例如：我的 MacBook" value={passkeyName} disabled={passkeyBusy} onChange={e => setPasskeyName(e.target.value)} />
                    </label>
                  </div>
                  <div className="profile-edit-panel__actions"><Button variant="default"  disabled={passkeyBusy || !passkeyPassword.trim()} onClick={() => void registerPasskey()}>{passkeyBusy ? '处理中…' : '注册 Passkey'}</Button></div>
                </> : <p className="profile-section-note">管理员暂时关闭了新的 Passkey 注册；已有凭据仍按站点策略处理。</p>}
              </div>
            </section>

            {/* 密码 */}
            <section className="profile-section profile-security-section" hidden={activeSettings !== 'security'}>
              <div className="profile-edit-panel">
                <div className="profile-edit-panel__head">
                  <div>
                    <h2 className="profile-section-heading">修改密码</h2>
                  </div>
                </div>
                <div className="profile-settings">
                  <label className="profile-field">
                    <span>当前密码</span>
                    <input
                      type="password"
                      className="form-input"
                      id="currentPasswordInput"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </label>
                  <label className="profile-field">
                    <span>新密码</span>
                    <input
                      type="password"
                      className="form-input"
                      id="newPasswordInput"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </label>
                </div>
                <div className="profile-edit-panel__actions">
                  <Button variant="default"  onClick={() => void changePassword()}>
                    修改密码
                  </Button>
                </div>
              </div>
            </section>

            {/* 会话 */}
            <section className="profile-section profile-security-section" hidden={activeSettings !== 'sessions'}>
              <div className="profile-edit-panel">
                <div className="profile-edit-panel__head">
                  <div>
                    <h2 className="profile-section-heading">登录设备</h2>
                  </div>
                </div>
                <div className="profile-session-list" id="sessionList">
                  {sessions.length === 0 ? (
                    <p className="profile-empty-note">暂无登录设备</p>
                  ) : (
                    sessions.map((s) => (
                      <div className={`profile-session-item profile-session-card${s.current ? ' profile-session-card--current' : ''}`} key={s.id}>
                        <div className="profile-session-icon" aria-hidden="true">
                          {s.deviceName === '知舟 iOS App' ? <Smartphone size={18} /> : <Monitor size={18} />}
                        </div>
                        <div className="profile-session-meta">
                          <div className="profile-session-title-row">
                            <strong className="profile-session-title">{s.deviceName || (s.current ? '当前设备' : '其他设备')}</strong>
                            {s.current && <span className="profile-session-status">当前</span>}
                          </div>
                          <span className="profile-session-detail">
                            登录 {timeAgo(s.createdAt)} · 到期 {formatDate(s.expiresAt)}
                          </span>
                        </div>
                        <Button variant="secondary" size="sm" className="btn-session-delete" disabled={s.current} onClick={() => void deleteSession(s.id)}>
                          移除
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <div className="profile-session-actions">
                  <Button variant="secondary"  onClick={() => void logout()}>
                    退出登录
                  </Button>
                  <Button variant="secondary"  onClick={() => void logoutAll()}>
                    退出所有设备
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
