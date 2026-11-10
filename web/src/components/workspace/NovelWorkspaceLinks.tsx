import { Link } from 'react-router-dom'
import { BookOpen, FileText, Image, MessageSquare, Network, Sparkles } from 'lucide-react'
import styles from './novel-workspace-links.module.css'

/** Navigation only: each destination retains its own access checks and data loading. */
export default function NovelWorkspaceLinks({ novelId, title }: { novelId: string; title: string }) {
  const id = encodeURIComponent(novelId)
  return (
    <nav className={styles.links} aria-label={`${title}的作品工作区`}>
      <span>作品工作区</span>
      {[
        { to: `/admin/chapters?novelId=${id}`, label: '章节管理', icon: BookOpen },
        { to: `/admin/ai?sub=agent&novel=${id}`, label: '对话创作', icon: MessageSquare },
        { to: `/admin/ai?sub=writing&view=analysis&novel=${id}`, label: '分析报告', icon: FileText },
        { to: `/admin/ai?sub=writing&novel=${id}`, label: 'AI 创作', icon: Sparkles },
        { to: `/admin/ai?sub=cover&novel=${id}`, label: '封面', icon: Image },
        { to: `/admin/ai?sub=graph&novel=${id}`, label: '故事档案', icon: Network },
        { to: `/admin/ai?sub=content&novel=${id}`, label: '草稿与产出', icon: FileText },
      ].map((item) => (
        <Link key={item.label} to={item.to}>
          <item.icon size={15} aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
