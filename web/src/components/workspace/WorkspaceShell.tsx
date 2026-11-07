import { MotionPresence } from '@/components/ui/motion'
import { isAdministrator } from '@shared/roles'
import '@/styles/input-fields.css'
import '@/styles/site-branding.css'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Dialog, Switch } from 'radix-ui'
import { ArrowUpRight, BookOpen, ChevronDown, History, Library, LogOut, Menu, Search, Settings2, Shield, X, type LucideIcon } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { useContentPolicy } from '../../context/ContentPolicyContext'
import { useSiteBranding } from '../../lib/site-branding'
import { useToast } from '../feedback'
import { AccountMenu } from '../AccountMenu'
import { ThemeMenu } from '../ThemeMenu'
import { UserAvatar } from "@/components/identity/UserAvatar"
import SiteNotice from '../SiteNotice'
import styles from './workspace-shell.module.css'

export interface WorkspaceNavItem {
  id: string
  label: string
  to: string
  icon: LucideIcon
  children?: Array<{ id: string; label: string; to: string }>
}
export interface WorkspaceNavGroup {
  label: string
  items: WorkspaceNavItem[]
}
const readerGroups: WorkspaceNavGroup[] = [
  {
    label: '阅读空间',
    items: [
      { id: 'library', label: '全部书库', to: '/', icon: Library },
      { id: 'shelf', label: '我的书架', to: '/bookshelf', icon: BookOpen },
      { id: 'history', label: '阅读记录', to: '/bookshelf?view=recent', icon: History },
    ],
  },
]

function selectedPath(to: string, pathname: string, search: string) {
  const target = new URL(to, 'https://workspace.local')
  if (target.pathname !== pathname) return false
  const current = new URLSearchParams(search)
  if (!target.search && target.pathname === '/bookshelf') return current.get('view') !== 'recent'
  return [...target.searchParams].every(([key, value]) => current.get(key) === value)
}

function Navigation({ groups, onNavigate }: { groups: WorkspaceNavGroup[]; onNavigate?: () => void }) {
  const { pathname, search } = useLocation()
  const navigationId = useId()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  return (
    <nav className={styles.navigation} aria-label="工作区导航">
      {groups.map((group) => (
        <section className={styles.navGroup} key={group.label}>
          <h2>{group.label}</h2>
          {group.items.map((item) => {
            const active = item.children?.some((child) => selectedPath(child.to, pathname, search)) || selectedPath(item.to, pathname, search)
            const isOpen = expanded[item.id] ?? active
            return (
              <div key={item.id} className={styles.navEntry}>
                <div className={styles.navRow}>
                  <Link
                    to={item.to}
                    className={styles.navLink}
                    data-active={active || undefined}
                    aria-current={active && !item.children ? 'page' : undefined}
                    onClick={() => {
                      if (item.children) setExpanded((previous) => ({ ...previous, [item.id]: true }))
                      onNavigate?.()
                    }}
                  >
                    <item.icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                  {item.children && (
                    <button
                      type="button"
                      className={styles.expand}
                      aria-label={`${isOpen ? '收起' : '展开'}${item.label}`}
                      aria-expanded={isOpen}
                      aria-controls={`${navigationId}-${item.id}`}
                      onClick={() => setExpanded((previous) => ({ ...previous, [item.id]: !isOpen }))}
                    >
                      <ChevronDown size={14} data-open={isOpen} />
                    </button>
                  )}
                </div>
                {item.children && (
                  <MotionPresence asChild open={isOpen} mode="disclosure" keepMounted><div id={`${navigationId}-${item.id}`} className={styles.subnav}>
                    {item.children.map((child, index) => {
                      const childActive =
                        selectedPath(child.to, pathname, search) ||
                        (index === 0 && pathname === new URL(item.to, 'https://workspace.local').pathname && !new URLSearchParams(search).size)
                      return (
                        <Link
                          to={child.to}
                          key={child.id}
                          data-active={childActive || undefined}
                          aria-current={childActive ? 'page' : undefined}
                          onClick={onNavigate}
                        >
                          {child.label}
                        </Link>
                      )
                    })}
                  </div></MotionPresence>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </nav>
  )
}

export default function WorkspaceShell({
  children,
  groups = readerGroups,
  title,
  admin = false,
  standalone = false,
}: {
  children: ReactNode
  groups?: WorkspaceNavGroup[]
  title?: string
  admin?: boolean
  standalone?: boolean
}) {
  const branding = useSiteBranding()
  const { user, loading, logout } = useSession()
  const { mode, setMode, adultContentEnabled, checking } = useContentPolicy()
  const { toast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [switchingMode, setSwitchingMode] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const logoutPending = useRef(false)
  const [floating, setFloating] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const pageTitle =
    title ||
    (location.pathname.startsWith('/novel/')
      ? '作品详情'
      : location.pathname === '/profile'
        ? '个人中心'
        : location.pathname === '/bookshelf'
          ? new URLSearchParams(location.search).get('view') === 'recent'
            ? '阅读记录'
            : '我的书架'
          : '全部书库')
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mobile = window.matchMedia('(max-width: 700px)')
    const closeDesktopDrawer = () => {
      if (!mobile.matches) setMenuOpen(false)
    }
    mobile.addEventListener('change', closeDesktopDrawer)
    return () => mobile.removeEventListener('change', closeDesktopDrawer)
  }, [])
  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get('q') || '')
  }, [location.search])
  useEffect(() => {
    let frame = 0
    let compact = false
    const update = () => {
      frame = 0
      compact = window.scrollY > (compact ? 12 : 40)
      setFloating(compact)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      window.removeEventListener('scroll', schedule)
      cancelAnimationFrame(frame)
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k' ||
        standalone ||
        document.querySelector('[role="dialog"]') ||
        location.pathname === '/'
      )
        return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location.pathname, standalone])
  const brand = (
    <Link to="/" className={styles.brand} onClick={() => setMenuOpen(false)}>
      <img src={branding.logoUrl} alt="" width={34} height={34} className="site-logo" />
      <span>
        <strong>{branding.name}</strong>
        <small>{admin ? '作品与创作管理' : '自己的阅读空间'}</small>
      </span>
    </Link>
  )
  async function changeSafeMode(checked: boolean) {
    if (checking || switchingMode) return
    setSwitchingMode(true)
    // 先关闭导航抽屉，再沿用内容策略提供的验证弹窗及授权流程。
    setMenuOpen(false)
    try {
      await setMode(checked ? 'safe' : 'adult')
    } catch (error) {
      toast((error as Error).message || '切换内容模式失败', 'error')
    } finally {
      setSwitchingMode(false)
    }
  }
  const showWorkspaceLink = admin || isAdministrator(user?.role)
  const showContentMode = adultContentEnabled && !!user
  const secondary = (showWorkspaceLink || showContentMode) ? (
    <div className={styles.secondary}>
      {showWorkspaceLink && (
        <Link className={styles.navLink} to={admin ? '/' : '/admin'} onClick={() => setMenuOpen(false)}>
          <Settings2 size={18} aria-hidden="true" />
          <span>{admin ? '返回阅读空间' : '管理工作台'}</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      )}
      {showContentMode && (
        <Switch.Root
          className={`${styles.navLink} ${styles.modeSwitch}`}
          checked={mode === 'safe'}
          onCheckedChange={(checked) => void changeSafeMode(checked)}
          disabled={checking || switchingMode}
          aria-label="安全模式"
          aria-busy={switchingMode}
        >
          <Shield size={18} aria-hidden="true" />
          <span>安全模式</span>
          <span className={styles.switchTrack} aria-hidden="true">
            <Switch.Thumb className={styles.switchThumb} />
          </span>
        </Switch.Root>
      )}
    </div>
  ) : null
  const accountName = user?.displayName || user?.username || `${branding.name}读者`
  const accountHandle = user?.username || user?.id || ''
  async function handleLogout() {
    if (logoutPending.current) return
    logoutPending.current = true
    setLoggingOut(true)
    setMenuOpen(false)
    try {
      await logout()
      navigate('/', { replace: true })
    } catch (error) {
      toast((error as Error).message || '退出登录失败', 'error')
    } finally {
      logoutPending.current = false
      setLoggingOut(false)
    }
  }
  const account = (
    <div className={styles.account}>
      {loading ? (
        <span className={styles.waiting}>正在恢复会话…</span>
      ) : user ? (
        <>
          <Link
            to="/profile"
            className={styles.profileLink}
            onClick={() => setMenuOpen(false)}
            aria-label={`个人中心：${accountName}，@${accountHandle}`}
            aria-current={location.pathname === '/profile' ? 'page' : undefined}
          >
            <UserAvatar name={accountName} src={user.avatarUrl} className={styles.accountAvatar} />
            <span className={styles.accountIdentity}>
              <span className={styles.accountName} title={accountName}>{accountName}</span>
              <span className={styles.accountHandle} title={`@${accountHandle}`}>@{accountHandle}</span>
            </span>
          </Link>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.logoutButton}`}
            aria-label={loggingOut ? '正在退出登录' : '退出登录'}
            title={loggingOut ? '正在退出登录' : '退出登录'}
            disabled={loggingOut}
            aria-busy={loggingOut}
            onClick={() => void handleLogout()}
          >
            <LogOut size={16} aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <Link to="/auth" state={{ from: location.pathname + location.search }} className={styles.login}>
            登录阅读空间
          </Link>
          <ThemeMenu className={`${styles.iconButton} ${styles.themeButton}`} />
        </>
      )}
    </div>
  )
  const shortcuts = admin
    ? groups.flatMap((group) => group.items).filter((item) => ['novels', 'ai', 'tasks', 'dashboard'].includes(item.id))
    : readerGroups[0]?.items || []
  return (
    <div className={styles.shell} data-standalone={standalone || undefined} data-workspace={admin ? 'admin' : 'reader'}>
      {!standalone && (
        <>
          <a href="#workspace-content" className={styles.skip}>
            跳转到内容
          </a>
          <aside className={styles.sidebar}>
            {brand}
            <Navigation groups={groups} />
            {secondary}
            {account}
          </aside>
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <header className={styles.mobileHeader}>
              {brand}
              <div className={styles.mobileHeaderActions}>
                <ThemeMenu className={`${styles.iconButton} ${styles.themeButton}`} />
                <Dialog.Trigger asChild>
                  <button type="button" className={styles.iconButton} aria-label="打开导航">
                    <Menu size={22} />
                  </button>
                </Dialog.Trigger>
              </div>
            </header>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.scrim} />
              <Dialog.Content className={styles.drawer} aria-describedby={undefined}>
                <div className={styles.drawerHeading}>
                  <Dialog.Title className="sr-only">{branding.name}导航</Dialog.Title>
                  {brand}
                  <Dialog.Close asChild>
                    <button type="button" className={styles.iconButton} aria-label="关闭导航">
                      <X size={20} />
                    </button>
                  </Dialog.Close>
                </div>
                <Navigation groups={groups} onNavigate={() => setMenuOpen(false)} />
                {secondary}
                {account}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <nav className={styles.quicknav} aria-label="快捷导航">
            {shortcuts.map((item) => (
              <Link key={item.id} to={item.to} data-active={selectedPath(item.to, location.pathname, location.search) || undefined}>
                <item.icon size={16} />
                {item.label}
              </Link>
            ))}
          </nav>
        </>
      )}
      <div className={styles.main}>
        {!standalone && (
          <>
            <header className={styles.topbar} data-floating={floating} data-home={location.pathname === '/'}>
              <div className={styles.topbarInner}>
                <div className={styles.location}>
                  <span className={styles.intro} aria-hidden={floating}>
                    {admin ? '让作品与创作有条不紊' : '留一段时间，读自己的故事'}
                  </span>
                  <span className={styles.pageTitle} aria-hidden={!floating} title={pageTitle}>
                    {pageTitle}
                  </span>
                </div>
                {location.pathname !== '/' && (
                  <form
                    role="search"
                    className={styles.search}
                    onSubmit={(event) => {
                      event.preventDefault()
                      navigate(query.trim() ? `/?q=${encodeURIComponent(query.trim())}` : '/')
                    }}
                  >
                    <Search size={17} aria-hidden="true" />
                    <input
                      data-inline-search
                      ref={searchRef}
                      aria-label="搜索书库"
                      type="search"
                      placeholder="搜索书名、作者…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      maxLength={200}
                    />
                    <button type="submit">搜索</button>
                  </form>
                )}
                <div className={styles.topbarAccount}>
                  {user && <AccountMenu />}
                  <ThemeMenu className={`${styles.iconButton} ${styles.themeButton}`} />
                </div>
              </div>
            </header>
            <SiteNotice />
          </>
        )}
        <div id="workspace-content" tabIndex={-1} className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  )
}
