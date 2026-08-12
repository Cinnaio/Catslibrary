/** AI 任务管理：查看生成进度、错误和输入 Prompt；有任务运行时自动轮询刷新。 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// 有运行中任务时的轮询间隔
const ACTIVE_POLL_INTERVAL = 4000

function taskKindLabel(kind: string): string {
  return kind === 'continue' ? '续写' : kind === 'write_outline' ? '创作大纲' : kind === 'write_chapter' ? '创作章节' : kind
}

function taskStatusLabel(status: string): string {
  return status === 'queued' ? '排队中' : status === 'running' ? '生成中' : status === 'completed' ? '已完成' : status === 'cancelled' ? '已取消' : status === 'failed' ? '失败' : status
}

interface AiTask {
  id: string
  novelId: string
  kind: string
  status: string
  current: number
  total: number
  step: string
  prompt: string
  batchId: string
  error: string
  createdAt: number
  updatedAt: number
}

export default function AiTasksPanel(props: { onViewBatch?: (batchId: string) => void } = {}) {
  const { toast } = useToast()
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const result = await aiApi.tasks({ limit: 100 })
      setTasks(result.items)
    } catch (err) {
      toast((err as Error).message || '加载 AI 任务失败', 'error')
    } finally { setLoading(false) }
  }, [toast])

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

  return <Card>
    <CardHeader><CardTitle className="text-base">AI 任务管理</CardTitle><p className="text-sm text-muted-foreground">独立于爬取任务，查看生成进度、错误和输入 Prompt</p></CardHeader>
    <CardContent>
      {loading ? <div className="flex h-32 items-center justify-center text-muted-foreground">加载中…</div> : tasks.length === 0 ? <div className="flex h-32 items-center justify-center text-muted-foreground">暂无 AI 任务</div> : <div className="space-y-2">
        {tasks.map((task) => <div key={task.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{taskKindLabel(task.kind)}</Badge><Badge variant={task.status === 'failed' ? 'destructive' : 'outline'}>{taskStatusLabel(task.status)}</Badge><span className="text-xs text-muted-foreground">{task.current} / {task.total}</span></div>
            <p className="mt-1 text-sm text-muted-foreground">{task.step || '等待处理'}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={task.prompt}>Prompt：{task.prompt || '无'}</p>
            {task.error && <p className="mt-1 text-xs text-destructive">{task.error}</p>}
          </div>
          <div className="flex flex-col items-end gap-2">
            {(task.status === 'queued' || task.status === 'running') && <Button variant="outline" size="sm" onClick={() => void cancel(task.id)}>取消任务</Button>}
            {/* 部分完成的批次（失败/取消但已产出若干章）也能从这里找到草稿 */}
            {task.batchId && task.current > 0 && props.onViewBatch && (
              <Button variant="outline" size="sm" onClick={() => props.onViewBatch?.(task.batchId)}>查看产出</Button>
            )}
          </div>
        </div>)}
      </div>}
    </CardContent>
  </Card>
}
