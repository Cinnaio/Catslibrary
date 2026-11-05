import '../../styles/admin/pages/ai-service-claude.css'
import '../../styles/admin/pages/ai.css'
/**
 * AI 服务 tab —— 薄容器：加载配置并把各子面板挂到分组子 tab 上。
 * 子 tab 支持 URL 深链：/admin/ai?sub=content&batch=... 可复现「任务 → 产出」上下文，
 * 刷新、返回、分享都不会丢；无 URL 参数时退回 localStorage 持久化。
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { aiApi, type AiSettings, type AiProviderConfig } from '../../lib/api'
import { useToast } from '../../components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Provider } from './ai/shared'
import { usePersistentState } from '@/hooks/usePersistentState'
import AiConfigPanel from './ai/AiConfigPanel'
import AiGenerationsPanel from './ai/AiGenerationsPanel'
import AiParamsPanel from './ai/AiParamsPanel'
import AiWritingPanel, { type WritingView } from './ai/AiWritingPanel'
import AiCoverPanel from './ai/AiCoverPanel'
import StoryGraphPanel from './ai/StoryGraphPanel'

// 兼容旧的导入路径（其它页面若直接引用面板，从 ./ai/* 走新路径）
export { AiWritingPanel, AiGenerationsPanel, AiParamsPanel }

/** 子 tab 合法值：创作 / 审阅 / 设置，避免 URL 或持久化里混入未知值。 */
const VALID_SUBS = ['writing', 'cover', 'content', 'config', 'params', 'graph'] as const
type SubTab = (typeof VALID_SUBS)[number]

const AI_SUBTAB_META: Record<SubTab, { title: string; description: string }> = {
  graph: { title: '故事档案', description: '查看本书人物关系、当前处境与未解情节，核对分析档案依据。' },
  writing: { title: 'AI 创作', description: '围绕当前作品构思情节、生成章节与审阅草稿。' },
  cover: { title: '封面生成', description: '生成、比较并应用小说封面候选图。' },
  content: { title: '草稿与产出', description: '审阅、编辑和管理 AI 生成的章节与摘要。' },
  config: { title: 'AI 配置', description: '连接文本与图像服务，管理模型和读者生成策略。' },
  params: { title: '参数调优', description: '调整摘要、回顾、创作和生图的生成参数。' },
}

function isSubTab(value: string): value is SubTab {
  return (VALID_SUBS as readonly string[]).includes(value)
}

export default function AiTab() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig | null>(null)
  const [imageProvider, setImageProvider] = useState<Provider | null>(null)
  const [imageProviderConfig, setImageProviderConfig] = useState<AiProviderConfig | null>(null)
  const [loading, setLoading] = useState(true)
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
    setLoading(true)
    try {
      const res = await aiApi.settings()
      setSettings(res.settings)
      setProvider(res.provider)
      setProviderConfig(res.providerConfig)
      setImageProviderConfig(res.imageProviderConfig)
      setImageProvider(res.imageProvider)
    } catch (err) {
      toast((err as Error).message || '加载 AI 设置失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AdminPage
      title={currentMeta.title}
      description={currentMeta.description}
      className={`admin-redesign-page admin-redesign-page--ai ai-admin-page${currentSubTab === 'writing' ? '' : ' ai-service'}`}
      actions={
        (currentSubTab === 'config' || currentSubTab === 'params') && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label={currentSubTab === 'config' ? '刷新 AI 配置' : '刷新生成参数'}
          >
            <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
            {loading ? '刷新中…' : '刷新'}
          </Button>
        )
      }
    >
      <Tabs
        value={currentSubTab}
        onValueChange={(subKey) => {
          setActiveSubTab(subKey)
          const next = new URLSearchParams(searchParams)
          next.set('sub', subKey)
          setSearchParams(next, { replace: false })
        }}
        className="ai-service-tabs admin-capsule-tabs"
      >
        {['config', 'params'].includes(currentSubTab) && (
          <div className="ai-workbench-nav-track flex items-center justify-between">
            <TabsList className="ai-service-tabs__list" aria-label="AI 服务视图">
              {VALID_SUBS.filter((subKey) =>
                ['config', 'params'].includes(currentSubTab)
                  ? ['config', 'params'].includes(subKey)
                  : !['config', 'params'].includes(subKey),
              ).map((subKey) => (
                <TabsTrigger key={subKey} value={subKey}>
                  {AI_SUBTAB_META[subKey].title}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        )}

        <div className="ai-service-tabs__content min-w-0">
          {(writingVisited || currentSubTab === 'writing' || currentSubTab === 'graph') && (
            <div hidden={currentSubTab !== 'writing'}>
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
            </div>
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

          {currentSubTab === 'config' && (
            <AiConfigPanel
              settings={settings}
              provider={provider}
              providerConfig={providerConfig}
              imageProviderConfig={imageProviderConfig}
              imageProvider={imageProvider}
              loading={loading}
              onReload={load}
            />
          )}

          {currentSubTab === 'params' && <AiParamsPanel settings={settings} loading={loading} onReload={load} />}
        </div>
      </Tabs>
    </AdminPage>
  )
}
