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
import { formatDateTime, timeAgo } from '../../lib/format'
import { useConfirm, useToast } from '../../components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { ErrorState } from "@/components/shared/AsyncStates"
import AdminRowActions from '@/components/admin/AdminRowActions'
import SearchSelect from "@/components/shared/SearchSelect"
import Pagination from "@/components/shared/Pagination"
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { SearchField } from '@/components/shared/SearchField'
import { ReadingDialog, ReadingDialogText, ReadingDialogToolbar } from '@/components/shared/ReadingDialog'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import EmptyState from "@/components/shared/EmptyState"
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Check, CircleMinus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import styles from './moderation.module.css'

type ModerationMode = 'thoughts' | 'comments' | 'reports'

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
  userDisplayName?: string
  userUsername?: string
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
  columns: readonly AdminColumn[]
  statusOptions: Array<[string, string]>
  defaultStatus: string
  showReason: boolean
  searchPlaceholder: string
}

const MODERATION_COLUMNS: Record<ModerationMode, readonly AdminColumn[]> = {
  thoughts: [
    { key: 'thought', label: '内容摘要', width: '34%', primary: true },
    { key: 'source', label: '作品 / 章节', width: '23%' },
    { key: 'user', label: '用户', width: '13%' },
    { key: 'status', label: '可见性', width: '9%' },
    { key: 'time', label: '时间', width: '9%' },
    { key: 'actions', label: '操作', width: '12%', actions: true },
  ],
  comments: [
    { key: 'comment', label: '评论内容', width: '30%', primary: true },
    { key: 'novel', label: '作品', width: '18%' },
    { key: 'user', label: '用户', width: '13%' },
    { key: 'engagement', label: '互动', width: '11%' },
    { key: 'status', label: '可见性', width: '8%' },
    { key: 'time', label: '时间', width: '8%' },
    { key: 'actions', label: '操作', width: '12%', actions: true },
  ],
  reports: [
    { key: 'comment', label: '被举报内容', width: '25%', primary: true },
    { key: 'novel', label: '作品', width: '15%' },
    { key: 'reporter', label: '举报人', width: '12%' },
    { key: 'reason', label: '原因', width: '12%' },
    { key: 'status', label: '处理状态', width: '10%' },
    { key: 'time', label: '时间', width: '8%' },
    { key: 'actions', label: '操作', width: '18%', actions: true },
  ],
}

const MODERATION_TYPES: Record<ModerationMode, ModeConfig> = {
  thoughts: {
    label: '想法',
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
  const name = t.displayName || t.userDisplayName || t.userUsername || '匿名读者'
  return (
    <span className={styles.user}>
      <span className={styles.avatar}>
        <UserAvatar src={t.avatarUrl} name={name} size="inherit" />
      </span>
      <span className={styles.userNames}>
        <span title={name}>{name}</span>
        {t.userUsername && <span className={styles.meta} title={`@${t.userUsername}`}>@{t.userUsername}</span>}
      </span>
    </span>
  )
}

function ModerationTime({ value }: { value: number }) {
  const full = formatDateTime(value)
  return full ? <time dateTime={new Date(value).toISOString()} title={full}>{timeAgo(value)}</time> : <span>未记录</span>
}

/** 每条记录自带 DialogTrigger，使键盘关闭后回到对应正文入口。 */
function ContentPreview({ text, title, source, user, createdAt, quote, imageId, href, chapterSource, note }: {
  text: string; title: string; source?: string; user?: string; createdAt: number
  quote?: string; imageId?: string; href?: string; chapterSource?: boolean; note?: string
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={styles.contentPreview} aria-label={`查看${title}：${text}`}>
          <span className={styles.contentText}>{text}</span>
          {quote && <span className={styles.quote}>引用：{quote}</span>}
          {imageId && <span className={styles.meta}>含图片 · 查看详情</span>}
        </button>
      </DialogTrigger>
      <ReadingDialog title={title} description={source || '未记录来源'} eyebrow={<><span>{user || '匿名读者'}</span><span>{formatDateTime(createdAt) || '时间未记录'}</span></>} bodyLabel={`${title}全文`}>
        <ReadingDialogText>{text}</ReadingDialogText>
        {imageId && <ThoughtImage id={imageId} />}
        {quote && <>
          <ReadingDialogToolbar label="引用原文" />
          <ReadingDialogText>{quote}</ReadingDialogText>
        </>}
        {note && <><ReadingDialogToolbar label="举报说明" /><ReadingDialogText>{note}</ReadingDialogText></>}
        {href && <ReadingDialogToolbar label="来源上下文" actions={<Button variant="outline" size="sm" asChild><Link to={href}>打开{chapterSource ? '章节' : '作品'}</Link></Button>} />}
      </ReadingDialog>
    </Dialog>
  )
}

export default function ModerationTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlMode = searchParams.get('mode')

  const [mode, setMode] = useState<ModerationMode>(() => (isModerationMode(urlMode) ? urlMode : 'thoughts'))
  const [status, setStatus] = useState<string>(() => MODERATION_TYPES[isModerationMode(urlMode) ? urlMode : 'thoughts'].defaultStatus)
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
    setRows([])
    setTotal(null)
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
      message: '确定永久删除这条评论？此操作不可恢复。',
      okText: '删除',
      danger: true,
      items: [c.commentText || c.id],
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
    const href = t.novelId && t.chapterId ? `/read/${encodeURIComponent(t.novelId)}/${encodeURIComponent(t.chapterId)}` : undefined
    const source = t.novelTitle || t.novelId || '未记录作品'
    const chapter = t.chapterTitle || t.chapterId || '未记录章节'
    const paragraph = typeof t.paragraphIndex === 'number' && Number.isInteger(t.paragraphIndex) && t.paragraphIndex >= 0
      ? `第 ${t.paragraphIndex + 1} 段` : '段落未记录'
    return (
      <TableRow key={t.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(idx, rows.length)}ms` }}>
        <TableCell data-primary="" data-label="内容摘要" className={styles.contentCell}>
          <ContentPreview text={t.thoughtText || (t.imageUrl ? '图片想法' : '未填写想法正文')} title="想法详情"
            source={`${source} · ${chapter} · ${paragraph}`} user={t.displayName || t.userDisplayName || t.userUsername}
            createdAt={t.createdAt} quote={t.selectedText} imageId={t.imageUrl ? t.id : undefined} href={href} chapterSource />
        </TableCell>
        <TableCell data-label="作品 / 章节">
          <div className={styles.source}>
            {href ? <Link to={href} title={source}>{source}</Link> : <span title={source}>{source}</span>}
            <span className={styles.meta} title={chapter}>{chapter}</span>
            <span className={styles.meta}>{paragraph}</span>
          </div>
        </TableCell>
        <TableCell data-label="用户"><ThoughtUser t={t} /></TableCell>
        <TableCell data-label="可见性">
          <AdminStatusBadge tone={visible ? 'success' : 'danger'}>{visible ? '可见' : '已隐藏'}</AdminStatusBadge>
        </TableCell>
        <TableCell data-label="时间" className={styles.meta}><ModerationTime value={t.createdAt} /></TableCell>
        <TableCell data-actions="">
          <AdminRowActions label={`想法 ${t.id.slice(0, 8)}`} items={[
            { label: '永久删除', icon: Trash2, danger: true, onSelect: () => void deleteThought(t) },
          ]}>
            <Button variant="ghost" size="sm" onClick={() => void updateThoughtStatus(t.id, visible ? 'hidden' : 'visible')}>
              {visible ? '隐藏' : '恢复'}
            </Button>
          </AdminRowActions>
        </TableCell>
      </TableRow>
    )
  }

  function renderCommentRow(c: CommentRow, idx: number) {
    const visible = (c.status || 'visible') === 'visible'
    const source = c.novelTitle || c.novelId || '未记录作品'
    const user = c.userDisplayName || c.userUsername || c.displayName || c.userId || '匿名读者'
    return (
      <TableRow key={c.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(idx, rows.length)}ms` }}>
        <TableCell data-primary="" data-label="评论内容" className={styles.contentCell}>
          <ContentPreview text={c.commentText || '未填写评论正文'} title="评论详情" source={source} user={user} createdAt={c.createdAt}
            href={c.novelId ? `/novel/${encodeURIComponent(c.novelId)}` : undefined} />
          {c.hasSpoiler && <Badge variant="outline" className={styles.spoiler}>剧透</Badge>}
        </TableCell>
        <TableCell data-label="作品">
          <div className={styles.source}>
            {c.novelId ? <Link to={`/novel/${encodeURIComponent(c.novelId)}`} title={source}>{source}</Link> : <span title={source}>{source}</span>}
            {c.parentId && <span className={styles.meta}>回复评论</span>}
          </div>
        </TableCell>
        <TableCell data-label="用户">
          <div className={styles.userNames}>
            <span title={user}>{user}</span>
            {c.userUsername && <span className={styles.meta} title={`@${c.userUsername}`}>@{c.userUsername}</span>}
          </div>
        </TableCell>
        <TableCell data-label="互动" className={styles.meta}>
          <div>赞 {c.likeCount || 0}</div><div>举报 {c.reportCount || 0}</div>
        </TableCell>
        <TableCell data-label="可见性">
          <AdminStatusBadge tone={visible ? 'success' : 'danger'}>{visible ? '可见' : '已隐藏'}</AdminStatusBadge>
        </TableCell>
        <TableCell data-label="时间" className={styles.meta}><ModerationTime value={c.createdAt} /></TableCell>
        <TableCell data-actions="">
          <AdminRowActions label={`评论 ${c.id.slice(0, 8)}`} items={[
            { label: '永久删除', icon: Trash2, danger: true, onSelect: () => void deleteComment(c) },
          ]}>
            <Button variant="ghost" size="sm" onClick={() => void updateCommentStatus(c.id, visible ? 'hidden' : 'visible')}>
              {visible ? '隐藏' : '恢复'}
            </Button>
          </AdminRowActions>
        </TableCell>
      </TableRow>
    )
  }

  function renderReportRow(r: ReportRow, idx: number) {
    const pending = (r.status || 'open') === 'open'
    const source = r.novelTitle || r.commentNovelId || '未记录作品'
    const reporter = r.reporterDisplayName || r.reporterUsername || r.reportedBy || '匿名读者'
    return (
      <TableRow key={r.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(idx, rows.length)}ms` }}>
        <TableCell data-primary="" data-label="被举报内容" className={styles.contentCell}>
          <ContentPreview text={r.commentText || '评论已删除'} title="举报详情" source={source} user={`举报人：${reporter}`} createdAt={r.createdAt}
            note={`${MODERATION_REASON_LABELS[r.reason || ''] || r.reason || '未记录原因'}${r.note ? `：${r.note}` : ''}`}
            href={r.commentNovelId ? `/novel/${encodeURIComponent(r.commentNovelId)}` : undefined} />
        </TableCell>
        <TableCell data-label="作品">
          <div className={styles.source}>
            {r.commentNovelId ? <Link to={`/novel/${encodeURIComponent(r.commentNovelId)}`} title={source}>{source}</Link> : <span title={source}>{source}</span>}
          </div>
        </TableCell>
        <TableCell data-label="举报人">
          <div className={styles.userNames}>
            <span title={reporter}>{reporter}</span>
            {r.reporterUsername && <span className={styles.meta} title={`@${r.reporterUsername}`}>@{r.reporterUsername}</span>}
          </div>
        </TableCell>
        <TableCell data-label="原因">
          <div className={styles.reason}>
            <span>{MODERATION_REASON_LABELS[r.reason || ''] || r.reason || '未记录原因'}</span>
            {r.note && <span className={styles.meta}>{r.note}</span>}
          </div>
        </TableCell>
        <TableCell data-label="处理状态">
          <AdminStatusBadge tone={r.status === 'resolved' ? 'success' : r.status === 'dismissed' ? 'subtle' : 'warning'}>
            {pending ? '待处理' : r.status === 'resolved' ? '已解决' : r.status === 'dismissed' ? '已驳回' : r.status}
          </AdminStatusBadge>
        </TableCell>
        <TableCell data-label="时间" className={styles.meta}><ModerationTime value={r.createdAt} /></TableCell>
        <TableCell data-actions="">
          {pending ? (
            <AdminRowActions label={`举报 ${r.id.slice(0, 8)}`} items={[
              { label: '解决（保留内容）', icon: Check, onSelect: () => void resolveReport(r.id, 'resolved', 'none') },
              { label: '驳回举报', icon: X, onSelect: () => void resolveReport(r.id, 'dismissed', 'none') },
            ]}>
              <Button size="sm" onClick={() => void resolveReport(r.id, 'resolved', 'hide')}>隐藏并解决</Button>
            </AdminRowActions>
          ) : <span className={styles.meta}>—</span>}
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

  const hasRows = !error && rows.length > 0
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
          ? `共 ${total} 条`
          : `显示 ${rows.length} 条`
        : '暂无内容'

  const hasActiveFilters = Boolean(
    status !== cfg.defaultStatus ||
    (cfg.showReason && reason !== 'all') ||
    searchInput.trim() !== '' ||
    searchQuery.trim() !== ''
  )

  function handleClearFilters() {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setStatus(cfg.defaultStatus)
    setReason('all')
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }

  return (
    <AdminPage
      className="admin-redesign-page--moderation"
      title="内容审核"
      description="管理想法、评论与举报，查看上下文并处理内容。"
    >
      <div className={styles.listControls}>
        <Tabs value={mode} onValueChange={(value) => switchMode(value as ModerationMode)} className={styles.tabs}>
          <TabsList aria-label="审核类型">
            {(Object.keys(MODERATION_TYPES) as ModerationMode[]).map((m) => (
              <TabsTrigger key={m} value={m}>
                {MODERATION_TYPES[m].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AdminToolbar layout="inline" className={styles.toolbar} ariaLive="polite">
          {mode !== 'reports' && <SearchField
            id="moderation-search"
            label="搜索审核内容"
            type="search"
            data-search-field
            placeholder={cfg.searchPlaceholder}
            value={searchInput}
            onChange={handleSearchChange}
          />}
          <div className={styles.filters}>
            <SearchSelect
              compact
              className={styles.statusSelect}
              aria-label={mode === 'reports' ? '按处理状态筛选' : '按可见性筛选'}
              options={cfg.statusOptions.map(([value, label]) => ({ value, label: `${mode === 'reports' ? '处理状态' : '可见性'}：${label}` }))}
              value={status}
              onChange={handleStatusChange}
            />
            {cfg.showReason && (
              <SearchSelect
                compact
                className={styles.statusSelect}
                aria-label="按举报原因筛选"
                options={REASON_OPTIONS.map(([value, label]) => ({ value, label: `原因：${label}` }))}
                value={reason}
                onChange={handleReasonChange}
              />
            )}
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
              >
                清除筛选
              </Button>
            )}
          </div>
          <div className={styles.listActions}>
            <span className={styles.meta} role="status">
              {listStatusLabel}
            </span>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? '刷新中…' : '刷新队列'}
            </Button>
          </div>
        </AdminToolbar>

        <AdminDataPanel className={styles.dataPanel} ariaLabel={`${cfg.label}列表`} columns={cfg.columns} density="comfortable">
          {loading && rows.length === 0 ? (
            <EmptyState
              icon={<Spinner size="sm" aria-hidden="true" />}
              message="正在读取审核内容…"
              hint="正在同步当前筛选结果，请稍候。"
            />
          ) : error && !loading ? (
            <ErrorState message={`审核队列加载失败：${error}`} />
          ) : hasRows ? (
            <Table aria-busy={loading} className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
              <TableCaption className="sr-only">{`${cfg.label}审核列表，含内容、来源、用户、${mode === 'reports' ? '处理状态' : '可见性'}与时间`}</TableCaption>
              <TableHeader>
                <TableRow>
                  {cfg.columns.map((column) => (
                    <TableHead key={column.key} scope="col">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>{renderRows()}</TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<CircleMinus aria-hidden="true" />}
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
      </div>
      <Pagination
        variant="detached"
        page={page}
        totalPages={Math.max(1, Math.ceil((total || 0) / pageSize))}
        onPage={setPage}
        busy={loading}
      />
    </AdminPage>
  )
}
