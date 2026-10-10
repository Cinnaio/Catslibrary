import type { PendingChapterCounts } from './novel-updates'

/**
 * 领域类型 —— web 与 api 共享的单一事实来源。
 * 与 api/src/db/mappers.ts 的行映射字段一一对应（API 层负责 snake_case→camelCase）。
 */

/**
 * 内容分级（三态）。unknown 是默认值，表示尚未人工判定——判定层会回落到标题/简介/
 * 分类的正则兜底，因此 unknown 不等于"安全"。详见 docs/novel-content-rating-plan-2026-09-23.md。
 */
export type ContentRating = 'general' | 'restricted' | 'unknown'

export interface Novel extends PendingChapterCounts {
  id: string
  title: string
  author: string
  description: string
  coverUrl: string
  categories: string[]
  status: string
  contentRating: ContentRating
  contentRatingRevision?: number
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

/**
 * 书籍导入的统一交换结构。文件和 URL 解析后都必须先落到这个形状，
 * 预览、差异选择与撤回因此不依赖具体来源。
 */
export type BookImportSourceType = 'file' | 'url'

export interface BookImportChapterInput {
  title: string
  order: number
  content: string
  sourceUrl?: string
}

export interface BookImportPayload {
  title: string
  author: string
  description?: string
  coverUrl?: string
  categories?: string[]
  status?: string
  sourceUrl?: string
  chapters: BookImportChapterInput[]
}

export interface BookImportNovelCandidate {
  novel: Novel
  matchReason: 'title' | 'title-author' | 'source-url'
  score: number
}

export type BookImportChapterStatus = 'new' | 'unchanged' | 'changed' | 'conflict'

export interface BookImportMetadataDiff {
  field: 'title' | 'author' | 'description' | 'coverUrl' | 'categories' | 'status' | 'sourceUrl'
  label: string
  localValue: string
  incomingValue: string
  changed: boolean
  selected: boolean
}

export interface BookImportChapterDiff {
  id: string
  status: BookImportChapterStatus
  localChapterId?: string
  localOrder?: number
  incomingOrder: number
  localTitle?: string
  incomingTitle: string
  localContent?: string
  incomingContent: string
  localSourceUrl?: string
  incomingSourceUrl?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
  selected: boolean
}

/**
 * 导入解析诊断 —— 把「这一行为什么被当成 / 没当成章节标题」从正则里的隐式判据
 * 变成可读数据。零 AI 依赖：先有诊断，AI 复核才有对照基准，
 * 也才能区分「规则判错」与「模型判错」——否则只是把黑盒从一层叠成两层。
 */
export type BookImportLineVerdict = 'heading' | 'prose'

/** 启发式命中标题的规则标识；prose 判定用否决理由标识。 */
export type BookImportHeadingRule =
  'numbered-heading' | 'bare-number-spaced' | 'bare-number-tight' | 'volume-heading' | 'duplicate-heading-merged' | 'forced-heading'

export type BookImportVerdictConfidence = 'high' | 'medium' | 'low'

/**
 * 单行判定证据。只收「证据不足」的行——全量入库会让快照膨胀且无信息量：
 * 高置信标题与普通正文段落本来就不需要复核。
 */
export interface BookImportLineEvidence {
  /** 1-based 行号，与 run 快照里的 source_text 行序一致。 */
  line: number
  /** 原文（截断到可读长度）。 */
  raw: string
  verdict: BookImportLineVerdict
  /** 命中的规则标识，或 prose 判定的否决理由标识。 */
  rule: string
  confidence: BookImportVerdictConfidence
  /** 形似章节却被否决时，触发否决的那条规则。 */
  rejectedBy?: string
  contextBefore?: string
  contextAfter?: string
}

/** 切分统计。异常检测与 AI 复核的语境都从这里取。 */
export interface BookImportSplitStats {
  parser: 'text' | 'epub' | 'json' | 'url'
  totalLines: number
  /** 命中的章节标题行数（含权威与非权威写法）。 */
  headingLines: number
  /** 卷/部/篇标题：并入上一章正文，不单独成章。 */
  volumeHeadingLines: number
  /** 与已有章节同编号、被并入正文的重复标题行（站点导出的两层标题）。 */
  mergedHeadingLines: number
  /** 首个章节标题之前的行数（站点前置信息）。 */
  frontMatterLines: number
  /** 空正文被丢弃的编号章节数——切分炸掉的直接信号。 */
  droppedEmptyChapters: number
  chapterCount: number
  /** 正文字符数分布（忽略空白）。 */
  chapterChars: { min: number; median: number; max: number }
  frontMatterChars: number
  /**
   * 识别到的章节编号序列统计。跳号指向漏切（90 章的文件只认出 45 章），
   * 重号指向伪章节（论坛楼层被切成独立章节）。比字数分布更可靠。
   */
  numbering: { detected: number; min: number; max: number; missing: number; duplicated: number }
}

export interface BookImportAnomaly {
  code:
    | 'no-heading-detected'
    | 'empty-chapters-dropped'
    | 'chapters-fragmented'
    | 'chapters-missing'
    | 'numbering-gaps'
    | 'numbering-duplicated'
    | 'chapter-length-outlier'
    | 'front-matter-oversized'
    | 'uncertain-lines'
  severity: 'info' | 'warning'
  message: string
}

export interface BookImportDiagnostics {
  stats: BookImportSplitStats
  /** 证据不足的行：低置信命中 + 形似章节但被否决。按风险排序后截断。 */
  uncertain: BookImportLineEvidence[]
  /** 截断前的总数。 */
  uncertainTotal: number
  anomalies: BookImportAnomaly[]
  /**
   * 启发式版本号。AI 复核与标注样本据此判断基线是否已变，
   * 避免拿旧模型结论对照新规则。
   */
  heuristicVersion: number
}

/** 单条 AI 裁决：模型对某个候选行的最终判定。 */
export interface BookImportAiSuggestion {
  line: number
  raw: string
  heuristic: BookImportLineVerdict
  verdict: BookImportLineVerdict
  confidence: BookImportVerdictConfidence
  reason: string
}

/**
 * AI 复核结果。只覆盖 uncertain 行——确定性基线照旧跑，
 * 模型仅裁决证据不足的区间，因此不引入全量不确定性。
 */
export interface BookImportAiReview {
  reviewedAt: number
  model: string
  heuristicVersion: number
  candidateCount: number
  suggestions: BookImportAiSuggestion[]
  /** 应用建议后的预计章节数，供管理员对比确认。 */
  projectedChapterCount: number
  usage: { promptTokens: number; completionTokens: number; costMillicents: number }
}

export interface BookImportPreview {
  runId: string
  sourceType: BookImportSourceType
  sourceLabel: string
  sourceUrl: string
  book: BookImportPayload
  candidates: BookImportNovelCandidate[]
  targetNovelId: string | null
  targetNovel: Novel | null
  metadataDiff: BookImportMetadataDiff[]
  chapters: BookImportChapterDiff[]
  summary: {
    newCount: number
    changedCount: number
    unchangedCount: number
    conflictCount: number
  }
  warnings: string[]
  /** 解析诊断：切分统计、证据不足行、异常信号。非文本来源或旧快照可能缺失。 */
  diagnostics?: BookImportDiagnostics
  /** AI 复核结果；未跑过为 null。只提建议，不改变已落库的 payload。 */
  aiReview?: BookImportAiReview | null
}

export interface BookImportCommitResult {
  runId: string
  batchId: string
  novelId: string
  novelCreated: boolean
  created: number
  updated: number
  skipped: number
  metadataUpdated: string[]
  conflicts: Array<{ id: string; title: string; reason: string }>
}

export interface BookImportRollbackResult {
  runId: string
  rolledBack: number
  conflicts: Array<{ id: string; title: string; reason: string }>
}

export interface BookImportHistoryItem {
  runId: string
  batchId: string
  sourceType: BookImportSourceType
  sourceLabel: string
  sourceUrl: string
  novelId: string
  novelTitle: string
  status: 'preview' | 'applied' | 'rolled_back' | 'partial'
  createdAt: number
  appliedAt: number
  rolledBackAt: number
  created: number
  updated: number
  conflicts: number
  canRollback: boolean
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
  imageUrl?: string
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

export type ReaderDevice = 'desktop' | 'mobile' | 'ios'

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
