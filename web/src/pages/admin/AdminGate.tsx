/**
 * AdminGate — 后台鉴权门。
 * 会话解析中显示加载态；未登录或非管理员显示整页门禁；其余渲染 children。
 *
 * 门禁使用共享 PageState，不渲染运营台或公开导航；后台表格空态不属于此模式。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LoaderCircle, ShieldAlert } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { setupApi } from '../../lib/api'
import PageState from '../../components/PageState'

export default function AdminGate({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [switching, setSwitching] = useState(false)
  // 未安装时不显示「创建管理员」入口；已就绪的实例上它是误导。
  const [needsBootstrap, setNeedsBootstrap] = useState(false)

  const isAdmin = Boolean(user && user.role === 'admin')

  /**
   * 只在拦截分支写标题，且不设 cleanup。
   * 进入后台时由 AdminShell 写页签标题；若此处也写（或无 cleanup 地写回默认值），
   * 父子 effect 的执行顺序会让门禁标题覆盖后台标题，浏览器标签会显示错的名字。
   * 条件写入与顺序无关：谁真正可见，谁就拥有标题。
   */
  useEffect(() => {
    if (!loading && !isAdmin) document.title = '需要管理员身份 · 知舟'
  }, [loading, isAdmin])

  // 仅探测引导状态，失败时静默（门禁页不应因探测失败而报错）。
  useEffect(() => {
    if (loading || isAdmin) return
    let alive = true
    void setupApi
      .status()
      .then((r) => {
        if (alive) setNeedsBootstrap(Boolean(r.needsBootstrap))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [loading, isAdmin])

  /**
   * 切换账号：先登出再进 /auth。
   * Auth.tsx 检测到「已登录」会立刻回跳来源页，若把已登录用户直接送过去，
   * 非管理员会被弹回 /admin 再次撞上门禁，形成无法切换的死循环。
   * 用命令式导航而非 <Link asChild>：必须在会话真正清理后再跳转，
   * 且 Button 的 disabled 对 asChild 渲染出的 <a> 不生效。
   */
  async function goToAuth() {
    if (switching) return
    const from = `${location.pathname}${location.search}`
    setSwitching(true)
    try {
      await logout()
    } catch {
      // 登出接口失败也应继续；本地 token 已被清理，视为已退出。
    }
    navigate('/auth', { state: { from }, replace: true })
  }

  if (loading) {
    return (
      <main className="auth-page">
        <div className="auth-shell">
          <div className="admin-gate-loading" role="status" aria-live="polite">
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">正在校验管理员身份</span>
          </div>
        </div>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <PageState
        title="需要管理员身份"
        icon={<ShieldAlert strokeWidth={1.5} />}
        description={user ? `当前账号「${user.displayName || user.username}」没有管理权限，请切换到管理员账号。` : '需要管理员账号才能进入运营台。'}
        actions={<>
          <button type="button" className="btn btn--primary" disabled={switching} onClick={() => void goToAuth()}>
            {switching ? '正在退出…' : user ? '切换账号' : '前往登录'}
          </button>
          <Link to="/" className="btn btn--secondary">返回首页</Link>
        </>}
      >
        <p className="page-state__hint">这是受限区域，登录后会自动回到你刚才打开的页面。</p>
        {needsBootstrap && <p className="page-state__hint"><Link to="/install">首次使用？创建管理员</Link></p>}
      </PageState>
    )
  }

  return <>{children}</>
}
