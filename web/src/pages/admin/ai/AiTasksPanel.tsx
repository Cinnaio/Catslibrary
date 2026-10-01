/** AI 任务管理：查看生成进度、错误和输入 Prompt；有任务运行时自动轮询刷新。 */
import { TaskDetails, TaskSummary } from '../TaskWorkspace'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import type { AdminStatusTone } from '@/lib/admin-status'
import { AdminDialogContent } from '@/components/admin/AdminDialog'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aiApi, newOperationId, type AiTaskInfo } from '@/lib/api'
import { parsePromptView } from '@/lib/prompt-view'
import { useToast, useConfirm } from '@/components/feedback'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import AdminEmptyState from '@/components/admin/AdminEmptyState'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import { kindLabel as taskKindLabel, retryMode, taskStatusLabel, taskStepText } from './labels'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ListFilter, RefreshCw } from 'lucide-react'
import { adminTabPath } from '../admin-registry'

// 有运行中任务时的轮询间隔
const ACTIVE_POLL_INTERVAL = 4000

const AI_TASK_COLUMNS: readonly AdminColumn[] = [
  { key: 'novel', label: '作品 / 类型', width: '27%', primary: true },
  { key: 'status', label: '状态', width: '13%' },
  { key: 'result', label: '进度 / 结果', width: '21%' },
  { key: 'prompt', label: '输入 Prompt', width: '17%' },
  { key: 'actions', label: '操作', actions: true, width: '22%' },
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

  const load = useCallback(async () => {
    try {
      const result = await aiApi.tasks({ limit, offset, status: filterStatus === 'all' ? undefined : filterStatus })
      setTasks(result.items)
      setTotal(result.total)
      setStatusCounts(result.counts || {})
      setError('')
    } catch (err) {
      setError((err as Error).message || '加载 AI 任务失败')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, limit, offset])

  useEffect(() => {
    void load()
  }, [load])

  // 有排队/运行中的任务时自动轮询；页面隐藏暂停，恢复可见立即刷新
  const hasActive = tasks.some((task) => task.status === 'queued' || task.status === 'running')
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => {
      if (document.hidden) return
      void load()
    }, ACTIVE_POLL_INTERVAL)
    const onVisibilityChange = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [hasActive, load])

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
      void load()
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
      void load()
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
      else void load()
    } catch (err) {
      toast((err as Error).message || '删除任务失败', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const detailTask = tasks.find((task) => task.id === detailsId)
  const activeCount = (statusCounts.queued ?? 0) + (statusCounts.running ?? 0)
  const failedCount = statusCounts.failed ?? 0
  function renderRetry(task: AiTask) {
    if (!['failed', 'cancelled'].includes(task.status) || !task.params) return null
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
  return (
    <>
      <TaskSummary
        title={
          loading && !tasks.length
            ? '正在读取 AI 任务'
            : error && !tasks.length
              ? 'AI 任务读取失败'
              : activeCount
                ? `${activeCount} 个任务正在处理`
                : '当前没有进行中的任务'
        }
        hint={failedCount ? `${failedCount} 个任务需要处理，可在列表中查看原因。` : '查看生成进度、输入 Prompt 与任务产出。'}
        counts={`全部 ${statusCounts.all ?? total} · 进行中 ${activeCount} · 已完成 ${statusCounts.completed ?? 0}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            刷新
          </Button>
        }
      />
      <AdminToolbar className="task-workspace-toolbar" ariaLive="polite">
        <div className="task-workspace-filters" role="group" aria-label="AI 任务状态筛选">
          {(['all', 'queued', 'running', 'completed', 'failed', 'cancelled'] as const).map((status) => (
            <Button
              key={status}
              variant="ghost"
              size="sm"
              aria-pressed={filterStatus === status}
              onClick={() => {
                if (filterStatus === status) return
                setLoading(true)
                setOffset(0)
                setFilterStatus(status)
              }}
            >
              {status === 'all' ? '全部' : taskStatusLabel(status)}
              {statusCounts[status] != null && <span>{statusCounts[status]}</span>}
            </Button>
          ))}
        </div>
      </AdminToolbar>
      <AdminDataPanel className="ai-tasks-panel task-workspace-panel overflow-hidden" ariaLabel="AI 任务列表" columns={AI_TASK_COLUMNS}>
        <AdminPanelHeading
          title="AI 任务"
          status={
            <span className={`admin-panel-status${error && tasks.length === 0 ? ' is-error' : ''}`}>
              {loading && !tasks.length ? '读取中' : error && !tasks.length ? '读取失败' : total ? `共 ${total} 条` : '暂无内容'}
            </span>
          }
        />
        <div className="ai-tasks-content">
          {loading && tasks.length === 0 ? (
            <LoadingState label="正在加载 AI 任务" />
          ) : error && tasks.length === 0 ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : tasks.length === 0 && filterStatus !== 'all' ? (
            <AdminEmptyState
              message={`当前筛选条件下暂无${taskStatusLabel(filterStatus)}任务`}
              icon={<ListFilter className="size-8 opacity-40" aria-hidden="true" />}
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
          ) : (
            <>
              {error && <InlineError message={error} onRetry={() => void load()} className="mb-3" />}
              <Table>
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
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell data-primary="" data-label="作品 / 类型">
                        <div className="task-workspace-title">{task.novelTitle || '—'}</div>
                        <div className="task-workspace-meta">
                          {taskKindLabel(task.kind)} ·{' '}
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
                        <button type="button" className="task-workspace-link" onClick={() => setViewingPrompt(task)}>
                          {task.prompt ? '查看输入' : '未记录 Prompt'}
                        </button>
                      </TableCell>
                      <TableCell data-actions="">
                        <div className="admin-cell-actions">
                          {task.batchId && task.current > 0 && props.onViewBatch && (
                            <Button variant="outline" size="sm" onClick={() => props.onViewBatch?.(task.batchId)}>
                              查看产出
                            </Button>
                          )}
                          {renderRetry(task)}
                          <Button variant="ghost" size="sm" onClick={() => setDetailsId(task.id)}>
                            详情
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
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
                  // 改变每页条数后由 Pagination 内部回调 onPage(1) 回到首页，
                  // 这里只需把 offset 一并归零，避免与 limit 变化不同步。
                  onChange: (size) => {
                    setLimit(size)
                    setOffset(0)
                  },
                  options: ADMIN_PAGE_SIZE_OPTIONS,
                }}
              />
            </>
          )}
        </div>
      </AdminDataPanel>
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
            </>
          )
        }
      >
        {detailTask ? (
          <dl className="task-workspace-details">
            <dt>任务 ID</dt>
            <dd className="task-workspace-id">{detailTask.id}</dd>
            <dt>作品</dt>
            <dd>{detailTask.novelTitle || '—'}</dd>
            <dt>类型</dt>
            <dd>{taskKindLabel(detailTask.kind)}</dd>
            <dt>状态</dt>
            <dd>{taskStatusLabel(detailTask.status)}</dd>
            <dt>进度</dt>
            <dd>
              {detailTask.current} / {detailTask.total}
            </dd>
            <dt>结果</dt>
            <dd>{taskStepText(detailTask)}</dd>
            <dt>错误</dt>
            <dd>{detailTask.error || '未记录错误'}</dd>
          </dl>
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
        <AdminDialogContent variant="reading">
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
                <div className="admin-dialog-section-label">
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
                          <details key={`${section.id}-${block.id}-${blockIndex}`} className="ai-prompt-view__block">
                            <summary>
                              <span className="ai-prompt-view__block-title">{block.idLabel}</span>
                              {block.kindLabel && <span className="ai-prompt-view__block-kind">{block.kindLabel}</span>}
                              {block.source && <span className="ai-prompt-view__block-source">{block.source}</span>}
                            </summary>
                            <pre className="ai-prompt-view__block-text">{block.text}</pre>
                          </details>
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
        </AdminDialogContent>
      </Dialog>
    </>
  )
}
