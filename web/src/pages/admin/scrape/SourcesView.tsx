// ============================================================
// 书源管理 — SourcesView
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm, useToast } from '../../../components/feedback'
import AdminTabHeader from '@/components/admin/AdminTabHeader'
import AdminPanel from '@/components/admin/AdminPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SourceRow } from './types'
import { scrapePost, supportBadge } from './utils'

export default function SourcesView({ active }: { active: boolean }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [sources, setSources] = useState<SourceRow[]>([])
  const [sourcesError, setSourcesError] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [enabledCount, setEnabledCount] = useState(0)
  const [bySupport, setBySupport] = useState<Record<string, number>>({})

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

  const loadScrapeSources = useCallback(async () => {
    setSourcesLoading(true)
    setSourcesError('')
    const body: Record<string, unknown> = { action: 'list-sources' }
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
    } catch (err) {
      setSourcesError((err as Error).message)
      setSources([])
    } finally {
      setSourcesLoading(false)
    }
  }, [supportFilter])

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
    if (hostDebounce.current) clearTimeout(hostDebounce.current)
    hostDebounce.current = setTimeout(() => void loadScrapeSources(), 300)
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
      <div className="grid gap-4">
      <AdminPanel title="导入书源">
        <div className="form-group">
          <Label className="mb-1.5">书源池 URL</Label>
          <div className="input-row">
            <Input type="url" className="flex-1" placeholder="https://raw.githubusercontent.com/aoaostar/legado/release/sources/xxx.json" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
            <Button size="sm" onClick={importFromUrl}>
              拉取并导入
            </Button>
          </div>
        </div>
        <div className="form-group">
          <Label className="mb-1.5">或粘贴书源 JSON（单个或数组）</Label>
          <Textarea
            rows={4}
            placeholder='[{"bookSourceName":"xxx小说网","bookSourceUrl":"https://...","ruleToc":{...},"ruleContent":{...}}]'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
        </div>
        <div className="action-row">
          <Button variant="secondary" size="sm" onClick={importFromText}>
            粘贴导入
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {importStatus}
          </span>
        </div>
        {importResult && (
          <div className="mt-3">
            {importResult.ok ? (
              <Badge className="bg-success/10 text-success">{importResult.text}</Badge>
            ) : (
              <div className="text-sm font-medium text-destructive">{importResult.text}</div>
            )}
            {importResult.sub && <div className="text-sm text-muted-foreground">{importResult.sub}</div>}
          </div>
        )}
      </AdminPanel>

      {/* Table card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* 工具栏 · 筛选 + 刷新 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Tabs value={supportFilter} onValueChange={setSupportFilter}>
            <TabsList>
              <TabsTrigger value="">全部</TabsTrigger>
              <TabsTrigger value="full">full</TabsTrigger>
              <TabsTrigger value="partial">partial</TabsTrigger>
              <TabsTrigger value="unsupported">unsupported</TabsTrigger>
              <TabsTrigger value="enabled">已启用</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input type="text" className="admin-input--compact ml-auto min-w-40" placeholder="按 host 过滤…" value={hostFilter} onChange={(e) => onHostFilterChange(e.target.value)} />
          <Button variant="secondary" size="sm" onClick={() => void loadScrapeSources()}>
            刷新
          </Button>
        </div>
        {/* 统计行 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Badge variant="secondary">总数: {total}</Badge>
          <Badge variant="secondary">已启用: {enabledCount}</Badge>
          <Badge className="bg-success/10 text-success">可用: {bySupport.full || 0}</Badge>
          <Badge className="bg-warning/10 text-warning">需核验: {bySupport.partial || 0}</Badge>
          <Badge className="bg-secondary text-muted-foreground">不支持: {bySupport.unsupported || 0}</Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>站点</TableHead>
              <TableHead>host</TableHead>
              <TableHead>编码</TableHead>
              <TableHead>支持度</TableHead>
              <TableHead>置信度</TableHead>
              <TableHead>章节列表选择器</TableHead>
              <TableHead>启用</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sourcesLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="table-empty">
                  加载中…
                </TableCell>
              </TableRow>
            ) : sourcesError ? (
              <TableRow>
                <TableCell colSpan={8} className="table-empty">
                  {sourcesError}
                </TableCell>
              </TableRow>
            ) : sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="table-empty">
                  没有匹配的书源
                </TableCell>
              </TableRow>
            ) : (
              sources.map((s) => (
                <TableRow key={s.host}>
                  <TableCell>
                    <strong>{s.name}</strong>
                    {Array.isArray(s.warnings) && s.warnings.length > 0 && (
                      <div className="text-xs text-muted-foreground" title={s.warnings.join('\n')}>
                        {s.warnings.slice(0, 2).join('; ')}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.host}</TableCell>
                  <TableCell className="text-muted-foreground">{s.encoding}</TableCell>
                  <TableCell>{supportBadge(s.support)}</TableCell>
                  <TableCell className="text-muted-foreground">{s.confidence}</TableCell>
                  <TableCell className="text-muted-foreground source-selector-cell" title={s.chapterList}>
                    {s.chapterList || '—'}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => void toggleSource(s)}>
                      {s.enabled ? '停用' : '启用'}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="secondary" size="sm" onClick={() => void testSource(s)}>
                        测试
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => void deleteSource(s)}>
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </div>

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
