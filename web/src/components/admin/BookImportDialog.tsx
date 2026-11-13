import AiStreamPreview from '@/components/shared/AiStreamPreview'
import type { AiTextProgress } from '@shared/ai-text-progress'
import { MotionDetails } from '@/components/ui/motion'
import '@/styles/input-fields.css'
import { DialogFrame } from "@/components/shared/DialogFrame"
import BookImportChapterResolver, { type ChapterResolutionChoice } from './BookImportChapterResolver'
import { planImportInsertions } from '@shared/book-import-resolution'
import ImportDiagnosticsPanel from '@/components/admin/ImportDiagnosticsPanel'
import { useEffect, useRef, useState } from 'react'
import { bookImportApi } from '@/lib/api'
import type {
  BookImportBoundaryOverride,
  BookImportChapterDiff,
  BookImportCommitResult,
  BookImportMetadataDiff,
  BookImportNovelCandidate,
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
import styles from './BookImportDialog.module.css'

type ImportStep = 'source' | 'match' | 'diff' | 'result'
type SourceMode = 'file' | 'url'


const STEP_LABELS: Array<{ id: ImportStep; label: string }> = [
  { id: 'source', label: '选择来源' },
  { id: 'match', label: '确认作品' },
  { id: 'diff', label: '查看差异' },
  { id: 'result', label: '导入结果' },
]

const STEP_DESCRIPTIONS: Record<ImportStep, string> = {
  source: '把新的故事带进书库，核对内容后再确认导入。',
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

const MATCH_REASON: Record<BookImportNovelCandidate['matchReason'], string> = {
  'source-url': '来源一致',
  'title-author': '标题 + 作者',
  'title-tag': '作者一致 · 书名带标签',
  title: '标题一致',
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
  if (diff.field === 'coverUrl' && text) return text === '压缩包中的本地封面' ? text : '已提供封面地址'
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
  const [archivePreviews, setArchivePreviews] = useState<BookImportPreview[]>([])
  const [archiveSelected, setArchiveSelected] = useState<Set<string>>(new Set())
  const [archiveRemaining, setArchiveRemaining] = useState<BookImportPreview[]>([])
  const [archiveTotal, setArchiveTotal] = useState(0)
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<BookImportPreview | null>(initialPreview || null)
  const [targetNovelId, setTargetNovelId] = useState<string | null>(initialPreview?.targetNovelId || null)
  const [createNewSelected, setCreateNewSelected] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set(initialPreview?.chapters.filter(c=>c.selected).map(c=>c.id)))
  const [metadataFields, setMetadataFields] = useState<Set<string>>(new Set())
  const [metadataMode, setMetadataMode] = useState<'missing' | 'replace'>('missing')
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null)
  const [resolvingChapterId, setResolvingChapterId] = useState<string | null>(null)
  const [resolutionError, setResolutionError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 复核与提交/目标变更互斥，避免确认中的预览被旧响应覆盖。 */
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewProgress, setReviewProgress] = useState<AiTextProgress | null>(null)
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
    setResolvingChapterId(null)
    setResolutionError('')
  }

  function chooseFile(next: File | null) {
    setError('')
    if (!next) return
    const lower = next.name.toLocaleLowerCase()
    setArchivePreviews([])
    setArchiveRemaining([])
    setArchiveTotal(0)
    if (!['.txt', '.text', '.json', '.epub', '.zip'].some((extension) => lower.endsWith(extension))) {
      setFile(null)
      setError('请选择 TXT、JSON、EPUB 或 ZIP 文件。')
      return
    }
    if (next.size > (lower.endsWith('.zip') ? 64 : 25) * 1024 * 1024) {
      setFile(null)
      setError(lower.endsWith('.zip') ? 'ZIP 文件不能超过 64 MB。' : '文件不能超过 25 MB。')
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
    if (sourceMode === 'file' && file?.name.toLowerCase().endsWith('.zip') && archivePreviews.length) {
      const chosen = archivePreviews.filter(item => archiveSelected.has(item.runId))
      if (!chosen.length) { setError('请至少选择一本书籍。'); return }
      setArchiveRemaining(chosen.slice(1))
      setArchiveTotal(chosen.length)
      applyPreview(chosen[0]!)
      setResult(null)
      setRollbackResult(null)
      setStep('match')
      return
    }
    setBusy(true)
    try {
      if (sourceMode === 'file' && file?.name.toLowerCase().endsWith('.zip')) {
        const archive = await bookImportApi.previewZip(file)
        setArchivePreviews(archive.previews)
        setArchiveSelected(new Set(archive.previews.map(item => item.runId)))
        return
      }
      const next = sourceMode === 'file' ? await bookImportApi.previewFile(file!, sourceUrl) : await bookImportApi.previewUrl(sourceUrl.trim())
      applyPreview(next)
      setStep('match')
    } catch (err) {
      setError((err as Error).message || '无法生成导入预览，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function nextArchiveBook() {
    if (operationBusy || !archiveRemaining.length) return
    setBusy(true)
    setError('')
    try {
      const next = await bookImportApi.getPreview(archiveRemaining[0]!.runId)
      setArchiveRemaining(previous => previous.slice(1))
      applyPreview(next)
      setResult(null)
      setRollbackResult(null)
      setStep('match')
    } catch (error) { setError((error as Error).message || '下一本预览读取失败') }
    finally { setBusy(false) }
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

  async function openChapterResolver(chapter: BookImportChapterDiff) {
    if (!preview || operationBusy || operationLock.current) return
    setResolutionError('')
    setError('')
    let current = preview
    if (!current.localChapters) {
      operationLock.current = true
      setReviewProgress(null)
    setReviewBusy(true)
      try {
        current = await bookImportApi.selectTarget(current.runId, current.targetNovelId, current.revision || 0)
        applyPreview(current)
        setNotice('已重新读取本地章节，尚未导入；请重新核对勾选。')
      } catch (error) { setError((error as Error).message); return }
      finally { operationLock.current = false; setReviewBusy(false) }
    }
    if (!current.chapters.some(item => item.id === chapter.id && (item.status === 'conflict' || current.chapterResolutions?.some(r => r.chapterId === item.id)))) return
    setExpandedChapterId(chapter.id)
    setResolvingChapterId(chapter.id)
  }

  async function resolveChapter(chapter: BookImportChapterDiff, choice: ChapterResolutionChoice | { action: 'clear' }) {
    if (!preview || operationBusy || operationLock.current) return
    operationLock.current = true
    const generation = requestGeneration.current
    setReviewProgress(null)
    setReviewBusy(true)
    setResolutionError('')
    setError('')
    try {
      const next = await bookImportApi.resolveChapter(preview.runId, { chapterId: chapter.id, ...choice, revision: preview.revision || 0 })
      if (generation !== requestGeneration.current) return
      const selected = new Set(next.chapters.filter(item => item.id !== chapter.id && selectedChapterIds.has(item.id) && !isDisabledChapter(item)).map(item => item.id))
      const resolved = next.chapters.find(item => item.id === chapter.id)
      if (resolved?.selected && !isDisabledChapter(resolved)) {
        if (resolved.variantGroup) for (const item of next.chapters) if (item.variantGroup === resolved.variantGroup) selected.delete(item.id)
        selected.add(chapter.id)
      }
      applyPreview(next)
      setSelectedChapterIds(selected)
      setMetadataFields(metadataFields)
      setMetadataMode(metadataMode)
      setExpandedChapterId(chapter.id)
      setNotice('人工确认已保存到预览，尚未写入书库。已保留其他章节的勾选，请核对后再确认导入。')
    } catch (error) {
      if (generation === requestGeneration.current) { setResolvingChapterId(chapter.id); setResolutionError((error as Error).message) }
    } finally {
      operationLock.current = false
      if (generation === requestGeneration.current) setReviewBusy(false)
    }
  }

  async function reloadResolutionBase() {
    if (!preview || operationBusy || operationLock.current) return
    operationLock.current = true
    setReviewProgress(null)
    setReviewBusy(true)
    try {
      const latest = await bookImportApi.getPreview(preview.runId)
      applyPreview(await bookImportApi.selectTarget(latest.runId, latest.targetNovelId, latest.revision || 0))
      setNotice('已重新读取本地章节，人工确认与勾选已重置，请重新核对。')
    } catch (error) { setResolutionError((error as Error).message) }
    finally { operationLock.current = false; setReviewBusy(false) }
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
    setReviewProgress(null)
    setReviewBusy(true)
    try {
      const review = await bookImportApi.aiReview(preview.runId, preview.revision || 0, (next) => { if (generation === requestGeneration.current) setReviewProgress(next) })
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
    setReviewProgress(null)
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
    setStep('source')
    setSourceMode('file')
    setFile(null)
    setSourceUrl('')
    setPreview(null)
    setResult(null)
    setRollbackResult(null)
    setArchivePreviews([])
    setArchiveSelected(new Set())
    setArchiveRemaining([])
    setArchiveTotal(0)
    setError('')
    setNotice('')
  }

  const changedMetadata = preview?.metadataDiff.filter((field) => field.changed) || []
  const selectedChapterCount = selectedChapterIds.size
  const selectedMetadataCount = metadataFields.size
  const hasImportableChanges = selectedChapterCount > 0 || selectedMetadataCount > 0
  const allResolutions = preview?.chapters.flatMap(chapter => (preview.chapterResolutions || []).filter(item => item.chapterId === chapter.id)) || []
  const insertionPlan = planImportInsertions(preview?.localChapters || [], allResolutions, selectedChapterIds)
  const plannedOrders = new Map(insertionPlan.insertOrders)
  if (preview?.chapterResolutions?.some(item => item.action === 'insert')) {
    let tail = insertionPlan.maxOrder
    for (const chapter of preview.chapters) if (chapter.status === 'new' && selectedChapterIds.has(chapter.id) && !plannedOrders.has(chapter.id)) plannedOrders.set(chapter.id, ++tail)
  }


  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !operationBusy && onOpenChange(nextOpen)}>
      <DialogFrame className={`book-import-dialog ${styles.dialog}`} aria-describedby="book-import-description" data-step={step}>
        <DialogHeader className={styles.header}>
          <DialogTitle>{STEP_TITLES[step]}</DialogTitle>
          <DialogDescription id="book-import-description">{STEP_DESCRIPTIONS[step]}</DialogDescription>
          <ol className={styles.steps} aria-label="导入进度">
            {STEP_LABELS.map((item, index) => {
              const active = item.id === step
              const complete = index < stepIndex(step)
              return (
                <li key={item.id} className={styles.step} data-active={active} data-complete={complete} aria-current={active ? 'step' : undefined}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {complete ? <Check /> : `0${index + 1}`}
                  </span>
                  <span>{item.label}</span>
                </li>
              )
            })}
          </ol>
        </DialogHeader>

        <div ref={bodyRef} className={`dialog-frame__body ${styles.body}`} aria-busy={operationBusy}>
          {archiveTotal > 0 && step !== 'source' && <p className="book-import__safe-note" role="status">ZIP 逐本导入 · 第 {archiveTotal - archiveRemaining.length} / {archiveTotal} 本 · 每本单独确认，可在导入历史中撤回。</p>}
          {error && (
            <Alert variant="destructive" className="book-import__alert" role="alert">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 'source' && (
            <div className={styles.source}>
              <Tabs
                value={sourceMode}
                onValueChange={(value) => {
                  setSourceMode(value as SourceMode)
                  setError('')
                }}
              >
                <TabsList className={styles.sourceTabs} aria-label="选择导入来源">
                  <TabsTrigger value="file" disabled={operationBusy}>
                    <FileText aria-hidden="true" /> 本地文件
                  </TabsTrigger>
                  <TabsTrigger value="url" disabled={operationBusy}>
                    <Globe2 aria-hidden="true" /> 网页链接
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="file" className={styles.sourceContent}>
                  <input
                    ref={fileInputRef}
                    className={styles.fileInput}
                    type="file"
                    tabIndex={-1}
                    aria-label="选择书籍文件"
                    disabled={operationBusy}
                    accept=".txt,.text,.json,.epub,.zip,text/plain,application/json,application/epub+zip,application/zip"
                    onChange={(event) => {
                      chooseFile(event.target.files?.[0] || null)
                      event.target.value = ''
                    }}
                  />
                  {file ? (
                    <div className={styles.selectedFile}>
                      <FileText aria-hidden="true" />
                      <div className={styles.fileCopy} role="status">
                        <strong>{file.name}</strong>
                        <span>
                          {file.name.split('.').at(-1)?.toUpperCase()} · {formatNumber(Math.ceil(file.size / 1024))} KB
                        </span>
                        <span className={styles.fileState}><Check aria-hidden="true" />{archivePreviews.length > 0 ? '书籍清单已就绪' : '已准备好预览'}</span>
                      </div>
                      <div className={styles.fileActions}>
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
                            setArchivePreviews([])
                            setArchiveRemaining([])
                            setArchiveTotal(0)
                            setError('')
                          }}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={styles.dropzone}
                      data-drag-active={dragActive}
                      aria-disabled={operationBusy}
                      onDragEnter={(event) => {
                        event.preventDefault()
                        if (!operationBusy) setDragActive(true)
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragActive(false)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragActive(false)
                        if (!operationBusy) chooseFile(event.dataTransfer.files[0] || null)
                      }}
                    >
                      <span className={styles.dropzoneIcon}>
                        <BookOpen aria-hidden="true" />
                      </span>
                      <div className={styles.dropzoneCopy}>
                        <strong>{dragActive ? '松开即可选择文件' : '拖入一本书，开始整理'}</strong>
                        <span>将文件拖到这里，或从设备中选择</span>
                      </div>
                      <Button
                        className={styles.chooseFile}
                        aria-label="选择或拖入书籍文件"
                        disabled={operationBusy}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload aria-hidden="true" />
                        选择文件
                      </Button>
                    </div>
                  )}
                  {!file && (
                    <div className={styles.formats}>
                      <span><strong>TXT · JSON · EPUB</strong><span>单个文件最大 25 MB</span></span>
                      <span><strong>ZIP 压缩包</strong><span>最大 64 MB，可逐本确认</span></span>
                    </div>
                  )}
                  {archivePreviews.length > 0 && (
                    <section className={styles.archive} aria-label="ZIP 书籍清单">
                      <div className={styles.archiveHeading}>
                        <h3>压缩包中的书籍</h3>
                        <span>已选 {archiveSelected.size} / {archivePreviews.length} 本</span>
                      </div>
                      <p className="book-import__hint">选择后逐本核对，此时尚未写入书库。</p>
                      <div className={styles.archiveList}>
                        {archivePreviews.map(item => (
                          <label key={item.runId} className={styles.archiveItem}>
                            <Checkbox checked={archiveSelected.has(item.runId)} disabled={operationBusy} aria-label={`导入书籍：${item.book.title}`}
                              onCheckedChange={() => setArchiveSelected(previous => { const next = new Set(previous); if (next.has(item.runId)) next.delete(item.runId); else next.add(item.runId); return next })} />
                            <span><strong>{item.book.title}</strong><small>{item.sourceLabel}</small></span>
                            <span className={styles.archiveChapters}>{formatNumber(item.chapters.length)} 章</span>
                          </label>
                        ))}
                      </div>
                    </section>
                  )}
                  {!file?.name.toLowerCase().endsWith('.zip') && <MotionDetails className={styles.optionalSource}>
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
                  </MotionDetails>}
                </TabsContent>
                <TabsContent value="url" className={`${styles.sourceContent} ${styles.urlContent}`}>
                  <div className={styles.urlIntro}>
                    <Globe2 aria-hidden="true" />
                    <div><strong>从网页带入一本书</strong><p>粘贴作品详情页链接，读取书籍信息与章节。</p></div>
                  </div>
                  <div className={`book-import__field ${styles.urlField}`}>
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
                      需要登录的站点，请先配置对应会话。
                    </p>
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
                  <Badge variant="secondary">{preview.candidates.length ? `找到 ${preview.candidates.length} 个候选` : '未匹配到已有作品'}</Badge>
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
                            {MATCH_REASON[candidate.matchReason]}
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
                      <p>提交前可以核对章节和作品信息。</p>
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
                    {insertionPlan.changes.length > 0 && <p role="status" className="book-import__safe-note">本次选中的插章将顺延 {insertionPlan.changes.length} 个已有章节的序号，正文和标题保留；取消勾选会重新计算。</p>}
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
                                disabled={disabled || operationBusy}
                                aria-label={`${status.label}章节：${chapter.incomingTitle}`}
                                title={chapter.status === 'conflict' ? '请先点击下方「核对章节对应关系」处理此项' : undefined}
                                aria-describedby={`book-import-reason-${chapter.id}`}
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
                                  <span id={`book-import-reason-${chapter.id}`}>{chapter.reason}</span>
                                  {plannedOrders.has(chapter.id) && <span>预计导入序号：{plannedOrders.get(chapter.id)}</span>}
                                </span>
                                <span className="book-import__chapter-meta">
                                  <Badge variant="outline" className={status.className}>
                                    {status.label}
                                  </Badge>
                                  {(chapter.status === 'changed' || chapter.status === 'conflict') && (expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />)}
                                </span>
                              </button>
                            </div>
                            {(chapter.status === 'conflict' || preview.chapterResolutions?.some(item => item.chapterId === chapter.id)) && <div className="book-import__resolution-entry">
                              <p>{chapter.status === 'conflict' ? '此项暂不可勾选，请先核对对应关系或章节边界。' : '已保存人工确认，最终写入以勾选和确认导入为准。'}</p>
                              <div className="book-import__resolution-actions">
                                <Button variant="outline" size="sm" disabled={operationBusy} onClick={() => void openChapterResolver(chapter)}>核对章节对应关系</Button>
                                {preview.chapterResolutions?.some(item => item.chapterId === chapter.id) && <Button variant="ghost" size="sm" disabled={operationBusy} onClick={() => void resolveChapter(chapter, { action: 'clear' })}>撤销人工确认</Button>}
                                {preview.diagnostics && <Button variant="ghost" size="sm" disabled={operationBusy} onClick={() => { setReviewTab('diagnostics'); bodyRef.current?.scrollTo({ top: 0, behavior: 'instant' }) }}>核对章节边界</Button>}
                              </div>
                            </div>}
                            {resolvingChapterId === chapter.id && <>
                              <BookImportChapterResolver key={`${preview.runId}:${preview.revision}:${chapter.id}`} chapter={chapter} local={preview.localChapters || []} resolutions={preview.chapterResolutions || []} chapters={preview.chapters} selectedIds={selectedChapterIds} busy={operationBusy} onSave={choice => void resolveChapter(chapter, choice)} onCancel={() => setResolvingChapterId(null)} />
                              {resolutionError && <div className="book-import__resolution-error" role="alert"><p>{resolutionError}</p>{reviewBusy && <AiStreamPreview progress={reviewProgress} structured />}
                <Button variant="outline" size="sm" disabled={operationBusy} onClick={() => void reloadResolutionBase()}>重新读取本地章节</Button><p>重新读取会清除本次人工确认及勾选，请重新核对。</p></div>}
                            </>}
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

        <DialogFooter className={styles.footer}>
          <div className={styles.footerStatus} role="status">
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
              <span>{sourceMode === 'file' && archivePreviews.length > 0 ? `已选 ${archiveSelected.size} 本，下一步逐本核对` : '先预览，确认后写入书库'}</span>
            ) : step === 'match' ? (
              <span>{targetNovelId ? '导入到已有作品' : createNewSelected || !preview?.candidates.length ? '将创建新作品' : '确认目标后，继续查看差异'}</span>
            ) : (
              <span>{rollbackResult ? '撤回结果已保存' : '已保留本次导入快照'}</span>
            )}
          </div>
          <div className={styles.footerActions}>
            {step === 'source' && (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={operationBusy}>
                  取消
                </Button>
                <Button onClick={() => void handlePreview()} disabled={operationBusy || (sourceMode === 'file' ? !file || (archivePreviews.length > 0 && archiveSelected.size === 0) : !sourceUrl.trim())}>
                  {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                  {busy ? '分析中…' : archivePreviews.length > 0 && sourceMode === 'file' ? '开始逐本核对' : '生成预览'}
                  {!busy && <ArrowRight aria-hidden="true" />}
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
            {archiveRemaining.length > 0 && (step === 'match' || step === 'result') && (
              <Button variant="secondary" disabled={operationBusy} onClick={() => void nextArchiveBook()}>
                {step === 'match' ? '跳过本书，查看下一本' : '下一本'}（剩余 {archiveRemaining.length} 本）
              </Button>
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
      </DialogFrame>
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
