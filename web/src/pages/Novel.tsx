/**
 * Novel 详情页 —— hero 信息、章节目录、本地书签、评分与评论。
 * 由 Novel-KV js/novel.js 平移为 React。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ChapterMeta, Comment, Novel, ReadingHistoryEntry } from '@shared/types'
import { chaptersApi, commentsApi, novelsApi, progressApi, ratingsApi, url } from '../lib/api'
import { getNovelBookmarks, getNovelHistory } from '../lib/storage'
import { getDemoNovel } from '../lib/demo'
import { formatDate, timeAgo } from '../lib/format'
import { useSession } from '../context/SessionContext'
import { useBookshelf } from '../hooks/useBookshelf'
import { useToast, useConfirm } from '../components/feedback'
import { BackToTopIcon, HomeIcon } from '../components/icons'
import CatchupRecap from '../components/CatchupRecap'

interface RatingSummary {
  average: number
  count: number
  distribution: Record<number, number>
  myRating: number | null
}

interface ServerProgress {
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  updatedAt: number
}

function isLocalDev(): boolean {
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')
}

function getBestProgress(server: ServerProgress | null, local: ReadingHistoryEntry | null) {
  if (server?.chapterId) {
    if (!local || (server.updatedAt || 0) >= (local.timestamp || 0)) return server
  }
  return local?.chapterId ? local : null
}

/** 最近一次阅读时间戳：服务端用 updatedAt，本地历史用 timestamp。 */
function lastReadAt(progress: ReadingHistoryEntry | ServerProgress | null): number {
  if (!progress) return 0
  return 'updatedAt' in progress ? progress.updatedAt || 0 : progress.timestamp || 0
}

export default function Novel() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [novel, setNovel] = useState<Novel | null>(null)
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [serverProgress, setServerProgress] = useState<ServerProgress | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descOverflows, setDescOverflows] = useState(false)

  const descRef = useRef<HTMLDivElement>(null)
  const { inShelf, toggle } = useBookshelf(id)

  // 评论
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsTotal, setCommentsTotal] = useState(0)
  const [commentsOffset, setCommentsOffset] = useState(0)
  const [sort, setSort] = useState('latest')
  const [rating, setRating] = useState<RatingSummary | null>(null)
  const [commentBox, setCommentBox] = useState<string>('')
  const [spoiler, setSpoiler] = useState(false)

  useEffect(() => {
    document.title = novel ? `${novel.title} — 知舟` : '知舟'
  }, [novel])

  // 描述溢出检测（>3 行显示"展开全部"）
  useEffect(() => {
    if (!descRef.current || descExpanded) return
    const el = descRef.current
    setDescOverflows(el.scrollHeight > el.clientHeight + 2)
  }, [novel, descExpanded])

  const load = useCallback(async () => {
    setLoading(true)
    setNotFound(false)
    try {
      const data = await novelsApi.get(id)
      const n = data.novel
      if (!n) throw new Error('Not found')
      setNovel(n)
      // 阅读进度
      if (user) {
        try {
          const p = (await progressApi.get(id)) as { progress?: ServerProgress | null }
          setServerProgress(p.progress || null)
        } catch {
          /* 本地历史兜底 */
        }
      }
      // 章节
      try {
        const ch = await chaptersApi.list(id)
        setChapters(ch.chapters || [])
      } catch {
        setChapters([])
      }
      setLoading(false)
      // 社区
      void Promise.all([loadRating(id), loadComments(id, true, 'latest')])
    } catch {
      // 演示数据回退
      const demo = getDemoNovel(id)
      if (demo) {
        const { _chapters, ...rest } = demo
        setNovel(rest)
        setChapters(_chapters)
        setLoading(false)
      } else {
        setNotFound(true)
        setLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user])

  useEffect(() => {
    void load()
  }, [load])

  // ---------- 评分 ----------
  const loadRating = useCallback(async (nid: string) => {
    try {
      const data = (await ratingsApi.get(nid)) as RatingSummary & { distribution?: Record<number, number> }
      setRating({ average: data.average || 0, count: data.count || 0, distribution: data.distribution || {}, myRating: data.myRating })
    } catch {
      setRating(null)
    }
  }, [])

  async function setRatingValue(star: number) {
    try {
      const data = (await ratingsApi.set(id, star)) as unknown as RatingSummary
      setRating({ ...data })
    } catch (err) {
      toast((err as Error).message || '评分失败', 'error')
    }
  }

  async function clearRating() {
    try {
      const data = (await ratingsApi.remove(id)) as unknown as RatingSummary
      setRating({ ...data, myRating: null })
    } catch (err) {
      toast((err as Error).message || '撤销失败', 'error')
    }
  }

  // ---------- 评论 ----------
  const loadComments = useCallback(async (nid: string, reset: boolean, activeSort: string) => {
    try {
      const data = await commentsApi.list({ novelId: nid, sort: activeSort, limit: '20', offset: String(reset ? 0 : commentsOffset) })
      setCommentsTotal(data.total || 0)
      setComments((prev) => (reset ? data.comments || [] : [...prev, ...(data.comments || [])]))
      setCommentsOffset((prev) => (reset ? (data.comments || []).length : prev + (data.comments || []).length))
    } catch {
      setComments((prev) => (reset ? [] : prev))
    }
  }, [commentsOffset])

  async function submitComment(text: string, hasSpoiler: boolean, parentId = '') {
    if (!text.trim()) return
    try {
      await commentsApi.create({ novelId: id, text, hasSpoiler, parentId })
      setCommentBox('')
      setSpoiler(false)
      await loadComments(id, true, sort)
    } catch (err) {
      toast((err as Error).message || '发布失败', 'error')
    }
  }

  async function likeComment(comment: Comment) {
    try {
      if (comment.userLiked) await commentsApi.unlike(comment.id)
      else await commentsApi.like(comment.id)
      await loadComments(id, true, sort)
    } catch (err) {
      toast((err as Error).message || '操作失败', 'error')
    }
  }

  async function reportComment(comment: Comment, reason: string) {
    try {
      await commentsApi.report(comment.id, { reason, note: '' })
      toast('已提交举报', 'success')
    } catch (err) {
      toast((err as Error).message || '举报失败', 'error')
    }
  }

  async function deleteComment(comment: Comment) {
    const ok = await confirm({ title: '删除评论', message: '确定删除这条评论？', okText: '删除' })
    if (ok) {
      try {
        await commentsApi.remove(comment.id)
        await loadComments(id, true, sort)
      } catch (err) {
        toast((err as Error).message || '操作失败', 'error')
      }
    }
  }

  function changeSort(next: string) {
    setSort(next)
    void loadComments(id, true, next)
  }

  // ---------- 渲染 ----------
  if (loading) {
    return (
      <main className="detail-page">
        <div className="container detail-shell">
          <div className="loading-center">
            <div className="spinner spinner--lg"></div>
          </div>
        </div>
      </main>
    )
  }

  if (notFound || !novel) {
    return (
      <main className="detail-page">
        <div className="container detail-shell">
          <div className="empty-state">
            <div className="empty-state__icon">📖</div>
            <div className="empty-state__title">小说未找到</div>
            <div className="empty-state__desc">请检查链接是否正确，或返回首页浏览其他小说</div>
            <Link to="/" className="btn btn--primary" style={{ marginTop: 20 }}>返回首页</Link>
          </div>
        </div>
      </main>
    )
  }

  const newCount = Math.max(0, (novel.remoteChapterCount || 0) - (novel.chapterCount || 0))
  const coverSrc = url(`/cover/${encodeURIComponent(novel.id)}?v=${encodeURIComponent(novel.updatedAt || 0)}&cover=2`)
  const progress = getBestProgress(serverProgress, getNovelHistory(id))
  const lastReadChapter = progress?.chapterId ? chapters.find((c) => c.id === progress!.chapterId) : null
  const startTargetId = lastReadChapter?.id || chapters[0]?.id
  const localBookmarks = getNovelBookmarks(id)
  const max = Math.max(1, rating?.distribution[1] || 0, rating?.distribution[2] || 0, rating?.distribution[3] || 0, rating?.distribution[4] || 0, rating?.distribution[5] || 0)

  return (
    <main className="detail-page">
      <div className="container detail-shell">
        {/* Hero */}
        <div className="novel-hero">
          <div className="novel-hero__paper-mark" aria-hidden="true">档</div>
          <div className="novel-hero__cover">
            <img
              src={coverSrc}
              alt={novel.title}
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                e.currentTarget.parentElement!.innerHTML = `<span class="novel-hero__cover-fallback">${(novel.title || '书')[0]}</span>`
              }}
            />
          </div>
          <div className="novel-hero__info">
            <p className="detail-kicker">BOOK DOSSIER</p>
            <h1 className="novel-hero__title">{novel.title}</h1>
            <div className="novel-hero__meta">
              <span><Link to={`/?author=${encodeURIComponent(novel.author)}`} className="author-link">{novel.author}</Link></span>
              <span className="novel-hero__meta-sep"></span>
              <span className={`badge badge--${novel.status === 'completed' ? 'completed' : 'ongoing'}`}>
                {novel.status === 'completed' ? '已完结' : '连载中'}
              </span>
              {novel.chapterCount ? (<><span className="novel-hero__meta-sep"></span><span>{novel.chapterCount} 章</span></>) : null}
              {newCount > 0 && (<><span className="novel-hero__meta-sep"></span><span className="badge-update" title="源站有新章节尚未抓取">有 {newCount} 章待更新</span></>)}
              {novel.updatedAt ? (<><span className="novel-hero__meta-sep"></span><span>更新于 {timeAgo(novel.updatedAt)}</span></>) : null}
            </div>
            {novel.categories.length > 0 && (
              <div className="novel-hero__categories">
                {novel.categories.map((c) => <span className="tag" key={c}>{c}</span>)}
              </div>
            )}
            <div
              ref={descRef}
              className={`novel-hero__desc${descExpanded ? ' novel-hero__desc--expanded' : ''}`}
            >
              {(novel.description || '暂无简介').split('\n').map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </div>
            {descOverflows && (
              <button className="novel-hero__desc-toggle" onClick={() => setDescExpanded((v) => !v)}>
                {descExpanded ? '收起' : '展开全部'}
              </button>
            )}
            <div className="novel-hero__actions">
              {chapters.length > 0 && (
                <button className="btn btn--primary" onClick={() => startTargetId && navigate(`/read/${encodeURIComponent(novel.id)}/${encodeURIComponent(startTargetId)}`)}>
                  {lastReadChapter ? '继续阅读' : '开始阅读'}
                </button>
              )}
              <button
                className={`btn ${inShelf ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => void toggle(novel)}
              >
                {inShelf ? '已在书架' : '加入书架'}
              </button>
              {(user || isLocalDev()) && (
                <Link to="/admin" className="btn btn--secondary admin-jump-btn">管理</Link>
              )}
            </div>
          </div>
        </div>

        {/* 回来接着读：隔了很久才回来时，用已缓存的提要合成连贯回顾（进书之前） */}
        <CatchupRecap novelId={novel.id} novelTitle={novel.title} lastReadAt={lastReadAt(progress)} />

        {/* 章节目录 */}
        <section className="section detail-section">
          <div className="detail-section__head">
            <div>
              <p className="detail-kicker">CONTENTS</p>
              <h2>章节目录</h2>
            </div>
            <span className="detail-section__count">{chapters.length ? `共 ${chapters.length} 章` : '暂无章节'}</span>
          </div>
          {chapters.length === 0 ? (
            <ul className="chapter-list">
              <li className="chapter-list__item" style={{ justifyContent: 'center', color: 'var(--text-muted)' }}>
                暂无章节内容
              </li>
            </ul>
          ) : (
            <ul className="chapter-list">
              {chapters.map((ch) => {
                const order = Number(ch.order || 0) || 0
                const isLastRead = ch.id === progress?.chapterId
                const isRead = !isLastRead && (progress?.chapterOrder || 0) > 0 && order > 0 && order < (progress?.chapterOrder || 0)
                return (
                  <Link
                    key={ch.id}
                    to={`/read/${encodeURIComponent(ch.novelId || novel.id)}/${encodeURIComponent(ch.id)}`}
                    className={`chapter-list__item${isRead ? ' chapter-list__item--read' : ''}${isLastRead ? ' chapter-list__item--last-read' : ''}`}
                  >
                    <span className="chapter-list__title">
                      {ch.order ? `第${ch.order}章 ` : ''}{ch.title}
                      {isLastRead && <span className="chapter-list__read-badge">读到这里</span>}
                    </span>
                    <span className="chapter-list__meta">
                      {isRead ? '已读 ' : ''}
                      {ch.wordCount ? `${ch.wordCount}字` : ''}
                      {ch.createdAt ? ` ${timeAgo(ch.createdAt)}` : ''}
                    </span>
                  </Link>
                )
              })}
            </ul>
          )}
        </section>

        {/* 本地书签 */}
        {localBookmarks.length > 0 && (
          <section className="section detail-section">
            <div className="detail-section__head">
              <div>
                <p className="detail-kicker">BOOKMARKS</p>
                <h2>书签</h2>
              </div>
            </div>
            <div className="bookmark-novel-list">
              {localBookmarks.map((bm) => (
                <Link
                  key={bm.id}
                  to={`/read/${encodeURIComponent(id)}/${encodeURIComponent(bm.chapterId)}`}
                  className="bookmark-novel-item"
                >
                  <span className="bookmark-novel-item__title">{bm.chapterTitle || `第 ${bm.chapterOrder || '?'} 章`}</span>
                  {bm.note && <span className="bookmark-novel-item__note">{bm.note}</span>}
                  <span className="bookmark-novel-item__time text-muted">{timeAgo(bm.timestamp)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 社区 */}
        <section className="section detail-section community-section">
          <div className="detail-section__head community-section__head">
            <div>
              <p className="detail-kicker">COMMUNITY</p>
              <h2>评分与评论</h2>
            </div>
            <div className="community-sort-wrap">
              <select
                className="community-sort-native"
                aria-label="评论排序"
                value={sort}
                onChange={(e) => changeSort(e.target.value)}
              >
                <option value="latest">最新评论</option>
                <option value="hot">热门评论</option>
              </select>
            </div>
          </div>

          {/* 评分面板 */}
          <div className="rating-panel">
            {rating === null ? (
              <div className="text-muted text-sm">评分加载中…</div>
            ) : (
              <div className="rating-summary">
                <div className="rating-summary__score">
                  <strong>{rating.average || '—'}</strong>
                  <span>共 {rating.count} 人评分</span>
                </div>
                <div className="rating-summary__bars">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const n = rating.distribution[star] || 0
                    return (
                      <div className="rating-bar-row" key={star}>
                        <span>{star}星</span>
                        <i><b style={{ width: `${Math.round((n / max) * 100)}%` }}></b></i>
                        <em>{n}</em>
                      </div>
                    )
                  })}
                </div>
                <div className="rating-picker">
                  <span>我的评分</span>
                  <div className="rating-stars">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        className={`rating-star${star <= (rating.myRating || 0) ? ' is-active' : ''}`}
                        data-rating={star}
                        disabled={!user}
                        key={star}
                        onClick={() => void setRatingValue(star)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  {rating.myRating ? (
                    <button type="button" className="rating-clear" title="撤销我的评分" aria-label="撤销我的评分" onClick={() => void clearRating()}>
                      清除评分
                    </button>
                  ) : null}
                  {!user && <small>登录后可评分</small>}
                </div>
              </div>
            )}
          </div>

          {/* 评论输入 */}
          {user ? (
            <div className="comment-composer">
              <div className="comment-form">
                <textarea
                  className="form-input"
                  rows={4}
                  maxLength={1000}
                  placeholder="写下你的评论…"
                  value={commentBox}
                  onChange={(e) => setCommentBox(e.target.value)}
                ></textarea>
                <label className="comment-spoiler-check">
                  <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /> 含剧透
                </label>
                <button className="btn btn--primary btn--sm" onClick={() => void submitComment(commentBox, spoiler)}>
                  发布评论
                </button>
              </div>
            </div>
          ) : (
            <div className="comment-composer">
              <div className="comment-login-tip">登录后可以发表评论、评分和点赞。</div>
            </div>
          )}

          {/* 评论列表 */}
          <div className="comments-list">
            {comments.length === 0 ? (
              <div className="empty-state compact">暂无评论，来写第一条吧。</div>
            ) : (
              comments.map((c) => <CommentCard key={c.id} comment={c} onLike={likeComment} onReport={reportComment} onDelete={deleteComment} onReply={(text, parentId) => void submitComment(text, false, parentId)} />)
            )}
          </div>
          {commentsOffset < commentsTotal && (
            <div className="comments-more">
              <button className="btn btn--secondary btn--sm" onClick={() => void loadComments(id, false, sort)}>
                加载更多
              </button>
            </div>
          )}
        </section>
      </div>

      {/* 浮动按钮 */}
      <Link to="/" className="float-top float-top--home visible" aria-label="回到首页" title="回到首页">
        <HomeIcon />
      </Link>
      <button
        className="float-top visible"
        aria-label="回到顶部"
        title="回到顶部"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <BackToTopIcon />
      </button>
    </main>
  )
}

// ---------- 评论卡片 ----------

interface CommentCardProps {
  comment: Comment
  onLike: (c: Comment) => Promise<void>
  onReport: (c: Comment, reason: string) => Promise<void>
  onDelete: (c: Comment) => Promise<void>
  onReply: (text: string, parentId: string) => void | Promise<void>
}

function CommentCard({ comment, onLike, onReport, onDelete, onReply }: CommentCardProps) {
  const [showSpoiler, setShowSpoiler] = useState(false)
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [reporting, setReporting] = useState(false)
  const { user } = useSession()
  const { toast } = useToast()

  const name = comment.displayName || '读者'
  const avatar = comment.avatarUrl
    ? <img src={url(comment.avatarUrl)} alt="" loading="lazy" onError={(e) => { e.currentTarget.remove() }} />
    : null

  return (
    <article className="comment-card" data-id={comment.id}>
      <div className={`comment-card__avatar${avatar ? ' has-image' : ''}`}>
        {avatar}
        <span>{name[0]}</span>
      </div>
      <div className="comment-card__body">
        <div className="comment-card__meta">
          <strong>{name}</strong>
          <span>{timeAgo(comment.createdAt)}</span>
          {comment.hasSpoiler && <em>剧透</em>}
        </div>
        <div className={`comment-card__text${comment.hasSpoiler ? ' is-spoiler' : ''}`}>
          {comment.hasSpoiler && !showSpoiler ? (
            <>
              <button className="comment-spoiler-toggle" onClick={() => setShowSpoiler(true)}>显示剧透</button>
              <span className="comment-spoiler-content hidden">{comment.commentText}</span>
            </>
          ) : (
            comment.commentText.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)
          )}
        </div>
        <div className="comment-card__actions">
          {user && (
            <button onClick={() => void onLike(comment)}>{comment.userLiked ? '已赞' : '点赞'} · {comment.likeCount || 0}</button>
          )}
          {!comment.parentId && user && <button onClick={() => setReplying((v) => !v)}>回复</button>}
          <button onClick={() => setReporting((v) => !v)}>举报</button>
          {comment.canEdit && <button onClick={() => void onDelete(comment)}>删除</button>}
        </div>
        <div className="comment-reply-box">
          {replying && (
            <div className="comment-form">
              <textarea className="form-input" rows={2} maxLength={500} placeholder="回复…" value={replyText} onChange={(e) => setReplyText(e.target.value)}></textarea>
              <button className="btn btn--primary btn--sm" onClick={() => { void onReply(replyText, comment.id); setReplyText(''); setReplying(false) }}>
                发布回复
              </button>
            </div>
          )}
          {reporting && (
            <div className="comment-report-box">
              {([['spam', '垃圾信息'], ['offensive', '冒犯内容'], ['spoiler', '未标注剧透'], ['other', '其他']] as const).map(([r, label]) => (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  key={r}
                  onClick={() => { void onReport(comment, r); setReporting(false) }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {comment.replies.length > 0 && (
          <div className="comment-replies">
            {comment.replies.map((r) => (
              <CommentCard key={r.id} comment={r} onLike={onLike} onReport={onReport} onDelete={onDelete} onReply={onReply} />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
