/**
 * 站点页头 —— 由 Novel-KV index.html/novel.html 的 header 结构平移。
 * 响应式：移动端搜索走全屏 overlay；主题切换带动画。
 * 移动端导航收进右侧抽屉（我的书架/管理面板/登录/刷新），页头只留紧凑图标按钮，
 * 避免窄屏上一行挤满文字链接。
 * 注意：搜索/抽屉两个全屏 overlay 必须渲染在 <header> 外 —— .header 有
 * backdrop-filter，会把 position: fixed 后代的包含块收进页头，导致遮罩只盖住页头一条。
 */
import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useSession } from '../context/SessionContext'
import { useSearch } from '../context/SearchContext'
import { useContentPolicy } from '../context/ContentPolicyContext'
import { url } from '../lib/api'
import { BookIcon, ChevronIcon, CloseIcon, MenuIcon, RefreshIcon, SearchIcon, ShieldIcon } from './icons'
import { ThemeMenu } from './ThemeMenu'
import { useConfirm } from './feedback'

export default function SiteHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useSession()
  const { query: searchValue, setQuery } = useSearch()
  const { mode, setMode, adultContentEnabled } = useContentPolicy()
  const { confirm } = useConfirm()
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)
  const mobileSearchTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const isHome = location.pathname === '/'

  const name = user?.displayName || user?.username || ''
  const avatarUrl = user?.avatarUrl ? url(user.avatarUrl) : ''
  const showAvatar = !!avatarUrl && !avatarFailed
  const isAdmin = user?.role === 'admin'

  function submitSearch(query: string) {
    const q = query.trim()
    setQuery(q)
    if (q) navigate(`/?q=${encodeURIComponent(q)}`, { replace: isHome })
    else if (isHome) navigate('/', { replace: true })
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

  function closeMenu() {
    setMenuOpen(false)
  }

  async function toggleContentMode() {
    // 侧边栏层级高于确认弹窗；先收束，避免遮挡确认按钮。
    setMenuOpen(false)
    if (mode === 'adult') {
      setMode('safe')
      return
    }
    const confirmed = await confirm({
      title: '显示限制级内容？',
      message: '仅限年满 18 岁的用户查看限制级内容。此设置会同步到你的账号。',
      okText: '确认查看',
      cancelText: '暂不查看',
    })
    if (confirmed) setMode('adult')
  }

  return (
    <>
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
                ref={mobileSearchTriggerRef}
                type="button"
                className="mobile-search-trigger"
                aria-label="搜索"
                aria-haspopup="dialog"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(true)}
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
              <Link to="/auth" className="nav-link nav-link--desktop" aria-label="登录" state={{ from: location.pathname }}>
                登录
              </Link>
            )}

            <Link to="/bookshelf" className="nav-link nav-link--desktop">
              我的书架
            </Link>

            {isAdmin && (
              <Link to="/admin" className="nav-link nav-link--desktop">
                管理面板
              </Link>
            )}

            {adultContentEnabled && <button
              type="button"
              className={`content-mode-btn content-mode-btn--desktop${mode === 'adult' ? ' content-mode-btn--adult' : ''}`}
              aria-label={mode === 'safe' ? '内容安全模式，点击显示限制级内容' : '成人内容模式，点击隐藏限制级内容'}
              aria-pressed={mode === 'adult'}
              title={mode === 'safe' ? '安全模式：限制级内容已隐藏' : '成人内容模式：点击切回安全模式'}
              onClick={toggleContentMode}
            >
              <ShieldIcon />
              <span>{mode === 'safe' ? '安全模式' : '成人内容'}</span>
            </button>}

            <button className="refresh-btn" aria-label="刷新页面" title="刷新页面" onClick={refresh}>
              <RefreshIcon />
            </button>

            <ThemeMenu className="theme-btn" ariaLabel="主题设置" title="主题设置" />

            <button
              ref={mobileMenuTriggerRef}
              type="button"
              className="mobile-menu-trigger"
              aria-label="打开菜单"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <MenuIcon />
            </button>
          </div>
        </div>
      </header>

      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="search-overlay" />
          <DialogPrimitive.Content
            className="search-overlay__bar"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              mobileSearchInputRef.current?.focus()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              mobileSearchTriggerRef.current?.focus()
            }}
          >
            <DialogPrimitive.Title className="sr-only">搜索小说</DialogPrimitive.Title>
            <SearchIcon className="search-overlay__icon" />
            <input
              ref={mobileSearchInputRef}
              type="text"
              className="search-overlay__input"
              placeholder="搜索小说…"
              autoComplete="off"
              defaultValue={searchValue}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  submitSearch((e.target as HTMLInputElement).value)
                  setMobileOpen(false)
                }
              }}
            />
            <DialogPrimitive.Close asChild>
              <button type="button" className="search-overlay__close">取消</button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="mobile-drawer-overlay" />
          <DialogPrimitive.Content
            className="mobile-drawer"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              mobileMenuTriggerRef.current?.focus()
            }}
          >
            <DialogPrimitive.Title className="sr-only">导航菜单</DialogPrimitive.Title>
            <div className="mobile-drawer__head">
              <Link to="/" className="header__logo mobile-drawer__brand" onClick={closeMenu}>
                <img className="header__logo-img" src="/images/logo.png" alt="知舟" />
                知舟
              </Link>
              <DialogPrimitive.Close asChild>
                <button type="button" className="mobile-drawer__close" aria-label="关闭菜单">
                  <CloseIcon />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="mobile-drawer__body">
              {user ? (
                <Link to="/profile" className="mobile-drawer__user" onClick={closeMenu}>
                  <span className="mobile-drawer__avatar">
                    {showAvatar ? <img src={avatarUrl} alt={name} /> : <span>{name.slice(0, 1)}</span>}
                  </span>
                  <span className="mobile-drawer__user-text">
                    <span className="mobile-drawer__user-name">{name || '知舟读者'}</span>
                    <span className="mobile-drawer__user-sub">
                      {isAdmin ? '管理员 · ' : ''}@{user.username || 'reader'}
                    </span>
                  </span>
                  <ChevronIcon className="mobile-drawer__chevron" />
                </Link>
              ) : (
                <div className="mobile-drawer__guest">
                  <Link to="/auth" className="btn btn--primary mobile-drawer__login" state={{ from: location.pathname }} onClick={closeMenu}>
                    登录 / 注册
                  </Link>
                  <p className="mobile-drawer__guest-hint">登录后同步阅读进度与书架</p>
                </div>
              )}

              <nav className="mobile-drawer__nav" aria-label="站点导航">
                <Link to="/bookshelf" className="mobile-drawer__item" onClick={closeMenu}>
                  <BookIcon />
                  我的书架
                </Link>
                {isAdmin && (
                  <Link to="/admin" className="mobile-drawer__item" onClick={closeMenu}>
                    <ShieldIcon />
                    管理面板
                  </Link>
                )}
                {adultContentEnabled && <button type="button" className="mobile-drawer__item" onClick={toggleContentMode} aria-pressed={mode === 'adult'}>
                  <ShieldIcon />
                  {mode === 'safe' ? '安全模式（已隐藏限制级内容）' : '成人内容模式（点击关闭）'}
                </button>}
                <button className="mobile-drawer__item" onClick={refresh}>
                  <RefreshIcon />
                  刷新页面
                </button>
              </nav>
            </div>

            <footer className="mobile-drawer__foot">知舟 · 安静的中文小说书库</footer>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
