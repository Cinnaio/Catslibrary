/**
 * 站点页头 —— 由 Novel-KV index.html/novel.html 的 header 结构平移。
 * 首页搜索由 Home 的中央搜索框承担；账户、主题和导航使用共享组件。
 * 移动端导航收进右侧抽屉（我的书架/管理面板/登录），页头只留紧凑图标按钮，
 * 避免窄屏上一行挤满文字链接。
 * 注意：导航抽屉必须渲染在 <header> 外 —— 非首页的 .header 有
 * backdrop-filter，会把 position: fixed 后代的包含块收进页头，导致遮罩只盖住页头一条。
 */
import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useSession } from '../context/SessionContext'
import { useContentPolicy } from '../context/ContentPolicyContext'
import { BookIcon, ChevronIcon, CloseIcon, MenuIcon, MoonIcon, ShieldIcon, SunIcon } from './icons'
import { ThemeMenu } from './ThemeMenu'
import { useToast } from './feedback'
import { AccountMenu } from './AccountMenu'
import { useSiteBranding } from '../lib/site-branding'

export default function SiteHeader() {
  const branding = useSiteBranding()
  const location = useLocation()
  const { user } = useSession()
  const { mode, setMode, adultContentEnabled } = useContentPolicy()
  const { toast } = useToast()
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const isHome = location.pathname === '/'

  const name = user?.displayName || user?.username || ''
  const isAdmin = user?.role === 'admin'

  function closeMenu() {
    setMenuOpen(false)
  }

  async function toggleContentMode() {
    // 侧边栏层级高于确认弹窗；先收束，避免遮挡确认按钮。
    setMenuOpen(false)
    if (mode === 'adult') {
      await setMode('safe').catch(() => toast('本地已切回安全模式，但服务端撤销失败，请检查网络后重试', 'error'))
      return
    }
    if (user) await setMode('adult')
  }

  return (
    <>
      <header className={`header${isHome ? ' header--home' : (['/bookshelf', '/profile'].includes(location.pathname) || location.pathname.startsWith('/novel/')) ? ' header--paper' : ''}`}>
        <div className="header__inner">
          <Link to="/" className="header__logo">
            <img className="header__logo-img" src={branding.logoUrl} alt="" />
            <span>{branding.name}</span>
          </Link>

          <div className="header__actions">
            {user ? (
              <AccountMenu variant="site" />
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

            {user && adultContentEnabled && (
              <button
                type="button"
                className={`content-mode-btn content-mode-btn--desktop${mode === 'adult' ? ' content-mode-btn--adult' : ''}`}
                aria-label={mode === 'safe' ? '内容安全模式，点击显示限制级内容' : '成人内容模式，点击隐藏限制级内容'}
                aria-pressed={mode === 'adult'}
                title={mode === 'safe' ? '安全模式：限制级内容已隐藏' : '成人内容模式：点击切回安全模式'}
                onClick={toggleContentMode}
              >
                <ShieldIcon />
                <span>{mode === 'safe' ? '安全模式' : '成人内容'}</span>
              </button>
            )}

            <ThemeMenu
              className="theme-btn"
              ariaLabel="主题设置"
              title="主题设置"
              mobileChildren={
                <>
                  <SunIcon />
                  <MoonIcon />
                </>
              }
            />

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
                <img className="header__logo-img" src={branding.logoUrl} alt="" />
                <span>{branding.name}</span>
              </Link>
              <DialogPrimitive.Close asChild>
                <button type="button" className="mobile-drawer__close" aria-label="关闭菜单">
                  <CloseIcon />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="mobile-drawer__body">
              {user ? (
                <div className="mobile-drawer__user">
                  <AccountMenu variant="mobile" wrapperClassName="mobile-drawer__account-menu" onNavigate={closeMenu} />
                  <Link to="/profile" className="mobile-drawer__user-main" onClick={closeMenu}>
                    <span className="mobile-drawer__user-text">
                      <span className="mobile-drawer__user-name">{name || `${branding.name}读者`}</span>
                      <span className="mobile-drawer__user-sub">
                        {isAdmin ? '管理员 · ' : ''}@{user.username || 'reader'}
                      </span>
                    </span>
                    <ChevronIcon className="mobile-drawer__chevron" />
                  </Link>
                </div>
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
                {user && adultContentEnabled && (
                  <button type="button" className="mobile-drawer__item" onClick={toggleContentMode} aria-pressed={mode === 'adult'}>
                    <ShieldIcon />
                    {mode === 'safe' ? '安全模式（已隐藏限制级内容）' : '成人内容模式（点击关闭）'}
                  </button>
                )}
              </nav>
            </div>

            <footer className="mobile-drawer__foot">{branding.name} · {branding.tagline}</footer>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
