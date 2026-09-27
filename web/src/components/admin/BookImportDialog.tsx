import { useRef, useState } from 'react'
import { bookImportApi } from '@/lib/api'
import type {
  BookImportChapterDiff,
  BookImportCommitResult,
  BookImportMetadataDiff,
  BookImportPreview,
  BookImportRollbackResult,
} from '@shared/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  FileText,
  Globe2,
  LoaderCircle,
  RotateCcw,
  Upload,
} from 'lucide-react'

type ImportStep = 'source' | 'match' | 'diff' | 'result'
type SourceMode = 'file' | 'url'

/** 来源分段控件的激活滑块位移索引，供 CSS 的 [data-active-index] 消费。 */
const SOURCE_MODE_INDEX: Record<SourceMode, number> = { file: 0, url: 1 }

const STEP_LABELS: Array<{ id: ImportStep; label: string }> = [
  { id: 'source', label: '选择来源' },
  { id: 'match', label: '确认作品' },
  { id: 'diff', label: '查看差异' },
  { id: 'result', label: '导入结果' },
]

const CHAPTER_STATUS: Record<BookImportChapterDiff['status'], { label: string; className: string }> = {
  new: { label: '新增', className: 'book-import__badge--new' },
  changed: { label: '有变化', className: 'book-import__badge--changed' },
  unchanged: { label: '无变化', className: 'book-import__badge--unchanged' },
  conflict: { label: '需确认', className: 'book-import__badge--conflict' },
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Number(value) || 0))
}

function sourceTypeLabel(preview: BookImportPreview): string {
  return preview.sourceType === 'url' ? '网页来源' : '本地文件'
}

function metadataValue(diff: BookImportMetadataDiff, value: 'localValue' | 'incomingValue'): string {
  const text = diff[value]
  if (diff.field === 'coverUrl' && text) return '已提供封面地址'
  if (diff.field === 'sourceUrl' && text) return text
  return text || '未填写'
}

function isDisabledChapter(chapter: BookImportChapterDiff): boolean {
  return chapter.status === 'unchanged' || chapter.status === 'conflict'
}

function stepIndex(step: ImportStep): number {
  return STEP_LABELS.findIndex((item) => item.id === step)
}

export default function BookImportDialog({
  open,
  onOpenChange,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ImportStep>('source')
  const [sourceMode, setSourceMode] = useState<SourceMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<BookImportPreview | null>(null)
  const [targetNovelId, setTargetNovelId] = useState<string | null>(null)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
  const [metadataFields, setMetadataFields] = useState<Set<string>>(new Set())
  const [metadataMode, setMetadataMode] = useState<'missing' | 'replace'>('missing')
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BookImportCommitResult | null>(null)
  const [rollbackResult, setRollbackResult] = useState<BookImportRollbackResult | null>(null)

  function applyPreview(next: BookImportPreview) {
    setPreview(next)
    setTargetNovelId(next.targetNovelId)
    setSelectedChapterIds(new Set(next.chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.id)))
    setMetadataFields(new Set(next.metadataDiff.filter((field) => field.selected).map((field) => field.field)))
    setMetadataMode('missing')
    setExpandedChapterId(null)
  }

  function chooseFile(next: File | null) {
    setError('')
    if (!next) return
    const lower = next.name.toLocaleLowerCase()
    if (!['.txt', '.text', '.json', '.epub'].some((extension) => lower.endsWith(extension))) {
      setFile(null)
      setError('请选择 TXT、JSON 或 EPUB 文件。')
      return
    }
    if (next.size > 25 * 1024 * 1024) {
      setFile(null)
      setError('文件不能超过 25 MB。')
      return
    }
    setFile(next)
  }

  async function handlePreview() {
    if (busy) return
    setError('')
    if (sourceMode === 'file' && !file) {
      setError('请先选择一本书籍文件。')
      return
    }
    if (sourceMode === 'url' && !sourceUrl.trim()) {
      setError('请先填写书籍 URL。')
      return
    }
    setBusy(true)
    try {
      const next = sourceMode === 'file' ? await bookImportApi.previewFile(file!, sourceUrl) : await bookImportApi.previewUrl(sourceUrl.trim())
      applyPreview(next)
      setStep('match')
    } catch (err) {
      setError((err as Error).message || '无法生成导入预览，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function handleMatchContinue() {
    if (!preview || busy) return
    if (preview.candidates.length > 1 && !targetNovelId) {
      setError('请先选择一个导入目标；如果都不是目标，也可以返回来源重新检查书名。')
      return
    }
    setError('')
    setBusy(true)
    try {
      if (targetNovelId !== preview.targetNovelId) {
        const next = await bookImportApi.selectTarget(preview.runId, targetNovelId)
        applyPreview(next)
      }
      setStep('diff')
    } catch (err) {
      setError((err as Error).message || '无法加载差异预览。')
    } finally {
      setBusy(false)
    }
  }

  function toggleChapter(chapter: BookImportChapterDiff, checked: boolean | 'indeterminate') {
    if (isDisabledChapter(chapter)) return
    setSelectedChapterIds((previous) => {
      const next = new Set(previous)
      if (checked === true) next.add(chapter.id)
      else next.delete(chapter.id)
      return next
    })
  }

  function toggleMetadata(field: BookImportMetadataDiff, checked: boolean | 'indeterminate') {
    if (checked === true && field.localValue) setMetadataMode('replace')
    setMetadataFields((previous) => {
      const next = new Set(previous)
      if (checked === true) {
        next.add(field.field)
      } else {
        next.delete(field.field)
      }
      return next
    })
  }

  async function handleCommit() {
    if (!preview || busy) return
    setError('')
    setBusy(true)
    try {
      const next = await bookImportApi.commit(preview.runId, {
        targetNovelId,
        selectedChapterIds: Array.from(selectedChapterIds),
        metadataFields: Array.from(metadataFields),
        metadataMode,
      })
      setResult(next)
      setStep('result')
      onCompleted?.()
    } catch (err) {
      setError((err as Error).message || '导入提交失败，请重新打开预览检查。')
    } finally {
      setBusy(false)
    }
  }

  async function handleRollback() {
    if (!result || busy) return
    setError('')
    setBusy(true)
    try {
      const next = await bookImportApi.rollback(result.runId)
      setRollbackResult(next)
      onCompleted?.()
    } catch (err) {
      setError((err as Error).message || '撤回失败，可能有内容已被再次编辑。')
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    onOpenChange(false)
    window.setTimeout(() => onOpenChange(true), 0)
  }

  const changedMetadata = preview?.metadataDiff.filter((field) => field.changed) || []
  const selectedChapterCount = selectedChapterIds.size
  const selectedMetadataCount = metadataFields.size
  const hasImportableChanges = selectedChapterCount > 0 || selectedMetadataCount > 0

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="admin-dialog book-import-dialog sm:max-w-[980px]" aria-describedby="book-import-description">
        <DialogHeader className="book-import__header">
          <DialogTitle>导入书籍</DialogTitle>
          <DialogDescription id="book-import-description">先分析来源，再确认同名作品和章节差异；提交后仍可以安全撤回。</DialogDescription>
          {/* 管理员提示并进页头：独立成行时会与步骤条抢同一段垂直空间（实测重叠）。
              放在页头内既与标题同组居中，也不再影响弹窗栅格行数。 */}
          <p className="book-import__header-note">管理员操作 · 保留导入快照</p>
        </DialogHeader>

        <div className="book-import__body">
          <ol className="book-import__steps" aria-label="导入进度">
            {STEP_LABELS.map((item, index) => {
              const active = item.id === step
              const complete = index < stepIndex(step)
              return (
                <li key={item.id} className="book-import__step" data-active={active} data-complete={complete}>
                  <span className="book-import__step-marker" aria-hidden="true">
                    {complete ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span>{item.label}</span>
                </li>
              )
            })}
          </ol>

          {error && (
            <Alert variant="destructive" className="book-import__alert">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 'source' && (
            <div className="book-import__source">
              <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as SourceMode)}>
                {/* data-active-index 供 CSS 移动分段控件的激活滑块，
                    与书源面板、审核类型等处同一约定。 */}
                <TabsList className="book-import__source-tabs" aria-label="选择导入来源" data-active-index={SOURCE_MODE_INDEX[sourceMode]}>
                  <TabsTrigger value="file">
                    <FileText aria-hidden="true" /> 文件
                  </TabsTrigger>
                  <TabsTrigger value="url">
                    <Globe2 aria-hidden="true" /> URL
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="file" className="book-import__source-content">
                  <div
                    className="book-import__dropzone"
                    data-drag-active={dragActive}
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setDragActive(true)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragActive(false)
                      chooseFile(event.dataTransfer.files[0] || null)
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      className="book-import__file-input"
                      type="file"
                      accept=".txt,.text,.json,.epub,text/plain,application/json,application/epub+zip"
                      onChange={(event) => chooseFile(event.target.files?.[0] || null)}
                    />
                    <span className="book-import__dropzone-icon">
                      <Upload aria-hidden="true" />
                    </span>
                    <strong>{file ? file.name : '拖入书籍文件，或点击选择'}</strong>
                    <span>支持 TXT、JSON、EPUB，单个文件不超过 25 MB</span>
                    {file && <Badge variant="outline">{formatNumber(Math.ceil(file.size / 1024))} KB</Badge>}
                  </div>
                  <div className="book-import__field">
                    <Label htmlFor="book-import-source-url">可选：文件对应的来源 URL</Label>
                    <Input
                      id="book-import-source-url"
                      type="url"
                      placeholder="用于更准确匹配章节来源，可留空"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="url" className="book-import__source-content">
                  <div className="book-import__field">
                    <Label htmlFor="book-import-url">书籍详情页 URL</Label>
                    <Input
                      id="book-import-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/book/123"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                    />
                    <p className="book-import__hint">服务端会读取作品元数据和章节正文，预计需要一点时间；需要登录的站点请先配置对应会话。</p>
                  </div>
                  <div className="book-import__source-callout">
                    <Globe2 aria-hidden="true" />
                    <span>会先抓取并生成差异预览，不会在分析阶段写入书库。</span>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {step === 'match' && preview && (
            <div className="book-import__workspace">
              <div className="book-import__book-summary">
                <div>
                  <span className="book-import__eyebrow">{sourceTypeLabel(preview)}</span>
                  <h3>{preview.book.title}</h3>
                  <p>{preview.book.author || '未知作者'} · {formatNumber(preview.book.chapters.length)} 章 · {preview.sourceLabel}</p>
                </div>
                <Badge variant="outline">待确认目标</Badge>
              </div>

              <section className="book-import__section" aria-labelledby="book-import-match-title">
                <div className="book-import__section-heading">
                  <div>
                    <h3 id="book-import-match-title">书库匹配</h3>
                    <p>同名作品不会自动合并多个目标，请明确选择一次。</p>
                  </div>
                  <Badge variant="secondary">{preview.candidates.length ? `找到 ${preview.candidates.length} 个候选` : '没有同名作品'}</Badge>
                </div>
                {preview.candidates.length ? (
                  <div className="book-import__candidate-list">
                    {preview.candidates.map((candidate) => {
                      const selected = targetNovelId === candidate.novel.id
                      return (
                        <button
                          key={candidate.novel.id}
                          type="button"
                          className="book-import__candidate"
                          data-selected={selected}
                          aria-pressed={selected}
                          onClick={() => setTargetNovelId(candidate.novel.id)}
                        >
                          <span className="book-import__candidate-check" aria-hidden="true">
                            {selected && <Check className="size-3.5" />}
                          </span>
                          <span className="book-import__candidate-copy">
                            <strong>{candidate.novel.title}</strong>
                            <span>{candidate.novel.author || '未知作者'} · 本地 {formatNumber(candidate.novel.chapterCount)} 章</span>
                          </span>
                          <Badge variant="outline">{candidate.matchReason === 'source-url' ? '来源一致' : candidate.matchReason === 'title-author' ? '标题 + 作者' : '标题一致'}</Badge>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="book-import__empty-state">
                    <FileText aria-hidden="true" />
                    <div>
                      <strong>将创建一本新作品</strong>
                      <p>当前书库没有同名作品。提交前仍会展示章节和元数据预览。</p>
                    </div>
                  </div>
                )}
              </section>
              {preview.warnings.length > 0 && <WarningList warnings={preview.warnings} />}
            </div>
          )}

          {step === 'diff' && preview && (
            <div className="book-import__workspace book-import__workspace--diff">
              <div className="book-import__book-summary">
                <div>
                  <span className="book-import__eyebrow">差异预览 · {preview.targetNovel ? '增量导入' : '新建作品'}</span>
                  <h3>{preview.book.title}</h3>
                  <p>{preview.targetNovel ? `目标：${preview.targetNovel.title}` : '提交后会创建新的书库作品'} · {preview.sourceLabel}</p>
                </div>
                <Badge variant="outline">不会删除本地章节</Badge>
              </div>

              <div className="book-import__summary-grid" aria-label="章节差异统计">
                <SummaryStat label="新增" value={preview.summary.newCount} tone="new" />
                <SummaryStat label="有变化" value={preview.summary.changedCount} tone="changed" />
                <SummaryStat label="无变化" value={preview.summary.unchangedCount} tone="unchanged" />
                <SummaryStat label="需确认" value={preview.summary.conflictCount} tone="conflict" />
              </div>

              {changedMetadata.length > 0 && (
                <section className="book-import__section" aria-labelledby="book-import-metadata-title">
                  <div className="book-import__section-heading">
                    <div>
                      <h3 id="book-import-metadata-title">作品信息变化</h3>
                      <p>新作品默认带入；已有内容只补空白，覆盖已有值需要显式选择。</p>
                    </div>
                    <Badge variant="secondary">已选 {selectedMetadataCount} 项</Badge>
                  </div>
                  <div className="book-import__metadata-list">
                    {changedMetadata.map((field) => (
                      <label key={field.field} className="book-import__metadata-row">
                        <Checkbox checked={metadataFields.has(field.field)} onCheckedChange={(checked) => toggleMetadata(field, checked)} />
                        <span className="book-import__metadata-copy">
                          <strong>{field.label}</strong>
                          <span className="book-import__metadata-values">
                            <span>{metadataValue(field, 'localValue')}</span>
                            <ArrowRight aria-hidden="true" />
                            <span>{metadataValue(field, 'incomingValue')}</span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="book-import__mode-picker" role="radiogroup" aria-label="作品信息导入方式">
                    <label>
                      <input type="radio" name="book-import-metadata-mode" checked={metadataMode === 'missing'} onChange={() => setMetadataMode('missing')} />
                      <span>只补齐空白</span>
                    </label>
                    <label>
                      <input type="radio" name="book-import-metadata-mode" checked={metadataMode === 'replace'} onChange={() => setMetadataMode('replace')} />
                      <span>覆盖已选字段</span>
                    </label>
                  </div>
                </section>
              )}

              <section className="book-import__section" aria-labelledby="book-import-chapters-title">
                <div className="book-import__section-heading">
                  <div>
                    <h3 id="book-import-chapters-title">章节差异</h3>
                    <p>新增章节默认选中；有变化的章节需要你展开比较后再选择。</p>
                  </div>
                  <Badge variant="secondary">已选 {selectedChapterCount} 章</Badge>
                </div>
                <ScrollArea className="book-import__chapter-list">
                  {preview.chapters.map((chapter) => {
                    const status = CHAPTER_STATUS[chapter.status]
                    const disabled = isDisabledChapter(chapter)
                    const expanded = expandedChapterId === chapter.id
                    return (
                      <div key={chapter.id} className="book-import__chapter-row" data-status={chapter.status}>
                        <div className="book-import__chapter-main">
                          <Checkbox
                            checked={selectedChapterIds.has(chapter.id)}
                            disabled={disabled}
                            aria-label={`${status.label}章节：${chapter.incomingTitle}`}
                            onCheckedChange={(checked) => toggleChapter(chapter, checked)}
                          />
                          <button
                            type="button"
                            className="book-import__chapter-toggle"
                            aria-expanded={expanded}
                            onClick={() => setExpandedChapterId(expanded ? null : chapter.id)}
                          >
                            <span className="book-import__chapter-title">
                              <strong>{chapter.incomingTitle}</strong>
                              <span>{chapter.reason}</span>
                            </span>
                            <span className="book-import__chapter-meta">
                              <Badge variant="outline" className={status.className}>{status.label}</Badge>
                              {chapter.status === 'changed' && (expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />)}
                            </span>
                          </button>
                        </div>
                        {expanded && (
                          <div className="book-import__chapter-diff">
                            <ContentPreview label="本地版本" content={chapter.localContent || '本地没有对应正文'} muted={!chapter.localContent} />
                            <ContentPreview label="导入版本" content={chapter.incomingContent} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </ScrollArea>
                {preview.chapters.length === 0 && <div className="book-import__empty-state">没有可展示的章节差异。</div>}
                <p className="book-import__safe-note">本地独有章节不会被删除；同名冲突章节也不会默认覆盖。</p>
              </section>
              {preview.warnings.length > 0 && <WarningList warnings={preview.warnings} />}
            </div>
          )}

          {step === 'result' && result && <ImportResult result={result} rollbackResult={rollbackResult} onRollback={() => void handleRollback()} busy={busy} />}
        </div>

        {busy && (
          <div className="book-import__progress" aria-live="polite">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            <span>{step === 'source' ? '正在分析来源并生成预览…' : step === 'result' ? '正在撤回导入…' : '正在处理，请稍候…'}</span>
            <Progress value={undefined} aria-label="处理中" />
          </div>
        )}

        <DialogFooter className="book-import__footer">
          {step === 'source' && (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
              <Button onClick={() => void handlePreview()} disabled={busy}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                {busy ? '分析中…' : '生成预览'}
              </Button>
            </>
          )}
          {step === 'match' && (
            <>
              <Button variant="secondary" onClick={() => setStep('source')} disabled={busy}><ArrowLeft aria-hidden="true" />返回</Button>
              <Button onClick={() => void handleMatchContinue()} disabled={busy}><ArrowRight aria-hidden="true" />查看差异</Button>
            </>
          )}
          {step === 'diff' && (
            <>
              <Button variant="secondary" onClick={() => setStep('match')} disabled={busy}><ArrowLeft aria-hidden="true" />返回</Button>
              <Button onClick={() => void handleCommit()} disabled={busy || !hasImportableChanges}>
                {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                {busy ? '导入中…' : `确认导入${hasImportableChanges ? ` · ${selectedChapterCount} 章` : ''}`}
              </Button>
            </>
          )}
          {step === 'result' && (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>关闭</Button>
              <Button variant="outline" onClick={startOver} disabled={busy}><RotateCcw aria-hidden="true" />再导入一本</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="book-import__summary-stat" data-tone={tone}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  return (
    <div className="book-import__warnings" role="status">
      <CircleAlert aria-hidden="true" />
      <div>
        <strong>需要留意</strong>
        <ul>
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </div>
    </div>
  )
}

function ContentPreview({ label, content, muted = false }: { label: string; content: string; muted?: boolean }) {
  return (
    <div className="book-import__content-preview">
      <span>{label}</span>
      <pre data-muted={muted}>{content}</pre>
    </div>
  )
}

function ImportResult({
  result,
  rollbackResult,
  onRollback,
  busy,
}: {
  result: BookImportCommitResult
  rollbackResult: BookImportRollbackResult | null
  onRollback: () => void
  busy: boolean
}) {
  const rolledBack = Boolean(rollbackResult)
  return (
    <div className="book-import__result" aria-live="polite">
      <div className="book-import__result-icon" data-rolled-back={rolledBack}>
        {rolledBack ? <RotateCcw aria-hidden="true" /> : <Check aria-hidden="true" />}
      </div>
      <span className="book-import__eyebrow">{rolledBack ? '导入已撤回' : result.conflicts.length ? '导入已部分完成' : '导入完成'}</span>
      <h3>{rolledBack ? '已恢复可安全恢复的内容' : result.novelCreated ? '已创建新作品' : '已增量更新作品'}</h3>
      <p>{rolledBack ? `已撤回 ${formatNumber(rollbackResult?.rolledBack || 0)} 项变更。` : `作品「${result.novelId}」已记录本次导入快照。`}</p>
      <div className="book-import__result-grid">
        <SummaryStat label="新增章节" value={rolledBack ? 0 : result.created} tone="new" />
        <SummaryStat label="更新章节" value={rolledBack ? 0 : result.updated} tone="changed" />
        <SummaryStat label="跳过章节" value={result.skipped} tone="unchanged" />
        <SummaryStat label="冲突" value={(rollbackResult?.conflicts.length || result.conflicts.length) ?? 0} tone="conflict" />
      </div>
      {(result.conflicts.length > 0 || rollbackResult?.conflicts.length) && (
        <div className="book-import__result-warning">
          <CircleAlert aria-hidden="true" />
          <span>{rollbackResult?.conflicts.length ? '有内容在操作后再次变化，系统已保留这些内容，没有强制覆盖。' : '有章节在提交时发生变化，系统已跳过这些章节，可重新预览后处理。'}</span>
        </div>
      )}
      {!rolledBack && <Button variant="outline" onClick={onRollback} disabled={busy}><RotateCcw aria-hidden="true" />撤回这次导入</Button>}
    </div>
  )
}
