import { type ReactNode, lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { SupplementaryOverview } from '@shared/supplementary-source'
import { scrapeApi, supplementarySourceApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import { Files, ListOrdered } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { MotionDetails } from '@/components/ui/motion'
import styles from './NovelFollowupDialog.module.css'
import SupplementarySourcesDialog from './SupplementarySourcesDialog'

const ChapterMergeDialog = lazy(() => import('@/pages/admin/ChaptersTab'))
type Novel = { id: string; title: string; author?: string; chapterCount?: number }
const time = (value: number) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '尚未检查'
const statusText = (status: string) =>
  status === 'partial' ? '部分目录未完整读取' : status === 'error' ? '检查失败' : status === 'never' ? '尚未检查' : '目录检查成功'
const statusTone = (status: string) => (status === 'error' ? 'failed' : status === 'partial' ? 'partial' : 'idle')

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
export default function NovelRelatedSources({ novel, onUpdated, activeTab }: { novel: Novel; onUpdated: () => void; activeTab?: string }) {
  const [overview, setOverview] = useState<SupplementaryOverview | null>(null)
  const [bindings, setBindings] = useState<Array<Record<string, unknown>> | null>(null)
  const [fileError, setFileError] = useState('')
  const [referenceError, setReferenceError] = useState('')
  const [filesOpen, setFilesOpen] = useState(false)
  const [sourceId, setSourceId] = useState<string>()
  const [mergeOpen, setMergeOpen] = useState(false)
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
            {(!overview || fileBindings.length > 0 || fileError) && fileAction}
          </div>
          <p className="dialog-frame-hint">检查 TXT／EPUB 文件版本，预览章节差异后再确认入库。</p>
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
