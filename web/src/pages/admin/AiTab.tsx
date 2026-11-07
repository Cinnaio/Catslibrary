import { MotionView } from '@/components/ui/motion'
import '../../styles/admin/pages/ai-service-claude.css'
import '../../styles/admin/pages/ai.css'
/**
 * AI 创作容器；模型与服务、创作参数由站点设置工作区统一呈现。
 * 子 tab 支持 URL 深链：/admin/ai?sub=content&batch=... 可复现「任务 → 产出」上下文，
 * 刷新、返回、分享都不会丢；无 URL 参数时退回 localStorage 持久化。
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { aiApi } from '../../lib/api'
import { useToast } from '../../components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import type { Provider } from './ai/shared'
import { usePersistentState } from '@/hooks/usePersistentState'
import AiGenerationsPanel from './ai/AiGenerationsPanel'
import AiWritingPanel, { type WritingView } from './ai/AiWritingPanel'
import AiCoverPanel from './ai/AiCoverPanel'
import StoryGraphPanel from './ai/StoryGraphPanel'

/** 创作视图合法值；旧设置地址由 Admin 路由交给站点设置工作区。 */
const VALID_SUBS = ['writing', 'cover', 'content', 'graph'] as const
type SubTab = (typeof VALID_SUBS)[number]

const AI_SUBTAB_META: Record<SubTab, { title: string; description: string }> = {
  graph: { title: '故事档案', description: '查看本书人物关系、当前处境与未解情节，核对分析档案依据。' },
  writing: { title: 'AI 创作', description: '围绕当前作品构思情节、生成章节与审阅草稿。' },
  cover: { title: '封面生成', description: '生成、比较并应用小说封面候选图。' },
  content: { title: '草稿与产出', description: '审阅、编辑和管理 AI 生成的章节与摘要。' },
}

function isSubTab(value: string): value is SubTab {
  return (VALID_SUBS as readonly string[]).includes(value)
}

export default function AiTab() {
  const { toast } = useToast()
  const [provider, setProvider] = useState<Provider | null>(null)
  // URL 深链优先于 localStorage：进入/刷新/返回时按 sub 参数定位子页
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSub = searchParams.get('sub')
  const urlBatch = searchParams.get('batch') || ''
  const urlNovel = searchParams.get('novel') || ''
  const urlView = searchParams.get('view')
  const writingView: WritingView = urlView === 'review' || urlView === 'outputs' ? urlView : 'compose'
  const [writingVisited, setWritingVisited] = useState(false)
  /** 子标签持久化：无 URL 参数时停留在上次选中的子页，不重置回默认 */
  const [activeSubTab, setActiveSubTab] = usePersistentState<string>('ai_active_subtab', 'writing', (v) => isSubTab(v))

  // 标题直接响应 URL 深链；持久化状态尚未同步时也不会短暂显示父级标题。
  const currentSubTab: SubTab = isSubTab(urlSub || '')
    ? (urlSub as SubTab)
    : isSubTab(activeSubTab)
      ? activeSubTab
      : 'writing'
  const currentMeta = AI_SUBTAB_META[currentSubTab]
  useEffect(() => {
    if (currentSubTab === 'writing' || currentSubTab === 'graph') setWritingVisited(true)
  }, [currentSubTab])

  // 地址栏 sub 变化（深链进入、浏览器返回）时同步子 tab
  useEffect(() => {
    if (urlSub && isSubTab(urlSub) && urlSub !== activeSubTab) setActiveSubTab(urlSub)
  }, [urlSub, activeSubTab, setActiveSubTab])

  /** 本书审阅与产出通过 URL 传递，旧 sub=content 全局入口继续可用。 */
  const openGenerations = useCallback(
    (batchId?: string, novelId?: string, view: 'review' | 'outputs' = 'review') => {
      setActiveSubTab('writing')
      const next = new URLSearchParams(searchParams)
      next.set('sub', 'writing')
      next.set('view', view)
      if (novelId) next.set('novel', novelId)
      if (novelId && novelId !== urlNovel) next.delete('afterChapterId')
      if (batchId) next.set('batch', batchId)
      else next.delete('batch')
      setSearchParams(next, { replace: false })
    },
    [searchParams, setActiveSubTab, setSearchParams, urlNovel],
  )

  const load = useCallback(async () => {
    try {
      const res = await aiApi.settings()
      setProvider(res.provider)
    } catch (err) {
      toast((err as Error).message || '加载 AI 设置失败', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AdminPage motionKey={currentSubTab}
      title={currentMeta.title}
      description={currentMeta.description}
      className={`admin-redesign-page admin-redesign-page--ai ai-admin-page${currentSubTab === 'writing' ? '' : ' ai-service'}`}
    >
      <div className="ai-service-tabs">
        <div className="ai-service-tabs__content min-w-0">
          {(writingVisited || currentSubTab === 'writing' || currentSubTab === 'graph') && (
            <MotionView asChild><div hidden={currentSubTab !== 'writing'}>
              <AiWritingPanel
                model={provider?.model}
                onViewBatch={openGenerations}
                initialNovelId={urlNovel || undefined}
                view={writingView}
                focusBatchId={urlBatch || undefined}
                onViewChange={(view) => {
                  const next = new URLSearchParams(searchParams)
                  next.set('sub', 'writing')
                  if (view === 'compose') next.delete('view')
                  else next.set('view', view)
                  next.delete('batch')
                  setSearchParams(next)
                }}
                onNovelChange={(novelId) => {
                  const next = new URLSearchParams(searchParams)
                  if (novelId) next.set('novel', novelId)
                  else next.delete('novel')
                  next.delete('afterChapterId')
                  next.delete('batch')
                  setSearchParams(next)
                }}
                onAfterChapterChange={(chapterId) => {
                  const next = new URLSearchParams(searchParams)
                  if (chapterId) next.set('afterChapterId', chapterId)
                  else next.delete('afterChapterId')
                  setSearchParams(next)
                }}
                initialAfterChapterId={searchParams.get('afterChapterId') || undefined}
                onOpenGraph={(novelId, afterChapterId) => {
                  const next = new URLSearchParams(searchParams)
                  next.set('sub', 'graph')
                  next.set('novel', novelId)
                  if (afterChapterId) next.set('afterChapterId', afterChapterId)
                  else next.delete('afterChapterId')
                  setSearchParams(next)
                }}
              />
            </div></MotionView>
          )}
          {currentSubTab === 'graph' && (
            <StoryGraphPanel
              key={`${urlNovel}:${searchParams.get('afterChapterId') || ''}`}
              novelId={urlNovel}
              afterChapterId={searchParams.get('afterChapterId') || undefined}
            />
          )}

          {currentSubTab === 'cover' && (
            <AiCoverPanel
              initialNovelId={urlNovel || undefined}
              onNovelChange={(novelId) => {
                const next = new URLSearchParams(searchParams)
                if (novelId) next.set('novel', novelId)
                else next.delete('novel')
                setSearchParams(next, { replace: false })
              }}
            />
          )}

          {currentSubTab === 'content' && (
            <AiGenerationsPanel
              key={urlNovel}
              scope="all"
              status="all"
              focusBatchId={urlBatch}
              novelId={urlNovel || undefined}
            />
          )}

        </div>
      </div>
    </AdminPage>
  )
}
