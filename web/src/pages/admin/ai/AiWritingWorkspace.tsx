import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AdminNovelIndexItem } from '@shared/types'
import { loadAdminNovelIndex } from '@/lib/admin-novel-index'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import FormField from '@/components/shared/FormField'
import SearchSelect from '@/components/shared/SearchSelect'
import AiWritingPanel, { type WritingView } from './AiWritingPanel'
import NovelAnalysisPanel from './NovelAnalysisPanel'
import styles from './writing-workspace.module.css'

type WorkspaceView = WritingView | 'analysis'

/** 同书视图共用 URL 与作品选择；按需挂载后保留输入和报告阅读状态。 */
export default function AiWritingWorkspace({ model, active = true, defaultView = 'compose' }: {
  model?: string
  active?: boolean
  defaultView?: WorkspaceView
}) {
  const [params, setParams] = useSearchParams()
  const novelId = params.get('novel') || ''
  const urlView = params.get('view')
  const view: WorkspaceView = params.get('sub') === 'analysis' ? 'analysis'
    : urlView === 'analysis' || urlView === 'review' || urlView === 'outputs' ? urlView : defaultView
  const [visits, setVisits] = useState({
    view, active, writing: active && view !== 'analysis', analysis: active && view === 'analysis',
    lastWritingView: (view === 'analysis' ? 'compose' : view) as WritingView,
  })
  if (visits.view !== view || visits.active !== active) {
    setVisits({
      view, active,
      writing: visits.writing || (active && view !== 'analysis'),
      analysis: visits.analysis || (active && view === 'analysis'),
      lastWritingView: active && view !== 'analysis' ? view : visits.lastWritingView,
    })
  }
  const writingView = view === 'analysis' ? visits.lastWritingView : view
  const [novels, setNovels] = useState<AdminNovelIndexItem[]>([])
  const [loadedRevision, setLoadedRevision] = useState(-1)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  const loading = loadedRevision !== reload

  useEffect(() => {
    let alive = true
    void loadAdminNovelIndex('', () => alive)
      .then(items => { if (alive) { setNovels(items); setError('') } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : '书目加载失败') })
      .finally(() => { if (alive) setLoadedRevision(reload) })
    return () => { alive = false }
  }, [reload])

  function changeView(nextView: WorkspaceView) {
    if (nextView === view) return
    setParams(current => {
      const next = new URLSearchParams(current)
      next.set('sub', 'writing')
      next.set('view', nextView)
      return next
    })
  }

  function changeNovel(id: string) {
    setParams(current => {
      const next = new URLSearchParams(current)
      next.set('sub', 'writing')
      next.set('view', view)
      if (id) next.set('novel', id)
      else next.delete('novel')
      for (const key of ['report', 'batch', 'afterChapterId']) next.delete(key)
      return next
    })
  }

  // 提交报告期间可以继续构思；迟到回执只更新同书报告，不把页面拉回分析。
  const chooseReport = useCallback((reportId: string) => {
    setParams(current => {
      if ((current.get('novel') || '') !== novelId) return current
      const next = new URLSearchParams(current)
      next.set('report', reportId)
      return next
    })
  }, [novelId, setParams])

  return <section className={styles.workbench} aria-label="作品创作工作区">
    <div className={styles.bookToolbar}>
      <FormField label="当前作品" labelId="ai-writing-novel-label">
        <SearchSelect
          options={novels.map(novel => ({ value: novel.id, label: novel.title, sub: `${novel.author || '未知作者'} · ${novel.chapterCount} 章` }))}
          value={novelId} onChange={changeNovel}
          placeholder={loading ? '正在加载书目…' : '选择小说'} disabled={loading || !!error}
          searchable searchPlaceholder="搜索书名或作者…" dropdownSide="bottom"
          filter={(option, query) => `${option.label} ${option.sub || ''}`.toLowerCase().includes(query)}
          aria-labelledby="ai-writing-novel-label"
        />
        {error && <div role="alert" className="text-sm text-destructive">{error}
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => setReload(v => v + 1)}>重新加载书目</Button>
        </div>}
      </FormField>
    </div>
    <Tabs value={view} onValueChange={value => changeView(value as WorkspaceView)} className={styles.viewTabs}>
      <div className={styles.navigation}>
        <TabsList variant="line" aria-label="本书创作视图">
          <TabsTrigger value="analysis">分析报告</TabsTrigger>
          <TabsTrigger value="compose">构思与生成</TabsTrigger>
          <TabsTrigger value="review">草稿审阅</TabsTrigger>
          <TabsTrigger value="outputs">本书产出</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="analysis" forceMount hidden={view !== 'analysis'} className={styles.analysisContent}>
        {visits.analysis && <NovelAnalysisPanel
          novelId={novelId} reportId={params.get('report') || ''} onSelectReport={chooseReport}
          active={active && view === 'analysis'}
        />}
      </TabsContent>
      <TabsContent value={writingView} forceMount hidden={view === 'analysis'}>
        {visits.writing && <AiWritingPanel
          active={active && view !== 'analysis'}
          novelId={novelId} novels={novels} view={writingView} model={model}
          focusBatchId={params.get('batch') || undefined}
          initialAfterChapterId={params.get('afterChapterId') || undefined}
          onAfterChapterChange={chapterId => setParams(current => {
            const next = new URLSearchParams(current)
            if (chapterId) next.set('afterChapterId', chapterId)
            else next.delete('afterChapterId')
            return next
          })}
          onOpenAnalysis={() => changeView('analysis')}
          onViewBatch={(batchId, targetNovelId, nextView = 'review') => {
            if (targetNovelId && !novels.some(novel => novel.id === targetNovelId)) setReload(v => v + 1)
            setParams(current => {
              const next = new URLSearchParams(current)
              next.set('sub', 'writing'); next.set('view', nextView)
              if (targetNovelId) next.set('novel', targetNovelId)
              if (targetNovelId && targetNovelId !== current.get('novel')) {
                next.delete('report'); next.delete('afterChapterId')
              }
              if (batchId) next.set('batch', batchId)
              else next.delete('batch')
              return next
            })
          }}
          onOpenGraph={(id, chapterId) => setParams(current => {
            const next = new URLSearchParams(current)
            next.set('sub', 'graph'); next.set('novel', id)
            if (chapterId) next.set('afterChapterId', chapterId)
            else next.delete('afterChapterId')
            return next
          })}
        />}
      </TabsContent>
    </Tabs>
  </section>
}
