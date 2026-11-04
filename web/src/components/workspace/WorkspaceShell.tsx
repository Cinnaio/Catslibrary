import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Dialog } from 'radix-ui'
import { ArrowUpRight, BookOpen, ChevronDown, History, Library, Menu, Search, Settings2, Shield, X, type LucideIcon } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { useContentPolicy } from '../../context/ContentPolicyContext'
import { useSiteBranding } from '../../lib/site-branding'
import { useToast } from '../feedback'
import { AccountMenu } from '../AccountMenu'
import { ThemeMenu } from '../ThemeMenu'
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
                      onClick={() => setExpanded((previous) => ({ ...previous, [item.id]: !isOpen }))}
                    >
                      <ChevronDown size={14} data-open={isOpen} />
                    </button>
                  )}
                </div>
                {item.children && (
                  <div className={styles.subnav} hidden={!isOpen}>
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
                  </div>
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
  const { user, loading } = useSession()
  const { mode, setMode, adultContentEnabled } = useContentPolicy()
  const { toast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
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
      <img src={branding.logoUrl} alt="" width={34} height={34} />
      <span>
        <strong>{branding.name}</strong>
        <small>{admin ? '作品与创作管理' : '自己的阅读空间'}</small>
      </span>
    </Link>
  )
  const secondary = (
    <div className={styles.secondary}>
      {(admin || user?.role === 'admin') && (
        <Link className={styles.navLink} to={admin ? '/' : '/admin'} onClick={() => setMenuOpen(false)}>
          <Settings2 size={18} />
          <span>{admin ? '返回阅读空间' : '管理工作台'}</span>
          <ArrowUpRight size={14} />
        </Link>
      )}
      {user && (
        <Link className={styles.navLink} data-active={location.pathname === '/profile' || undefined} to="/profile" onClick={() => setMenuOpen(false)}>
          <Settings2 size={18} />
          <span>个人中心</span>
        </Link>
      )}
      {adultContentEnabled && user && (
        <button
          className={styles.navLink}
          type="button"
          onClick={async () => {
            setMenuOpen(false)
            try {
              await setMode(mode === 'adult' ? 'safe' : 'adult')
            } catch (error) {
              toast((error as Error).message || '切换内容模式失败', 'error')
            }
          }}
        >
          <Shield size={18} />
          <span>{mode === 'adult' ? '切回安全模式' : '内容访问设置'}</span>
        </button>
      )}
    </div>
  )
  const account = (
    <div className={styles.account}>
      {loading ? (
        <span className={styles.waiting}>正在恢复会话…</span>
      ) : user ? (
        <>
          <AccountMenu variant="admin" onNavigate={() => setMenuOpen(false)} />
          <ThemeMenu className={`${styles.iconButton} ${styles.themeButton}`} />
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
              <Dialog.Trigger asChild>
                <button type="button" className={styles.iconButton} aria-label="打开导航">
                  <Menu size={22} />
                </button>
              </Dialog.Trigger>
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
