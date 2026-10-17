import { AdminDialogContent } from '@/components/admin/AdminDialog'
import ImportDiagnosticsPanel from '@/components/admin/ImportDiagnosticsPanel'
import { useEffect, useRef, useState } from 'react'
import { bookImportApi } from '@/lib/api'
import type {
  BookImportBoundaryOverride,
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
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, CircleAlert, FileText, Globe2, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'

type ImportStep = 'source' | 'match' | 'diff' | 'result'
type SourceMode = 'file' | 'url'


const STEP_LABELS: Array<{ id: ImportStep; label: string }> = [
  { id: 'source', label: '选择来源' },
  { id: 'match', label: '确认作品' },
  { id: 'diff', label: '查看差异' },
  { id: 'result', label: '导入结果' },
]

const STEP_DESCRIPTIONS: Record<ImportStep, string> = {
  source: '选择书籍文件或网页链接，先预览，再导入。',
  match: '确认导入到哪本作品，避免同名书籍混在一起。',
  diff: '核对作品信息与章节差异，只导入你选中的内容。',
  result: '查看本次导入结果，或撤回可安全恢复的变更。',
}

const STEP_TITLES: Record<ImportStep, string> = {
  source: '导入书籍',
  match: '确认作品',
  diff: '核对导入内容',
  result: '导入结果',
}

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
  if (preview.supplementary) return '蓝奏附加源'
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
  initialPreview,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted?: () => void
  initialPreview?: BookImportPreview
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<ImportStep>(initialPreview ? 'diff' : 'source')
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [step])
  const [sourceMode, setSourceMode] = useState<SourceMode>('file')
  const [reviewTab, setReviewTab] = useState('chapters')
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<BookImportPreview | null>(initialPreview || null)
  const [targetNovelId, setTargetNovelId] = useState<string | null>(initialPreview?.targetNovelId || null)
  const [createNewSelected, setCreateNewSelected] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set(initialPreview?.chapters.filter(c=>c.selected).map(c=>c.id)))
  const [metadataFields, setMetadataFields] = useState<Set<string>>(new Set())
  const [metadataMode, setMetadataMode] = useState<'missing' | 'replace'>('missing')
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 复核与提交/目标变更互斥，避免确认中的预览被旧响应覆盖。 */
  const [reviewBusy, setReviewBusy] = useState(false)
  const operationBusy = busy || reviewBusy
  const operationLock = useRef(false)
  const requestGeneration = useRef(0)
  useEffect(
    () => () => {
      requestGeneration.current++
    },
    [open],
  )
  const [notice, setNotice] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BookImportCommitResult | null>(null)
  const [rollbackResult, setRollbackResult] = useState<BookImportRollbackResult | null>(null)

  function applyPreview(next: BookImportPreview) {
    setPreview(next)
    setTargetNovelId(next.targetNovelId)
    setCreateNewSelected(false)
    setSelectedChapterIds(new Set(next.chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.id)))
    setMetadataFields(new Set(next.supplementary ? [] : next.metadataDiff.filter((field) => field.selected).map((field) => field.field)))
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
    if (operationBusy || operationLock.current) return
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
    if (!preview || operationBusy || operationLock.current) return
    if (preview.candidates.length > 0 && !targetNovelId && !createNewSelected) {
      setError('请选择一个已有作品，或选择新建作品。')
      return
    }
    setError('')
    setBusy(true)
    try {
      if (targetNovelId !== preview.targetNovelId) {
        const next = await bookImportApi.selectTarget(preview.runId, targetNovelId, preview.revision || 0)
        applyPreview(next)
        setCreateNewSelected(next.targetNovelId === null)
      }
      setReviewTab('chapters')
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
      if (checked === true) {
        if (chapter.variantGroup) preview?.chapters.forEach(other => {
          if (other.variantGroup === chapter.variantGroup) next.delete(other.id)
        })
        next.add(chapter.id)
      }
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
    if (!preview || operationBusy || operationLock.current) return
    setError('')
    operationLock.current = true
    setBusy(true)
    try {
      const next = await bookImportApi.commit(preview.runId, {
        targetNovelId,
        selectedChapterIds: Array.from(selectedChapterIds),
        metadataFields: Array.from(metadataFields),
        metadataMode,
        revision: preview.revision || 0,
      })
      setResult(next)
      setStep('result')
      onCompleted?.()
    } catch (err) {
      setError((err as Error).message || '导入提交失败，请重新打开预览检查。')
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function handleAiReview() {
    if (!preview || operationBusy || operationLock.current) return
    operationLock.current = true
    const generation = requestGeneration.current
    setError('')
    setReviewBusy(true)
    try {
      const review = await bookImportApi.aiReview(preview.runId, preview.revision || 0)
      if (generation !== requestGeneration.current) return
      setPreview({
        ...preview,
        revision: review.revision,
        reviewedLines: review.reviewedLines,
        diagnostics: review.diagnostics || preview.diagnostics,
        aiReview: review,
      })
    } catch (err) {
      if (generation === requestGeneration.current) setError((err as Error).message || 'AI 复核失败，请稍后重试。')
    } finally {
      operationLock.current = false
      if (generation === requestGeneration.current) setReviewBusy(false)
    }
  }

  async function changeBoundaries(action: {
    lines?: number[]
    changes?: Pick<BookImportBoundaryOverride, 'line' | 'verdict'>[]
    removeLines?: number[]
    reset?: boolean
  }) {
    if (!preview || operationBusy || operationLock.current) return
    operationLock.current = true
    const generation = requestGeneration.current
    setError('')
    setReviewBusy(true)
    try {
      const next = action.lines
        ? await bookImportApi.applyAiReview(preview.runId, preview.revision || 0, action.lines)
        : await bookImportApi.editBoundaries(preview.runId, { ...action, revision: preview.revision || 0 })
      if (generation !== requestGeneration.current) return
      applyPreview(next)
      setNotice('已重新识别章节，尚未导入。章节和作品信息的勾选已重置，请重新核对后确认导入。')
    } catch (err) {
      if (generation === requestGeneration.current) setError((err as Error).message || '边界修正失败，请稍后重试。')
    } finally {
      operationLock.current = false
      if (generation === requestGeneration.current) setReviewBusy(false)
    }
  }

  async function refreshPreview() {
    if (!preview || operationBusy || operationLock.current) return
    setBusy(true)
    try {
      applyPreview(await bookImportApi.getPreview(preview.runId))
      setError('')
      setNotice('已加载最新预览，请重新核对勾选。')
    } catch (err) {
      setError((err as Error).message)
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
    <Dialog open={open} onOpenChange={(nextOpen) => !operationBusy && onOpenChange(nextOpen)}>
      <AdminDialogContent className="book-import-dialog" aria-describedby="book-import-description" data-step={step}>
        <DialogHeader className="book-import__header">
          <DialogTitle>{STEP_TITLES[step]}</DialogTitle>
          <DialogDescription id="book-import-description">{STEP_DESCRIPTIONS[step]}</DialogDescription>
          <ol className="book-import__steps" aria-label="导入进度">
            {STEP_LABELS.map((item, index) => {
              const active = item.id === step
              const complete = index < stepIndex(step)
              return (
                <li key={item.id} className="book-import__step" data-active={active} data-complete={complete} aria-current={active ? 'step' : undefined}>
                  <span className="book-import__step-number" aria-hidden="true">
                    {complete ? <Check /> : index + 1}
                  </span>
                  <span>{item.label}</span>
                </li>
              )
            })}
          </ol>
        </DialogHeader>

        <div ref={bodyRef} className="admin-dialog__body book-import__body" aria-busy={operationBusy}>
          {error && (
            <Alert variant="destructive" className="book-import__alert" role="alert">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 'source' && (
            <div className="book-import__source">
              <Tabs
                value={sourceMode}
                onValueChange={(value) => {
                  setSourceMode(value as SourceMode)
                  setError('')
                }}
              >
                <TabsList variant="line" className="book-import__source-tabs" aria-label="选择导入来源">
                  <TabsTrigger value="file" disabled={operationBusy}>
                    <FileText aria-hidden="true" /> 本地文件
                  </TabsTrigger>
                  <TabsTrigger value="url" disabled={operationBusy}>
                    <Globe2 aria-hidden="true" /> 网页链接
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="file" className="book-import__source-content">
                  <input
                    ref={fileInputRef}
                    className="book-import__file-input"
                    type="file"
                    tabIndex={-1}
                    aria-label="选择书籍文件"
                    disabled={operationBusy}
                    accept=".txt,.text,.json,.epub,text/plain,application/json,application/epub+zip"
                    onChange={(event) => {
                      chooseFile(event.target.files?.[0] || null)
                      event.target.value = ''
                    }}
                  />
                  {file ? (
                    <div className="book-import__selected-file">
                      <FileText aria-hidden="true" />
                      <div className="book-import__file-copy" role="status">
                        <strong>{file.name}</strong>
                        <span>
                          {file.name.split('.').at(-1)?.toUpperCase()} · {formatNumber(Math.ceil(file.size / 1024))} KB · 已准备好预览
                        </span>
                      </div>
                      <div className="book-import__file-actions">
                        <Button variant="ghost" size="sm" disabled={operationBusy} onClick={() => fileInputRef.current?.click()}>
                          更换
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={operationBusy}
                          aria-label="移除已选文件"
                          onClick={() => {
                            setFile(null)
                            setError('')
                          }}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="book-import__dropzone"
                      data-drag-active={dragActive}
                      aria-disabled={operationBusy}
                      onDragEnter={(event) => {
                        event.preventDefault()
                        if (!busy) setDragActive(true)
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragActive(false)
                        if (!busy) chooseFile(event.dataTransfer.files[0] || null)
                      }}
                    >
                      <span className="book-import__dropzone-icon">
                        <BookOpen aria-hidden="true" />
                      </span>
                      <strong>把书籍文件拖到这里</strong>
                      <span className="book-import__formats">支持 TXT、JSON、EPUB · 最大 25 MB</span>
                      <Button
                        variant="outline"
                        className="book-import__choose-file"
                        aria-label="选择或拖入书籍文件"
                        disabled={operationBusy}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload aria-hidden="true" />
                        选择文件
                      </Button>
                    </div>
                  )}
                  <details className="book-import__optional-source">
                    <summary>
                      补充来源链接 <span>可选</span>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="book-import__field">
                      <Label htmlFor="book-import-source-url">原书来源 URL</Label>
                      <Input
                        id="book-import-source-url"
                        type="url"
                        placeholder="https://example.com/book/123"
                        disabled={operationBusy}
                        aria-describedby="book-import-source-hint"
                        value={sourceUrl}
                        onChange={(event) => setSourceUrl(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            void handlePreview()
                          }
                        }}
                      />
                      <p id="book-import-source-hint" className="book-import__hint">
                        用于更准确地匹配已有作品和章节；留空也可以导入。
                      </p>
                    </div>
                  </details>
                </TabsContent>
                <TabsContent value="url" className="book-import__source-content">
                  <div className="book-import__field">
                    <Label htmlFor="book-import-url">书籍详情页 URL</Label>
                    <Input
                      id="book-import-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/book/123"
                      disabled={operationBusy}
                      aria-describedby="book-import-url-hint"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          void handlePreview()
                        }
                      }}
                    />
                    <p id="book-import-url-hint" className="book-import__hint">
                      读取作品信息与章节正文。需要登录的站点，请先配置对应会话。
                    </p>
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
                  <h3>{preview.book.title}</h3>
                  <p>
                    {sourceTypeLabel(preview)} · {preview.book.author || '未知作者'} · {formatNumber(preview.book.chapters.length)} 章 · {preview.sourceLabel}
                  </p>
                </div>
              </div>

              <section className="book-import__section" aria-labelledby="book-import-match-title">
                <div className="book-import__section-heading">
                  <div>
                    <h3 id="book-import-match-title">书库匹配</h3>
                    <p>确认书名和作者后选择已有作品；候选都不符时，可选择新建作品。</p>
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
                          onClick={() => {
                            setTargetNovelId(candidate.novel.id)
                            setCreateNewSelected(false)
                          }}
                        >
                          <span className="book-import__candidate-check" aria-hidden="true">
                            {selected && <Check className="size-3.5" />}
                          </span>
                          <span className="book-import__candidate-copy">
                            <strong>{candidate.novel.title}</strong>
                            <span>
                              {candidate.novel.author || '未知作者'} · 本地 {formatNumber(candidate.novel.chapterCount)} 章
                            </span>
                          </span>
                          <Badge variant="outline">
                            {candidate.matchReason === 'source-url' ? '来源一致' : candidate.matchReason === 'title-author' ? '标题 + 作者' : '标题一致'}
                          </Badge>
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      className="book-import__candidate"
                      data-selected={createNewSelected}
                      aria-pressed={createNewSelected}
                      onClick={() => {
                        setTargetNovelId(null)
                        setCreateNewSelected(true)
                      }}
                    >
                      <span className="book-import__candidate-check" aria-hidden="true">
                        {createNewSelected && <Check className="size-3.5" />}
                      </span>
                      <span className="book-import__candidate-copy">
                        <strong>新建作品</strong>
                        <span>候选都不是这本书，将单独创建作品并导入章节。</span>
                      </span>
                    </button>
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
                  <h3>{preview.book.title}</h3>
                  <p>
                    {preview.targetNovel ? `目标：${preview.targetNovel.title}` : '提交后会创建新的书库作品'} · {preview.sourceLabel}
                  </p>
                </div>
              </div>

              <div className="book-import__summary-grid" aria-label="章节差异统计">
                <SummaryStat label="新增" value={preview.summary.newCount} tone="new" />
                <SummaryStat label="有变化" value={preview.summary.changedCount} tone="changed" />
                <SummaryStat label="无变化" value={preview.summary.unchangedCount} tone="unchanged" />
                <SummaryStat label="需确认" value={preview.summary.conflictCount} tone="conflict" />
              </div>

              {notice && (
                <p className="book-import__diagnostics-clean" role="status">
                  {notice}
                </p>
              )}
              {error.includes('预览版本') && (
                <Button variant="outline" disabled={operationBusy} onClick={() => void refreshPreview()}>
                  加载最新预览
                </Button>
              )}
              {preview.diagnostics &&
                ((preview.diagnostics.pendingCount ?? preview.diagnostics.uncertainTotal) > 0 || preview.diagnostics.anomalies.length > 0) && (
                  <div className="book-import__review-notice" role="status">
                    <CircleAlert aria-hidden="true" />
                    <span>
                      章节划分有待核对：{preview.diagnostics.pendingCount ?? preview.diagnostics.uncertainTotal} 行待复核，
                      {preview.diagnostics.anomalies.length} 项解析提示。
                    </span>
                    <Button variant="ghost" size="sm" disabled={operationBusy} onClick={() => setReviewTab('diagnostics')}>
                      前往检查
                    </Button>
                  </div>
                )}
              <Tabs value={reviewTab} onValueChange={setReviewTab} className="book-import__review">
                <TabsList className="book-import__review-tabs" aria-label="核对导入内容">
                  <TabsTrigger value="chapters" disabled={operationBusy}>
                    章节差异<span>{preview.chapters.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="metadata" disabled={operationBusy || !!preview.supplementary}>
                    作品信息<span>{changedMetadata.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="diagnostics" disabled={operationBusy}>
                    解析检查
                  </TabsTrigger>
                </TabsList>
                {/* 保持面板挂载，切换核对页签时保留手动编辑与 AI 对比结果。 */}
                <TabsContent value="diagnostics" forceMount hidden={reviewTab !== 'diagnostics'} className="book-import__review-panel">
                  {preview.diagnostics && (
                    <ImportDiagnosticsPanel
                      diagnostics={preview.diagnostics}
                      aiReview={preview.aiReview || null}
                      onReview={() => void handleAiReview()}
                      onApply={(lines) => void changeBoundaries({ lines })}
                      busy={operationBusy}
                      runId={preview.runId}
                      revision={preview.revision || 0}
                      overrides={preview.boundaryOverrides || []}
                      reviewedLines={preview.reviewedLines || []}
                      canResplit={preview.canResplit ?? false}
                      expiresAt={preview.sourceExpiresAt}
                      onEdit={(changes) => void changeBoundaries({ changes })}
                      onUndo={(line) => void changeBoundaries({ removeLines: [line] })}
                      onReset={() => void changeBoundaries({ reset: true })}
                    />
                  )}
                  {!preview.diagnostics && <div className="book-import__empty-state">此来源直接提供章节内容，无需检查文本章节划分。</div>}
                </TabsContent>

                <TabsContent value="metadata" forceMount hidden={reviewTab !== 'metadata'} className="book-import__review-panel">
                  {changedMetadata.length > 0 && (
                    <section className="book-import__section" aria-labelledby="book-import-metadata-title">
                      <div className="book-import__section-heading">
                        <h3 id="book-import-metadata-title">作品信息变化</h3>
                        <Badge variant="secondary">已选 {selectedMetadataCount} 项</Badge>
                      </div>
                      <p className="book-import__hint">新作品默认带入；已有内容只补空白，覆盖已有值需要显式选择。</p>
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
                          <input
                            type="radio"
                            name="book-import-metadata-mode"
                            checked={metadataMode === 'missing'}
                            onChange={() => setMetadataMode('missing')}
                          />
                          <span>只补齐空白</span>
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="book-import-metadata-mode"
                            checked={metadataMode === 'replace'}
                            onChange={() => setMetadataMode('replace')}
                          />
                          <span>覆盖已选字段</span>
                        </label>
                      </div>
                    </section>
                  )}
                  {changedMetadata.length === 0 && <div className="book-import__empty-state">作品信息与书库一致，没有需要更新的字段。</div>}
                </TabsContent>

                <TabsContent value="chapters" forceMount hidden={reviewTab !== 'chapters'} className="book-import__review-panel">
                  <section className="book-import__section" aria-labelledby="book-import-chapters-title">
                    <div className="book-import__section-heading">
                      <div>
                        <h3 id="book-import-chapters-title">章节差异</h3>
                        <p>新增章节默认选中；有变化的章节需展开比较。同章不同版本默认不选，每组只选一个。</p>
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
                                  <Badge variant="outline" className={status.className}>
                                    {status.label}
                                  </Badge>
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
                </TabsContent>
              </Tabs>
              {preview.warnings.length > 0 && <WarningList warnings={preview.warnings} />}
            </div>
          )}

          {step === 'result' && result && (
            <ImportResult
              result={result}
              novelTitle={preview?.book.title || '作品'}
              rollbackResult={rollbackResult}
              onRollback={() => void handleRollback()}
              busy={busy}
            />
          )}
        </div>

        <DialogFooter className="book-import__footer">
          <div className="book-import__footer-status" role="status">
            {operationBusy ? (
              <div className="book-import__progress" aria-live="polite">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                <span>
                  {reviewBusy
                    ? '正在复核或更新章节边界，请稍候…'
                    : step === 'source'
                      ? '正在分析来源并生成预览…'
                      : step === 'result'
                        ? '正在撤回导入…'
                        : '正在处理，请稍候…'}
                </span>
              </div>
            ) : step === 'diff' ? (
              <span>
                已选 {selectedChapterCount} 章 · {selectedMetadataCount} 项作品信息
              </span>
            ) : step === 'source' ? (
              <span>生成预览后，再确认导入</span>
            ) : step === 'match' ? (
              <span>{targetNovelId ? '导入到已有作品' : createNewSelected || !preview?.candidates.length ? '将创建新作品' : '确认目标后，继续查看差异'}</span>
            ) : (
              <span>{rollbackResult ? '撤回结果已保存' : '已保留本次导入快照'}</span>
            )}
          </div>
          <div className="book-import__footer-actions">
            {step === 'source' && (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={operationBusy}>
                  取消
                </Button>
                <Button onClick={() => void handlePreview()} disabled={operationBusy || (sourceMode === 'file' ? !file : !sourceUrl.trim())}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                  {busy ? '分析中…' : '生成预览'}
                </Button>
              </>
            )}
            {step === 'match' && (
              <>
                <Button variant="ghost" onClick={() => setStep('source')} disabled={operationBusy}>
                  <ArrowLeft aria-hidden="true" />
                  返回
                </Button>
                <Button onClick={() => void handleMatchContinue()} disabled={operationBusy}>
                  <ArrowRight aria-hidden="true" />
                  查看差异
                </Button>
              </>
            )}
            {step === 'diff' && (
              <>
                <Button variant="ghost" onClick={() => preview?.supplementary ? onOpenChange(false) : setStep('match')} disabled={operationBusy}>
                  <ArrowLeft aria-hidden="true" />
                  返回
                </Button>
                <Button onClick={() => void handleCommit()} disabled={operationBusy || !hasImportableChanges}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                  {busy ? '导入中…' : `确认导入${hasImportableChanges ? ` · ${selectedChapterCount} 章` : ''}`}
                </Button>
              </>
            )}
            {step === 'result' && (
              <>
                <Button variant="ghost" onClick={startOver} disabled={operationBusy || !!preview?.supplementary}>
                  <RotateCcw aria-hidden="true" />
                  再导入一本
                </Button>
                <Button onClick={() => onOpenChange(false)} disabled={operationBusy}>
                  完成
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </AdminDialogContent>
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
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
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
  novelTitle,
  rollbackResult,
  onRollback,
  busy,
}: {
  result: BookImportCommitResult
  novelTitle: string
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
      <h3>{rolledBack ? '已恢复可安全恢复的内容' : result.novelCreated ? '已创建新作品' : '已增量更新作品'}</h3>
      <p>{rolledBack ? `已撤回 ${formatNumber(rollbackResult?.rolledBack || 0)} 项变更。` : `「${novelTitle}」已记录本次导入快照。`}</p>
      {!rolledBack && (
        <div className="book-import__result-grid">
          <SummaryStat label="新增章节" value={result.created} tone="new" />
          <SummaryStat label="更新章节" value={result.updated} tone="changed" />
          <SummaryStat label="跳过章节" value={result.skipped} tone="unchanged" />
          <SummaryStat label="冲突" value={result.conflicts.length} tone="conflict" />
        </div>
      )}
      {(result.conflicts.length > 0 || (rollbackResult?.conflicts.length || 0) > 0) && (
        <div className="book-import__result-warning">
          <CircleAlert aria-hidden="true" />
          <span>
            {rollbackResult?.conflicts.length
              ? '有内容在操作后再次变化，系统已保留这些内容，没有强制覆盖。'
              : '有章节在提交时发生变化，系统已跳过这些章节，可重新预览后处理。'}
          </span>
        </div>
      )}
      {!rolledBack && (
        <Button variant="ghost" onClick={onRollback} disabled={busy}>
          <RotateCcw aria-hidden="true" />
          撤回这次导入
        </Button>
      )}
    </div>
  )
}
