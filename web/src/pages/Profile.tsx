import { MotionPresence, MotionView } from '@/components/ui/motion'
import { Spinner } from '@/components/ui/spinner'
import { roleLabel } from '@shared/roles'
import ProfileEmail from './ProfileEmail'
import '@/styles/account-content.css'
import '@/styles/input-fields.css'
import { Button } from '@/components/ui/button'
import styles from './account.module.css'
import securityStyles from './profile-security.module.css'
import FormField from '@/components/shared/FormField'
import { InlineError } from '@/components/shared/AsyncStates'
import { Input } from '@/components/ui/input'
/**
 * Profile 页 —— 头像、资料编辑、密码、会话管理、退出（由 Novel-KV js/profile.js 平移）。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi, type PasskeyItem } from '../lib/api'
import { UserAvatar } from "@/components/identity/UserAvatar"
import { useSession } from '../context/SessionContext'
import { useConfirm } from '../components/feedback'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate, timeAgo } from '../lib/format'
import { ImagePlus, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react'
import { ReadingDataPanel } from '../components/ReadingDataPanel'
import { useContentPolicy } from '../context/ContentPolicyContext'

const ReadingStatsPanel = lazy(() => import('../components/ReadingStatsPanel').then((module) => ({ default: module.ReadingStatsPanel })))

interface SessionItem {
  id: string
  deviceName: string
  current: boolean
  createdAt: number
  expiresAt: number
}

function roleText(role: string): string {
  return roleLabel(role)
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
  const [passwordBusy, setPasswordBusy] = useState(false)
  const passwordPending = useRef(false)
  const focusPasskeyAction = useRef(false)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [passkeysLoading, setPasskeysLoading] = useState(true)
  const [passkeysError, setPasskeysError] = useState('')
  const [addingPasskey, setAddingPasskey] = useState(false)
  const passkeyTrigger = useRef<HTMLButtonElement>(null)
  const [passkeyEnabled, setPasskeyEnabled] = useState(false)
  const [passkeyRegistrationEnabled, setPasskeyRegistrationEnabled] = useState(false)
  const [passkeyPassword, setPasskeyPassword] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const passkeyPending = useRef(false)
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
  useEffect(() => {
    if (focusPasskeyAction.current && !passkeyBusy) {
      passkeyTrigger.current?.focus({ preventScroll: true }); focusPasskeyAction.current = false
    }
  }, [passkeyBusy, addingPasskey])
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
    setPasskeysLoading(true)
    setPasskeysError('')
    try {
      const data = await authApi.passkeys()
      setPasskeys(data.passkeys || [])
    } catch { setPasskeysError('通行密钥读取失败，请重试。') }
    finally { setPasskeysLoading(false) }
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
    if (passwordPending.current) return
    passwordPending.current = true
    setPasswordBusy(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      await refresh()
      await loadSessions()
      setCurrentPassword('')
      setNewPassword('')
      message('密码已修改')
    } catch (err) {
      message((err as Error).message || '修改失败')
    } finally { passwordPending.current = false; setPasswordBusy(false) }
  }

  async function registerPasskey() {
    if (passkeyPending.current) return
    if (!passkeyPassword.trim()) { message('请先输入当前密码'); return }
    passkeyPending.current = true
    setPasskeyBusy(true)
    try {
      await authApi.registerPasskey(passkeyPassword, passkeyName.trim())
      setPasskeyPassword('')
      setPasskeyName('')
      await loadPasskeys()
      focusPasskeyAction.current = true
      setAddingPasskey(false)
      message('Passkey 已注册')
    } catch (err) {
      message((err as Error).message || 'Passkey 注册失败')
    } finally {
      passkeyPending.current = false
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

          <MotionView asChild motionKey={activeSettings}><div className={`profile-edit-grid${activeSettings === 'security' ? ` ${securityStyles.securityLayout}` : ''}`} data-settings={activeSettings}>
            {activeSettings === 'security' && <ProfileEmail key={user.id} user={user} />}
            {activeSettings === 'stats' && <Suspense fallback={<Spinner aria-label="正在加载阅读统计" />}><ReadingStatsPanel key={`${user.id}:${safeMode}`} /></Suspense>}
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
                  <input type="email" className="form-input" id="emailInput" value={user.email || ''} placeholder="请在账户安全中绑定邮箱" disabled />
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
            <section className={`profile-section ${securityStyles.panel} ${securityStyles.passwordPanel}`} aria-label="修改密码" hidden={activeSettings !== 'security'}>
              <header className={securityStyles.heading}>
                <h2 className="profile-section-heading">修改密码</h2>
                <p>验证当前密码后，设置新的登录密码。</p>
              </header>
              <form className={securityStyles.form} onSubmit={event => { event.preventDefault(); void changePassword() }}>
                <FormField label="当前密码" htmlFor="currentPasswordInput">
                  <Input id="currentPasswordInput" type="password" autoComplete="current-password" value={currentPassword} required disabled={passwordBusy} onChange={e => setCurrentPassword(e.target.value)} />
                </FormField>
                <FormField label="新密码" htmlFor="newPasswordInput" hint="8–512 位">
                  <Input id="newPasswordInput" type="password" autoComplete="new-password" value={newPassword} required minLength={8} maxLength={512} disabled={passwordBusy} onChange={e => setNewPassword(e.target.value)} />
                </FormField>
                <div className={securityStyles.actions}>
                  <Button type="submit" disabled={passwordBusy}>{passwordBusy && <Spinner size="sm" aria-hidden="true" />}{passwordBusy ? '保存中…' : '保存新密码'}</Button>
                </div>
              </form>
            </section>

            {/* 通行密钥 */}
            <section className={`profile-section ${securityStyles.panel} ${securityStyles.passkeyPanel}`} aria-label="Passkey" hidden={activeSettings !== 'security' || !passkeyEnabled}>
              <header className={securityStyles.headingRow}>
                <div className={securityStyles.heading}>
                  <h2 className="profile-section-heading">通行密钥 <span>Passkey</span></h2>
                  <p>通过设备解锁、指纹或面容登录，私钥保留在设备或密码管理器中。</p>
                </div>
                {passkeyRegistrationEnabled && <Button ref={passkeyTrigger} type="button" variant="secondary" size="sm" aria-expanded={addingPasskey} aria-controls="profile-passkey-registration" disabled={passkeyBusy || passkeysLoading} onClick={() => setAddingPasskey(value => !value)}>
                  {!addingPasskey && <Plus size={14} aria-hidden="true" />}{addingPasskey ? '收起添加' : '添加通行密钥'}
                </Button>}
              </header>
              {passkeysError && <InlineError message={passkeysError} onRetry={() => void loadPasskeys()} />}
              {passkeysLoading && <p className={securityStyles.notice} role="status">正在读取通行密钥…</p>}
              {!passkeysLoading && !passkeysError && passkeys.length === 0 && <p className={securityStyles.notice}>尚未添加通行密钥。</p>}
              <div className={securityStyles.passkeyList}>
                {passkeys.map(item => (
                  <div className={securityStyles.passkeyItem} key={item.id}>
                    <div className={securityStyles.passkeyMeta}>
                      {editingPasskeyId === item.id ? <Input aria-label="Passkey 名称" value={editingPasskeyName} maxLength={80} disabled={passkeyBusy} autoFocus onChange={e => setEditingPasskeyName(e.target.value)} /> : <strong>{item.name}</strong>}
                      {item.deviceName && <span>{item.deviceName}</span>}
                      <span>{formatDate(item.createdAt)} 注册{item.lastUsedAt ? ` · ${timeAgo(item.lastUsedAt)}使用` : ''}</span>
                    </div>
                    <div className={securityStyles.passkeyActions}>
                      {editingPasskeyId === item.id ? <>
                        <Button variant="secondary" size="sm" disabled={passkeyBusy} onClick={() => void savePasskeyName(item.id)}>保存</Button>
                        <Button variant="ghost" size="sm" disabled={passkeyBusy} onClick={() => setEditingPasskeyId('')}>取消</Button>
                      </> : <>
                        <Button variant="ghost" size="sm" disabled={passkeyBusy} onClick={() => beginRenamePasskey(item)}>改名</Button>
                        <Button variant="ghost" size="sm" className={securityStyles.remove} disabled={passkeyBusy} onClick={() => void deletePasskey(item.id)}>移除</Button>
                      </>}
                    </div>
                  </div>
                ))}
              </div>
              {passkeyRegistrationEnabled ? <MotionPresence asChild open={addingPasskey} mode="disclosure" keepMounted><div id="profile-passkey-registration" className={securityStyles.passkeyRegistration}>
                <h3 className={securityStyles.subheading}>添加通行密钥</h3>
                <form className={securityStyles.registrationForm} onSubmit={event => { event.preventDefault(); void registerPasskey() }}>
                  <FormField label="当前密码" htmlFor="passkeyPasswordInput">
                    <Input id="passkeyPasswordInput" type="password" autoComplete="current-password" value={passkeyPassword} required disabled={passkeyBusy} onChange={e => setPasskeyPassword(e.target.value)} />
                  </FormField>
                  <FormField label="设备名称" htmlFor="passkeyNameInput">
                    <Input id="passkeyNameInput" type="text" maxLength={80} placeholder="例如：我的 MacBook" value={passkeyName} disabled={passkeyBusy} onChange={e => setPasskeyName(e.target.value)} />
                  </FormField>
                  <div className={securityStyles.actions}>
                    <Button type="submit" disabled={passkeyBusy || !passkeyPassword.trim()}>{passkeyBusy && <Spinner size="sm" aria-hidden="true" />}{passkeyBusy ? '处理中…' : '注册 Passkey'}</Button>
                  </div>
                </form>
              </div></MotionPresence> : <p className={securityStyles.notice}>管理员暂时关闭了新的 Passkey 注册；已有凭据仍按站点策略处理。</p>}
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
                          {['知舟 iOS App', 'Cat’s Library iOS App'].includes(s.deviceName) ? <Smartphone size={18} /> : <Monitor size={18} />}
                        </div>
                        <div className="profile-session-meta">
                          <div className="profile-session-title-row">
                            <strong className="profile-session-title">{s.deviceName === '知舟 iOS App' ? 'Cat’s Library iOS App' : s.deviceName || (s.current ? '当前设备' : '其他设备')}</strong>
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
          </div></MotionView>
        </div>
      </div>
    </main>
  )
}
