/**
 * 行映射 —— snake_case DB 列 ↔ camelCase API 字段（由 Novel-KV _db.js 平移）。
 */
import type { ContentRating } from '@shared/types'

export interface NovelRow {
  id: string
  title: string
  author: string
  description: string
  cover_url: string
  categories: string
  status: string
  content_rating: string
  source_url: string
  chapter_count: number
  remote_chapter_count: number
  update_checked_at: number
  created_at: number
  updated_at: number
}

export interface Novel {
  id: string
  title: string
  author: string
  description: string
  coverUrl: string
  categories: string[]
  status: string
  contentRating: ContentRating
  sourceUrl: string
  chapterCount: number
  remoteChapterCount: number
  updateCheckedAt: number
  createdAt: number
  updatedAt: number
}

export interface ChapterMeta {
  id: string
  novelId: string
  title: string
  order: number
  wordCount: number
  sourceUrl: string
  createdAt: number
}

export interface ChapterFull extends ChapterMeta {
  content: string
}

export interface Thought {
  id: string
  novelId: string
  chapterId: string
  paragraphIndex: number
  paragraphHash: string
  selectedText: string
  thoughtText: string
  displayName: string
  status: string
  reportCount: number
  createdAt: number
  updatedAt: number
  userId: string
  avatarUrl: string
}

export interface Comment {
  id: string
  novelId: string
  userId: string
  parentId: string
  commentText: string
  displayName: string
  hasSpoiler: boolean
  status: string
  likeCount: number
  reportCount: number
  createdAt: number
  updatedAt: number
  userLiked: boolean
  canEdit: boolean
  replies: Comment[]
  avatarUrl: string
}

export interface Rating {
  id: string
  novelId: string
  userId: string
  rating: number
  createdAt: number
  updatedAt: number
}

/**
 * 归一化内容分级。非枚举值（历史脏数据、规则回填写错）一律按「未判定」处理，
 * 而不是当成安全——宁可让它继续走正则兜底，也不能静默放行。
 */
export function toContentRating(value: unknown): ContentRating {
  return value === 'general' || value === 'restricted' ? value : 'unknown'
}

export function rowToNovel(row: NovelRow | undefined | null): Novel | null {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    coverUrl: row.cover_url,
    categories: safeJsonParse(row.categories, []),
    status: row.status,
    contentRating: toContentRating(row.content_rating),
    sourceUrl: row.source_url,
    chapterCount: row.chapter_count,
    remoteChapterCount: row.remote_chapter_count || 0,
    updateCheckedAt: row.update_checked_at || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function novelToRow(novel: Novel): Record<string, unknown> {
  return {
    id: novel.id,
    title: novel.title,
    author: novel.author || '',
    description: novel.description || '',
    cover_url: novel.coverUrl || '',
    categories: JSON.stringify(novel.categories || []),
    status: novel.status || 'ongoing',
    content_rating: toContentRating(novel.contentRating),
    source_url: novel.sourceUrl || '',
    chapter_count: novel.chapterCount || 0,
    created_at: novel.createdAt,
    updated_at: novel.updatedAt,
  }
}

export function rowToChapterMeta(row: Record<string, unknown> | undefined | null): ChapterMeta | null {
  if (!row) return null
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    title: String(row.title),
    order: Number(row.sort_order) || 0,
    wordCount: Number(row.word_count) || 0,
    sourceUrl: String(row.source_url || ''),
    createdAt: Number(row.created_at),
  }
}

export function rowToChapterFull(row: Record<string, unknown> | undefined | null): ChapterFull | null {
  if (!row) return null
  const meta = rowToChapterMeta(row)
  if (!meta) return null
  return { ...meta, content: String(row.content || '') }
}

export function rowToThought(row: Record<string, unknown> | undefined | null): Thought | null {
  if (!row) return null
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    chapterId: String(row.chapter_id),
    paragraphIndex: Number(row.paragraph_index),
    paragraphHash: String(row.paragraph_hash || ''),
    selectedText: String(row.selected_text || ''),
    thoughtText: String(row.thought_text || ''),
    displayName: String(row.display_name || ''),
    status: String(row.status || 'visible'),
    reportCount: Number(row.report_count) || 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    userId: String(row.user_id || ''),
    avatarUrl: row.user_id
      ? '/api/avatar/' + encodeURIComponent(String(row.user_id)) + '?v=' + encodeURIComponent(Number(row.user_updated_at || row.updated_at) || 0)
      : '',
  }
}

export interface ThoughtAdmin extends Thought {
  novelTitle: string
  chapterTitle: string
  userUsername: string
  userDisplayName: string
  clientIdHash: string
  ipHash: string
}

export function rowToThoughtAdmin(row: Record<string, unknown> | undefined | null): ThoughtAdmin | null {
  if (!row) return null
  const base = rowToThought(row)
  if (!base) return null
  return {
    ...base,
    novelTitle: String(row.novel_title || ''),
    chapterTitle: String(row.chapter_title || ''),
    userUsername: String(row.user_username || ''),
    userDisplayName: String(row.user_display_name || ''),
    clientIdHash: String(row.client_id_hash || ''),
    ipHash: String(row.ip_hash || ''),
  }
}

export function rowToComment(row: Record<string, unknown> | undefined | null): Comment | null {
  if (!row) return null
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    userId: String(row.user_id || ''),
    parentId: String(row.parent_id || ''),
    commentText: String(row.comment_text || ''),
    displayName: String(row.display_name || ''),
    hasSpoiler: row.has_spoiler === 1,
    status: String(row.status || 'visible'),
    likeCount: Number(row.like_count) || 0,
    reportCount: Number(row.report_count) || 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    userLiked: row.user_liked === 1,
    canEdit: row.can_edit === 1,
    replies: [],
    avatarUrl: row.user_id
      ? '/api/avatar/' + encodeURIComponent(String(row.user_id)) + '?v=' + encodeURIComponent(Number(row.user_updated_at || row.updated_at) || 0)
      : '',
  }
}

export interface CommentAdmin extends Comment {
  novelTitle: string
  userUsername: string
  userDisplayName: string
  clientIdHash: string
  ipHash: string
}

export function rowToCommentAdmin(row: Record<string, unknown> | undefined | null): CommentAdmin | null {
  if (!row) return null
  const base = rowToComment(row)
  if (!base) return null
  return {
    ...base,
    novelTitle: String(row.novel_title || ''),
    userUsername: String(row.user_username || ''),
    userDisplayName: String(row.user_display_name || ''),
    clientIdHash: String(row.client_id_hash || ''),
    ipHash: String(row.ip_hash || ''),
  }
}

export interface CommentReport {
  id: string
  commentId: string
  reportedBy: string
  reason: string
  note: string
  status: string
  resolvedBy: string
  resolvedAt: number
  createdAt: number
  commentText: string
  commentStatus: string
  commentNovelId: string
  commentAuthor: string
  novelTitle: string
  reporterUsername: string
  reporterDisplayName: string
  resolverUsername: string
}

export function rowToCommentReport(row: Record<string, unknown> | undefined | null): CommentReport | null {
  if (!row) return null
  return {
    id: String(row.id),
    commentId: String(row.comment_id),
    reportedBy: String(row.reported_by || ''),
    reason: String(row.reason || 'other'),
    note: String(row.note || ''),
    status: String(row.status || 'open'),
    resolvedBy: String(row.resolved_by || ''),
    resolvedAt: Number(row.resolved_at) || 0,
    createdAt: Number(row.created_at),
    commentText: String(row.comment_text || ''),
    commentStatus: String(row.comment_status || ''),
    commentNovelId: String(row.comment_novel_id || ''),
    commentAuthor: String(row.comment_author || ''),
    novelTitle: String(row.novel_title || ''),
    reporterUsername: String(row.reporter_username || ''),
    reporterDisplayName: String(row.reporter_display_name || ''),
    resolverUsername: String(row.resolver_username || ''),
  }
}

export function rowToRating(row: Record<string, unknown> | undefined | null): Rating | null {
  if (!row) return null
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    userId: String(row.user_id),
    rating: Number(row.rating),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(str || '') as T
  } catch {
    return fallback
  }
}
