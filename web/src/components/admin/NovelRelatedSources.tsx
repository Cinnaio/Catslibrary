import { type ReactNode, lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { SupplementaryOverview, SupplementaryUpdateMode, SupplementaryUpdateResult } from '@shared/supplementary-source'
import type { BookImportPreview } from '@shared/types'
import { bookImportApi, scrapeApi, supplementarySourceApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import { Files, ListOrdered } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import SearchSelect from '@/components/shared/SearchSelect'
import { MotionDetails } from '@/components/ui/motion'
import styles from './NovelFollowupDialog.module.css'
import SupplementarySourcesDialog from './SupplementarySourcesDialog'
import BookImportDialog from './BookImportDialog'

const ChapterMergeDialog = lazy(() => import('@/pages/admin/ChaptersTab'))
type Novel = { id: string; title: string; author?: string; chapterCount?: number }
const time = (value: number) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '尚未检查'
const statusText = (status: string) =>
  status === 'partial' ? '部分目录未完整读取' : status === 'error' ? '检查失败' : status === 'never' ? '尚未检查' : '目录检查成功'
const statusTone = (status: string) => (status === 'error' ? 'failed' : status === 'partial' ? 'partial' : 'idle')
const fileUpdateModes = [
  { value: 'manual', label: '手动确认' },
  { value: 'preview', label: '自动生成预览' },
  { value: 'append', label: '自动追加尾章' },
] satisfies { value: SupplementaryUpdateMode; label: string }[]

function fileUpdateStatus(result?: SupplementaryUpdateResult | null) {
  if (!result) return '等待处理候选文件'
  return {
    'no-file': '未找到匹配的文件',
    unchanged: '文件无新章',
    review: '待确认',
    added: `已追加 ${result.addedCount} 章`,
    'manual-download': '下载需人工接续',
    failed: '文件处理失败',
    'rolled-back': '已撤回',
  }[result.status]
}

function SourcePanel({ value, activeTab, children }: { value: string; activeTab?: string; children: ReactNode }) {
  return activeTab === undefined ? (
    <>{children}</>
  ) : (
    <TabsContent value={value} forceMount hidden={activeTab !== value} className={styles.panel}>
      {children}
    </TabsContent>
  )
}

/** 来源按用途展示，参考目录与文件绑定均不会启用网页正文抓取。 */
export default function NovelRelatedSources({ novel, onUpdated, activeTab }: { novel: Novel; onUpdated: (mode?: SupplementaryUpdateMode) => void; activeTab?: string }) {
  const [overview, setOverview] = useState<SupplementaryOverview | null>(null)
  const [bindings, setBindings] = useState<Array<Record<string, unknown>> | null>(null)
  const [fileError, setFileError] = useState('')
  const [referenceError, setReferenceError] = useState('')
  const [filesOpen, setFilesOpen] = useState(false)
  const [sourceId, setSourceId] = useState<string>()
  const [mergeOpen, setMergeOpen] = useState(false)
  const [draftModes, setDraftModes] = useState<Record<string, SupplementaryUpdateMode>>({})
  const [fileActionId, setFileActionId] = useState('')
  const [fileActionError, setFileActionError] = useState<{ id: string; message: string } | null>(null)
  const [fileNotice, setFileNotice] = useState('')
  const [automaticPreview, setAutomaticPreview] = useState<BookImportPreview | null>(null)
  const loadFiles = useCallback(async () => {
    try {
      setOverview(await supplementarySourceApi.overview())
      setFileError('')
    } catch (error) {
      setFileError((error as Error).message)
    }
  }, [])
  const loadReference = useCallback(async () => {
    try {
      setBindings((await scrapeApi.sourceBindings(novel.id)).bindings)
      setReferenceError('')
    } catch (error) {
      setReferenceError((error as Error).message)
    }
  }, [novel.id])
  useEffect(() => {
    let active = true
    supplementarySourceApi
      .overview()
      .then((data) => {
        if (active) {
          setOverview(data)
          setFileError('')
        }
      })
      .catch((error) => {
        if (active) setFileError(error.message)
      })
    scrapeApi
      .sourceBindings(novel.id)
      .then((data) => {
        if (active) {
          setBindings(data.bindings)
          setReferenceError('')
        }
      })
      .catch((error) => {
        if (active) setReferenceError(error.message)
      })
    return () => {
      active = false
    }
  }, [novel.id])
  const fileBindings = overview?.bindings.filter((binding) => binding.novelId === novel.id) || []
  function openFiles(id?: string) {
    setSourceId(id)
    setFilesOpen(true)
  }
  async function fileBindingAction(id: string, task: () => Promise<void>) {
    setFileActionId(id)
    setFileActionError(null)
    setFileNotice('')
    try {
      await task()
    } catch (error) {
      setFileActionError({ id, message: (error as Error).message })
    } finally {
      setFileActionId('')
    }
  }
  const fileAction = (
    <Button variant="secondary" size="sm" onClick={() => openFiles()}>
      绑定附加源
    </Button>
  )
  const referenceAction = (
    <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)}>
      读取参考目录并预览
    </Button>
  )
  return (
    <div className={styles.sources} data-tabbed={activeTab !== undefined}>
      <SourcePanel value="files" activeTab={activeTab}>
        <section className={styles.section} aria-labelledby="novel-file-source-title">
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>
              <h3 id="novel-file-source-title">文件来源</h3>
              {overview && fileBindings.length > 0 && (
                <span className={styles.count} aria-label="已绑定附加源数量">
                  {fileBindings.length} 个绑定
                </span>
              )}
            </div>
            <div className={styles.entryActions}>
              {fileBindings.some(binding => binding.updateMode && binding.updateMode !== 'manual') && (
                <Button variant="ghost" size="sm" disabled={!!fileActionId} onClick={() => void fileBindingAction('refresh', loadFiles)}>
                  {fileActionId === 'refresh' ? '正在刷新…' : '刷新文件状态'}
                </Button>
              )}
              {(!overview || fileBindings.length > 0 || fileError) && fileAction}
            </div>
          </div>
          <p className="dialog-frame-hint">为每个绑定选择如何处理共享目录中的 TXT／EPUB 文件。</p>
          {fileNotice && <p className={styles.notice} role="status">{fileNotice}</p>}
          {fileError && (
            <div role="alert" className={styles.inlineAlert}>
              <p>{fileError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadFiles()}>
                重新读取附加源
              </Button>
            </div>
          )}
          {!overview && !fileError && (
            <p role="status" className={styles.loading}>
              正在读取附加源…
            </p>
          )}
          {overview && !fileBindings.length && !fileError && (
            <EmptyState icon={<Files />} message="还没有文件来源" hint="从共享目录选择文件，绑定到这本书后即可检查新版本。" action={fileAction} />
          )}
          <div className={styles.sourceList}>
            {fileBindings.map((binding, index) => {
              const source = overview!.sources.find((item) => item.id === binding.sourceId)
              if (!source) return null
              const mode = draftModes[binding.id] || binding.updateMode
              const result = binding.updateResult
              return (
                <div className={styles.entry} key={binding.id} style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}>
                  <div className={styles.entryHead}>
                    <strong>{source.name}</strong>
                    <span className={styles.badge} data-tone={statusTone(source.status)}>
                      {statusText(source.status)}
                    </span>
                  </div>
                  <p className="dialog-frame-hint">
                    {source.enabled ? `跟随来源设置 · 每 ${source.intervalHours} 小时自动检查文件更新` : '来源的自动检查已暂停'}
                  </p>
                  {source.error && (
                    <p role="status" className={styles.sourceError}>
                      {source.error}
                    </p>
                  )}
                  <dl className={styles.sourceFacts}>
                    <div>
                      <dt>上次检查</dt>
                      <dd>{time(source.checkedAt)}</dd>
                    </div>
                    <div>
                      <dt>下次检查</dt>
                      <dd>{source.enabled ? (source.nextCheckAt ? time(source.nextCheckAt) : '等待安排') : '已暂停'}</dd>
                    </div>
                  </dl>
                  {mode && (
                    <div className={styles.candidateRow}>
                      <div className={styles.settingCopy}>
                        <label className={styles.factLabel} htmlFor={`file-mode-${binding.id}`}>文件更新方式</label>
                        <p id={`file-mode-hint-${binding.id}`}>
                          {mode === 'append' ? '只追加能接上本地末章的新章。保存时会暂停本书的网页自动追更。'
                            : mode === 'preview' ? '定时比较新文件，有章节差异时生成预览，供你确认。' : '从候选版本打开文件，核对章节后确认。'}
                        </p>
                      </div>
                      <div className={styles.entryActions}>
                        <SearchSelect id={`file-mode-${binding.id}`} aria-describedby={`file-mode-hint-${binding.id}`}
                          value={mode} options={fileUpdateModes} searchable={false} disabled={!!fileActionId}
                          onChange={value => {
                            const next = fileUpdateModes.find(option => option.value === value)?.value
                            if (next) setDraftModes(current => ({ ...current, [binding.id]: next }))
                            setFileNotice('')
                          }} />
                        {mode !== binding.updateMode && (
                          <Button size="sm" disabled={!!fileActionId} onClick={() => void fileBindingAction(binding.id, async () => {
                            setOverview(await supplementarySourceApi.saveUpdateMode(binding.id, mode))
                            setDraftModes(current => {
                              const next = { ...current }
                              delete next[binding.id]
                              return next
                            })
                            setFileNotice('文件更新方式已保存')
                            onUpdated(mode)
                          })}>
                            {fileActionId === binding.id ? '保存中…' : '保存方式'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {binding.updateMode && binding.updateMode !== 'manual' && (
                    <div className={styles.candidateRow}>
                      <div className={styles.settingCopy} aria-live="polite">
                        <span className={styles.factLabel}>{binding.updating ? '正在处理文件…' : fileUpdateStatus(result)}</span>
                        {source.enabled && (source.status === 'partial' || source.status === 'error') && (
                          <p>等待目录完整读取后再处理文件。</p>
                        )}
                        {result && <p>{[result.fileName, time(result.checkedAt)].filter(Boolean).join(' · ')}</p>}
                        {result?.message && <p>{result.message}</p>}
                      </div>
                      {result?.runId && (
                        <Button variant="secondary" size="sm" disabled={!!fileActionId} onClick={() => void fileBindingAction(binding.id, async () => {
                          setAutomaticPreview(await bookImportApi.getPreview(result.runId!))
                        })}>打开预览</Button>
                      )}
                    </div>
                  )}
                  {fileActionError?.id === binding.id && <p role="alert" className={styles.sourceError}>{fileActionError.message}</p>}
                  <div className={styles.candidateRow}>
                    <div className={styles.settingCopy}>
                      <span className={styles.factLabel}>候选文件</span>
                      <p>{binding.candidates.length ? `${binding.candidates.length} 个版本 · 以预览为准` : '未找到匹配文件，请检查目录或绑定新的来源别名'}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openFiles(source.id)}>
                      查看候选版本
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <MotionDetails className={styles.help}>
            <summary>文件更新说明</summary>
            <p className="dialog-frame-hint">文件名进度仅作线索。共享目录共用检查频率；解除本书绑定不会暂停其他书籍。</p>
          </MotionDetails>
        </section>
      </SourcePanel>
      <SourcePanel value="reference" activeTab={activeTab}>
        <section className={styles.section} aria-labelledby="novel-reference-title">
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>
              <h3 id="novel-reference-title">参考目录</h3>
              {bindings && bindings.length > 0 && (
                <span className={styles.count} aria-label="参考目录数量">
                  {bindings.length} 个目录
                </span>
              )}
            </div>
          </div>
          <p className="dialog-frame-hint">核对章节名与顺序，预览对应关系后再确认融合。</p>
          {referenceError && (
            <div role="alert" className={styles.inlineAlert}>
              <p>{referenceError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadReference()}>
                重新读取参考目录
              </Button>
            </div>
          )}
          {!bindings && !referenceError && (
            <p role="status" className={styles.loading}>
              正在读取参考目录…
            </p>
          )}
          {bindings && !bindings.length && !referenceError && (
            <EmptyState
              icon={<ListOrdered />}
              message="还没有参考目录"
              hint="按书名和作者搜索，或粘贴目录链接，核对本地章节的名称与顺序。"
              action={referenceAction}
            />
          )}
          <div className={styles.sourceList}>
            {bindings?.map((binding, index) => (
              <div className={styles.entry} key={String(binding.id)} style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}>
                <div className={styles.entryHead}>
                  <strong>{String(binding.site || '参考目录')}</strong>
                  {Boolean(binding.isPrimary) && (
                    <span className={styles.badge} data-tone="primary">
                      当前优先使用
                    </span>
                  )}
                </div>
                <p className={styles.sourceUrl}>{String(binding.sourceUrl || '')}</p>
                <dl className={styles.facts}>
                  <div>
                    <dt>上次融合</dt>
                    <dd>{Number(binding.lastSyncedAt) ? time(Number(binding.lastSyncedAt)) : '已读取来源，尚未确认融合'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          {(!bindings || bindings.length > 0 || referenceError) && <div className={styles.entryActions}>{referenceAction}</div>}
          <MotionDetails className={styles.help}>
            <summary>目录融合说明</summary>
            <p className="dialog-frame-hint">新增章节可继续融合；暂未匹配时保留 TXT 标题。正文版本、插章与映射冲突需要确认，打赏章等有效章节继续保留。</p>
          </MotionDetails>
        </section>
      </SourcePanel>
      {automaticPreview && <BookImportDialog key={automaticPreview.runId} open initialPreview={automaticPreview} onCompleted={onUpdated}
        onOpenChange={open => {
          if (!open) {
            setAutomaticPreview(null)
            void loadFiles()
          }
        }} />}
      {filesOpen && (
        <SupplementarySourcesDialog
          novel={novel}
          initialSourceId={sourceId}
          onCompleted={onUpdated}
          onClose={() => {
            setFilesOpen(false)
            void loadFiles()
            onUpdated()
          }}
        />
      )}
      {mergeOpen && (
        <Suspense fallback={<p role="status">正在打开章节名融合…</p>}>
          <ChapterMergeDialog
            mergeNovel={{ ...novel, author: novel.author || '', chapterCount: novel.chapterCount || 0 }}
            onMergeApplied={() => {
              void loadReference()
              onUpdated()
            }}
            onMergeClose={() => {
              setMergeOpen(false)
              void loadReference()
              onUpdated()
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
