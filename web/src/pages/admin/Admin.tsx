/**
 * 管理后台外壳 —— shadcn Sidebar 侧边栏 + 8 个 tab + 管理员鉴权门（shadcn Card）。
 * 保留：admin_active_tab localStorage 持久化、highlightNovelId sessionStorage 高亮、
 * 主题切换（startViewTransition）、TAB_KEY export。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Braces,
  Bug,
  Clock,
  FileText,
  Home,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Sun,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { useTheme } from '../../context/ThemeContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import DashboardTab from './DashboardTab'
import NovelsTab from './NovelsTab'
import ChaptersTab from './ChaptersTab'
import ScrapeTab from './ScrapeTab'
import JobsTab from './JobsTab'
import ModerationTab from './ModerationTab'
import SettingsTab from './SettingsTab'
import RulesTab from './RulesTab'

const TABS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: '总览', icon: LayoutDashboard },
  { id: 'novels', label: '小说管理', icon: BookOpen },
  { id: 'chapters', label: '章节管理', icon: FileText },
  { id: 'scrape', label: '爬虫抓取', icon: Bug },
  { id: 'jobs', label: '任务管理', icon: Clock },
  { id: 'moderation', label: '内容审核', icon: MessageSquare },
  { id: 'settings', label: '账户与注册', icon: UserCog },
  { id: 'rules', label: '解析规则', icon: Braces },
]

export interface AdminTabProps {
  highlightNovelId?: string
  onHighlightConsumed?: () => void
}

const TAB_COMPONENTS: Record<string, React.ComponentType<AdminTabProps>> = {
  dashboard: DashboardTab,
  novels: NovelsTab,
  chapters: ChaptersTab,
  scrape: ScrapeTab,
  jobs: JobsTab,
  moderation: ModerationTab,
  settings: SettingsTab,
  rules: RulesTab,
}

const TAB_KEY = 'admin_active_tab'

export default function Admin() {
  const { user, loading } = useSession()
  const { theme, toggleTheme } = useTheme()
  const [active, setActive] = useState<string>(() => localStorage.getItem(TAB_KEY) || 'dashboard')

  // 激活 tab 持久化（与原版 admin_active_tab 一致）
  useEffect(() => {
    localStorage.setItem(TAB_KEY, active)
  }, [active])

  // 从小说详情页「管理」跳转：聚焦 novels tab 并高亮目标行
  const [highlightNovelId, setHighlightNovelId] = useState<string>(() => {
    try {
      return sessionStorage.getItem('adminEditNovel') ? (JSON.parse(sessionStorage.getItem('adminEditNovel')!) as { id?: string }).id || '' : ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    if (highlightNovelId) {
      sessionStorage.removeItem('adminEditNovel')
      setActive('novels')
    }
  }, [highlightNovelId])

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  // 未登录或非管理员 → 鉴权门
  if (!user || user.role !== 'admin') {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-2xl">
              舟
            </div>
            <div>
              <h1 className="text-xl font-semibold">知舟</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {user ? '当前账号没有管理权限' : '请先登录管理员账号'}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button asChild>
                <Link to="/auth">{user ? '切换账号' : '前往登录'}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/">← 返回首页</Link>
              </Button>
            </div>
            <Link to="/install" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              首次使用？创建管理员 →
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  const TabComponent = TAB_COMPONENTS[active] || DashboardTab
  const activeLabel = TABS.find((t) => t.id === active)?.label || ''

  return (
    <SidebarProvider className="admin-layout">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                  舟
                </span>
                <span className="text-sm font-semibold">知舟 · 管理面板</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {TABS.map((tab) => (
                  <SidebarMenuItem key={tab.id}>
                    <SidebarMenuButton
                      isActive={active === tab.id}
                      tooltip={tab.label}
                      onClick={() => setActive(tab.id)}
                    >
                      <tab.icon />
                      <span>{tab.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="回主页">
                <Link to="/">
                  <Home />
                  <span>回主页</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={toggleTheme} tooltip="切换主题">
                {theme === 'dark' ? <Sun /> : <Moon />}
                <span>{theme === 'dark' ? '切换浅色' : '切换暗色'}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="admin-layout__inset min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-sm font-medium">{activeLabel}</span>
        </header>
        <main className="admin-layout__content min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6">
          <TabComponent highlightNovelId={highlightNovelId} onHighlightConsumed={() => setHighlightNovelId('')} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export { TAB_KEY }
