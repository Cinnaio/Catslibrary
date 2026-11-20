import { useEffect, useRef, useState } from 'react'
import type { AdminNovelIndexItem } from '@shared/types'
import type { GenerationAssociationPreview } from '@shared/ai-generation-association'
import { aiApi, newOperationId } from '@/lib/api'
import { loadAdminNovelIndex } from '@/lib/admin-novel-index'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import FormField from '@/components/shared/FormField'
import SearchSelect from '@/components/shared/SearchSelect'
import { InlineError } from '@/components/shared/AsyncStates'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import styles from './generation-association.module.css'

export default function GenerationAssociationDialog({ ids, onClose, onApplied }: {
  ids: string[]
  onClose: () => void
  onApplied: (novelId: string, count: number) => void
}) {
  const [novels, setNovels] = useState<AdminNovelIndexItem[]>([])
  const [novelId, setNovelId] = useState('')
  const [includeBatch, setIncludeBatch] = useState(true)
  const [preview, setPreview] = useState<GenerationAssociationPreview | null>(null)
  const [loadedRevision, setLoadedRevision] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const loading = loadedRevision !== reload
  const request = useRef(0)
  const mounted = useRef(true)
  const operationId = useRef('')

  useEffect(() => {
    let alive = true
    void loadAdminNovelIndex('', () => alive)
      .then(items => { if (alive) { setNovels(items); setError('') } })
      .catch(error => { if (alive) setError(error instanceof Error ? error.message : '作品列表读取失败') })
      .finally(() => { if (alive) setLoadedRevision(reload) })
    return () => { alive = false }
  }, [reload])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  function invalidate() {
    request.current++
    setPreview(null)
    setError('')
    operationId.current = ''
  }

  async function inspect() {
    const version = ++request.current
    setBusy(true)
    setPreview(null)
    setError('')
    try {
      const result = await aiApi.previewGenerationAssociation({ ids, novelId, includeBatch })
      if (!mounted.current || version !== request.current) return
      setPreview(result)
      operationId.current = newOperationId('ai-generation-association')
    } catch (error) {
      if (mounted.current && version === request.current) setError(error instanceof Error ? error.message : '关联预览失败')
    } finally {
      if (mounted.current && version === request.current) setBusy(false)
    }
  }

  async function apply() {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const result = await aiApi.confirmGenerationAssociation({ ids, novelId, includeBatch, revision: preview.revision }, operationId.current)
      if (mounted.current) onApplied(result.novelId, result.count)
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : '重新关联失败，可以重试或重新预览')
    } finally { if (mounted.current) setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <ReadingDialog title="重新关联作品" description={`已选择 ${ids.length} 条待审草稿，选择作品后先核对关联范围。`}
      bodyLabel="作品关联预览" onEscapeKeyDown={event => { if (busy) event.preventDefault() }}
      onPointerDownOutside={event => { if (busy) event.preventDefault() }}
      footer={<div className={styles.actions}>
        <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="outline" disabled={loading || busy || !novelId} onClick={() => void inspect()}>{busy ? '处理中…' : preview ? '重新预览' : '预览关联'}</Button>
        {preview && <Button disabled={busy} onClick={() => void apply()}>确认关联 {preview.items.length} 条草稿</Button>}
      </div>}>
      <div className={styles.content}>
        <FormField label="关联到作品" labelId="generation-association-target-label">
          <SearchSelect aria-labelledby="generation-association-target-label" value={novelId} disabled={loading || busy}
            placeholder={loading ? '正在读取作品…' : '搜索书名或作者'}
            options={novels.map(novel => ({ value: novel.id, label: novel.title, sub: `${novel.author || '未知作者'} · ${novel.chapterCount} 章` }))}
            onChange={value => { setNovelId(value); invalidate() }} searchable matchTriggerWidth />
        </FormField>
        {!loading && !novels.length && <Button variant="ghost" onClick={() => setReload(value => value + 1)}>重新读取作品列表</Button>}
        <label className={styles.batchChoice}>
          <Checkbox checked={includeBatch} disabled={busy} onCheckedChange={checked => { setIncludeBatch(checked === true); invalidate() }} />
          <span>同时处理所属批次的其他失联待审草稿</span>
        </label>
        {error && <InlineError message={error} />}
        {preview && <section className={styles.preview} aria-label="核对关联范围" aria-live="polite">
          <div>
            <p className={styles.target}>关联到《{preview.target.title}》</p>
            <p className={styles.note}>{preview.target.author || '未知作者'}</p>
          </div>
          <p className={styles.note}>所选 {preview.selectedCount} 条{preview.additionalCount ? `，另含同批次 ${preview.additionalCount} 条` : ''}，共 {preview.items.length} 条待审草稿。</p>
          {!includeBatch && preview.batchRemainderCount > 0 && <p className={styles.note}>同批次还有 {preview.batchRemainderCount} 条草稿，本次保留原关联。</p>}
          <ul className={styles.records}>
            {preview.items.map(item => <li key={item.id}>
              <span>{item.title}</span>
              <span className={styles.note}>原作品：{item.source.title || '旧记录未保存书名'}{item.source.author ? ` · ${item.source.author}` : ''}</span>
              {item.source.anchor?.title && <span className={styles.note}>原续写起点：{item.source.anchor.title}</span>}
            </li>)}
          </ul>
        </section>}
        <p className={styles.note}>确认后保留草稿正文、原始提示词和生成依据，并记录关联变更。草稿仍需审阅后发布；继续创作前请重新选择续写起点。</p>
      </div>
    </ReadingDialog>
  </Dialog>
}
