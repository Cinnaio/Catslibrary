import { Spinner } from '@/components/ui/spinner'
/**
 * 内容审核 tab —— 想法 / 评论 / 举报（单一数据驱动组件）。
 * 由 Novel-KV js/admin-moderation.js + admin.html #tab-moderation 平移。
 */
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminApi, thoughtsApi } from '../../lib/api'
import ThoughtImage from '../../components/reader/ThoughtImage'
import { UserAvatar } from "@/components/identity/UserAvatar"
import { timeAgo } from '../../lib/format'
import { useConfirm, useToast } from '../../components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { ErrorState } from "@/components/shared/AsyncStates"
import AdminRowActions from '@/components/admin/AdminRowActions'
import SearchSelect from "@/components/shared/SearchSelect"
import Pagination from "@/components/shared/Pagination"
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { SearchField } from '@/components/shared/SearchField'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import EmptyState from "@/components/shared/EmptyState"
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Check, CircleMinus, CirclePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModerationMode = 'thoughts' | 'comments' | 'reports'

const MODERATION_MODE_INDEX: Record<ModerationMode, number> = {
  thoughts: 0,
  comments: 1,
  reports: 2,
}

function isModerationMode(value: string | null): value is ModerationMode {
  return value === 'thoughts' || value === 'comments' || value === 'reports'
}

interface ThoughtRow {
  imageUrl?: string
  id: string
  status?: string
  createdAt: number
  novelId: string
  chapterId: string
  novelTitle?: string
  chapterTitle?: string
  paragraphIndex?: number
  selectedText?: string
  thoughtText?: string
  displayName?: string
  avatarUrl?: string
}

interface CommentRow {
  id: string
  status?: string
  createdAt: number
  novelId: string
  novelTitle?: string
  parentId?: string
  userDisplayName?: string
  userUsername?: string
  displayName?: string
  userId?: string
  commentText?: string
  hasSpoiler?: boolean
  likeCount?: number
  reportCount?: number
}

interface ReportRow {
  id: string
  status?: string
  createdAt: number
  commentNovelId?: string
  novelTitle?: string
  commentText?: string
  reporterDisplayName?: string
  reporterUsername?: string
  reportedBy?: string
  reason?: string
  note?: string
}

const MODERATION_REASON_LABELS: Record<string, string> = { spam: '垃圾信息', offensive: '攻击辱骂', spoiler: '剧透', other: '其他' }

const REASON_OPTIONS: Array<[string, string]> = [
  ['all', '全部原因'],
  ['spam', '垃圾信息'],
  ['offensive', '攻击辱骂'],
  ['spoiler', '剧透'],
  ['other', '其他'],
]

interface ModeConfig {
  label: string
  head: string[]
  columns: readonly AdminColumn[]
  statusOptions: Array<[string, string]>
  defaultStatus: string
  showReason: boolean
  searchPlaceholder: string
}

const MODERATION_COLUMNS: Record<ModerationMode, readonly AdminColumn[]> = {
  thoughts: [
    { key: 'time', label: '时间', width: '10%' },
    { key: 'source', label: '小说 / 章节', width: '16%' },
    { key: 'paragraph', label: '段落', width: '7%' },
    { key: 'selectedText', label: '划选文字', width: '16%' },
    { key: 'thought', label: '想法', width: '19%', primary: true },
    { key: 'user', label: '昵称', width: '12%' },
    { key: 'status', label: '状态', width: '8%' },
    { key: 'actions', label: '操作', width: '12%', actions: true },
  ],
  comments: [
    { key: 'time', label: '时间', width: '10%' },
    { key: 'novel', label: '小说', width: '16%' },
    { key: 'user', label: '用户', width: '13%' },
    { key: 'comment', label: '评论', width: '28%', primary: true },
    { key: 'engagement', label: '互动', width: '11%' },
    { key: 'status', label: '状态', width: '8%' },
    { key: 'actions', label: '操作', width: '14%', actions: true },
  ],
  reports: [
    { key: 'time', label: '时间', width: '10%' },
    { key: 'novel', label: '小说', width: '14%' },
    { key: 'comment', label: '评论', width: '23%', primary: true },
    { key: 'reporter', label: '举报人', width: '12%' },
    { key: 'reason', label: '原因', width: '12%' },
    { key: 'status', label: '状态', width: '8%' },
    { key: 'actions', label: '操作', width: '21%', actions: true },
  ],
}

const MODERATION_TYPES: Record<ModerationMode, ModeConfig> = {
  thoughts: {
    label: '想法',
    head: ['时间', '小说 / 章节', '段落', '划选文字', '想法', '昵称', '状态', '操作'],
    columns: MODERATION_COLUMNS.thoughts,
    statusOptions: [
      ['all', '全部'],
      ['visible', '可见'],
      ['hidden', '已隐藏'],
    ],
    defaultStatus: 'all',
    showReason: false,
    searchPlaceholder: '搜索小说/章节/想法/用户…',
  },
  comments: {
    label: '评论',
    head: ['时间', '小说', '用户', '评论', '互动', '状态', '操作'],
    columns: MODERATION_COLUMNS.comments,
    statusOptions: [
      ['all', '全部'],
      ['visible', '可见'],
      ['hidden', '已隐藏'],
    ],
    defaultStatus: 'all',
    showReason: false,
    searchPlaceholder: '搜索小说/评论/用户…',
  },
  reports: {
    label: '举报',
    head: ['时间', '小说', '评论', '举报人', '原因', '状态', '操作'],
    columns: MODERATION_COLUMNS.reports,
    statusOptions: [
      ['open', '待处理'],
      ['resolved', '已解决'],
      ['dismissed', '已驳回'],
      ['all', '全部'],
    ],
    defaultStatus: 'open',
    showReason: true,
    searchPlaceholder: '搜索小说/评论…',
  },
}

type AnyRow = ThoughtRow | CommentRow | ReportRow

function ThoughtUser({ t }: { t: ThoughtRow }) {
  const name = t.displayName || '匿名读者'
  return (
    <span className="thought-admin-user">
      <span className="thought-admin-avatar">
        <UserAvatar src={t.avatarUrl} name={name} size="inherit" />
      </span>
      <span>{name}</span>
    </span>
  )
}

export default function ModerationTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlMode = searchParams.get('mode')

  const [mode, setMode] = useState<ModerationMode>(() => (isModerationMode(urlMode) ? urlMode : 'thoughts'))
  const [status, setStatus] = useState<string>('all')
  const [reason, setReason] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [rows, setRows] = useState<AnyRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const requestRevision = useRef(0)
  const [page, setPage] = useState(1)
  const pageSize = 80
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cfg = MODERATION_TYPES[mode]

  // 二级审核入口位于侧边栏，URL 变化时同步当前审核类型，保留刷新、返回和深链接能力。
  useEffect(() => {
    const nextMode = isModerationMode(urlMode) ? urlMode : urlMode === null ? 'thoughts' : null
    if (!nextMode || nextMode === mode) return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setMode(nextMode)
    setPage(1)
    setStatus(MODERATION_TYPES[nextMode].defaultStatus)
    setReason('all')
    setSearchInput('')
    setSearchQuery('')
  }, [mode, urlMode])

  const load = useCallback(async () => {
    const revision = ++requestRevision.current
    const current = () => revision === requestRevision.current
    setLoading(true)
    setError('')
    try {
      if (mode === 'thoughts') {
        const d = await thoughtsApi.adminList({ status, search: searchQuery, limit: String(pageSize), offset: String((page - 1) * pageSize) })
        if (!current()) return
        setRows((d.thoughts || []) as ThoughtRow[])
        setTotal(d.total || 0)
      } else if (mode === 'comments') {
        const d = await adminApi.comments.list({ status, search: searchQuery, limit: String(pageSize), offset: String((page - 1) * pageSize) })
        if (!current()) return
        setRows((d.comments || []) as CommentRow[])
        setTotal(d.total || 0)
      } else {
        const d = await adminApi.commentReports.list({ status, reason, limit: String(pageSize), offset: String((page - 1) * pageSize) })
        if (!current()) return
        setRows((d.reports || []) as ReportRow[])
        setTotal(d.total || 0)
      }
    } catch (err) {
      if (!current()) return
      setError((err as Error).message || '未知错误')
      toast(`${MODERATION_TYPES[mode].label}列表加载失败`, 'error')
    } finally {
      if (current()) setLoading(false)
    }
  }, [mode, status, reason, searchQuery, toast, page])

  useEffect(() => {
    void load()
    return () => { requestRevision.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, reason, searchQuery, page])

  useEffect(() => {
    if (total !== null && page > Math.max(1, Math.ceil(total / pageSize))) setPage(Math.max(1, Math.ceil(total / pageSize)))
  }, [total, page])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  function handleStatusChange(value: string) {
    setPage(1)
    setStatus(value || 'all')
  }

  function handleReasonChange(value: string) {
    setPage(1)
    setReason(value || 'all')
  }

  function switchMode(nextMode: ModerationMode) {
    if (nextMode === mode) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('mode', nextMode)
    setSearchParams(nextParams, { replace: true })
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(1); setSearchQuery(v.trim()) }, 250)
  }

  // --- Thoughts actions -------------------------------------------------

  async function updateThoughtStatus(id: string, status: 'visible' | 'hidden') {
    try {
      await thoughtsApi.update(id, { status })
      toast(status === 'visible' ? '已恢复想法' : '已隐藏想法', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '操作失败', 'error')
    }
  }

  async function deleteThought(t: ThoughtRow) {
    const ok = await confirm({
      title: '永久删除想法',
      message: '确定永久删除这条想法？此操作不可恢复。',
      okText: '删除',
      danger: true,
      items: [t.thoughtText || t.selectedText || t.id],
    })
    if (!ok) return
    try {
      await thoughtsApi.hardDelete(t.id)
      toast('已删除想法', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    }
  }

  // --- Comments actions -------------------------------------------------

  async function updateCommentStatus(id: string, status: 'visible' | 'hidden') {
    try {
      await adminApi.comments.update(id, { status })
      toast(status === 'visible' ? '已恢复评论' : '已隐藏评论', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '操作失败', 'error')
    }
  }

  async function deleteComment(c: CommentRow) {
    const ok = await confirm({
      title: '永久删除评论',
      message: '确定永久删除这条评论？',
      okText: '删除',
      danger: true,
      items: [c.id],
    })
    if (!ok) return
    try {
      await adminApi.comments.remove(c.id)
      toast('已删除评论', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '删除失败', 'error')
    }
  }

  // --- Reports actions --------------------------------------------------

  async function resolveReport(id: string, status: 'resolved' | 'dismissed', action: 'hide' | 'none') {
    try {
      await adminApi.commentReports.update(id, { status, action })
      toast('举报已处理', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '处理失败', 'error')
    }
  }

  // --- Row renderers -----------------------------------------------------

  function renderThoughtRow(t: ThoughtRow, idx: number) {
    const visible = (t.status || 'visible') === 'visible'
    const readable = t.novelId && t.chapterId
    const delay = getAdminTableRowStaggerDelay(idx, rows.length)
    return (
      <TableRow key={t.id} style={{ animationDelay: `${delay}ms` }}>
        <TableCell data-label="时间" className="text-xs text-muted-foreground whitespace-nowrap">
          {timeAgo(t.createdAt)}
        </TableCell>
        <TableCell data-label="小说 / 章节" className="moderation-source-cell">
          <div className="flex flex-col gap-0.5">
            {readable ? (
              <Link
                to={`/read/${encodeURIComponent(t.novelId)}/${encodeURIComponent(t.chapterId)}`}
                className="font-medium text-foreground hover:text-primary transition-colors line-clamp-1"
              >
                {t.novelTitle || t.novelId}
              </Link>
            ) : (
              <span className="font-medium text-foreground line-clamp-1">{t.novelTitle || t.novelId}</span>
            )}
            <span className="text-xs text-muted-foreground line-clamp-1">{t.chapterTitle || t.chapterId}</span>
          </div>
        </TableCell>
        <TableCell data-label="段落" className="text-xs text-muted-foreground tabular-nums">
          {String((t.paragraphIndex || 0) + 1)}
        </TableCell>
        <TableCell data-label="划选文字" className="thought-admin-cell text-xs text-muted-foreground">
          {t.selectedText ? (
            <span className="line-clamp-2 italic text-foreground/80 bg-muted/40 px-1.5 py-0.5 rounded">
              “{t.selectedText}”
            </span>
          ) : (
            '—'
          )}
        </TableCell>
        <TableCell data-primary="" data-label="想法" className="thought-admin-cell">
          <div className="font-medium text-foreground leading-snug">{t.thoughtText || '—'}</div>
          {t.imageUrl && (
            <div className="mt-1.5">
              <ThoughtImage id={t.id} />
            </div>
          )}
        </TableCell>
        <TableCell data-label="昵称">
          <ThoughtUser t={t} />
        </TableCell>
        <TableCell data-label="状态">
          <AdminStatusBadge tone={visible ? 'success' : 'danger'}>{visible ? '可见' : '已隐藏'}</AdminStatusBadge>
        </TableCell>
        <TableCell data-actions="">
          <div className="admin-cell-actions flex items-center gap-1">
            {visible ? (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
                title="隐藏"
                onClick={() => void updateThoughtStatus(t.id, 'hidden')}
              >
                隐藏
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-7 px-3 text-xs text-primary hover:bg-primary/10"
                title="恢复"
                onClick={() => void updateThoughtStatus(t.id, 'visible')}
              >
                恢复
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-7 px-3 text-xs text-destructive hover:bg-destructive/10"
              title="永久删除"
              onClick={() => void deleteThought(t)}
            >
              删除
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  function renderCommentRow(c: CommentRow, idx: number) {
    const visible = (c.status || 'visible') === 'visible'
    const delay = getAdminTableRowStaggerDelay(idx, rows.length)
    return (
      <TableRow key={c.id} style={{ animationDelay: `${delay}ms` }}>
        <TableCell data-label="时间" className="text-xs text-muted-foreground whitespace-nowrap">
          {timeAgo(c.createdAt)}
        </TableCell>
        <TableCell data-label="小说" className="moderation-source-cell">
          <div className="flex flex-col gap-0.5">
            {c.novelId ? (
              <Link
                to={`/novel/${encodeURIComponent(c.novelId)}`}
                className="font-medium text-foreground hover:text-primary transition-colors line-clamp-1"
              >
                {c.novelTitle || c.novelId}
              </Link>
            ) : (
              <span className="font-medium text-foreground line-clamp-1">{c.novelTitle || c.novelId}</span>
            )}
            {c.parentId && <span className="text-xs text-muted-foreground">回复评论</span>}
          </div>
        </TableCell>
        <TableCell data-label="用户" className="text-xs font-medium text-foreground/90">
          {c.userDisplayName || c.userUsername || c.displayName || c.userId || '—'}
        </TableCell>
        <TableCell data-primary="" data-label="评论" className="thought-admin-cell">
          <div className="font-medium text-foreground leading-snug">{c.commentText || '—'}</div>
          {c.hasSpoiler && (
            <Badge variant="outline" className="mt-1 text-[11px] font-normal border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10">
              剧透
            </Badge>
          )}
        </TableCell>
        <TableCell data-label="互动" className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          <span>赞 {c.likeCount || 0}</span>
          <span className="mx-1 text-muted-foreground/40">·</span>
          <span>举报 {c.reportCount || 0}</span>
        </TableCell>
        <TableCell data-label="状态">
          <AdminStatusBadge tone={visible ? 'success' : 'danger'}>{visible ? '可见' : '已隐藏'}</AdminStatusBadge>
        </TableCell>
        <TableCell data-actions="">
          <div className="admin-cell-actions flex items-center gap-1">
            {visible ? (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
                title="隐藏"
                onClick={() => void updateCommentStatus(c.id, 'hidden')}
              >
                隐藏
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-7 px-3 text-xs text-primary hover:bg-primary/10"
                title="恢复"
                onClick={() => void updateCommentStatus(c.id, 'visible')}
              >
                恢复
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-7 px-3 text-xs text-destructive hover:bg-destructive/10"
              title="永久删除"
              onClick={() => void deleteComment(c)}
            >
              删除
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  function renderReportRow(r: ReportRow, idx: number) {
    const pending = (r.status || 'open') === 'open'
    const delay = getAdminTableRowStaggerDelay(idx, rows.length)
    return (
      <TableRow key={r.id} style={{ animationDelay: `${delay}ms` }}>
        <TableCell data-label="时间" className="text-xs text-muted-foreground whitespace-nowrap">
          {timeAgo(r.createdAt)}
        </TableCell>
        <TableCell data-label="小说" className="moderation-source-cell">
          {r.commentNovelId ? (
            <Link
              to={`/novel/${encodeURIComponent(r.commentNovelId)}`}
              className="font-medium text-foreground hover:text-primary transition-colors line-clamp-1"
            >
              {r.novelTitle || r.commentNovelId || '—'}
            </Link>
          ) : (
            <span className="font-medium text-foreground line-clamp-1">{r.novelTitle || '—'}</span>
          )}
        </TableCell>
        <TableCell data-primary="" data-label="评论" className="thought-admin-cell">
          <div className="rounded-lg bg-muted/40 p-2 text-xs text-foreground/90 leading-relaxed border border-border/40">
            {r.commentText || '评论已删除'}
          </div>
        </TableCell>
        <TableCell data-label="举报人" className="text-xs font-medium text-foreground/90">
          {r.reporterDisplayName || r.reporterUsername || r.reportedBy || '—'}
        </TableCell>
        <TableCell data-label="原因">
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center text-xs font-medium text-foreground">
              {MODERATION_REASON_LABELS[r.reason || ''] || r.reason}
            </span>
            {r.note && <span className="text-xs text-muted-foreground line-clamp-2">{r.note}</span>}
          </div>
        </TableCell>
        <TableCell data-label="状态">
          <AdminStatusBadge tone={r.status === 'resolved' ? 'success' : r.status === 'dismissed' ? 'subtle' : 'warning'}>
            {r.status === 'open' ? '待处理' : r.status === 'resolved' ? '已解决' : r.status === 'dismissed' ? '已驳回' : r.status}
          </AdminStatusBadge>
        </TableCell>
        <TableCell data-actions="">
          {pending ? (
            <div className="flex items-center gap-1.5">
              <AdminRowActions
                label={`举报 ${r.id.slice(0, 8)}`}
                items={[
                  // 「隐藏并解决」是这条举报的主处置，常驻；
                  // 「解决」（保留内容）与「驳回」是判断性结论，收进菜单减少误点。
                  { label: '解决（保留内容）', icon: Check, onSelect: () => void resolveReport(r.id, 'resolved', 'none') },
                  { label: '驳回举报', icon: X, onSelect: () => void resolveReport(r.id, 'dismissed', 'none') },
                ]}
              >
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-full h-7 px-3 text-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-none font-medium"
                  title="隐藏并解决"
                  onClick={() => void resolveReport(r.id, 'resolved', 'hide')}
                >
                  隐藏并解决
                </Button>
              </AdminRowActions>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/60">—</span>
          )}
        </TableCell>
      </TableRow>
    )
  }

  function renderRows() {
    return rows.map((r, idx) => {
      if (mode === 'thoughts') return renderThoughtRow(r as ThoughtRow, idx)
      if (mode === 'comments') return renderCommentRow(r as CommentRow, idx)
      return renderReportRow(r as ReportRow, idx)
    })
  }

  const hasRows = !loading && !error && rows.length > 0
  const listStateTitle = loading ? '正在读取审核内容' : error ? '审核队列加载失败' : `当前没有${cfg.label}`
  const listStateDescription = loading
    ? '正在同步当前筛选结果，请稍候。'
    : error
      ? error
      : `暂时没有符合当前筛选条件的${cfg.label}，可以切换类型或放宽筛选条件。`
  const listStatusLabel = loading
    ? '读取中'
    : error
      ? '读取失败'
      : rows.length > 0
        ? total !== null
          ? `显示 ${rows.length} / 共 ${total} 条`
          : `显示 ${rows.length} 条`
        : '暂无内容'

  const hasActiveFilters = Boolean(
    status !== cfg.defaultStatus ||
    (cfg.showReason && reason !== 'all') ||
    searchInput.trim() !== '' ||
    searchQuery.trim() !== ''
  )

  function handleClearFilters() {
    setStatus(cfg.defaultStatus)
    setReason('all')
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--moderation"
      title="内容审核"
      description="把想法、评论与举报放进同一条审核队列，先判断内容，再执行可见性操作。"
      actions={
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新队列'}
        </Button>
      }
    >
      {/* Claude 胶囊工作视图 Tabs */}
      <Tabs value={mode} onValueChange={(value) => switchMode(value as ModerationMode)} className="admin-capsule-tabs moderation-tabs">
        <TabsList aria-label="审核类型">
          {(Object.keys(MODERATION_TYPES) as ModerationMode[]).map((m) => (
            <TabsTrigger key={m} value={m}>
              {MODERATION_TYPES[m].label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Claude 全要素胶囊筛选轨道（以小说管理为基准，严格单行、紧凑对齐） */}
      <AdminToolbar layout="inline" className="admin-filter-rail moderation-filter-rail" ariaLive="polite">
        <SearchField
          id="moderation-search"
          label="搜索审核内容"
          type="search"
          data-search-field
          placeholder={cfg.searchPlaceholder}
          value={searchInput}
          onChange={handleSearchChange}
        />
        <div className="select-filter-chips">
          <SearchSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
            aria-label="按状态筛选"
            options={cfg.statusOptions.map(([value, label]) => ({ value, label }))}
            value={status}
            onChange={handleStatusChange}
          />
          {cfg.showReason && (
            <SearchSelect
              compact
              chip
              filterChip
              leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size)]" />}
              aria-label="按举报原因筛选"
              options={REASON_OPTIONS.map(([value, label]) => ({ value, label }))}
              value={reason}
              onChange={handleReasonChange}
            />
          )}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
              onClick={handleClearFilters}
            >
              清除筛选
            </Button>
          )}
        </div>
        <div className="admin-filter-rail__status ml-auto shrink-0" aria-live="polite">
          <span className={cn('admin-panel-status tabular-nums text-xs', error && 'is-error')}>
            {listStatusLabel}
          </span>
        </div>
      </AdminToolbar>

      {/* 数据实体直接作为卡片 */}
      <AdminDataPanel className="overflow-hidden moderation-data-panel" ariaLabel={`${cfg.label}列表`} columns={cfg.columns} density="comfortable">
        {loading && rows.length === 0 ? (
          <EmptyState
            icon={<Spinner size="sm" aria-hidden="true" />}
            message="正在读取审核内容…"
            hint="正在同步当前筛选结果，请稍候。"
          />
        ) : error && !loading ? (
          <ErrorState message={`审核队列加载失败：${error}`} />
        ) : hasRows ? (
          <Table className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
            <TableCaption className="sr-only">{`${cfg.label}审核列表，含时间、来源、内容、用户与处理状态`}</TableCaption>
            <TableHeader>
              <TableRow>
                {cfg.head.map((h, i) => (
                  <TableHead key={i} scope="col">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>{renderRows()}</TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={<CircleMinus className="size-8 opacity-40" aria-hidden="true" />}
            message={listStateTitle}
            hint={listStateDescription}
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={handleClearFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        )}
      </AdminDataPanel>
      <Pagination
        variant="detached"
        page={page}
        totalPages={Math.max(1, Math.ceil((total || 0) / pageSize))}
        onPage={setPage}
        busy={loading}
        summary={total === null ? '读取中' : `共 ${total} 条`}
      />
    </AdminPage>
  )
}
