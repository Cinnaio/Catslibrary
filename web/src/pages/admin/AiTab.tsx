/**
 * AI 服务 tab —— 薄容器：加载配置并把各子面板挂到分组子 tab 上。
 * 子 tab 支持 URL 深链：/admin?sub=tasks&batch=... 可复现「任务 → 产出」上下文，
 * 刷新、返回、分享都不会丢；无 URL 参数时退回 localStorage 持久化。
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { aiApi, type AiSettings, type AiProviderConfig } from '../../lib/api'
import { useToast } from '../../components/feedback'
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

const AI_SUBTAB_META: Record<SubTab, { title: string; description: string }> = {
  writing: { title: 'AI 创作', description: '组织大纲、章节与续写任务，保留现有创作上下文。' },
  cover: { title: '封面生成', description: '生成、比较并应用小说封面候选图。' },
  tasks: { title: 'AI 任务', description: '跟踪生成任务、批次状态与失败重试。' },
  content: { title: '已生成内容', description: '审阅、编辑和管理 AI 生成的章节与摘要。' },
  usage: { title: '用量统计', description: '观察调用次数、Token 用量和成本趋势。' },
  audit: { title: '调用审计', description: '查看 AI 调用记录、关联内容与费用明细。' },
  config: { title: 'AI 配置', description: '管理文本与图像供应商、模型和连接设置。' },
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
  const [loading, setLoading] = useState(true)
  // URL 深链优先于 localStorage：进入/刷新/返回时按 sub 参数定位子页
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSub = searchParams.get('sub')
  const urlBatch = searchParams.get('batch') || ''
  const urlNovel = searchParams.get('novel') || ''
  /** 子标签持久化：无 URL 参数时停留在上次选中的子页，不重置回默认 */
  const [activeSubTab, setActiveSubTab] = usePersistentState<string>('ai_active_subtab', 'writing', (v) => isSubTab(v))

  // 标题直接响应 URL 深链；持久化状态尚未同步时也不会短暂显示父级标题。
  const currentSubTab: SubTab = isSubTab(urlSub || '') ? (urlSub as SubTab) : isSubTab(activeSubTab) ? activeSubTab : 'writing'
  const currentMeta = AI_SUBTAB_META[currentSubTab]

  // 地址栏 sub 变化（深链进入、浏览器返回）时同步子 tab
  useEffect(() => {
    if (urlSub && isSubTab(urlSub) && urlSub !== activeSubTab) setActiveSubTab(urlSub)
  }, [urlSub, activeSubTab, setActiveSubTab])

  /** 从任务面板 / 创作页跳到「已生成内容」时展开的批次：经 URL 传递，可复现可分享。 */
  const openGenerations = useCallback(
    (batchId?: string) => {
      setActiveSubTab('content')
      const next = new URLSearchParams(searchParams)
      next.set('sub', 'content')
      if (batchId) next.set('batch', batchId)
      else next.delete('batch')
      next.delete('novel')
      setSearchParams(next, { replace: false })
    },
    [searchParams, setActiveSubTab, setSearchParams],
  )

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
      title={currentMeta.title}
      description={currentMeta.description}
      meta={<Badge variant={provider?.configured ? 'default' : 'secondary'}>{provider?.configured ? '服务已连接' : loading ? '读取配置中' : '未配置'}</Badge>}
      className="admin-redesign-page admin-redesign-page--ai ai-admin-page ai-service"
    >
      <div className="ai-service-tabs__content min-w-0">
        {currentSubTab === 'writing' && (
          <AiWritingPanel onViewBatch={openGenerations} initialNovelId={urlNovel || undefined} />
        )}

        {currentSubTab === 'cover' && (
          <AiCoverPanel />
        )}

        {currentSubTab === 'tasks' && (
          <AiTasksPanel onViewBatch={openGenerations} />
        )}

        {currentSubTab === 'content' && (
          <AiGenerationsPanel scope="all" status="all" focusBatchId={urlBatch} />
        )}

        {currentSubTab === 'usage' && (
          <AiUsagePanel />
        )}

        {currentSubTab === 'audit' && (
          <AiAuditPanel />
        )}

        {currentSubTab === 'config' && (
          <AiConfigPanel settings={settings} provider={provider} providerConfig={providerConfig} loading={loading} onReload={load} />
        )}

        {currentSubTab === 'params' && (
          <AiParamsPanel settings={settings} loading={loading} onReload={load} />
        )}
      </div>
    </AdminPage>
  )
}
