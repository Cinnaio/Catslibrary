/** AI 任务管理：查看生成进度、错误和输入 Prompt；有任务运行时自动轮询刷新。 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, newOperationId, type AiTaskInfo } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { ErrorState, InlineError, LoadingState } from '@/components/admin/AsyncStates'
import AiPanelEmptyState from './AiPanelEmptyState'
import { useAiConfigured } from './useAiConfigured'
import Pagination from '@/components/admin/Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'
import { AdminDataPanel, AdminPanelHeading, AdminToolbar, type AdminColumn } from '@/components/admin/AdminWorkspace'
import { kindLabel as taskKindLabel, taskStatusLabel, taskStepText } from './labels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// 有运行中任务时的轮询间隔
const ACTIVE_POLL_INTERVAL = 4000

/**
 * 表格列定义：与小说管理、章节管理同一套契约 —— 桌面端据此固定列宽，
 * 移动端据此折成卡片并显示字段名。顺序必须与 thead/tbody 单元格顺序一致，
 * 且每格必须标注 data-label / data-primary / data-actions。
 *
 * 宽度全部用百分比：fixed 布局下百分比与 rem 混用时定长列会先吃掉宽度
 * （见 NovelsTab 的同名注释）。合计 100%，任何宽度下等比缩放。
 * 操作列给到 24%：本面板是文字按钮（取消任务/查看产出/重试/删除），
 * 一行最多三个，比范本的图标按钮宽得多，按 11% 排会被裁切。
 */
const AI_TASK_COLUMNS: readonly AdminColumn[] = [
  { key: 'kind', label: '类型', width: '10%' },
  { key: 'status', label: '状态', width: '10%' },
  { key: 'progress', label: '进度', width: '7%' },
  { key: 'step', label: '当前步骤', width: '19%', primary: true },
  { key: 'prompt', label: '输入 Prompt', width: '23%' },
  { key: 'actions', actions: true, width: '31%' },
]

type AiTask = AiTaskInfo

export default function AiTasksPanel(props: { onViewBatch?: (batchId: string) => void } = {}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>('all')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  /** 分页：与已生成内容、调用审计同构（offset 分页）。后端 /tasks 已在
   *  listAiTasks 里返回 total，无需改接口。 */
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(ADMIN_DEFAULT_PAGE_SIZE)
  const [offset, setOffset] = useState(0)
  const configured = useAiConfigured()

  const load = useCallback(async () => {
    try {
      const result = await aiApi.tasks({ limit, offset, status: filterStatus === 'all' ? undefined : filterStatus })
      setTasks(result.items)
      setTotal(result.total)
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

  return (
    <>
      <AdminDataPanel className="ai-tasks-panel overflow-hidden" ariaLabel="AI 任务列表" columns={AI_TASK_COLUMNS}>
        <AdminPanelHeading
          title="任务列表"
          description="独立于爬取任务，查看生成进度、错误和输入 Prompt。"
          status={
            <span className={`admin-panel-status${error && tasks.length === 0 ? ' is-error' : ''}`}>
              {loading && tasks.length === 0 ? '读取中' : error && tasks.length === 0 ? '读取失败' : total ? `共 ${total} 条` : '暂无内容'}
            </span>
          }
        />
        {/* 筛选条属于面板内部：它只筛「任务列表」这一份数据，与标题、列表构成
          同一个属主。外置会把它变成与数据面板等权的第二个表面。 */}
        <AdminToolbar className="ai-tasks-toolbar" ariaLive="polite">
          <Label htmlFor="task-filter-status" className="text-xs text-muted-foreground">
            状态
          </Label>
          <Select
            value={filterStatus}
            onValueChange={(v) => {
              setLoading(true)
              // 换筛选条件必须回第 1 页：留在原 offset 会落在越界区间，
              // 表现为「筛完一片空白」。
              setOffset(0)
              setFilterStatus(v as typeof filterStatus)
            }}
          >
            <SelectTrigger size="sm" id="task-filter-status" className="min-w-[7.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={4}>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="queued">排队中</SelectItem>
              <SelectItem value="running">生成中</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
            </SelectContent>
          </Select>
        </AdminToolbar>
        <div className="ai-tasks-content">
          {loading && tasks.length === 0 ? (
            <LoadingState label="正在加载 AI 任务" />
          ) : error && tasks.length === 0 ? (
            <ErrorState message={error} onRetry={() => void load()} />
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
                <TableCaption className="sr-only">AI 任务列表，含类型、状态、进度、结果与输入 Prompt</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">类型</TableHead>
                    <TableHead scope="col">状态</TableHead>
                    <TableHead scope="col">进度</TableHead>
                    <TableHead scope="col">结果</TableHead>
                    <TableHead scope="col">输入 Prompt</TableHead>
                    <TableHead scope="col">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell data-label="类型">
                        <Badge variant="secondary">{taskKindLabel(task.kind)}</Badge>
                      </TableCell>
                      <TableCell data-label="状态">
                        <Badge variant={task.status === 'failed' ? 'destructive' : 'outline'}>{taskStatusLabel(task.status)}</Badge>
                      </TableCell>
                      <TableCell data-label="进度" className="tabular-nums">
                        {task.current} / {task.total}
                      </TableCell>
                      <TableCell data-primary="" data-label="结果">
                        <span className="ai-task-step">{taskStepText(task)}</span>
                        {task.error && <span className="ai-task-error">{task.error}</span>}
                      </TableCell>
                      <TableCell data-label="输入 Prompt" className="text-xs text-muted-foreground">
                        <span className="ai-task-prompt" title={task.prompt}>
                          {task.prompt || '无'}
                        </span>
                      </TableCell>
                      <TableCell data-actions="">
                        <div className="admin-cell-actions">
                          {(task.status === 'queued' || task.status === 'running') && (
                            <Button variant="outline" size="sm" onClick={() => void cancel(task.id)}>
                              取消任务
                            </Button>
                          )}
                          {/* 部分完成的批次（失败/取消但已产出若干章）也能从这里找到草稿 */}
                          {task.batchId && task.current > 0 && props.onViewBatch && (
                            <Button variant="outline" size="sm" onClick={() => props.onViewBatch?.(task.batchId)}>
                              查看产出
                            </Button>
                          )}
                          {(task.status === 'failed' || task.status === 'cancelled') && !!task.params && (
                            <Button variant="outline" size="sm" disabled={retryingId === task.id} onClick={() => void retry(task.id)}>
                              {retryingId === task.id ? '重试中…' : '重试'}
                            </Button>
                          )}
                          {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={deletingId === task.id}
                              onClick={() => void remove(task)}
                            >
                              {deletingId === task.id ? '删除中…' : '删除'}
                            </Button>
                          )}
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
    </>
  )
}
