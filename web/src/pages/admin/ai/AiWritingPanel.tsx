/** AI 创作工作台：新写 / 续写，生成结果先保存为草稿。 */
import { useEffect, useState } from 'react'
import { aiApi, novelsApi, type AiTaskInfo } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import CustomSelect from '@/components/admin/CustomSelect'

// 后台续写任务的进度轮询间隔
const TASK_POLL_INTERVAL = 3000

function taskStatusLabel(status: string): string {
  return status === 'queued' ? '排队中' : status === 'running' ? '生成中' : status === 'completed' ? '已完成' : status === 'cancelled' ? '已取消' : status === 'failed' ? '失败' : status
}

export default function AiWritingPanel(props: { onViewBatch?: (batchId?: string) => void } = {}) {
  const { toast } = useToast()
  const [mode, setMode] = useState<'new' | 'continue'>('new')
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([])
  const [novelId, setNovelId] = useState('')
  const [title, setTitle] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [outline, setOutline] = useState('')
  const [targetWords, setTargetWords] = useState(2000)
  const [chapterCount, setChapterCount] = useState(1)
  const [busy, setBusy] = useState(false)
  /** 当前续写后台任务；null 表示未启动过 */
  const [task, setTask] = useState<AiTaskInfo | null>(null)
  /** 选中小说的未发布续写草稿数：续写上下文只取已发布章节，草稿积压会导致剧情断档 */
  const [pendingDrafts, setPendingDrafts] = useState(0)
  const taskActive = !!task && (task.status === 'queued' || task.status === 'running')

  useEffect(() => {
    void novelsApi.list({ limit: 100, page: 1 }).then((data) => setNovels(data.novels.map((novel) => ({ id: novel.id, title: novel.title })))).catch((err) => toast((err as Error).message, 'error'))
  }, [toast])

  // 挂载时恢复正在运行的续写任务：切换 tab 回来后进度不丢
  useEffect(() => {
    let cancelled = false
    aiApi.tasks({ limit: 20 })
      .then((result) => {
        if (cancelled) return
        const running = result.items.find((item) => item.kind === 'continue' && (item.status === 'queued' || item.status === 'running'))
        if (running) setTask((prev) => prev ?? running)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 统计选中小说的未发布续写草稿；任务结束后刷新（新草稿刚落库）
  const taskStatus = task?.status || ''
  useEffect(() => {
    if (!novelId) {
      setPendingDrafts(0)
      return
    }
    let cancelled = false
    aiApi.generations({ scope: 'writing', status: 'draft', limit: 100 })
      .then((res) => {
        if (cancelled) return
        setPendingDrafts(res.items.filter((item) => item.kind === 'continue' && item.novelId === novelId).length)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [novelId, taskStatus])

  // 轮询后台续写任务：setTask 触发下一轮 effect，形成 3 秒间隔的轮询链，任务结束自然停止
  useEffect(() => {
    if (!task || (task.status !== 'queued' && task.status !== 'running')) return
    const timer = setTimeout(() => {
      if (document.hidden) {
        // 页面不可见时跳过本轮请求，仅续上轮询链
        setTask((prev) => (prev ? { ...prev } : prev))
        return
      }
      aiApi.task(task.id)
        .then(({ task: next }) => {
          setTask(next)
          if (next.status === 'completed') toast('续写完成，草稿已保存到“已生成内容”', 'success')
          else if (next.status === 'failed') toast(next.error || 'AI 续写失败', 'error')
        })
        .catch(() => setTask((prev) => (prev ? { ...prev } : prev)))
    }, TASK_POLL_INTERVAL)
    return () => clearTimeout(timer)
  }, [task, toast])

  async function generateOutline() {
    if (!title.trim()) return toast('请填写作品标题', 'error')
    setBusy(true)
    try {
      await aiApi.writing.outline({ novelId, title, instruction, targetWords, chapterCount })
      toast('大纲已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function generateChapter() {
    if (!novelId || !chapterTitle.trim()) return toast('请选择小说并填写章节标题', 'error')
    setBusy(true)
    try {
      await aiApi.writing.chapter({ novelId, title, outline, instruction, targetWords, chapterCount })
      toast('章节已生成，请到“已生成内容”查看', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function continueNovel() {
    if (!novelId) return toast('请选择小说', 'error')
    setBusy(true)
    try {
      const res = await aiApi.writing.continue({ novelId, title: chapterTitle, instruction, targetWords, chapterCount })
      // 后台任务模式：立即拿到 taskId，进度由上方 effect 轮询
      const { task: created } = await aiApi.task(res.taskId)
      setTask(created)
      toast('续写任务已开始，完成后草稿在“已生成内容”', 'success')
    } catch (err) { toast((err as Error).message, 'error') } finally { setBusy(false) }
  }

  async function cancelContinuation() {
    if (!task) return
    try {
      await aiApi.cancelTask(task.id)
      const { task: next } = await aiApi.task(task.id)
      setTask(next)
      toast('续写任务已取消', 'success')
    } catch (err) { toast((err as Error).message, 'error') }
  }

  return <div className="space-y-4">
    <Card>
      <CardHeader><CardTitle className="text-base">AI 创作工作台</CardTitle><p className="text-sm text-muted-foreground">生成结果先保存为草稿，编辑确认后再发布为正式章节。</p></CardHeader>
      <CardContent className="grid gap-4">
        <Tabs value={mode} onValueChange={(value) => setMode(value as 'new' | 'continue')}>
          <TabsList><TabsTrigger value="new">新写</TabsTrigger><TabsTrigger value="continue">续写</TabsTrigger></TabsList>
        </Tabs>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>目标小说</Label>
            <CustomSelect
              options={novels.map((novel) => ({ value: novel.id, label: novel.title }))}
              value={novelId}
              onChange={setNovelId}
              placeholder="选择小说"
              searchable
              searchPlaceholder="搜索小说名称…"
              dropdownSide="bottom"
            />
          </div>
          <div className="grid gap-1.5"><Label>{mode === 'new' ? '作品标题' : '章节标题（可选）'}</Label><Input value={mode === 'new' ? title : chapterTitle} onChange={(event) => mode === 'new' ? setTitle(event.target.value) : setChapterTitle(event.target.value)} placeholder={mode === 'new' ? '例如：雾城来信' : '例如：第十二章 暴雨前夜'} /></div>
        </div>
        {mode === 'new' && <div className="grid gap-1.5"><Label>章节标题</Label><Input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="例如：第一章 雾中来客" /></div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5"><Label>{mode === 'continue' ? '每章目标字数' : '目标字数'}</Label><Input type="number" min={300} max={30000} step={100} value={targetWords} onChange={(event) => setTargetWords(Number(event.target.value) || 300)} /></div>
          {mode === 'continue' && (
            <div className="grid gap-1.5">
              <Label>续写章节数</Label>
              <Input type="number" min={1} max={20} value={chapterCount} onChange={(event) => setChapterCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
            </div>
          )}
        </div>
        <div className="grid gap-1.5"><Label>创作要求</Label><textarea className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="人物、风格、冲突、节奏或本次剧情目标" /></div>
        {mode === 'new' && <div className="grid gap-1.5"><Label>大纲（生成章节时使用）</Label><textarea className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={outline} onChange={(event) => setOutline(event.target.value)} placeholder="先生成大纲，或直接粘贴已有大纲" /></div>}
        {mode === 'continue' && pendingDrafts > 0 && !taskActive && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span>该小说有 {pendingDrafts} 章未发布的续写草稿。续写上下文只取已发布章节，建议先发布草稿再继续，避免剧情断档。</span>
            {props.onViewBatch && <Button variant="outline" size="sm" className="ml-auto" onClick={() => props.onViewBatch?.()}>查看草稿</Button>}
          </div>
        )}
        {mode === 'continue' && task && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{taskStatusLabel(task.status)}</span>
              <span className="text-muted-foreground">{task.current} / {task.total} 章</span>
              {taskActive && <Button variant="outline" size="sm" className="ml-auto" onClick={() => void cancelContinuation()}>取消任务</Button>}
              {!taskActive && task.current > 0 && task.batchId && props.onViewBatch && (
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => props.onViewBatch?.(task.batchId)}>查看本批草稿（{task.current} 章）</Button>
              )}
            </div>
            <p className="mt-1 text-muted-foreground">{task.step || '等待处理'}</p>
            {task.error && <p className="mt-1 text-destructive">{task.error}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {mode === 'new' ? <><Button variant="secondary" disabled={busy} onClick={() => void generateOutline()}>生成大纲</Button><Button disabled={busy} onClick={() => void generateChapter()}>生成章节</Button></> : <Button disabled={busy || taskActive} onClick={() => void continueNovel()}>生成续写</Button>}
        </div>
      </CardContent>
    </Card>
  </div>
}
