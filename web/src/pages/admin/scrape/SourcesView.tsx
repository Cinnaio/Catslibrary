// ============================================================
// 书源管理 — SourcesView
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm, useToast } from '../../../components/feedback'
import AdminTabHeader from '@/components/admin/AdminTabHeader'
import AdminPanel from '@/components/admin/AdminPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SourceRow } from './types'
import { connectivityBadge, scrapePost, supportBadge } from './utils'

export default function SourcesView({ active }: { active: boolean }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [sources, setSources] = useState<SourceRow[]>([])
  const [sourcesError, setSourcesError] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [enabledCount, setEnabledCount] = useState(0)
  const [bySupport, setBySupport] = useState<Record<string, number>>({})
  const [unreachableCount, setUnreachableCount] = useState(0)
  const [sourcePage, setSourcePage] = useState(1)
  const [sourcePageSize, setSourcePageSize] = useState(50)
  const [sourceTotalPages, setSourceTotalPages] = useState(1)
  const [sourceMatchedTotal, setSourceMatchedTotal] = useState(0)
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set())

  const [supportFilter, setSupportFilter] = useState('')
  const [hostFilter, setHostFilter] = useState('')
  const hostFilterRef = useRef('')
  const hostDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [importUrl, setImportUrl] = useState('')
  const [importText, setImportText] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importResult, setImportResult] = useState<{ ok: boolean; text: string; sub?: string } | null>(null)

  const [testState, setTestState] = useState<{ loading: boolean; data: Record<string, any> | null; error: string }>({ loading: false, data: null, error: '' })
  const [testHost, setTestHost] = useState('')
  const [connectivityDialogOpen, setConnectivityDialogOpen] = useState(false)
  const [connectivityScope, setConnectivityScope] = useState<'all' | 'page' | 'selected'>('page')
  const [connectivityChecking, setConnectivityChecking] = useState(false)
  const [connectivityResult, setConnectivityResult] = useState<{ checked: number; reachable: number; unreachable: number } | null>(null)
  const [connectivityProgress, setConnectivityProgress] = useState({ completed: 0, total: 0, reachable: 0, unreachable: 0, currentHost: '' })

  const loadScrapeSources = useCallback(async () => {
    setSourcesLoading(true)
    setSourcesError('')
    const body: Record<string, unknown> = { action: 'list-sources' }
    body.page = sourcePage
    body.pageSize = sourcePageSize
    if (supportFilter === 'enabled') body.enabled = 1
    else if (supportFilter) body.support = supportFilter
    const host = hostFilterRef.current
    if (host) body.host = host
    try {
      const data = await scrapePost(body)
      setSources(Array.isArray(data.sources) ? data.sources : [])
      setTotal(data.total || 0)
      setEnabledCount(data.enabledCount || 0)
      setBySupport(data.bySupport || {})
      setUnreachableCount(Number(data.unreachableCount || 0))
      setSourceTotalPages(Math.max(1, Number(data.totalPages) || 1))
      setSourceMatchedTotal(Number(data.matchedTotal) || 0)
    } catch (err) {
      setSourcesError((err as Error).message)
      setSources([])
    } finally {
      setSourcesLoading(false)
    }
  }, [sourcePage, sourcePageSize, supportFilter])

  // 视图可见时加载 + 过滤条件变化时重载
  useEffect(() => {
    if (active) void loadScrapeSources()
  }, [active, loadScrapeSources])

  useEffect(() => {
    return () => {
      if (hostDebounce.current) clearTimeout(hostDebounce.current)
    }
  }, [])

  function onHostFilterChange(value: string) {
    hostFilterRef.current = value.trim()
    setHostFilter(value)
    setSourcePage(1)
    if (hostDebounce.current) clearTimeout(hostDebounce.current)
    hostDebounce.current = setTimeout(() => void loadScrapeSources(), 300)
  }

  function onSupportFilterChange(value: string) {
    setSupportFilter(value)
    setSourcePage(1)
  }

  async function toggleSource(s: SourceRow) {
    try {
      await scrapePost({ action: 'toggle-source', host: s.host, enabled: !s.enabled })
      await loadScrapeSources()
      toast(s.enabled ? `已停用 ${s.host}` : `已启用 ${s.host}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function deleteSource(s: SourceRow) {
    const ok = await confirm({
      title: '删除书源',
      message: `确定删除书源「${s.host}」？删除后运行时不再按该 host 匹配。`,
      okText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await scrapePost({ action: 'delete-source', host: s.host })
      await loadScrapeSources()
      toast(`已删除 ${s.host}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  function toggleSelected(host: string, checked: boolean) {
    setSelectedHosts((current) => {
      const next = new Set(current)
      if (checked) next.add(host)
      else next.delete(host)
      return next
    })
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedHosts((current) => {
      const next = new Set(current)
      sources.forEach((source) => checked ? next.add(source.host) : next.delete(source.host))
      return next
    })
  }

  async function batchDisableSources() {
    const hosts = [...selectedHosts]
    const ok = await confirm({ title: '批量停用书源', message: `确定停用已选择的 ${hosts.length} 个书源？`, okText: '停用', danger: true })
    if (!ok) return
    try {
      await scrapePost({ action: 'batch-toggle-sources', hosts, enabled: false })
      setSelectedHosts(new Set())
      await loadScrapeSources()
      toast(`已停用 ${hosts.length} 个书源`, 'success')
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function batchDeleteSources() {
    const hosts = [...selectedHosts]
    const ok = await confirm({ title: '批量删除书源', message: `确定删除已选择的 ${hosts.length} 个书源？删除后运行时不再按这些 host 匹配。`, okText: '删除', danger: true })
    if (!ok) return
    try {
      await scrapePost({ action: 'batch-delete-sources', hosts })
      setSelectedHosts(new Set())
      await loadScrapeSources()
      toast(`已删除 ${hosts.length} 个书源`, 'success')
    } catch (err) { toast((err as Error).message, 'error') }
  }

  function openConnectivityDialog() {
    setConnectivityResult(null)
    setConnectivityScope(selectedHosts.size > 0 ? 'selected' : 'page')
    setConnectivityDialogOpen(true)
  }

  async function checkConnectivity() {
    let hosts = connectivityScope === 'selected'
      ? [...selectedHosts]
      : connectivityScope === 'page'
        ? sources.map((source) => source.host)
        : undefined
    if (connectivityScope === 'selected' && !hosts?.length) return
    if (!hosts) {
      const preview = await scrapePost({ action: 'check-source-connectivity', preview: true })
      hosts = Array.isArray(preview.hosts) ? preview.hosts : []
    }
    const targetHosts = hosts || []
    if (!targetHosts.length) return
    setConnectivityChecking(true)
    setConnectivityResult(null)
    setConnectivityProgress({ completed: 0, total: targetHosts.length, reachable: 0, unreachable: 0, currentHost: targetHosts[0] || '' })
    try {
      let reachable = 0
      let unreachable = 0
      for (let index = 0; index < targetHosts.length; index++) {
        const host = targetHosts[index]!
        const data = await scrapePost({ action: 'check-source-connectivity', hosts: [host] })
        reachable += Number(data.reachable) || 0
        unreachable += Number(data.unreachable) || 0
        setConnectivityProgress({ completed: index + 1, total: targetHosts.length, reachable, unreachable, currentHost: targetHosts[index + 1] || host })
      }
      const data = { checked: targetHosts.length, reachable, unreachable }
      setConnectivityResult(data)
      await loadScrapeSources()
      toast(`连接检测完成：可连接 ${data.reachable}，不可访问 ${data.unreachable}`, data.unreachable ? 'error' : 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setConnectivityChecking(false)
    }
  }

  async function deleteUnreachableSources() {
    const ok = await confirm({ title: '删除不可访问书源', message: `确定删除最近检测不可访问的 ${unreachableCount} 个书源？此操作不可恢复。`, okText: '删除', danger: true })
    if (!ok) return
    try {
      const data = await scrapePost({ action: 'delete-unreachable-sources' })
      setSelectedHosts(new Set())
      await loadScrapeSources()
      toast(`已删除 ${data.deleted} 个不可访问书源`, 'success')
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function testSource(s: SourceRow) {
    setTestHost(s.host)
    setTestState({ loading: true, data: null, error: '' })
    try {
      const data = await scrapePost({ action: 'test-source', host: s.host })
      setTestState({ loading: false, data, error: '' })
    } catch (err) {
      setTestState({ loading: false, data: null, error: (err as Error).message })
    }
  }

  async function doImportLegado(payload: { url?: string; text?: string }) {
    setImportStatus('正在导入…')
    setImportResult(null)
    try {
      const data = await scrapePost({ action: 'import-legado', ...payload })
      const s = data.bySupport || {}
      setImportResult({
        ok: true,
        text: `导入完成 — 新增 ${data.imported}，更新 ${data.updated}，跳过 ${data.skipped}`,
        sub: `支持度: full ${s.full} · partial ${s.partial} · unsupported ${s.unsupported}${data.parseErrorCount ? ` · 解析失败 ${data.parseErrorCount}` : ''}`,
      })
      setImportStatus('')
      await loadScrapeSources()
      toast(`成功导入 ${data.imported} 条书源`, 'success')
    } catch (err) {
      setImportStatus('')
      setImportResult({ ok: false, text: (err as Error).message })
      toast((err as Error).message, 'error')
    }
  }

  function importFromUrl() {
    if (!importUrl.trim()) {
      toast('请填写书源池 URL', 'error')
      return
    }
    void doImportLegado({ url: importUrl.trim() })
  }

  function importFromText() {
    if (!importText.trim()) {
      toast('请粘贴书源 JSON', 'error')
      return
    }
    void doImportLegado({ text: importText.trim() })
  }

  const testSampleOk = Array.isArray(testState.data?.sampleChapters) ? testState.data.sampleChapters.filter((s: any) => s.ok).length : 0

  return (
    <>
      <AdminTabHeader
        title="书源管理"
        description="批量导入 Legado 社区书源池，智能分析小说时自动按 host 匹配书源选择器。仅消费书源规则数据，转换器为项目自研。"
      />

      {/* Import card */}
      <div className="source-workspace">
        <AdminPanel className="source-import-panel" title="导入书源">
          <div className="source-import__body">
            <div className="form-group source-import__url-group">
              <Label className="source-import__label mb-1.5">书源池 URL</Label>
              <div className="input-row source-import__url-row">
                <Input type="url" placeholder="https://raw.githubusercontent.com/aoaostar/legado/release/sources/xxx.json" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
                <Button size="sm" onClick={importFromUrl}>
                  拉取并导入
                </Button>
              </div>
            </div>
            <div className="form-group source-import__json-group">
              <Label className="source-import__label mb-1.5">或粘贴书源 JSON（单个或数组）</Label>
              <Textarea
                rows={4}
                placeholder='[{"bookSourceName":"xxx小说网","bookSourceUrl":"https://...","ruleToc":{...},"ruleContent":{...}}]'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
            </div>
            <div className="action-row source-import__actions">
              <Button variant="secondary" size="sm" onClick={importFromText}>
                粘贴导入
              </Button>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {importStatus}
              </span>
            </div>
            {importResult && (
              <div className="source-import__result">
                {importResult.ok ? (
                  <Badge className="bg-success/10 text-success">{importResult.text}</Badge>
                ) : (
                  <div className="text-sm font-medium text-destructive">{importResult.text}</div>
                )}
                {importResult.sub && <div className="text-sm text-muted-foreground">{importResult.sub}</div>}
              </div>
            )}
          </div>
        </AdminPanel>

        <section className="source-panel" aria-label="书源列表">
          <div className="source-panel__bar">
            <div className="source-panel__cluster source-panel__cluster--primary">
              <div className="source-panel__filter-group">
                <span className="source-panel__section-label">筛选</span>
                <Tabs className="source-panel__tabs" value={supportFilter} onValueChange={onSupportFilterChange}>
                  <TabsList>
                    <TabsTrigger value="">全部</TabsTrigger>
                    <TabsTrigger value="full">full</TabsTrigger>
                    <TabsTrigger value="partial">partial</TabsTrigger>
                    <TabsTrigger value="unsupported">unsupported</TabsTrigger>
                    <TabsTrigger value="enabled">已启用</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="source-panel__stats" aria-label="书源统计">
                <Badge variant="secondary">总数 {total}</Badge>
                <Badge variant="secondary">已启用 {enabledCount}</Badge>
                <Badge className="bg-success/10 text-success">可用 {bySupport.full || 0}</Badge>
                <Badge className="bg-warning/10 text-warning">需核验 {bySupport.partial || 0}</Badge>
                <Badge className="bg-secondary text-muted-foreground">不支持 {bySupport.unsupported || 0}</Badge>
                <Badge className="bg-destructive/10 text-destructive">不可访问 {unreachableCount}</Badge>
              </div>
            </div>
            <div className="source-panel__cluster source-panel__cluster--actions">
              <div className="source-panel__search">
                <Label htmlFor="source-host-filter" className="sr-only">按站点名或 host 搜索书源</Label>
                <Input id="source-host-filter" type="text" className="admin-input--compact" placeholder="按站点名或 host 搜索…" value={hostFilter} onChange={(e) => onHostFilterChange(e.target.value)} />
              </div>
              <Button variant="secondary" size="sm" onClick={() => void loadScrapeSources()}>
                刷新
              </Button>
              <Button variant="secondary" size="sm" onClick={openConnectivityDialog}>检测连接</Button>
              <Button variant="destructive" size="sm" disabled={unreachableCount === 0} onClick={() => void deleteUnreachableSources()}>删除不可访问</Button>
            </div>
          </div>
          {selectedHosts.size > 0 && (
            <div className="source-panel__bulk-actions">
              <span className="text-sm text-muted-foreground">已选择 {selectedHosts.size}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedHosts(new Set())}>清空</Button>
              <Button variant="secondary" size="sm" onClick={() => void batchDisableSources()}>批量停用</Button>
              <Button variant="destructive" size="sm" onClick={() => void batchDeleteSources()}>批量删除</Button>
            </div>
          )}
          <div className="source-panel__scroll-hint" aria-hidden="true">左右滑动查看完整字段</div>

          <div className="table-wrapper source-panel__table-wrapper">
            <Table className="source-table">
              <colgroup>
                <col className="source-table__col source-table__col--select" />
                <col className="source-table__col source-table__col--site" />
                <col className="source-table__col source-table__col--host" />
                <col className="source-table__col source-table__col--encoding" />
                <col className="source-table__col source-table__col--support" />
                <col className="source-table__col source-table__col--connectivity" />
                <col className="source-table__col source-table__col--confidence" />
                <col className="source-table__col source-table__col--selector" />
                <col className="source-table__col source-table__col--enabled" />
                <col className="source-table__col source-table__col--actions" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="source-table__head source-table__head--select">
                    <Checkbox aria-label="选择当前列表中的全部书源" checked={sources.length > 0 && sources.every((source) => selectedHosts.has(source.host))} onCheckedChange={(checked) => toggleAllVisible(checked === true)} />
                  </TableHead>
                  <TableHead className="source-table__head source-table__head--site">站点</TableHead>
                  <TableHead className="source-table__head source-table__head--host">host</TableHead>
                  <TableHead className="source-table__head source-table__head--encoding">编码</TableHead>
                  <TableHead className="source-table__head source-table__head--support">支持度</TableHead>
                  <TableHead className="source-table__head source-table__head--connectivity">连接状态</TableHead>
                  <TableHead className="source-table__head source-table__head--confidence">置信度</TableHead>
                  <TableHead className="source-table__head source-table__head--selector">章节列表选择器</TableHead>
                  <TableHead className="source-table__head source-table__head--enabled">启用</TableHead>
                  <TableHead className="source-table__head source-table__head--actions text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourcesLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="table-empty">加载中…</TableCell>
                  </TableRow>
                ) : sourcesError ? (
                  <TableRow>
                    <TableCell colSpan={10} className="table-empty">{sourcesError}</TableCell>
                  </TableRow>
                ) : sources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="table-empty">没有匹配的书源</TableCell>
                  </TableRow>
                ) : (
                  sources.map((s) => (
                    <TableRow key={s.host}>
                      <TableCell className="source-table__cell source-table__cell--select">
                        <Checkbox aria-label={`选择 ${s.name}`} checked={selectedHosts.has(s.host)} onCheckedChange={(checked) => toggleSelected(s.host, checked === true)} />
                      </TableCell>
                      <TableCell className="source-table__cell source-table__cell--site">
                        <div className="source-table__site">
                          <strong className="source-table__site-name">{s.name}</strong>
                          {Array.isArray(s.warnings) && s.warnings.length > 0 && (
                            <div className="source-table__warnings" title={s.warnings.join('\n')}>
                              {s.warnings.slice(0, 2).join('; ')}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="source-table__cell source-table__cell--host text-muted-foreground">
                        <span className="source-table__host">{s.host}</span>
                      </TableCell>
                      <TableCell className="source-table__cell source-table__cell--encoding text-muted-foreground">{s.encoding}</TableCell>
                      <TableCell className="source-table__cell source-table__cell--support">{supportBadge(s.support)}</TableCell>
                      <TableCell className="source-table__cell source-table__cell--connectivity" title={s.connectivityError || undefined}>{connectivityBadge(s.connectivity)}</TableCell>
                      <TableCell className="source-table__cell source-table__cell--confidence text-muted-foreground">{s.confidence}</TableCell>
                      <TableCell className="source-table__cell source-table__cell--selector text-muted-foreground" title={s.chapterList}>
                        <span className="source-table__selector">{s.chapterList || '—'}</span>
                      </TableCell>
                      <TableCell className="source-table__cell source-table__cell--enabled">
                        <Button variant="ghost" size="sm" onClick={() => void toggleSource(s)}>
                          {s.enabled ? '停用' : '启用'}
                        </Button>
                      </TableCell>
                      <TableCell className="source-table__cell source-table__cell--actions text-right">
                        <div className="source-table__actions">
                          <Button variant="secondary" size="sm" onClick={() => void testSource(s)}>测试</Button>
                          <Button variant="destructive" size="sm" onClick={() => void deleteSource(s)}>删除</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="source-panel__pagination" aria-label="书源分页">
            <span className="text-sm text-muted-foreground">显示 {sourceMatchedTotal === 0 ? 0 : (sourcePage - 1) * sourcePageSize + 1}-{Math.min(sourcePage * sourcePageSize, sourceMatchedTotal)} / {sourceMatchedTotal}</span>
            <div className="source-panel__pagination-controls">
              <div className="source-panel__page-size">
                <span>每页</span>
                <Select value={String(sourcePageSize)} onValueChange={(value) => { setSourcePageSize(Number(value)); setSourcePage(1) }}>
                  <SelectTrigger size="sm" aria-label="每页显示数量"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper" align="start" sideOffset={4} className="source-page-size__content">
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="secondary" size="sm" disabled={sourcePage <= 1} onClick={() => setSourcePage((page) => page - 1)}>上一页</Button>
              <span className="source-panel__page-indicator">第 {sourcePage} / {sourceTotalPages} 页</span>
              <Button variant="secondary" size="sm" disabled={sourcePage >= sourceTotalPages} onClick={() => setSourcePage((page) => page + 1)}>下一页</Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={connectivityDialogOpen} onOpenChange={(open) => { if (!connectivityChecking) setConnectivityDialogOpen(open) }}>
        <DialogContent className="admin-dialog source-connectivity-dialog">
          <DialogHeader>
            <DialogTitle className="editor-modal__title">检测书源连接</DialogTitle>
            <DialogDescription>选择需要检测的书源范围。检测会访问每个书源的入口地址。</DialogDescription>
          </DialogHeader>
          <div className="source-connectivity-dialog__body">
            <div className="source-connectivity-dialog__field">
              <Label htmlFor="connectivity-scope">检测范围</Label>
              <Select value={connectivityScope} onValueChange={(value) => setConnectivityScope(value as typeof connectivityScope)} disabled={connectivityChecking}>
                <SelectTrigger id="connectivity-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">当前页（{sources.length} 个）</SelectItem>
                  <SelectItem value="selected" disabled={selectedHosts.size === 0}>已选择（{selectedHosts.size} 个）</SelectItem>
                  <SelectItem value="all">全部书源（{total} 个）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {connectivityChecking ? (
              <div className="source-connectivity-dialog__feedback" aria-live="polite">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>正在检测连接，请稍候…</span>
                  <span className="text-muted-foreground">{connectivityProgress.completed} / {connectivityProgress.total}</span>
                </div>
                <Progress value={connectivityProgress.total ? connectivityProgress.completed / connectivityProgress.total * 100 : 0} className="source-connectivity-dialog__progress" />
                <div className="source-connectivity-dialog__live-stats">
                  <span>当前：{connectivityProgress.currentHost}</span>
                  <span className="text-success">可连接 {connectivityProgress.reachable}</span>
                  <span className="text-destructive">不可访问 {connectivityProgress.unreachable}</span>
                </div>
              </div>
            ) : connectivityResult ? (
              <div className="source-connectivity-dialog__result" aria-live="polite">
                <div className="source-connectivity-dialog__result-title">检测完成</div>
                <div className="source-connectivity-dialog__result-grid">
                  <span>检测数量 <strong>{connectivityResult.checked}</strong></span>
                  <span className="text-success">可连接 <strong>{connectivityResult.reachable}</strong></span>
                  <span className="text-destructive">不可访问 <strong>{connectivityResult.unreachable}</strong></span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">本次将检测 {connectivityScope === 'all' ? total : connectivityScope === 'selected' ? selectedHosts.size : sources.length} 个书源。</div>
            )}
          </div>
          <DialogFooter>
            {connectivityResult && <Button variant="ghost" onClick={() => setConnectivityResult(null)}>再次检测</Button>}
            <Button variant="secondary" disabled={connectivityChecking} onClick={() => setConnectivityDialogOpen(false)}>关闭</Button>
            {!connectivityResult && <Button disabled={connectivityChecking || (connectivityScope === 'selected' && selectedHosts.size === 0) || (connectivityScope === 'page' && sources.length === 0)} onClick={() => void checkConnectivity()}>{connectivityChecking ? '检测中…' : '开始检测'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test result dialog */}
      <Dialog open={!!testState.data || !!testState.error} onOpenChange={(open) => !open && setTestState((prev) => ({ ...prev, data: null, error: '' }))}>
        <DialogContent className="admin-dialog sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle className="editor-modal__title">{testHost ? `测试书源 · ${testHost}` : '测试书源'}</DialogTitle>
            <DialogDescription>选择器测试结果</DialogDescription>
          </DialogHeader>
          <div className="admin-dialog__body">
            {testState.loading ? (
              <div className="flex items-center gap-2">
                <div className="spinner"></div>
                <span className="text-sm text-muted-foreground">正在测试书源…</span>
              </div>
            ) : testState.data && testState.data.links && testState.data.links.length > 0 ? (
              <>
                <Badge className="bg-success/10 text-success">
                  测试成功 — 找到 {testState.data.links.length} 个章节链接 (编码 {testState.data.encoding})
                </Badge>
                <ul className="scrape-feedback__links text-xs">
                  {testState.data.links.slice(0, 20).map((l: any, i: number) => (
                    <li key={i}>
                      {l.text || l.href} → <span className="text-muted-foreground">{l.href}</span>
                    </li>
                  ))}
                  {testState.data.links.length > 20 && <li className="text-muted-foreground">…还有 {testState.data.links.length - 20} 个</li>}
                </ul>
                {testState.data.sampleChapters ? <div className="text-sm text-muted-foreground">样章可读: {testSampleOk}/{testState.data.sampleChapters.length}</div> : null}
              </>
            ) : testState.error ? (
              <div className="text-sm font-medium text-destructive">测试失败: {testState.error}</div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
