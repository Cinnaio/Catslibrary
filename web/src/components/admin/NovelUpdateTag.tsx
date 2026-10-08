import { LockKeyhole } from 'lucide-react'
import type { Novel } from '@shared/types'
import { pendingUpdateDisplay } from '@shared/novel-updates'
import { timeAgo } from '@/lib/format'

export default function NovelUpdateTag({ novel }: { novel: Novel }) {
  const { total, protectedCount, allProtected, unknown } = pendingUpdateDisplay(novel)
  if (!total) return null
  const title = `源站 ${novel.remoteChapterCount || 0} 章 / 本地 ${novel.chapterCount || 0} 章${novel.updateCheckedAt ? `，检查于 ${timeAgo(novel.updateCheckedAt)}` : ''}`
  return (
    <span className="novel-update-indicator" title={title}>
      {allProtected ? (
        <span className="novel-update-protection">
          <LockKeyhole aria-hidden="true" />
          受保护 {protectedCount} 章
        </span>
      ) : (
        <>
          <span className="novel-update-tag">待更新 {total} 章</span>
          {protectedCount > 0 && (
            <span className="novel-update-protection">
              <LockKeyhole aria-hidden="true" />
              含受保护 {protectedCount} 章
            </span>
          )}
          {unknown && <span className="novel-update-unknown">保护状态待检查</span>}
        </>
      )}
    </span>
  )
}
