import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { SupplementaryOverview } from '@shared/supplementary-source'
import { scrapeApi, supplementarySourceApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import SupplementarySourcesDialog from './SupplementarySourcesDialog'

const ChapterMergeDialog = lazy(() => import('@/pages/admin/ChaptersTab'))
type Novel = { id: string; title: string; author?: string; chapterCount?: number }
const time = (value: number) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查')

/** 来源按用途展示，参考目录与文件绑定均不会启用网页正文抓取。 */
export default function NovelRelatedSources({ novel, onUpdated }: { novel: Novel; onUpdated: () => void }) {
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
  return (
    <>
      <section className="novel-followup-dialog__source-section" aria-labelledby="novel-file-source-title">
        <h3 id="novel-file-source-title">附加文件更新</h3>
        <p className="admin-dialog-hint">检查 TXT／EPUB 文件版本，下载并预览实际章节差异后确认入库。</p>
        {fileError && (
          <div role="alert">
            <p>{fileError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadFiles()}>
              重新读取附加源
            </Button>
          </div>
        )}
        {!overview && !fileError && <p role="status">正在读取附加源…</p>}
        {overview && !fileBindings.length && <p>尚未绑定附加源，可从共享目录选择文件并绑定到这本书。</p>}
        {fileBindings.map((binding) => {
          const source = overview!.sources.find((item) => item.id === binding.sourceId)
          if (!source) return null
          return (
            <div className="novel-followup-dialog__source-row" key={binding.id}>
              <strong>{source.name}</strong>
              <p>{source.enabled ? `跟随来源设置 · 每 ${source.intervalHours} 小时自动检查文件更新` : '来源的自动检查已暂停'}</p>
              <p>
                上次检查：{time(source.checkedAt)} ·{' '}
                {source.status === 'partial'
                  ? '部分目录未完整读取'
                  : source.status === 'error'
                    ? '检查失败'
                    : source.status === 'never'
                      ? '尚未检查'
                      : '目录检查成功'}
              </p>
              {source.enabled && <p>下次检查：{source.nextCheckAt ? time(source.nextCheckAt) : '等待安排'}</p>}
              {source.error && <p role="status">{source.error}</p>}
              <p>
                {binding.candidates.length
                  ? `已发现 ${binding.candidates.length} 个候选文件版本，实际差异以预览为准`
                  : '当前清单未找到匹配文件；请检查目录或绑定新的来源别名。'}
              </p>
              <Button variant="outline" size="sm" onClick={() => openFiles(source.id)}>
                查看候选版本
              </Button>
            </div>
          )
        })}
        <Button variant="secondary" size="sm" onClick={() => openFiles()}>
          绑定附加源
        </Button>
        <p className="admin-dialog-hint">文件名进度仅作线索。共享目录共用检查频率；解除本书绑定不会暂停其他书籍。</p>
      </section>
      <section className="novel-followup-dialog__source-section" aria-labelledby="novel-reference-title">
        <h3 id="novel-reference-title">章节名与顺序</h3>
        <p className="admin-dialog-hint">使用参考目录核对章节名和顺序，保留已确认的对应关系。</p>
        {referenceError && (
          <div role="alert">
            <p>{referenceError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadReference()}>
              重新读取参考目录
            </Button>
          </div>
        )}
        {!bindings && !referenceError && <p role="status">正在读取参考目录…</p>}
        {bindings && !bindings.length && <p>尚未绑定参考目录。可按书名和作者搜索，或粘贴目录链接。</p>}
        {bindings?.map((binding) => (
          <div className="novel-followup-dialog__source-row" key={String(binding.id)}>
            <strong>
              {String(binding.site || '参考目录')}
              {binding.isPrimary ? ' · 当前优先使用' : ''}
            </strong>
            <p className="novel-followup-dialog__source-url">{String(binding.sourceUrl || '')}</p>
            <p>{Number(binding.lastSyncedAt) ? `上次融合：${time(Number(binding.lastSyncedAt))}` : '已读取来源，尚未确认融合'}</p>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)}>
          读取参考目录并预览
        </Button>
        <p className="admin-dialog-hint">新增章节可继续融合；暂未匹配时保留 TXT 标题。正文版本、插章与映射冲突需要确认，打赏章等有效章节继续保留。</p>
      </section>
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
    </>
  )
}
