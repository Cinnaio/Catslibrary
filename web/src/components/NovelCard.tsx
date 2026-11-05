import styles from './novel-card.module.css'
/**
 * 小说卡片 —— 左侧封面，右侧集中呈现作品信息。
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Novel } from '@shared/types'
import { coverUrl } from '../lib/cover-url'
import NovelCoverStatus from './NovelCoverStatus'
import { getNovelHistory, isInBookshelf } from '../lib/storage'
import { timeAgo } from '../lib/format'

export default function NovelCard({ novel, variant, category }: { novel: Novel; variant?: 'library'; category?: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  const src = coverUrl(novel)
  const hasCover = !!src && !imgFailed
  const newCount = Math.max(0, (novel.remoteChapterCount || 0) - (novel.chapterCount || 0))
  const read = !!getNovelHistory(novel.id)
  const categories = [...new Set([category, ...novel.categories].filter((value): value is string => !!value))]

  return (
    <Link to={`/novel/${encodeURIComponent(novel.id)}`} className={`${styles.card} novel-card${variant === 'library' ? ' novel-card--library' : ''}`}>
      <div className={`novel-card__cover${hasCover ? '' : ' novel-card__cover--placeholder'}`}>
        {hasCover ? (
          <img src={src} alt={novel.title} loading="lazy" onLoad={() => setImgFailed(false)} onError={() => setImgFailed(true)} />
        ) : variant === 'library' ? (
          <span className="novel-card__cover-typeset" aria-hidden="true">
            <span className="novel-card__cover-title">{novel.title || '书'}</span>
            <span className="novel-card__cover-author">{novel.author}</span>
          </span>
        ) : (
          <span className="novel-card__cover-char">{(novel.title || '书').slice(0, 1)}</span>
        )}
        <NovelCoverStatus updates={newCount} read={read} favorite={isInBookshelf(novel.id)} />
      </div>
      <div className="novel-card__body">
        <div className="novel-card__title" title={novel.title}>{novel.title}</div>
        <div className="novel-card__meta">{novel.author || '未知作者'}</div>
        <div className="novel-card__facts">
          <span>{novel.chapterCount ?? 0} 章</span>
          <span className="novel-card__status">{novel.status === 'completed' ? '已完结' : '连载中'}</span>
        </div>
        <div className="novel-card__desc">{novel.description?.trim() || '暂无简介'}</div>
        <div className="novel-card__footer">
          <span className="novel-card__category" title={categories.join(' · ') || '未分类'}>{categories.join(' · ') || '未分类'}</span>
          {novel.updatedAt ? <span className="novel-card__time">{timeAgo(novel.updatedAt)}</span> : null}
        </div>
      </div>
    </Link>
  )
}
