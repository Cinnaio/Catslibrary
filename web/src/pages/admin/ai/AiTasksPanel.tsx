import { watchAiTask } from '@/lib/ai-task-stream'
import AiStreamPreview from '@/components/shared/AiStreamPreview'
import { parseAiTextProgress } from '@shared/ai-text-progress'
import { MotionDetails } from '@/components/ui/motion'
/** AI 任务管理：查看生成进度、错误和输入 Prompt；有任务运行时自动轮询刷新。 */
import { TaskDetails, TaskDetailsFact, TaskDetailsFacts, TaskDetailsIdentifier, TaskDetailsResult, TaskDetailsSection, TaskDetailsSummary } from '../TaskWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { DialogFrame } from "@/components/shared/DialogFrame"
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startPolling } from '@/lib/polling'
import { useNavigate } from 'react-router-dom'
import { aiApi, newOperationId, type AiTaskInfo } from '@/lib/api'
import { parsePromptView } from '@/lib/prompt-view'
import { useToast, useConfirm } from '@/components/feedback'
import { ErrorState, InlineError, LoadingState } from "@/components/shared/AsyncStates"
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import EmptyState from "@/components/shared/EmptyState"
import Pagination from "@/components/shared/Pagination"
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { getAdminTableRowStaggerDelay } from '@/lib/admin-table-motion'
import { AdminDataPanel, type AdminColumn } from '@/components/admin/AdminDataPanel'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { SearchField } from '@/components/shared/SearchField'
import { kindLabel as taskKindLabel, retryMode, taskStatusLabel, taskStepText } from './labels'
import SearchSelect, { type SelectOption } from "@/components/shared/SearchSelect"
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle, CirclePlus, ListFilter, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { adminTabPath } from '../admin-registry'
import { formatDateTime } from '@/lib/format'

// 有运行中任务时的轮询间隔
const ACTIVE_POLL_INTERVAL = 4000

const AI_TASK_COLUMNS: readonly AdminColumn[] = [
  { key: 'novel', label: '作品 / 类型', width: '27%', primary: true },
  { key: 'status', label: '状态', width: '13%' },
  { key: 'result', label: '进度 / 结果', width: '21%' },
  { key: 'prompt', label: '输入 Prompt', width: '21%' },
  { key: 'actions', label: '操作', actions: true, width: '18%' },
]

/** 状态标签沿用后台其它任务列表的柔和填充胶囊，不再使用描边徽章。 */
const TASK_STATUS_TONE: Record<string, AdminStatusTone> = {
  queued: 'info',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'muted',
}

function taskStatusTone(status: string): AdminStatusTone {
  return TASK_STATUS_TONE[status] || 'muted'
}

type TaskStatusFilter = 'all' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
type TaskStatusCounts = Partial<Record<TaskStatusFilter, number>>

type AiTask = AiTaskInfo

export default function AiTasksPanel(props: { onViewBatch?: (batchId: string) => void } = {}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState<TaskStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewingPrompt, setViewingPrompt] = useState<AiTask | null>(null)
  /** Prompt 弹窗的结构化/原始视图切换；关闭弹窗时复位，避免下次打开停留在原始文本。 */
  const [showRawPrompt, setShowRawPrompt] = useState(false)
  const [statusCounts, setStatusCounts] = useState<TaskStatusCounts>({})
  /** 分页：与已生成内容、调用审计同构（offset 分页）。后端 /tasks 已在
   *  listAiTasks 里返回 total 与状态分组计数。 */
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [offset, setOffset] = useState(0)
  const configured = useAiConfigured()

  /**
   * 当前弹窗的 Prompt 结构。prompt 可能是上万字的编译产物（含整章正文），
   * 放在渲染路径里每次重渲染都解析一遍代价过高，故只随 viewingPrompt 变化计算。
   * 解析失败时 structured 为 false，弹窗退回原文展示。
   */
  const promptView = useMemo(() => parsePromptView(viewingPrompt?.prompt || ''), [viewingPrompt])
  const requestSequence = useRef(0)
  const queryKey = `${filterStatus}:${limit}:${offset}`
  const currentQuery = useRef(queryKey)
  currentQuery.current = queryKey
  const inFlight = useRef<{ key: string; promise: Promise<boolean | undefined> } | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async function load(fresh = false): Promise<boolean | undefined> {
    if (!mounted.current || currentQuery.current !== queryKey) return
    const existing = inFlight.current
    if (existing?.key === queryKey) {
      const sequence = requestSequence.current
      const result = await existing.promise
      if (fresh && sequence === requestSequence.current) return await load()
      return result
    }
    const sequence = ++requestSequence.current
    const pending: { key: string; promise: Promise<boolean | undefined> } = { key: queryKey, promise: Promise.resolve(undefined) }
    inFlight.current = pending
    pending.promise = (async () => {
      try {
        const result = await aiApi.tasks({ limit, offset, status: filterStatus === 'all' ? undefined : filterStatus })
        if (sequence !== requestSequence.current || currentQuery.current !== queryKey) return
        setTasks(result.items)
        setTotal(result.total)
        setStatusCounts(result.counts || {})
        setError('')
        return result.items.some(task => task.status === 'queued' || task.status === 'running')
      } catch (err) {
        if (sequence === requestSequence.current && currentQuery.current === queryKey) setError((err as Error).message || '加载 AI 任务失败')
      } finally {
        if (inFlight.current === pending) inFlight.current = null
        if (sequence === requestSequence.current) setLoading(false)
      }
    })()
    return await pending.promise
  }, [filterStatus, limit, offset, queryKey])

  useEffect(() => {
    mounted.current = true
    setLoading(true)
    void load()
    return () => { mounted.current = false; requestSequence.current++; inFlight.current = null }
  }, [load])

  // 有排队/运行中的任务时自动轮询；页面隐藏暂停，恢复可见立即刷新
  const hasActive = tasks.some((task) => task.status === 'queued' || task.status === 'running')
  useEffect(() => {
    if (!hasActive) return
    return startPolling(load, ACTIVE_POLL_INTERVAL, false)
  }, [hasActive, load])

  // Only the open detail needs token-level updates; list polling still discovers new tasks.
  useEffect(() => {
    if (!detailsId) return
    return watchAiTask(detailsId, (next) => setTasks((previous) => previous.map((task) => task.id === next.id ? { ...task, ...next } : task)))
  }, [detailsId])

  async function cancel(id: string) {
    const task = tasks.find((item) => item.id === id)
    const ok = await confirm({
      title: '终止 AI 任务？',
      message: `确定终止${task ? `「${taskKindLabel(task.kind)}」` : ''}任务？已产生的结果和用量记录会保留。`,
      items: [`操作目标：${id}`],
      okText: '终止任务',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.cancelTask(id, newOperationId('ai-task-cancel'))
      toast('AI 任务已取消', 'success')
      void load(true)
    } catch (err) {
      toast((err as Error).message || '取消任务失败', 'error')
    }
  }

  async function retry(id: string) {
    const task = tasks.find((item) => item.id === id)
    const ok = await confirm({
      title: '重新发起 AI 任务？',
      message: '重试会再次调用 AI，并可能产生新的用量。原任务记录会保留。',
      items: [`操作目标：${id}`, ...(task ? [`任务类型：${taskKindLabel(task.kind)}`] : [])],
      okText: '确认重试',
      cancelText: '取消',
    })
    if (!ok) return
    setRetryingId(id)
    try {
      await aiApi.retryTask(id, newOperationId('ai-task-retry'))
      toast('已按原参数重新发起任务', 'success')
      void load(true)
    } catch (err) {
      toast((err as Error).message || '重试失败', 'error')
    } finally {
      setRetryingId(null)
    }
  }

  function adjustAndRetry(task: AiTask) {
    const params = new URLSearchParams({ sub: 'writing' })
    if (task.novelId) params.set('novel', task.novelId)
    navigate(`${adminTabPath('ai')}?${params.toString()}`)
    toast('原参数会被上游再次拒绝，已跳转到创作页，调整内容后可重新发起', 'default')
  }

  async function remove(task: AiTask) {
    const ok = await confirm({
      title: '删除这条任务记录？',
      message: '删除后无法恢复。这是操作性记录，不影响 AI 用量审计。任务下已生成的草稿仍保留在「已生成内容」中。',
      okText: '删除',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setDeletingId(task.id)
    try {
      await aiApi.deleteTask(task.id)
      toast('任务已删除', 'success')
      // 当前页删空时回退一页，避免停在空页（与已生成内容表同构）。
      if (tasks.length === 1 && offset > 0) setOffset(Math.max(0, offset - limit))
      else void load(true)
    } catch (err) {
      toast((err as Error).message || '删除任务失败', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const detailTask = tasks.find((task) => task.id === detailsId)
  const failedCount = statusCounts.failed ?? 0
  function renderRetry(task: AiTask) {
    if (task.kind === 'novel_analysis') {
      let reportId = ''
      try { reportId = String(JSON.parse(task.params || '{}').reportId || '') } catch { /* Historic metadata can be missing. */ }
      return <Button variant="outline" size="sm" onClick={() => navigate(`/admin/ai?${new URLSearchParams({ sub: 'writing', view: 'analysis', novel: task.novelId, report: reportId })}`)}>查看分析报告</Button>
    }
    if (task.kind === 'agent_chat') {
      let sessionId = ''
      try { sessionId = String(JSON.parse(task.params || '{}').sessionId || '') } catch { /* Historic metadata can be missing. */ }
      return <Button variant="outline" size="sm" onClick={() => navigate(`/admin/ai?${new URLSearchParams({ sub: 'agent', novel: task.novelId, session: sessionId })}`)}>返回对话</Button>
    }
    if (!['failed', 'cancelled'].includes(task.status) || !task.params) return null
    if (task.kind === 'selection_image') {
      let chapterId = ''
      try { chapterId = JSON.parse(task.params || '{}').chapterId || '' } catch { /* 历史任务参数可能损坏。 */ }
      return <Button variant="outline" size="sm" onClick={() => navigate(`/read/${encodeURIComponent(task.novelId)}/${encodeURIComponent(chapterId)}`)}>返回阅读器重试</Button>
    }
    return retryMode(task) === 'adjust' ? (
      <Button variant="outline" size="sm" onClick={() => adjustAndRetry(task)}>
        调整后重试
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled={retryingId === task.id} onClick={() => void retry(task.id)}>
        {retryingId === task.id ? '重试中…' : '重试'}
      </Button>
    )
  }
  const displayTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((task) => {
      const title = (task.novelTitle || '').toLowerCase()
      const kind = taskKindLabel(task.kind).toLowerCase()
      const id = (task.id || '').toLowerCase()
      const prompt = (task.prompt || '').toLowerCase()
      return title.includes(q) || kind.includes(q) || id.includes(q) || prompt.includes(q)
    })
  }, [tasks, search])

  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: `全部状态 (${statusCounts.all ?? total})` },
      { value: 'queued', label: `排队中 (${statusCounts.queued ?? 0})` },
      { value: 'running', label: `生成中 (${statusCounts.running ?? 0})` },
      { value: 'completed', label: `已完成 (${statusCounts.completed ?? 0})` },
      { value: 'failed', label: `失败 (${statusCounts.failed ?? 0})` },
      { value: 'cancelled', label: `已取消 (${statusCounts.cancelled ?? 0})` },
    ],
    [statusCounts, total],
  )

  return (
    <>
      <AdminToolbar layout="inline" className="task-workspace-toolbar admin-filter-rail" ariaLive="polite">
        <SearchField
          id="ai-tasks-search"
          label="搜索 AI 任务"
          type="search"
          data-search-field
          placeholder="搜索作品标题、任务类型或 Prompt…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="select-filter-chips">
          <SearchSelect
            compact
            chip
            filterChip
            leadingIcon={<CirclePlus className="size-[var(--select-filter-chip-icon-size,1rem)]" />}
            aria-label="按 AI 任务状态筛选"
            options={statusOptions}
            value={filterStatus}
            onChange={(v) => {
              if (filterStatus === v) return
              setLoading(true)
              setOffset(0)
              setFilterStatus(v as TaskStatusFilter)
            }}
          />
          {failedCount > 0 && (
            <button
              type="button"
              className={cn(
                'task-workspace-alert-badge cursor-pointer transition-colors',
                filterStatus === 'failed' && 'ring-1 ring-[#d97757] font-semibold',
              )}
              onClick={() => {
                setLoading(true)
                setOffset(0)
                setFilterStatus(filterStatus === 'failed' ? 'all' : 'failed')
              }}
              title={filterStatus === 'failed' ? '点击查看全部任务' : '点击快速筛选需处理任务'}
            >
              <AlertCircle className="size-3.5" aria-hidden="true" />
              {failedCount} 个任务需处理
              {filterStatus === 'failed' && <span className="ml-1 text-[11px] opacity-75">✕</span>}
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              void load(true)
            }}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
            刷新
          </Button>
        </div>
      </AdminToolbar>
      <AdminDataPanel className="ai-tasks-panel overflow-hidden" ariaLabel="AI 任务列表" columns={AI_TASK_COLUMNS} density="comfortable">
        {loading && tasks.length === 0 ? (
          <LoadingState label="正在加载 AI 任务" />
        ) : error && tasks.length === 0 ? (
          <ErrorState message={`AI 任务加载失败：${error}`} />
        ) : tasks.length === 0 && filterStatus !== 'all' ? (
          <EmptyState
            message={`当前筛选条件下暂无${taskStatusLabel(filterStatus)}任务`}
            icon={<ListFilter aria-hidden="true" />}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true)
                  setOffset(0)
                  setFilterStatus('all')
                }}
              >
                清除状态筛选
              </Button>
            }
          />
        ) : tasks.length === 0 ? (
          <AiPanelEmptyState
            configured={configured}
            unconfiguredMessage="尚未配置文本 AI 供应商，无法发起生成任务"
            unconfiguredHint="配置文本供应商后，才能从「AI 创作」发起任务。"
            emptyMessage="暂无 AI 任务"
            hint="在「AI 创作」或「封面生成」里发起任务后，这里会显示进度与失败原因。"
          />
        ) : displayTasks.length === 0 ? (
          <EmptyState
            message={`未找到与「${search.trim()}」相关的 AI 任务`}
            icon={<ListFilter aria-hidden="true" />}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearch('')}
              >
                清空搜索
              </Button>
            }
          />
        ) : (
          <>
            {error && <InlineError message={error} onRetry={() => void load()} className="mb-3" />}
            <Table className={cn('admin-data-table admin-data-table--animated', loading && 'admin-data-table--transitioning')}>
              <TableCaption className="sr-only">AI 任务列表，含类型、小说、状态、进度、结果与输入 Prompt</TableCaption>
              <TableHeader>
                <TableRow>
                  {AI_TASK_COLUMNS.map((column) => (
                    <TableHead key={column.key} scope="col">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody key={limit}>
                {displayTasks.map((task, index) => (
                  <TableRow key={task.id} style={{ animationDelay: `${getAdminTableRowStaggerDelay(index, displayTasks.length)}ms` }}>
                    <TableCell data-primary="" data-label="作品 / 类型">
                      <strong className="task-workspace-title font-medium">
                        {task.novelTitle || taskKindLabel(task.kind)}
                      </strong>
                      <div className="task-workspace-meta">
                        {task.novelTitle ? `${taskKindLabel(task.kind)} · ` : ''}
                        <span className="task-workspace-id" title={task.id}>
                          {task.id.slice(0, 12)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell data-label="状态">
                      <AdminStatusBadge tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status)}</AdminStatusBadge>
                    </TableCell>
                    <TableCell data-label="进度 / 结果">
                      <div className="task-workspace-cell">
                        <span className="tabular-nums">
                          {task.current} / {task.total} 个步骤
                        </span>
                        <span className="task-workspace-meta">{taskStepText(task)}</span>
                        {task.error && <span className="task-workspace-error">{task.error}</span>}
                      </div>
                    </TableCell>
                    <TableCell data-label="输入 Prompt">
                      {task.prompt ? (
                        <button
                          type="button"
                          className="ai-task-prompt-button"
                          onClick={() => setViewingPrompt(task)}
                          title="点击查看完整 Prompt"
                        >
                          <span className="ai-task-prompt text-xs text-muted-foreground">{task.prompt}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">未记录 Prompt</span>
                      )}
                    </TableCell>
                    <TableCell data-actions="">
                      <div className="admin-cell-actions">
                        {task.batchId && task.current > 0 && props.onViewBatch && (
                          <Button variant="outline" size="sm" onClick={() => props.onViewBatch?.(task.batchId)}>
                            查看产出
                          </Button>
                        )}
                        {renderRetry(task)}
                        <Button variant="outline" size="sm" onClick={() => setDetailsId(task.id)}>
                          详情
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </AdminDataPanel>
      {tasks.length > 0 && (
        <Pagination
          variant="detached"
          page={Math.floor(offset / limit) + 1}
          totalPages={Math.max(1, Math.ceil(total / limit))}
          onPage={(page) => setOffset((page - 1) * limit)}
          busy={loading}
          summary={
            <>
              共 {total} 条，显示 {offset + 1}-{Math.min(offset + limit, total)}
            </>
          }
          pageSize={{
            value: limit,
            onChange: (size) => {
              setLimit(size)
              setOffset(0)
            },
            options: ADMIN_PAGE_SIZE_OPTIONS,
          }}
        />
      )}
      <p className="task-workspace-footnote">重试会再次调用 AI；删除任务记录后，已生成内容与用量审计仍保留。</p>
      <TaskDetails
        open={detailsId != null}
        onClose={() => setDetailsId(null)}
        actions={
          detailTask && (
            <>
              {['queued', 'running'].includes(detailTask.status) && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDetailsId(null)
                    void cancel(detailTask.id)
                  }}
                >
                  终止任务
                </Button>
              )}
              {['completed', 'failed', 'cancelled'].includes(detailTask.status) && (
                <Button
                  variant="destructive"
                  disabled={deletingId === detailTask.id}
                  onClick={() => {
                    setDetailsId(null)
                    void remove(detailTask)
                  }}
                >
                  删除记录
                </Button>
              )}
              {renderRetry(detailTask)}
              {detailTask.batchId && detailTask.current > 0 && props.onViewBatch && (
                <Button onClick={() => {
                  setDetailsId(null)
                  props.onViewBatch?.(detailTask.batchId)
                }}>查看产出</Button>
              )}
            </>
          )
        }
      >
        {detailTask ? (
          <>
            <TaskDetailsSummary
              title={detailTask.novelTitle || (detailTask.novelId ? '作品标题未提供' : '未关联作品')}
              meta={taskKindLabel(detailTask.kind)}
              status={<AdminStatusBadge tone={taskStatusTone(detailTask.status)}>{taskStatusLabel(detailTask.status)}</AdminStatusBadge>}
            />
            <TaskDetailsSection label={['queued', 'running'].includes(detailTask.status) ? '执行进度' : '执行结果'}>
              <TaskDetailsResult
                value={taskStepText(detailTask)}
                hint={detailTask.total > 0
                  ? `已处理 ${detailTask.current} / ${detailTask.total} 个步骤`
                  : detailTask.current > 0 ? `已处理 ${detailTask.current} 个步骤 · 总数未提供` : '处理数量未提供'}
              />
            </TaskDetailsSection>
            <AiStreamPreview progress={parseAiTextProgress(detailTask.result)} stopped={!['queued', 'running'].includes(detailTask.status)} structured={['plot_state', 'relationship_profile', 'content_rating_review', 'cover_prompt'].includes(detailTask.kind)} />
            {detailTask.error && (
              <TaskDetailsSection label="错误原因" tone="danger">{detailTask.error}</TaskDetailsSection>
            )}
            <TaskDetailsSection label="执行记录">
              <TaskDetailsFacts>
                <TaskDetailsFact label="创建时间">{formatDateTime(detailTask.createdAt) || '未记录'}</TaskDetailsFact>
                <TaskDetailsFact label={detailTask.finishedAt ? '结束时间' : '最近更新'}>
                  {formatDateTime(detailTask.finishedAt || detailTask.updatedAt) || '未记录'}
                </TaskDetailsFact>
              </TaskDetailsFacts>
            </TaskDetailsSection>
            <TaskDetailsIdentifier id={detailTask.id} />
          </>
        ) : (
          <p>任务记录已不在当前列表，请刷新后查看。</p>
        )}
      </TaskDetails>
      <Dialog
        open={!!viewingPrompt}
        onOpenChange={(open) => {
          if (!open) {
            setViewingPrompt(null)
            setShowRawPrompt(false)
          }
        }}
      >
        <DialogFrame variant="reading">
          <DialogHeader>
            <DialogTitle>{viewingPrompt ? `${taskKindLabel(viewingPrompt.kind)} · 输入 Prompt` : '输入 Prompt'}</DialogTitle>
            <DialogDescription>
              {promptView.structured
                ? '这是实际提交给 AI 服务的完整 Prompt，已按材料块整理；可由「原始文本」查看未经排版的内容。'
                : '查看提交给 AI 服务的完整 Prompt，仅供查看，不会修改任务记录。'}
            </DialogDescription>
          </DialogHeader>
          {viewingPrompt && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              {/* 视图切换：结构化视图便于阅读，原始文本用于逐字核对。
                  没有解析出材料块（封面图像 prompt、选段改写、旧版编译器输出）时
                  不提供切换按钮，但仍保留区段标签，与其它弹窗的读法一致。 */}
              <div className="ai-prompt-view__switch shrink-0">
                <div className="dialog-frame-section-label">
                  {promptView.structured ? (showRawPrompt ? '原始文本' : `材料块 · ${promptView.blockCount} 块`) : '输入 Prompt'}
                </div>
                {promptView.structured && (
                  <Button variant="outline" size="sm" onClick={() => setShowRawPrompt((prev) => !prev)}>
                    {showRawPrompt ? '结构化视图' : '原始文本'}
                  </Button>
                )}
              </div>
              <div className="ai-prompt-view min-h-0 flex-1 overflow-y-auto">
                {!viewingPrompt.prompt ? (
                  <p className="text-sm text-muted-foreground">未记录 Prompt</p>
                ) : showRawPrompt || !promptView.structured ? (
                  <pre className="ai-prompt-view__raw">{viewingPrompt.prompt}</pre>
                ) : (
                  <>
                    {promptView.version && (
                      <p className="ai-prompt-view__meta">
                        提示词流水线版本 {promptView.version}
                        {promptView.hasInstructions ? ' · 含本次任务要求' : ''}
                      </p>
                    )}
                    {promptView.sections.map((section) => (
                      <section key={section.id} className="ai-prompt-view__section" data-instructions={section.instructions ? '' : undefined}>
                        <header className="ai-prompt-view__section-head">
                          <h4>{section.label}</h4>
                          <span>{section.hint}</span>
                        </header>
                        {section.blocks.map((block, blockIndex) => (
                          <MotionDetails key={`${section.id}-${block.id}-${blockIndex}`} className="ai-prompt-view__block">
                            <summary>
                              <span className="ai-prompt-view__block-title">{block.idLabel}</span>
                              {block.kindLabel && <span className="ai-prompt-view__block-kind">{block.kindLabel}</span>}
                              {block.source && <span className="ai-prompt-view__block-source">{block.source}</span>}
                            </summary>
                            <pre className="ai-prompt-view__block-text">{block.text}</pre>
                          </MotionDetails>
                        ))}
                      </section>
                    ))}
                    {/* 尾部文本（如「输出要求：…」）不套在材料结构里，单独平铺。 */}
                    {promptView.notes.map((note, index) => (
                      <p key={`prompt-note-${index}`} className="ai-prompt-view__note">
                        {note}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogFrame>
      </Dialog>
    </>
  )
}
