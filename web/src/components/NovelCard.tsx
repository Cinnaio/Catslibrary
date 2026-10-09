/**
 * 小说卡片 —— 由 home.js renderNovels 平移。封面左侧横排卡片。
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Novel } from '@shared/types'
import { url } from '../lib/api'
import NovelCoverStatus from './NovelCoverStatus'
import { getNovelHistory, isInBookshelf } from '../lib/storage'
import { timeAgo } from '../lib/format'

/** 封面 URL：优先本地 cover 端点；demo 数据无封面。 */
export function coverUrl(novel: { id: string; updatedAt?: number }): string {
  if (!novel.id || novel.id.startsWith('demo_')) return ''
  return url(`/cover/${encodeURIComponent(novel.id)}?v=${encodeURIComponent(novel.updatedAt || 0)}&cover=2`)
}

export default function NovelCard({ novel, variant, category }: { novel: Novel; variant?: 'library'; category?: string }) {
  const [imgFailed, setImgFailed] = useState(false)
  const src = coverUrl(novel)
  const hasCover = !!src && !imgFailed
  const newCount = Math.max(0, (novel.remoteChapterCount || 0) - (novel.chapterCount || 0))
  const read = !!getNovelHistory(novel.id)

  return (
    <Link to={`/novel/${encodeURIComponent(novel.id)}`} className={`novel-card${variant === 'library' ? ' novel-card--library' : ''}`}>
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
        <div className="novel-card__title">{novel.title}</div>
        <div className="novel-card__meta">{variant === 'library' ? novel.author : `作者：${novel.author}`}</div>
        {variant === 'library' ? (
          <div className="novel-card__facts">
            <span className="novel-card__status">{novel.status === 'completed' ? '已完结' : '连载中'}</span>
            {novel.chapterCount ? <span>{novel.chapterCount} 章</span> : null}
          </div>
        ) : (
          <div className="novel-card__meta">
            {novel.status === 'completed' ? '已完结' : '连载中'}
            {novel.chapterCount ? ` · ${novel.chapterCount} 章` : ''}
          </div>
        )}
        <div className="novel-card__desc">{novel.description || '暂无简介'}</div>
        {variant === 'library' ? (
          <div className="novel-card__footer">
            {category && <span className="novel-card__category">{category}</span>}
            {novel.updatedAt ? <span className="novel-card__time">{timeAgo(novel.updatedAt)}</span> : null}
          </div>
        ) : novel.updatedAt ? (
          <div className="novel-card__time">{timeAgo(novel.updatedAt)}</div>
        ) : null}
      </div>
    </Link>
  )
}
