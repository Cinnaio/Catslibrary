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
      className="admin-redesign-page admin-redesign-page--ai ai-admin-page ai-service"
    >
      <div className="ai-service-tabs__content min-w-0">
        {activeSubTab === 'writing' && (
          <AiWritingPanel onViewBatch={openGenerations} />
        )}

        {activeSubTab === 'cover' && (
          <AiCoverPanel />
        )}

        {activeSubTab === 'tasks' && (
          <AiTasksPanel onViewBatch={openGenerations} />
        )}

        {activeSubTab === 'content' && (
          <AiGenerationsPanel scope="all" status="all" focusBatchId={urlBatch} />
        )}

        {activeSubTab === 'usage' && (
          <AiUsagePanel />
        )}

        {activeSubTab === 'audit' && (
          <AiAuditPanel />
        )}

        {activeSubTab === 'config' && (
          <AiConfigPanel settings={settings} provider={provider} providerConfig={providerConfig} loading={loading} onReload={load} />
        )}

        {activeSubTab === 'params' && (
          <AiParamsPanel settings={settings} loading={loading} onReload={load} />
        )}
      </div>
    </AdminPage>
  )
}
