/**
 * 封面历史：管理员每次替换封面时留下的快照，用于误替换后回滚。
 *
 * 三个约束决定了这里的写法：
 * 1. `GET /cover/history/:novelId/:id/image` 要求管理员鉴权，不能用 <img src> 直连，
 *    必须带 token 取回 Blob 再转 object URL；卸载时要 revoke，否则泄漏。
 * 2. 恢复必须带 expectedCoverVersion（当前封面摘要），后端据此拒绝覆盖他人改动；
 *    版本号来自 coverHistory 的 current.version。
 * 3. 缩略图按需加载：只有展开时才拉图片，避免每次进面板都下载至多 10 张整图。
 */
import { useEffect, useRef, useState } from 'react'
import { aiApi, type AiCoverHistoryItem, type AiCurrentCoverState, type ApiError } from '@/lib/api'
import { useToast, useConfirm } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronRight, History, ImageOff, Loader2, RotateCcw } from 'lucide-react'

/** 同时拉取的缩略图数量；历史至多 10 条，串行太慢、全并发又容易打满连接。 */
const IMAGE_CONCURRENCY = 3

const SOURCE_LABELS: Record<string, string> = {
  ai: 'AI 生成',
  upload: '本地上传',
  default: '缺省图',
}

/** 快照「因何进入历史」——后端在替换事务里记下的 reason。 */
const REASON_LABELS: Record<string, string> = {
  adopt: '采纳候选时归档',
  upload: '上传替换时归档',
  restore: '恢复快照时归档',
  replace: '替换时归档',
}

function sourceLabel(source: string): string {
  if (!source) return '来源未知'
  return SOURCE_LABELS[source] || '外部链接'
}

function formatTime(ts: number): string {
  if (!ts) return '时间未知'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export default function CoverHistory(props: {
  novelId: string
  /** 父级封面的缓存破坏戳；变化说明当前封面被改过，要重取版本号 */
  coverVersion: number
  /** 恢复到当前封面后通知父级刷新预览 */
  onRestored: () => void
  /** 把当前封面版本号交给父级，供采纳/上传时做并发校验 */
  onCurrentVersion: (version: string) => void
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  // 解构出回调单独做依赖：依赖整个 props 对象会因每轮渲染的新引用而反复触发。
  // 父级直接传 setState，引用天然稳定。
  const { novelId, coverVersion, onRestored, onCurrentVersion } = props
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<{ items: AiCoverHistoryItem[]; current: AiCurrentCoverState } | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')
  const objectUrls = useRef<string[]>([])

  // 卸载时释放所有 object URL，避免图片内存常驻
  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current = []
  }, [])

  // 版本号同步给父级；采纳/上传要靠它做乐观并发校验
  useEffect(() => {
    if (history) onCurrentVersion(history.current.version)
  }, [history, onCurrentVersion])

  // 元数据始终拉取（轻量 JSON，需要知道条数与版本号）；图片只在展开时拉。
  // 刻意不在 effect 体内同步 setState：所有状态变更都发生在 await 之后。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await aiApi.coverHistory(novelId)
        if (cancelled) return
        setHistory({ items: res.items, current: res.current })
        if (!expanded) return
        const queue = res.items.map((item) => item.id)
        const load = async () => {
          for (;;) {
            if (cancelled) return
            const id = queue.shift()
            if (!id) return
            try {
              const blob = await aiApi.coverHistoryImage(novelId, id)
              if (cancelled) return
              const objectUrl = URL.createObjectURL(blob)
              objectUrls.current.push(objectUrl)
              setImages((prev) => ({ ...prev, [id]: objectUrl }))
            } catch {
              // 单张失败不阻断其余；该格显示占位
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, queue.length) }, load))
      } catch (err) {
        if (!cancelled) toast((err as Error).message, 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [novelId, coverVersion, expanded, toast])

  async function restore(item: AiCoverHistoryItem) {
    if (!history) return
    const ok = await confirm({
      title: '恢复这个封面快照？',
      message: '当前封面会被该快照替换，读者端立即生效；当前封面会自动归档到历史里，之后可以再恢复回来。',
      items: [`快照来源：${sourceLabel(item.source)}`, `归档时间：${formatTime(item.createdAt)}`],
      okText: '确认恢复',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    setBusyId(item.id)
    try {
      await aiApi.restoreCoverHistory(novelId, item.id, history.current.version)
      toast('已恢复为当前封面', 'success')
      // 恢复会把「被顶替的那张」推入历史，故重取列表与版本号
      onRestored()
    } catch (err) {
      if ((err as ApiError).status === 409) {
        toast('当前封面已被其他操作改变，已为你刷新列表，请确认后重试', 'error')
        onRestored()
      } else {
        toast((err as Error).message, 'error')
      }
    } finally {
      setBusyId('')
    }
  }

  const items = history?.items ?? []
  const count = items.length

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2">
        {/* 触发器本身就是标题：button 提供键盘操作与 aria-expanded 播报。
            视觉规格（字号/字重）由 .ai-history-trigger 承担，与同栏其它小节标题一致。 */}
        <button
          type="button"
          className="ai-history-trigger"
          aria-expanded={expanded}
          /* 折叠时正文不在 DOM 里，此时不挂 aria-controls，避免指向不存在的 id */
          aria-controls={expanded ? 'cover-history-body' : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight className="ai-history-trigger__caret size-3.5" aria-hidden="true" />
          <History className="size-3.5 text-[var(--accent)]" aria-hidden="true" />
          封面历史
        </button>
        {count > 0 && <Badge variant="secondary">{count}</Badge>}
      </div>

      {expanded && (
        <div id="cover-history-body" className="grid gap-3">
          {history === null ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--admin-inset)] px-4 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              正在读取封面历史…
            </div>
          ) : count === 0 ? (
            <div className="grid gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--admin-inset)] px-4 py-8 text-center">
              <ImageOff className="mx-auto size-5 text-[var(--accent)]/55" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                暂无历史快照。采纳候选、上传替换或恢复历史时，被顶替的那张封面会自动归档到这里。
              </p>
            </div>
          ) : (
            <>
              <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
                这里保留最近 {count} 张被替换掉的封面（每本最多 10 张）。恢复会把快照设为当前封面，并把当前封面归档进来。
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                {items.map((item) => {
                  const src = images[item.id]
                  return (
                    <figure key={item.id} className="group grid w-[9rem] gap-2">
                      <div className="ai-cover-frame relative aspect-[2/3] w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] transition-shadow duration-200 group-hover:shadow-md">
                        {src ? (
                          <img src={src} alt={`封面快照 ${formatTime(item.createdAt)}`} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Loader2 className="size-4 animate-spin text-[var(--text-muted)]" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <figcaption className="grid gap-1.5">
                        <p className="text-[0.7rem] font-medium leading-snug text-foreground">{sourceLabel(item.source)}</p>
                        {REASON_LABELS[item.reason] && (
                          <p className="text-[0.68rem] leading-snug text-[var(--accent)]">{REASON_LABELS[item.reason]}</p>
                        )}
                        <p className="text-[0.68rem] leading-snug text-muted-foreground">{formatTime(item.createdAt)}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-1"
                          disabled={!!busyId}
                          onClick={() => void restore(item)}
                        >
                          {busyId === item.id ? (
                            <>
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              恢复中
                            </>
                          ) : (
                            <>
                              <RotateCcw className="size-3.5" aria-hidden="true" />
                              恢复
                            </>
                          )}
                        </Button>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
