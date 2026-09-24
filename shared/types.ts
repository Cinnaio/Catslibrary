/**
 * 领域类型 —— web 与 api 共享的单一事实来源。
 * 与 api/src/db/mappers.ts 的行映射字段一一对应（API 层负责 snake_case→camelCase）。
 */

/**
 * 内容分级（三态）。unknown 是默认值，表示尚未人工判定——判定层会回落到标题/简介/
 * 分类的正则兜底，因此 unknown 不等于"安全"。详见 docs/novel-content-rating-plan-2026-09-23.md。
 */
export type ContentRating = 'general' | 'restricted' | 'unknown'

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

export interface NovelListResponse {
  novels: Novel[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasMore: boolean
  availableCategories: string[]
  /** 全库标注进度（不受当前筛选影响），用于标注作业台显示「还剩多少未判定」。 */
  ratingCounts?: RatingCounts
  /** 服务端已过滤限制级作品时，供前端保留「安全模式已隐藏部分作品」提示。 */
  hiddenRestricted?: boolean
}

export interface RatingCounts {
  general: number
  restricted: number
  unknown: number
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

export interface User {
  id: string
  username: string
  displayName: string
  role: string
  status: string
  createdAt: number
  updatedAt: number
  lastLoginAt: number
  bio: string
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

export type ReaderDevice = 'desktop' | 'mobile'

/** 阅读设置（LWW 合并结构）：values 存设置值，updatedAt 存每项时间戳。 */
export interface ReaderSettings {
  values: Record<string, string>
  updatedAt: Record<string, number>
}

/** 阅读进度（reading_progress 表）。 */
export interface ReadingProgress {
  novelId: string
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  scrollPercent: number
  pageMode: string
  pageIndex: number
  pagePercent: number
  clientUpdatedAt: number
  updatedAt: number
}

/** 本地阅读历史（localStorage）。 */
export interface ReadingHistoryEntry {
  novelId: string
  novelTitle: string
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  scrollPercent: number
  pageMode: string
  pageIndex: number
  pagePercent: number
  timestamp: number
}

/** 本地书签（localStorage，后端同步用 user_bookmarks）。 */
export interface LocalBookmark {
  id: string
  novelId: string
  novelTitle: string
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  note: string
  timestamp: number
}
