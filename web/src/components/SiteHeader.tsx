/**
 * 站点页头 —— 由 Novel-KV index.html/novel.html 的 header 结构平移。
 * 响应式：移动端搜索走全屏 overlay；主题切换带动画。
 */
import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useSearch } from '../context/SearchContext'
import { url } from '../lib/api'
import { MoonIcon, RefreshIcon, SearchIcon, SunIcon } from './icons'
import { ThemeMenu } from './ThemeMenu'

export default function SiteHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useSession()
  const { query: searchValue, setQuery } = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const isHome = location.pathname === '/'

  const name = user?.displayName || user?.username || ''
  const avatarUrl = user?.avatarUrl ? url(user.avatarUrl) : ''
  const showAvatar = !!avatarUrl && !avatarFailed
  const isAdmin = user?.role === 'admin'

  function submitSearch(query: string) {
    const q = query.trim()
    setQuery(q)
    if (!isHome && q) navigate(`/?q=${encodeURIComponent(q)}`)
  }

  function refresh() {
    // 清 service worker 缓存后硬刷新（保留 query）
    if ('caches' in window) {
      caches.keys().then((names) => names.forEach((name) => caches.delete(name))).catch(() => {})
    }
    const url = new URL(window.location.href)
    url.searchParams.set('v', Date.now().toString())
    window.location.href = url.toString()
  }

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="header__logo">
          <img className="header__logo-img" src="/images/logo.png" alt="知舟" />
          知舟
        </Link>

        <div className="header__actions">
          {isHome && (
            <div className="search-bar">
              <span className="search-bar__icon">
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="text"
                className="search-bar__input"
                placeholder="搜索书名或作者…"
                autoComplete="off"
                value={searchValue}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSearch((e.target as HTMLInputElement).value)
                }}
              />
            </div>
          )}

          {isHome && (
            <button
              className="mobile-search-trigger"
              aria-label="搜索"
              onClick={() => {
                setMobileOpen(true)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
            >
              <SearchIcon />
            </button>
          )}

          {user ? (
            <Link to="/profile" className="nav-link account-avatar" aria-label={`我的账户：${name}`} title={name}>
              {showAvatar ? (
                <img src={avatarUrl} alt={name} onError={() => setAvatarFailed(true)} />
              ) : (
                <span>{name.slice(0, 1)}</span>
              )}
            </Link>
          ) : (
            <Link to="/auth" className="nav-link" aria-label="登录">
              登录
            </Link>
          )}

          <Link to="/bookshelf" className="nav-link">
            我的书架
          </Link>

          {isAdmin && (
            <Link to="/admin" className="nav-link">
              管理面板
            </Link>
          )}

          <button className="refresh-btn" aria-label="刷新页面" title="刷新页面" onClick={refresh}>
            <RefreshIcon />
          </button>

          <ThemeMenu className="theme-btn" ariaLabel="主题设置" title="主题设置">
            <SunIcon className="theme-icon theme-icon--sun" />
            <MoonIcon className="theme-icon theme-icon--moon" />
          </ThemeMenu>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="search-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileOpen(false)
          }}
        >
          <div className="search-overlay__bar">
            <SearchIcon className="search-overlay__icon" />
            <input
              type="text"
              className="search-overlay__input"
              placeholder="搜索小说…"
              autoComplete="off"
              autoFocus
              defaultValue={searchValue}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  submitSearch((e.target as HTMLInputElement).value)
                  setMobileOpen(false)
                }
              }}
            />
            <button className="search-overlay__close" onClick={() => setMobileOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
