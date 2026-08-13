/** AI 任务管理：查看生成进度、错误和输入 Prompt；有任务运行时自动轮询刷新。 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, type AiTaskInfo } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// 有运行中任务时的轮询间隔
const ACTIVE_POLL_INTERVAL = 4000

function taskKindLabel(kind: string): string {
  return kind === 'continue' ? '续写' : kind === 'write_outline' ? '创作大纲' : kind === 'write_chapter' ? '创作章节' : kind
}

function taskStatusLabel(status: string): string {
  return status === 'queued' ? '排队中' : status === 'running' ? '生成中' : status === 'completed' ? '已完成' : status === 'cancelled' ? '已取消' : status === 'failed' ? '失败' : status
}

type AiTask = AiTaskInfo

export default function AiTasksPanel(props: { onViewBatch?: (batchId: string) => void } = {}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>('all')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await aiApi.tasks({ limit: 100, status: filterStatus === 'all' ? undefined : filterStatus })
      setTasks(result.items)
    } catch (err) {
      toast((err as Error).message || '加载 AI 任务失败', 'error')
    } finally { setLoading(false) }
  }, [toast, filterStatus])

  useEffect(() => { void load() }, [load])

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
    try { await aiApi.cancelTask(id); toast('AI 任务已取消', 'success'); void load() }
    catch (err) { toast((err as Error).message || '取消任务失败', 'error') }
  }

  async function retry(id: string) {
    setRetryingId(id)
    try {
      await aiApi.retryTask(id)
      toast('已按原参数重新发起任务', 'success')
      void load()
    } catch (err) {
      toast((err as Error).message || '重试失败', 'error')
    } finally { setRetryingId(null) }
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
      void load()
    } catch (err) {
      toast((err as Error).message || '删除任务失败', 'error')
    } finally { setDeletingId(null) }
  }

  return <Card>
    <CardHeader className="flex-row items-center justify-between gap-2">
      <div>
        <CardTitle className="text-base">AI 任务管理</CardTitle>
        <p className="text-sm text-muted-foreground">独立于爬取任务，查看生成进度、错误和输入 Prompt</p>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="task-filter-status" className="text-xs text-muted-foreground">状态</Label>
        <Select value={filterStatus} onValueChange={(v) => { setLoading(true); setFilterStatus(v as typeof filterStatus) }}>
          <SelectTrigger size="sm" id="task-filter-status" className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="end" sideOffset={4}>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="queued">排队中</SelectItem>
            <SelectItem value="running">生成中</SelectItem>
            <SelectItem value="completed">已完成</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
            <SelectItem value="cancelled">已取消</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </CardHeader>
    <CardContent>
      {loading ? <div className="flex h-32 items-center justify-center text-muted-foreground">加载中…</div> : tasks.length === 0 ? <div className="flex h-32 items-center justify-center text-muted-foreground">暂无 AI 任务</div> : <div className="space-y-2">
        {tasks.map((task) => <div key={task.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{taskKindLabel(task.kind)}</Badge><Badge variant={task.status === 'failed' ? 'destructive' : 'outline'}>{taskStatusLabel(task.status)}</Badge><span className="text-xs text-muted-foreground">{task.current} / {task.total}</span></div>
            <p className="mt-1 text-sm text-muted-foreground">{task.step || '等待处理'}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={task.prompt}>Prompt：{task.prompt || '无'}</p>
            {task.error && <p className="mt-1 text-xs text-destructive">{task.error}</p>}
          </div>
          {/* 移动端按钮横向排列并自动换行；sm+ 右侧竖排对齐 */}
          <div className="flex flex-row flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-end">
            {(task.status === 'queued' || task.status === 'running') && <Button variant="outline" size="sm" onClick={() => void cancel(task.id)}>取消任务</Button>}
            {/* 部分完成的批次（失败/取消但已产出若干章）也能从这里找到草稿 */}
            {task.batchId && task.current > 0 && props.onViewBatch && (
              <Button variant="outline" size="sm" onClick={() => props.onViewBatch?.(task.batchId)}>查看产出</Button>
            )}
            {(task.status === 'failed' || task.status === 'cancelled') && !!task.params && (
              <Button variant="outline" size="sm" disabled={retryingId === task.id} onClick={() => void retry(task.id)}>{retryingId === task.id ? '重试中…' : '重试'}</Button>
            )}
            {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deletingId === task.id} onClick={() => void remove(task)}>{deletingId === task.id ? '删除中…' : '删除'}</Button>
            )}
          </div>
        </div>)}
      </div>}
    </CardContent>
  </Card>
}
