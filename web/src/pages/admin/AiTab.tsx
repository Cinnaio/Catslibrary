/**
 * AI 服务 tab —— 薄容器：加载配置并把各子面板挂到子 tab 上。
 * 各面板实现见 ./ai/ 目录。
 */
import { useCallback, useEffect, useState } from 'react'
import { aiApi, type AiSettings, type AiProviderConfig } from '../../lib/api'
import { useToast } from '../../components/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AdminPage from '@/components/admin/AdminPage'
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

export default function AiTab() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [providerConfig, setProviderConfig] = useState<AiProviderConfig | null>(null)
  const [loading, setLoading] = useState(true)
  /** 子标签持久化：刷新后停留在上次选中的子页（配置/封面生成/创作…），不重置回默认 */
  const [activeSubTab, setActiveSubTab] = usePersistentState<string>('ai_active_subtab', 'config', (v) =>
    ['tasks', 'config', 'content', 'usage', 'audit', 'params', 'writing', 'cover'].includes(v),
  )
  /** 从任务面板 / 创作页跳到「已生成内容」时要展开的批次 */
  const [focusBatchId, setFocusBatchId] = useState('')

  const openGenerations = useCallback((batchId?: string) => {
    setFocusBatchId(batchId || '')
    setActiveSubTab('content')
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
    <AdminPage title="AI 服务" description="管理 AI 功能配置、查看用量统计与调用审计" className="ai-admin-page">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="ai-service-tabs min-w-0">
        <TabsList className="ai-service-tabs__list w-full max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="tasks">AI 任务</TabsTrigger>
          <TabsTrigger value="config">配置</TabsTrigger>
          <TabsTrigger value="content">已生成内容</TabsTrigger>
          <TabsTrigger value="usage">用量统计</TabsTrigger>
          <TabsTrigger value="audit">调用审计</TabsTrigger>
          <TabsTrigger value="params">参数调优</TabsTrigger>
          <TabsTrigger value="writing">AI 创作</TabsTrigger>
          <TabsTrigger value="cover">封面生成</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="min-w-0">
          <AiConfigPanel settings={settings} provider={provider} providerConfig={providerConfig} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="content" className="min-w-0">
          <AiGenerationsPanel scope="all" status="all" focusBatchId={focusBatchId} />
        </TabsContent>

        <TabsContent value="tasks" className="min-w-0">
          <AiTasksPanel onViewBatch={openGenerations} />
        </TabsContent>

        <TabsContent value="usage" className="min-w-0">
          <AiUsagePanel />
        </TabsContent>

        <TabsContent value="audit" className="min-w-0">
          <AiAuditPanel />
        </TabsContent>

        <TabsContent value="params" className="min-w-0">
          <AiParamsPanel settings={settings} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="writing" className="min-w-0">
          <AiWritingPanel onViewBatch={openGenerations} />
        </TabsContent>

        <TabsContent value="cover" className="min-w-0">
          <AiCoverPanel />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}
