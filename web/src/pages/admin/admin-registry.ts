/**
 * Admin tab registry — nav data, tab components, shared props, and the
 * active-tab storage key. Extracted from the former Admin.tsx shell so the
 * shell only composes, and the registry stays the single source of truth.
 */
import { lazy, type ComponentType } from 'react'
import {
  BookOpen,
  Bug,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  BarChart3,
  Settings,
  UserCog,
  ListChecks,
  Activity,
  type LucideIcon,
} from 'lucide-react'

// 导航只读取注册表元数据；真正打开模块后才下载其组件和重依赖。
const SourceAnalyticsTab = lazy(() => import('./SourceAnalyticsTab'))
const DashboardTab = lazy(() => import('./DashboardTab'))
const NovelsTab = lazy(() => import('./NovelsTab'))
const ChaptersTab = lazy(() => import('./ChaptersTab'))
const ScrapeTab = lazy(() => import('./scrape'))
const JobsTab = lazy(() => import('./JobsTab'))
const TaskCenterTab = lazy(() => import('./TaskCenterTab'))
const CallsTab = lazy(() => import('./CallsTab'))
const ModerationTab = lazy(() => import('./ModerationTab'))
const AiTab = lazy(() => import('./AiTab'))
const SettingsTab = lazy(() => import('./SettingsTab'))
const ContentRatingsTab = lazy(() => import('./ContentRatingsTab'))
const SiteOperationsTab = lazy(() => import('./SiteOperationsTab'))
const SiteSettingsTab = lazy(() => import('./SiteSettingsTab'))
const BackupsTab = lazy(() => import('./BackupsTab'))

export interface AdminTabProps {
  highlightNovelId?: string
  onHighlightConsumed?: () => void
}

export interface AdminSubTab {
  id: string
  label: string
  to: string
}

export interface AdminNavItem {
  id: string
  label: string
  icon: LucideIcon
  children?: AdminSubTab[]
}

export const NAV_GROUPS: Array<{ label: string; items: AdminNavItem[] }> = [
  {
    label: '工作台',
    items: [{ id: 'dashboard', label: '后台总览', icon: LayoutDashboard }],
  },
  {
    label: '作品',
    items: [
      { id: 'novels', label: '作品库', icon: BookOpen },
      { id: 'chapters', label: '章节管理', icon: FileText },
    ],
  },
  {
    label: '创作',
    items: [
      {
        id: 'scrape',
        label: '导入与抓取',
        icon: Bug,
        children: [
          { id: 'scrape-center', label: '抓取中心', to: `${adminTabPath('scrape')}?view=center` },
          { id: 'scrape-proxy', label: '代理设置', to: `${adminTabPath('scrape')}?view=proxy` },
        ],
      },
      {
        id: 'ai',
        label: '创作工作区',
        icon: Sparkles,
        children: [
          { id: 'ai-writing', label: 'AI 创作', to: `${adminTabPath('ai')}?sub=writing` },
          { id: 'ai-cover', label: '封面生成', to: `${adminTabPath('ai')}?sub=cover` },
          { id: 'ai-content', label: '草稿与产出', to: `${adminTabPath('ai')}?sub=content` },
          { id: 'ai-graph', label: '故事档案', to: `${adminTabPath('ai')}?sub=graph` },
        ],
      },
    ],
  },
  {
    label: '运行',
    items: [
      { id: 'tasks', label: '任务中心', icon: ListChecks },
      { id: 'calls', label: '调用与用量', icon: Activity },
      { id: 'source-analytics', label: '书源与追更', icon: BarChart3 },
    ],
  },
  {
    label: '内容治理',
    items: [
      {
        id: 'moderation',
        label: '内容审核',
        icon: MessageSquare,
        children: [
          { id: 'moderation-queue', label: '审核队列', to: adminTabPath('moderation') },
          { id: 'content-ratings', label: '分级管理', to: adminTabPath('content-ratings') },
        ],
      },
    ],
  },
  {
    label: '系统',
    items: [
      {
        id: 'backups',
        label: '备份与恢复',
        icon: Settings,
        children: [
          { id: 'backups-versions', label: '备份版本', to: `${adminTabPath('backups')}?view=versions` },
          { id: 'backups-targets', label: '存储目标', to: `${adminTabPath('backups')}?view=targets` },
          { id: 'backups-schedule', label: '自动备份', to: `${adminTabPath('backups')}?view=schedule` },
          { id: 'backups-logs', label: '操作日志', to: `${adminTabPath('backups')}?view=logs` },
          { id: 'backups-settings', label: '备份设置', to: `${adminTabPath('backups')}?view=settings` },
        ],
      },
      {
        id: 'site-operations',
        label: '站点运营',
        icon: BarChart3,
        children: [{ id: 'site-traffic', label: '流量分析', to: `${adminTabPath('site-operations')}?view=traffic` }],
      },
      {
        id: 'settings',
        label: '账户与注册',
        icon: UserCog,
        children: [
          { id: 'settings-users', label: '用户管理', to: `${adminTabPath('settings')}?view=users` },
          { id: 'settings-registration', label: '注册与邀请码', to: `${adminTabPath('settings')}?view=registration` },
          { id: 'settings-audit', label: '登录审计', to: `${adminTabPath('settings')}?view=audit` },
          { id: 'settings-operation-audit', label: '操作审计', to: `${adminTabPath('settings')}?view=operation-audit` },
        ],
      },
      {
        id: 'site-settings',
        label: '站点设置',
        icon: Settings,
        children: [
          { id: 'site-settings-branding', label: '站点信息', to: `${adminTabPath('site-settings')}?view=branding` },
          { id: 'content-policy', label: '内容安全', to: `${adminTabPath('site-settings')}?view=content-policy` },
          { id: 'site-settings-security', label: '安全验证', to: `${adminTabPath('site-settings')}?view=security` },
          { id: 'site-settings-passkey', label: 'Passkey', to: `${adminTabPath('site-settings')}?view=passkey` },
          { id: 'ai-config', label: '模型与服务', to: `${adminTabPath('ai')}?sub=config` },
          { id: 'ai-params', label: '创作参数', to: `${adminTabPath('ai')}?sub=params` },
        ],
      },
    ],
  },
]

export const TABS = NAV_GROUPS.flatMap((group) => group.items)

export const TAB_COMPONENTS = {
  dashboard: DashboardTab,
  'source-analytics': SourceAnalyticsTab,
  novels: NovelsTab,
  chapters: ChaptersTab,
  scrape: ScrapeTab,
  jobs: JobsTab,
  tasks: TaskCenterTab,
  calls: CallsTab,
  moderation: ModerationTab,
  ai: AiTab,
  'content-policy': SiteSettingsTab,
  'content-ratings': ContentRatingsTab,
  'site-operations': SiteOperationsTab,
  'site-settings': SiteSettingsTab,
  settings: SettingsTab,
  backups: BackupsTab,
} satisfies Record<string, ComponentType<AdminTabProps>>

export const TAB_KEY = 'admin_active_tab'

export function isAdminTab(id: string | undefined): id is keyof typeof TAB_COMPONENTS {
  return !!id && Object.hasOwn(TAB_COMPONENTS, id)
}

export function adminTabPath(id: string): string {
  return `/admin/${encodeURIComponent(id)}`
}

export function getTabLabel(id: string): string {
  return (
    TABS.find((t) => t.id === id)?.label ||
    NAV_GROUPS.flatMap((group) => group.items.flatMap((item) => item.children || [])).find((sub) => sub.id === id)?.label ||
    ''
  )
}

/** Resolve the visible subview, including AI configuration placed in the system navigation. */
export function getAdminViewLabel(id: string, search: string): string {
  const current = new URLSearchParams(search)
  for (const child of NAV_GROUPS.flatMap(group => group.items.flatMap(item => item.children || []))) {
    const target = new URL(child.to, 'https://workspace.local')
    if (target.pathname === adminTabPath(id) && [...target.searchParams].every(([key, value]) => current.get(key) === value)) return child.label
  }
  return getTabLabel(id)
}
