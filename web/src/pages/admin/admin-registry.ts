/**
 * Admin tab registry — nav data, tab components, shared props, and the
 * active-tab storage key. Extracted from the former Admin.tsx shell so the
 * shell only composes, and the registry stays the single source of truth.
 */
import type { ComponentType } from 'react'
import { BookOpen, Bug, Activity, FileText, LayoutDashboard, MessageSquare, Sparkles, BarChart3, UserCog, type LucideIcon } from 'lucide-react'
import DashboardTab from './DashboardTab'
import NovelsTab from './NovelsTab'
import ChaptersTab from './ChaptersTab'
import ScrapeTab from './scrape'
import JobsTab from './JobsTab'
import ModerationTab from './ModerationTab'
import AiTab from './AiTab'
import SettingsTab from './SettingsTab'
import ContentPolicyTab from './ContentPolicyTab'
import SiteOperationsTab from './SiteOperationsTab'
import MobileTelemetryTab from './MobileTelemetryTab'

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
    label: '监控',
    items: [
      { id: 'dashboard', label: '总览', icon: LayoutDashboard },
      { id: 'mobile-telemetry', label: '客户端监控', icon: Activity },
    ],
  },
  {
    label: '内容库',
    items: [
      { id: 'novels', label: '小说管理', icon: BookOpen },
      { id: 'chapters', label: '章节管理', icon: FileText },
    ],
  },
  {
    label: '内容生产',
    items: [
      {
        id: 'scrape',
        label: '爬虫抓取',
        icon: Bug,
        children: [
          { id: 'scrape-center', label: '抓取中心', to: `${adminTabPath('scrape')}?view=center` },
          { id: 'scrape-sources', label: '书源管理', to: `${adminTabPath('scrape')}?view=sources` },
          { id: 'jobs', label: '任务队列', to: adminTabPath('jobs') },
          { id: 'scrape-proxy', label: '代理设置', to: `${adminTabPath('scrape')}?view=proxy` },
        ],
      },
      {
        id: 'ai',
        label: 'AI 服务',
        icon: Sparkles,
        children: [
          { id: 'ai-writing', label: 'AI 创作', to: `${adminTabPath('ai')}?sub=writing` },
          { id: 'ai-cover', label: '封面生成', to: `${adminTabPath('ai')}?sub=cover` },
          { id: 'ai-tasks', label: 'AI 任务', to: `${adminTabPath('ai')}?sub=tasks` },
          { id: 'ai-content', label: '已生成内容', to: `${adminTabPath('ai')}?sub=content` },
          { id: 'ai-usage', label: '用量统计', to: `${adminTabPath('ai')}?sub=usage` },
          { id: 'ai-audit', label: '调用审计', to: `${adminTabPath('ai')}?sub=audit` },
          { id: 'ai-config', label: '配置', to: `${adminTabPath('ai')}?sub=config` },
          { id: 'ai-params', label: '参数调优', to: `${adminTabPath('ai')}?sub=params` },
        ],
      },
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
          { id: 'content-policy', label: '安全策略', to: adminTabPath('content-policy') },
        ],
      },
    ],
  },
  {
    label: '平台运营',
    items: [
      {
        id: 'site-operations',
        label: '站点运营',
        icon: BarChart3,
        children: [
          { id: 'site-overview', label: '运营概览', to: `${adminTabPath('site-operations')}?view=overview` },
          { id: 'site-traffic', label: '流量分析', to: `${adminTabPath('site-operations')}?view=traffic` },
          { id: 'site-content', label: '内容分析', to: `${adminTabPath('site-operations')}?view=content` },
        ],
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
    ],
  },
]

export const TABS = NAV_GROUPS.flatMap((group) => group.items)

export const TAB_COMPONENTS = {
  dashboard: DashboardTab,
  novels: NovelsTab,
  chapters: ChaptersTab,
  scrape: ScrapeTab,
  jobs: JobsTab,
  moderation: ModerationTab,
  ai: AiTab,
  'content-policy': ContentPolicyTab,
  'site-operations': SiteOperationsTab,
  'mobile-telemetry': MobileTelemetryTab,
  settings: SettingsTab,
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
