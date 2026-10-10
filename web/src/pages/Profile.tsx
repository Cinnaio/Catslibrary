/**
 * Profile 页 —— 头像、资料编辑、密码、会话管理、退出（由 Novel-KV js/profile.js 平移）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useSession } from '../context/SessionContext'
import { useConfirm } from '../components/feedback'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatDate, timeAgo } from '../lib/format'
import { Monitor, Smartphone } from 'lucide-react'
import { ReadingDataPanel } from '../components/ReadingDataPanel'
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
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [msg, setMsg] = useState('')
  const [activeSettings, setActiveSettings] = useState('details')

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

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { replace: true, state: { from: '/profile' } })
      return
    }
    if (user) {
      setDisplayName(user.displayName || '')
      setBio(user.bio || '')
      void loadSessions()
    }
  }, [user, loading, navigate, loadSessions])

  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current)
    }
  }, [])

  if (loading || !user) {
    return (
      <div className="loading-center" style={{ minHeight: '50vh' }}>
        <div className="spinner spinner--lg"></div>
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
    <main className="profile-page">
      <div className="container profile-shell">
        <div className="account-page-heading">
          <h1>个人中心</h1>
          <p>管理你的资料与账户安全。</p>
          <p className="profile-message" id="profileMessage" role="status" aria-live="polite">
            {msg}
          </p>
        </div>

          <nav className="profile-tabs" aria-label="个人中心设置">
            {[
              { id: 'details', label: '个人资料' },
              { id: 'security', label: '账户安全' },
              { id: 'sessions', label: '登录设备' },
              { id: 'reading', label: '阅读数据' },
            ].map((item) => (
              <button type="button" className="profile-tab" key={item.id} aria-pressed={activeSettings === item.id} onClick={() => setActiveSettings(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
        <div className="profile-settings-sheet">
          {/* Account identity */}
          <section className="profile-hero" aria-label="账户摘要">
            <div className="profile-hero__main">
              <div className="profile-avatar profile-avatar--hero">
                <UserAvatar src={displayAvatar} name={name || '我'} size="inherit" />
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

          <div className="profile-edit-grid">
            {activeSettings === 'reading' && <ReadingDataPanel key={`${user.id}:${safeMode}`} userId={user.id} username={user.username} />}
            {/* 头像 */}
            <section className="profile-section profile-avatar-section" hidden={activeSettings !== 'details'}>
              <div className="profile-edit-panel">
                <div className="profile-edit-panel__head">
                  <div>
                    <h2 className="profile-section-heading">头像</h2>
                  </div>
                </div>
                <div className="profile-avatar-picker">
                  <div className="profile-action-group">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      id="avatarInput"
                      tabIndex={-1}
                      className="profile-file-input"
                      accept="image/*"
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
                    <button type="button" className="btn btn--secondary" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
                      选择头像
                    </button>
                    {(avatarFile || avatarUploading) && (
                      <button type="button" className="btn btn--primary" onClick={() => void uploadAvatar()} disabled={!avatarFile || avatarUploading}>
                        {avatarUploading ? '上传中…' : '上传头像'}
                      </button>
                    )}
                    <button type="button" className="btn btn--secondary" onClick={() => void deleteAvatar()} disabled={avatarUploading}>
                      删除头像
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* 资料编辑 */}
            <section className="profile-section" hidden={activeSettings !== 'details'}>
              <div className="profile-edit-panel">
                <div className="profile-edit-panel__head">
                  <div>
                    <h2 className="profile-section-heading sr-only">个人资料</h2>
                  </div>
                </div>
                <div className="profile-settings">
                  <label className="profile-field">
                    <span>显示名称</span>
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
                    <span>个人简介</span>
                    <textarea className="form-input" id="bioInput" maxLength={80} rows={3} value={bio} onChange={(e) => setBio(e.target.value)}></textarea>
                  </label>
                </div>
                <div className="profile-edit-panel__actions">
                  <button className="btn btn--primary" onClick={() => void saveProfile()}>
                    保存资料
                  </button>
                </div>
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
                  <button className="btn btn--primary" onClick={() => void changePassword()}>
                    修改密码
                  </button>
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
                        <button className="btn btn--secondary btn--sm btn-session-delete" disabled={s.current} onClick={() => void deleteSession(s.id)}>
                          移除
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="profile-session-actions">
                  <button className="btn btn--secondary" onClick={() => void logout()}>
                    退出登录
                  </button>
                  <button className="btn btn--secondary" onClick={() => void logoutAll()}>
                    退出所有设备
                  </button>
                </div>
              </div>
            </section>
          </div>
          <div className="profile-account-footnote">
            <span>注册 {formatDate(user.createdAt) || '—'}</span>
            <span>最近登录 {formatDate(user.lastLoginAt) || '—'}</span>
            {user.role === 'admin' && <Link to="/admin">进入管理面板</Link>}
          </div>
        </div>
      </div>
    </main>
  )
}
