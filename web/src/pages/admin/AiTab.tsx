/**
 * AI 服务 tab —— 薄容器：加载配置并把各子面板挂到分组子 tab 上。
 * 子 tab 支持 URL 深链：/admin?sub=tasks&batch=... 可复现「任务 → 产出」上下文，
 * 刷新、返回、分享都不会丢；无 URL 参数时退回 localStorage 持久化。
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { aiApi, type AiSettings, type AiProviderConfig } from '../../lib/api'
import { useToast } from '../../components/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AdminPage from '@/components/admin/AdminPage'
import { Badge } from '@/components/ui/badge'
import type { Provider } from './ai/shared'
import { usePersistentState } from '@/hooks/usePersistentState'
import AiConfigPanel from './ai/AiConfigPanel'
import AiGenerationsPanel from './ai/AiGenerationsPanel'
import AiTasksPanel from './ai/AiTasksPanel'
import AiUsagePanel from './ai/AiUsagePanel'
import AiAuditPanel from './ai/AiAuditPanel'
import AiParamsPanel from './ai/AiParamsPanel'
import AiWritingPanel from './ai/AiWritingPanel'
import AiCoverPanel from './ai/AiCoverPanel'

// 兼容旧的导入路径（其它页面若直接引用面板，从 ./ai/* 走新路径）
export { AiWritingPanel, AiGenerationsPanel, AiParamsPanel }

/** 子 tab 合法值：生成 / 审阅 / 观测 / 设置 四组，避免 URL 或持久化里混入未知值。 */
const VALID_SUBS = ['writing', 'cover', 'tasks', 'content', 'usage', 'audit', 'config', 'params'] as const
type SubTab = (typeof VALID_SUBS)[number]

/** 分组元数据：把八个平铺入口收敛为运营视角的「生成 → 审阅 → 观测 → 设置」。 */
const AI_TAB_GROUPS: Array<{ label: string; subs: Array<{ value: SubTab; label: string }> }> = [
  {
    label: '生成',
    subs: [
      { value: 'writing', label: 'AI 创作' },
      { value: 'cover', label: '封面生成' },
    ],
  },
  {
    label: '审阅',
    subs: [
      { value: 'tasks', label: 'AI 任务' },
      { value: 'content', label: '已生成内容' },
    ],
  },
  {
    label: '观测',
    subs: [
      { value: 'usage', label: '用量统计' },
      { value: 'audit', label: '调用审计' },
    ],
  },
  {
    label: '设置',
    subs: [
      { value: 'config', label: '配置' },
      { value: 'params', label: '参数调优' },
    ],
  },
]

function isSubTab(value: string): value is SubTab {
  return (VALID_SUBS as readonly string[]).includes(value)
}

export default function AiTab() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig | null>(null)
  const [loading, setLoading] = useState(true)
  // URL 深链优先于 localStorage：进入/刷新/返回时按 sub 参数定位子页
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSub = searchParams.get('sub')
  const urlBatch = searchParams.get('batch') || ''
  /** 子标签持久化：无 URL 参数时停留在上次选中的子页，不重置回默认 */
  const [activeSubTab, setActiveSubTab] = usePersistentState<string>('ai_active_subtab', 'writing', (v) => isSubTab(v))

  // 地址栏 sub 变化（深链进入、浏览器返回）时同步子 tab
  useEffect(() => {
    if (urlSub && isSubTab(urlSub) && urlSub !== activeSubTab) setActiveSubTab(urlSub)
  }, [urlSub, activeSubTab, setActiveSubTab])

  /** 子 tab 切换：写入 URL，content 外的子页清掉 batch 上下文。 */
  function handleSubTabChange(value: string) {
    if (!isSubTab(value)) return
    setActiveSubTab(value)
    const next = new URLSearchParams(searchParams)
    next.set('sub', value)
    if (value !== 'content') next.delete('batch')
    setSearchParams(next, { replace: true })
  }

  /** 从任务面板 / 创作页跳到「已生成内容」时展开的批次：经 URL 传递，可复现可分享。 */
  const openGenerations = useCallback(
    (batchId?: string) => {
      setActiveSubTab('content')
      const next = new URLSearchParams(searchParams)
      next.set('sub', 'content')
      if (batchId) next.set('batch', batchId)
      else next.delete('batch')
      setSearchParams(next, { replace: false })
    },
    [searchParams, setActiveSubTab, setSearchParams],
  )

  // 小屏横向滚动提示：tabs 溢出时在边缘显示淡出渐变，提示还有更多入口
  const listRef = useRef<HTMLDivElement | null>(null)
  const [canScroll, setCanScroll] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })
  useEffect(() => {
    const el = listRef.current || document.querySelector<HTMLElement>('.ai-service-tabs__list')
    if (!el) return
    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth
      setCanScroll({
        left: el.scrollLeft > 4,
        right: el.scrollLeft < maxScroll - 4,
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.settings()
      setSettings(res.settings)
      setProvider(res.provider)
      setProviderConfig(res.providerConfig)
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
      title="AI 服务"
      description="集中管理生成能力、产出审阅、用量观测与模型配置。"
      meta={<Badge variant={provider?.configured ? 'default' : 'secondary'}>{provider?.configured ? '服务已连接' : loading ? '读取配置中' : '未配置'}</Badge>}
      className="ai-admin-page ai-service"
    >
      <Tabs value={activeSubTab} onValueChange={handleSubTabChange} className="ai-service-tabs min-w-0">
        <AiServiceSummary settings={settings} provider={provider} loading={loading} />
        <div
          ref={listRef}
          className={`ai-service-tabs__scroll-wrap relative ${
            canScroll.left ? 'can-scroll-left' : ''
          } ${canScroll.right ? 'can-scroll-right' : ''}`}
        >
        <TabsList className="ai-service-tabs__list w-full max-w-full justify-start overflow-x-auto overflow-y-hidden">
          {AI_TAB_GROUPS.map((group, groupIndex) => (
            <Fragment key={group.label}>
              {groupIndex > 0 && (
                <span
                  role="separator"
                  aria-label={group.label}
                  className="mx-1.5 h-5 w-px shrink-0 self-center bg-border"
                />
              )}
              {group.subs.map((sub) => (
                <TabsTrigger key={sub.value} value={sub.value}>
                  {sub.label}
                </TabsTrigger>
              ))}
            </Fragment>
          ))}
        </TabsList>
        </div>

        <TabsContent value="writing" className="ai-service-tabs__content min-w-0">
          <AiWritingPanel onViewBatch={openGenerations} />
        </TabsContent>

        <TabsContent value="cover" className="ai-service-tabs__content min-w-0">
          <AiCoverPanel />
        </TabsContent>

        <TabsContent value="tasks" className="ai-service-tabs__content min-w-0">
          <AiTasksPanel onViewBatch={openGenerations} />
        </TabsContent>

        <TabsContent value="content" className="ai-service-tabs__content min-w-0">
          <AiGenerationsPanel scope="all" status="all" focusBatchId={urlBatch} />
        </TabsContent>

        <TabsContent value="usage" className="ai-service-tabs__content min-w-0">
          <AiUsagePanel />
        </TabsContent>

        <TabsContent value="audit" className="ai-service-tabs__content min-w-0">
          <AiAuditPanel />
        </TabsContent>

        <TabsContent value="config" className="ai-service-tabs__content min-w-0">
          <AiConfigPanel settings={settings} provider={provider} providerConfig={providerConfig} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="params" className="ai-service-tabs__content min-w-0">
          <AiParamsPanel settings={settings} loading={loading} onReload={load} />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}

function AiServiceSummary({ settings, provider, loading }: { settings: AiSettings | null; provider: Provider | null; loading: boolean }) {
  const status = loading ? '读取中' : provider?.configured ? '已连接' : '待配置'
  const model = provider?.model || '未设置模型'
  const recap = settings?.recapEnabled ? '已启用' : '已关闭'
  const catchup = settings?.catchupEnabled ? '已启用' : '已关闭'
  const quota = settings ? (settings.dailyQuota < 0 ? '不限额' : `${settings.dailyQuota} 次`) : '—'

  return (
    <div className="ai-service__summary" aria-label="AI 服务状态摘要">
      <div className="ai-service__summary-item"><span>文本模型</span><strong title={model}>{model}</strong></div>
      <div className="ai-service__summary-item"><span>服务状态</span><strong data-state={provider?.configured ? 'ready' : 'idle'}>{status}</strong></div>
      <div className="ai-service__summary-item"><span>前情提要</span><strong>{recap}</strong></div>
      <div className="ai-service__summary-item"><span>续读回顾</span><strong>{catchup}</strong></div>
      <div className="ai-service__summary-item"><span>每日额度</span><strong>{quota}</strong></div>
    </div>
  )
}
