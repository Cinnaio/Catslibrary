import { useEffect, useRef, useState } from 'react'
import type { MemoryKind, MemoryRebuildPlan, MemoryRebuildRequest } from '@shared/story-memory-rebuild'
import { aiApi, newOperationId } from '@/lib/api'
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import FormField from "@/components/shared/FormField"
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MoreHorizontal, RotateCcw } from 'lucide-react'

const labels = { relationship: '关系画像', plot: '情节状态' }
type History = Awaited<ReturnType<typeof aiApi.writing.memoryHistory>>['items']
export default function MemoryRebuildDialog({
  novelId,
  kind,
  chapters,
  disabled,
  onChanged,
  triggerMode = 'button',
}: {
  novelId: string
  kind: MemoryKind
  chapters: { value: string; label: string }[]
  disabled: boolean
  onChanged: () => void
  triggerMode?: 'button' | 'dropdown'
}) {
  const options = chapters.filter((chapter) => chapter.value)
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<MemoryRebuildRequest['range']>('single')
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('')
  const [both, setBoth] = useState(false),
    [followThrough, setFollowThrough] = useState(true)
  const [sample, setSample] = useState('3')
  const [plan, setPlan] = useState<MemoryRebuildPlan | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [history, setHistory] = useState<History | null>(null)
  const operation = useRef('')
  const impact = useRef<HTMLDivElement>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (plan) impact.current?.scrollIntoView?.({ block: 'nearest' })
  }, [plan])
  useEffect(() => {
    if (error) alert.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const request: MemoryRebuildRequest = {
    kinds: both ? ['relationship', 'plot'] : [kind],
    range,
    startChapterId: start,
    endChapterId: range === 'single' ? start : end,
    followThrough,
    sampleChapters: Number(sample),
  }
  function changed() {
    setPlan(null)
    setError('')
    operation.current = ''
  }
  async function preview() {
    if (!Number.isInteger(Number(sample)) || Number(sample) < 1 || Number(sample) > 30) {
      setError('每批章数应为 1–30 的整数')
      return
    }
    if (range !== 'all' && (!start || (range === 'range' && !end))) {
      setError('请选择要重新分析的章节范围')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await aiApi.writing.previewMemoryRebuild(novelId, request)
      if (alive.current) {
        setPlan(result)
        operation.current = newOperationId('memory-rebuild')
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function submit() {
    if (!plan || !operation.current) return
    setBusy(true)
    setError('')
    try {
      await aiApi.writing.rebuildMemory(novelId, request, plan.revision, operation.current)
      if (alive.current) {
        onChanged()
        setOpen(false)
        setPlan(null)
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <>
      {triggerMode === 'dropdown' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="ai-analysis-btn-icon size-7 min-h-7 min-w-7 rounded-full border-border/80 hover:border-border text-muted-foreground hover:text-foreground shrink-0 shadow-none transition-colors"
              disabled={disabled || !options.length}
              aria-label={`${labels[kind]}更多选项`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              disabled={disabled || !options.length}
              onSelect={() => {
                changed()
                setHistory(null)
                setOpen(true)
              }}
            >
              <RotateCcw className="size-3.5 mr-2 text-muted-foreground" />
              指定章节范围重新分析…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !options.length}
          onClick={() => {
            changed()
            setHistory(null)
            setOpen(true)
          }}
        >
          重新分析{labels[kind]}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogFrame
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>重新分析小说档案</DialogTitle>
            <DialogDescription>指定需要重新核对的章节。后续累计档案依赖旧结果，实际重建范围会在提交前列出。</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <p className="dialog-frame-hint">当前选择：{labels[kind]}。旧档案会保留；确认重建后暂不用于续写，完整结果通过来源校验后再替换。</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={both}
                disabled={busy}
                onCheckedChange={(value) => {
                  setBoth(value === true)
                  changed()
                }}
              />
              同时重新分析关系画像与情节状态
            </label>
            <FormField label="分析范围" htmlFor={`memory-range-${kind}`}>
              <Select
                value={range}
                disabled={busy}
                onValueChange={(value) => {
                  setRange(value as typeof range)
                  changed()
                }}
              >
                <SelectTrigger className="w-full" id={`memory-range-${kind}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">指定一章</SelectItem>
                  <SelectItem value="range">连续章节范围</SelectItem>
                  <SelectItem value="all">全部已分析章节</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {range !== 'all' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={range === 'single' ? '指定章节' : '起始章节'} htmlFor={`memory-start-${kind}`}>
                  <Select
                    value={start}
                    disabled={busy}
                    onValueChange={(value) => {
                      setStart(value)
                      changed()
                    }}
                  >
                    <SelectTrigger className="w-full" id={`memory-start-${kind}`}>
                      <SelectValue placeholder="选择章节" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                {range === 'range' && (
                  <FormField label="结束章节" htmlFor={`memory-end-${kind}`}>
                    <Select
                      value={end}
                      disabled={busy}
                      onValueChange={(value) => {
                        setEnd(value)
                        changed()
                      }}
                    >
                      <SelectTrigger className="w-full" id={`memory-end-${kind}`}>
                        <SelectValue placeholder="选择章节" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
              </div>
            )}
            <FormField label="后续处理" htmlFor={`memory-follow-${kind}`}>
              <Select
                value={followThrough ? 'follow' : 'stop'}
                disabled={busy}
                onValueChange={(value) => {
                  setFollowThrough(value === 'follow')
                  changed()
                }}
              >
                <SelectTrigger className="w-full" id={`memory-follow-${kind}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="follow">重建至原来的分析终点</SelectItem>
                  <SelectItem value="stop">只建立截至所选结束章节的档案</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="每批最多章节数" htmlFor={`memory-batch-${kind}`} hint="重建在后台分批进行，离开页面仍会继续，可暂停后恢复。">
              <Input
                id={`memory-batch-${kind}`}
                type="number"
                min={1}
                max={30}
                value={sample}
                disabled={busy}
                onChange={(event) => {
                  setSample(event.target.value)
                  changed()
                }}
              />
            </FormField>
            {plan && (
              <div ref={impact} role="status" className="grid gap-4 border-y border-border py-4">
                {plan.items.map((item) => (
                  <div key={item.kind} className="text-sm leading-7">
                    <h4 className="font-medium">{labels[item.kind]}</h4>
                    <p>
                      选择第 {item.selectedStart}–{item.selectedEnd} 章；实际重建第 {item.actualStart}–{item.targetOrdinal} 章。
                    </p>
                    <p className="dialog-frame-hint">
                      {item.actualStart > 1 ? `从截至第 ${item.actualStart - 1} 章的有效记录恢复。` : '没有可复用的前置快照或章节记录，需要从第 1 章重建。'}
                      {item.targetOrdinal > item.selectedEnd ? '后续档案依赖所选章节，将一并重建。' : ''}
                    </p>
                    {!followThrough && item.previousThrough > item.targetOrdinal && (
                      <p className="dialog-frame-hint">完成后仅覆盖至第 {item.targetOrdinal} 章，后续章节需继续分析。</p>
                    )}
                    {item.hasManualOverride && <p className="dialog-frame-hint">人工校正保留，重建后需复核并重新保存才能生效。</p>}
                  </div>
                ))}
                <p className="dialog-frame-hint">确认后会调用模型并计入用量。增量模式的两类档案共用章节记录，会一并更新，星图自动派生；原模式图谱需重新生成。已有草稿与发布章节不会被改写。</p>
              </div>
            )}
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  try {
                    const result = await aiApi.writing.memoryHistory(novelId, kind)
                    if (alive.current) setHistory(result.items)
                  } catch (err) {
                    if (alive.current) setError((err as Error).message)
                  }
                }}
              >
                查看保留的旧档案
              </Button>
              <p className="dialog-frame-hint">每类最多保留 8 份旧档案，只读查看；不会自动恢复旧结果或人工校正。</p>
              {history &&
                (history.length ? (
                  history.map((item) => (
                    <details key={item.id} className="border-t border-border py-3 text-sm">
                      <summary>
                        {labels[kind]} · {new Date(item.created_at).toLocaleString('zh-CN')} · 只读
                      </summary>
                      <p className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words leading-7">{item.content}</p>
                    </details>
                  ))
                ) : (
                  <p className="dialog-frame-hint">暂无历史备份；开始重建时会保留当前档案。</p>
                ))}
            </div>
            {error && (
              <p ref={alert} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
            {plan && (
              <Button variant="outline" disabled={busy} onClick={() => void preview()}>
                重新预览
              </Button>
            )}
            {plan ? (
              <Button disabled={busy} onClick={() => void submit()}>
                {busy ? '正在提交…' : '确认并开始重建'}
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void preview()}>
                {busy ? '正在核对…' : '预览实际重建范围'}
              </Button>
            )}
          </DialogFooter>
        </DialogFrame>
      </Dialog>
    </>
  )
}
