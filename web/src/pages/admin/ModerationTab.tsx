/**
 * 内容审核 tab —— 想法 / 评论 / 举报（单一数据驱动组件）。
 * 由 Novel-KV js/admin-moderation.js + admin.html #tab-moderation 平移。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, thoughtsApi, url } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { useConfirm, useToast } from '../../components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import CustomSelect from '../../components/admin/CustomSelect'
import { AdminDataPanel, AdminPanelHeading, AdminSearch, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type ModerationMode = 'thoughts' | 'comments' | 'reports'

const MODERATION_MODE_INDEX: Record<ModerationMode, number> = {
  thoughts: 0,
  comments: 1,
  reports: 2,
}

interface ThoughtRow {
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
  showUser: boolean
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
    head: ['时间', '小说 / 章节', '段落', '划选文字', '想法', '昵称', '状态', ''],
    columns: MODERATION_COLUMNS.thoughts,
    statusOptions: [
      ['all', '全部'],
      ['visible', '可见'],
      ['hidden', '已隐藏'],
    ],
    defaultStatus: 'all',
    showUser: true,
    showReason: false,
    searchPlaceholder: '搜索小说/章节/想法…',
  },
  comments: {
    label: '评论',
    head: ['时间', '小说', '用户', '评论', '互动', '状态', ''],
    columns: MODERATION_COLUMNS.comments,
    statusOptions: [
      ['all', '全部'],
      ['visible', '可见'],
      ['hidden', '已隐藏'],
    ],
    defaultStatus: 'all',
    showUser: true,
    showReason: false,
    searchPlaceholder: '搜索小说/用户/评论…',
  },
  reports: {
    label: '举报',
    head: ['时间', '小说', '评论', '举报人', '原因', '状态', ''],
    columns: MODERATION_COLUMNS.reports,
    statusOptions: [
      ['open', '待处理'],
      ['resolved', '已解决'],
      ['dismissed', '已驳回'],
      ['all', '全部'],
    ],
    defaultStatus: 'open',
    showUser: false,
    showReason: true,
    searchPlaceholder: '搜索小说/评论…',
  },
}

type AnyRow = ThoughtRow | CommentRow | ReportRow

function ThoughtUser({ t }: { t: ThoughtRow }) {
  // 头像失败走 state 兜底（不能 remove() React 管理的节点）；无 img 时 CSS :has 让首字显示
  const [avatarFailed, setAvatarFailed] = useState(false)
  const name = t.displayName || '匿名读者'
  return (
    <span className="thought-admin-user">
      <span className="thought-admin-avatar">
        {t.avatarUrl && !avatarFailed ? <img src={url(t.avatarUrl)} alt="" onError={() => setAvatarFailed(true)} /> : null}
        <span>{name.slice(0, 1)}</span>
      </span>
      <span>{name}</span>
    </span>
  )
}

export default function ModerationTab(_props: { highlightNovelId?: string; onHighlightConsumed?: () => void }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [mode, setMode] = useState<ModerationMode>('thoughts')
  const [status, setStatus] = useState<string>('all')
  const [reason, setReason] = useState<string>('all')
  const [userInput, setUserInput] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [rows, setRows] = useState<AnyRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadingRef = useRef(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cfg = MODERATION_TYPES[mode]
  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    setRows([])
    setTotal(null)
    try {
      if (mode === 'thoughts') {
        const d = await thoughtsApi.adminList({ status, userId: userQuery, search: searchQuery, limit: '80' })
        setRows((d.thoughts || []) as ThoughtRow[])
        setTotal(d.total || 0)
      } else if (mode === 'comments') {
        const d = await adminApi.comments.list({ status, userId: userQuery, search: searchQuery, limit: '80' })
        setRows((d.comments || []) as CommentRow[])
        setTotal(d.total || 0)
      } else {
        const d = await adminApi.commentReports.list({ status, reason, limit: '80' })
        setRows((d.reports || []) as ReportRow[])
        setTotal(d.total || 0)
      }
    } catch (err) {
      setError((err as Error).message || '未知错误')
      toast(`${MODERATION_TYPES[mode].label}列表加载失败`, 'error')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [mode, status, reason, userQuery, searchQuery, toast])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, reason, userQuery, searchQuery])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      if (userTimer.current) clearTimeout(userTimer.current)
    }
  }, [])

  function switchMode(next: ModerationMode) {
    if (next === mode) return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (userTimer.current) clearTimeout(userTimer.current)
    setMode(next)
    setStatus(MODERATION_TYPES[next].defaultStatus)
    setReason('all')
    setUserInput('')
    setUserQuery('')
    setSearchInput('')
    setSearchQuery('')
  }

  function handleStatusChange(value: string) {
    setStatus(value || 'all')
  }

  function handleReasonChange(value: string) {
    setReason(value || 'all')
  }

  function handleUserChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setUserInput(v)
    if (userTimer.current) clearTimeout(userTimer.current)
    userTimer.current = setTimeout(() => setUserQuery(v.trim()), 250)
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearchQuery(v.trim()), 250)
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

  function renderThoughtRow(t: ThoughtRow) {
    const visible = (t.status || 'visible') === 'visible'
    const readable = t.novelId && t.chapterId
    const link = readable ? (
      <Link to={`/read/${encodeURIComponent(t.novelId)}/${encodeURIComponent(t.chapterId)}`}>
        <strong>{t.novelTitle || t.novelId}</strong>
        <br />
        <span className="text-sm text-muted-foreground">{t.chapterTitle || t.chapterId}</span>
      </Link>
    ) : (
      <>
        <strong>{t.novelTitle || t.novelId}</strong>
        <br />
        <span className="text-sm text-muted-foreground">{t.chapterTitle || t.chapterId}</span>
      </>
    )
    return (
      <TableRow key={t.id}>
        <TableCell data-label="时间" className="text-sm text-muted-foreground">
          {timeAgo(t.createdAt)}
        </TableCell>
        <TableCell data-label="小说 / 章节" className="moderation-source-cell">
          {link}
        </TableCell>
        <TableCell data-label="段落">{String((t.paragraphIndex || 0) + 1)}</TableCell>
        <TableCell data-label="划选文字" className="thought-admin-cell">
          {t.selectedText || '—'}
        </TableCell>
        <TableCell data-primary="" data-label="想法" className="thought-admin-cell">
          <strong>{t.thoughtText || '—'}</strong>
        </TableCell>
        <TableCell data-label="昵称">
          <ThoughtUser t={t} />
        </TableCell>
        <TableCell data-label="状态">
          <Badge className={visible ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>{visible ? '可见' : '已隐藏'}</Badge>
        </TableCell>
        <TableCell data-actions="">
          <div className="admin-cell-actions">
            {visible ? (
              <Button variant="ghost" size="sm" title="隐藏" onClick={() => void updateThoughtStatus(t.id, 'hidden')}>
                隐藏
              </Button>
            ) : (
              <Button variant="ghost" size="sm" title="恢复" onClick={() => void updateThoughtStatus(t.id, 'visible')}>
                恢复
              </Button>
            )}
            <Button variant="ghost" size="sm" title="永久删除" onClick={() => void deleteThought(t)}>
              删除
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  function renderCommentRow(c: CommentRow) {
    const visible = (c.status || 'visible') === 'visible'
    return (
      <TableRow key={c.id}>
        <TableCell data-label="时间" className="text-sm text-muted-foreground">
          {timeAgo(c.createdAt)}
        </TableCell>
        <TableCell data-label="小说" className="moderation-source-cell">
          {c.novelId ? (
            <Link to={`/novel/${encodeURIComponent(c.novelId)}`}>
              <strong>{c.novelTitle || c.novelId}</strong>
            </Link>
          ) : (
            <strong>{c.novelTitle || c.novelId}</strong>
          )}
          {c.parentId ? (
            <>
              <br />
              <span className="text-sm text-muted-foreground">回复</span>
            </>
          ) : null}
        </TableCell>
        <TableCell data-label="用户">{c.userDisplayName || c.userUsername || c.displayName || c.userId || '—'}</TableCell>
        <TableCell data-primary="" data-label="评论" className="thought-admin-cell">
          <strong>{c.commentText || '—'}</strong>
          {c.hasSpoiler ? (
            <>
              <br />
              <Badge className="mt-1 bg-accent/10 text-accent">剧透</Badge>
            </>
          ) : null}
        </TableCell>
        <TableCell data-label="互动" className="text-sm text-muted-foreground">
          赞 {c.likeCount || 0}
          <br />
          举报 {c.reportCount || 0}
        </TableCell>
        <TableCell data-label="状态">
          <Badge className={visible ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>{visible ? '可见' : '已隐藏'}</Badge>
        </TableCell>
        <TableCell data-actions="">
          <div className="admin-cell-actions">
            {visible ? (
              <Button variant="ghost" size="sm" title="隐藏" onClick={() => void updateCommentStatus(c.id, 'hidden')}>
                隐藏
              </Button>
            ) : (
              <Button variant="ghost" size="sm" title="恢复" onClick={() => void updateCommentStatus(c.id, 'visible')}>
                恢复
              </Button>
            )}
            <Button variant="ghost" size="sm" title="永久删除" onClick={() => void deleteComment(c)}>
              删除
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  function renderReportRow(r: ReportRow) {
    const pending = (r.status || 'open') === 'open'
    return (
      <TableRow key={r.id}>
        <TableCell data-label="时间" className="text-sm text-muted-foreground">
          {timeAgo(r.createdAt)}
        </TableCell>
        <TableCell data-label="小说" className="moderation-source-cell">
          {r.commentNovelId ? (
            <Link to={`/novel/${encodeURIComponent(r.commentNovelId)}`}>{r.novelTitle || r.commentNovelId || '—'}</Link>
          ) : (
            r.novelTitle || '—'
          )}
        </TableCell>
        <TableCell data-primary="" data-label="评论" className="thought-admin-cell">
          {r.commentText || '评论已删除'}
        </TableCell>
        <TableCell data-label="举报人">{r.reporterDisplayName || r.reporterUsername || r.reportedBy || '—'}</TableCell>
        <TableCell data-label="原因">
          {MODERATION_REASON_LABELS[r.reason || ''] || r.reason}
          {r.note ? (
            <>
              <br />
              <span className="text-sm text-muted-foreground">{r.note}</span>
            </>
          ) : null}
        </TableCell>
        <TableCell data-label="状态">
          <Badge
            className={
              r.status === 'resolved'
                ? 'bg-success/10 text-success'
                : r.status === 'dismissed'
                  ? 'bg-muted/20 text-muted-foreground'
                  : 'bg-warning/10 text-warning'
            }
          >
            {r.status}
          </Badge>
        </TableCell>
        <TableCell data-actions="">
          {pending ? (
            <div className="admin-cell-actions">
              <Button variant="ghost" size="sm" title="隐藏并解决" onClick={() => void resolveReport(r.id, 'resolved', 'hide')}>
                隐藏并解决
              </Button>
              <Button variant="ghost" size="sm" title="解决" onClick={() => void resolveReport(r.id, 'resolved', 'none')}>
                解决
              </Button>
              <Button variant="ghost" size="sm" title="驳回" onClick={() => void resolveReport(r.id, 'dismissed', 'none')}>
                驳回
              </Button>
            </div>
          ) : (
            '—'
          )}
        </TableCell>
      </TableRow>
    )
  }

  function renderRows() {
    return rows.map((r) => {
      if (mode === 'thoughts') return renderThoughtRow(r as ThoughtRow)
      if (mode === 'comments') return renderCommentRow(r as CommentRow)
      return renderReportRow(r as ReportRow)
    })
  }

  const hasRows = !loading && !error && rows.length > 0
  const listStateTitle = loading ? '正在读取审核内容' : error ? '审核队列加载失败' : `当前没有${cfg.label}`
  const listStateDescription = loading
    ? '正在同步当前筛选结果，请稍候。'
    : error
      ? error
      : `暂时没有符合当前筛选条件的${cfg.label}，可以切换类型或放宽筛选条件。`
  const listStatusLabel = loading ? '读取中' : error ? '读取失败' : rows.length > 0 ? `显示 ${rows.length} 条` : '暂无内容'

  return (
    <AdminPage
      className="admin-redesign-page admin-redesign-page--moderation"
      title="内容审核"
      description="把想法、评论与举报放进同一条审核队列，先判断内容，再执行可见性操作。"
      meta={total !== null ? `共 ${total} 条` : '审核队列'}
      actions={
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新队列'}
        </Button>
      }
    >
      <AdminToolbar className="moderation-toolbar" ariaLive="polite">
        <div className="moderation-toolbar__filters">
          <span className="moderation-toolbar__label">审核类型</span>
          <Tabs className="moderation-toolbar__modes" value={mode} onValueChange={(v) => switchMode(v as ModerationMode)}>
            <TabsList data-active-index={MODERATION_MODE_INDEX[mode]}>
              {(Object.keys(MODERATION_TYPES) as ModerationMode[]).map((m) => (
                <TabsTrigger key={m} value={m}>
                  {MODERATION_TYPES[m].label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="moderation-toolbar__field-label">状态</span>
          <CustomSelect
            className="moderation-toolbar__status admin-input--select-sm"
            compact
            options={cfg.statusOptions.map(([value, label]) => ({ value, label }))}
            value={status}
            aria-label="状态筛选"
            onChange={handleStatusChange}
          />
          <span
            className={`moderation-toolbar__field-label${cfg.showReason ? '' : ' moderation-toolbar__field-label--placeholder'}`}
            aria-hidden={!cfg.showReason}
          >
            原因
          </span>
          {cfg.showReason ? (
            <CustomSelect
              className="moderation-toolbar__reason admin-input--select-sm"
              compact
              options={REASON_OPTIONS.map(([value, label]) => ({ value, label }))}
              value={reason}
              aria-label="举报原因筛选"
              onChange={handleReasonChange}
            />
          ) : (
            <span className="moderation-toolbar__reason moderation-toolbar__reason-placeholder" aria-hidden="true" />
          )}
        </div>
        <div className={`moderation-toolbar__query${cfg.showUser ? '' : ' moderation-toolbar__query--without-user'}`}>
          <span className="moderation-toolbar__label">查找内容</span>
          {cfg.showUser ? (
            <Input
              type="text"
              className="moderation-toolbar__user admin-input--compact"
              aria-label="用户 ID"
              placeholder="用户ID"
              value={userInput}
              onChange={handleUserChange}
            />
          ) : (
            <span className="moderation-toolbar__user moderation-toolbar__user-placeholder" aria-hidden="true" />
          )}
          <div className="moderation-toolbar__search-field">
            <AdminSearch
              id="moderation-search"
              label="搜索审核内容"
              type="search"
              className="moderation-toolbar__search-input admin-input--compact"
              data-admin-search
              placeholder={cfg.searchPlaceholder}
              value={searchInput}
              onChange={handleSearchChange}
            />
          </div>
        </div>
      </AdminToolbar>
      <AdminDataPanel className="overflow-hidden" ariaLabel="审核列表" columns={cfg.columns}>
        <AdminPanelHeading
          title="审核列表"
          description={`当前查看${cfg.label}，先确认内容上下文，再执行可见性操作。`}
          status={<span className={`moderation-list-status${error ? ' is-error' : ''}`}>{listStatusLabel}</span>}
        />
        {hasRows ? (
          <Table>
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
          <div className={`moderation-empty${error ? ' moderation-empty--error' : ''}`} role={error ? 'alert' : 'status'}>
            <strong>{listStateTitle}</strong>
            <p>{listStateDescription}</p>
          </div>
        )}
      </AdminDataPanel>
    </AdminPage>
  )
}
