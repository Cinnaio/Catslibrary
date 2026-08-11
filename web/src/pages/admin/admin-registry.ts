/**
 * Admin tab registry — nav data, tab components, shared props, and the
 * active-tab storage key. Extracted from the former Admin.tsx shell so the
 * shell only composes, and the registry stays the single source of truth.
 */
import type { ComponentType } from 'react'
import {
  BookOpen,
  Bug,
  Clock,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import DashboardTab from './DashboardTab'
import NovelsTab from './NovelsTab'
import ChaptersTab from './ChaptersTab'
import ScrapeTab from './scrape'
import JobsTab from './JobsTab'
import ModerationTab from './ModerationTab'
import AiTab from './AiTab'
import SettingsTab from './SettingsTab'

export interface AdminTabProps {
  highlightNovelId?: string
  onHighlightConsumed?: () => void
}

export const NAV_GROUPS: Array<{ label: string; items: Array<{ id: string; label: string; icon: LucideIcon }> }> = [
  {
    label: '监控',
    items: [
      { id: 'dashboard', label: '总览', icon: LayoutDashboard },
      { id: 'jobs', label: '任务管理', icon: Clock },
    ],
  },
  {
    label: '内容',
    items: [
      { id: 'novels', label: '小说管理', icon: BookOpen },
      { id: 'chapters', label: '章节管理', icon: FileText },
      { id: 'moderation', label: '内容审核', icon: MessageSquare },
    ],
  },
  {
    label: '采集',
    items: [{ id: 'scrape', label: '爬虫抓取', icon: Bug }],
  },
  {
    label: '系统',
    items: [
      { id: 'ai', label: 'AI 服务', icon: Sparkles },
      { id: 'settings', label: '账户与注册', icon: UserCog },
    ],
  },
]

export const TABS = NAV_GROUPS.flatMap((group) => group.items)

export const TAB_COMPONENTS: Record<string, ComponentType<AdminTabProps>> = {
  dashboard: DashboardTab,
  novels: NovelsTab,
  chapters: ChaptersTab,
  scrape: ScrapeTab,
  jobs: JobsTab,
  moderation: ModerationTab,
  ai: AiTab,
  settings: SettingsTab,
}

export const TAB_KEY = 'admin_active_tab'

export function getTabLabel(id: string): string {
  return TABS.find((t) => t.id === id)?.label || ''
}
