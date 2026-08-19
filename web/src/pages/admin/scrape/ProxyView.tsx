import { useCallback, useEffect, useState } from 'react'
import { Globe2, Info, LoaderCircle, Network, RefreshCw, Save, ScrollText, ShieldCheck, Waypoints } from 'lucide-react'
import { scrapeApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type ProxyConfig = { proxyBase: string; proxyBypass: string }
type ProxySource = 'environment' | 'runtime' | 'none'
type ProxyLog = Awaited<ReturnType<typeof scrapeApi.proxyLogs>>['logs'][number]

function sourceLabel(source: ProxySource): string {
  if (source === 'environment') return '环境变量优先'
  if (source === 'runtime') return '管理端配置'
  return '未启用'
}

function logSourceLabel(source: ProxySource): string {
  if (source === 'environment') return '环境代理'
  if (source === 'runtime') return '管理端代理'
  return '直连'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export default function ProxyView() {
  const { toast } = useToast()
  const [draft, setDraft] = useState<ProxyConfig>({ proxyBase: '', proxyBypass: '' })
  const [effective, setEffective] = useState<ProxyConfig>({ proxyBase: '', proxyBypass: '' })
  const [noProxy, setNoProxy] = useState('')
  const [effectiveHost, setEffectiveHost] = useState('')
  const [source, setSource] = useState<ProxySource>('none')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [logsLoading, setLogsLoading] = useState(true)
  const [logs, setLogs] = useState<ProxyLog[]>([])
  const [targetUrl, setTargetUrl] = useState('https://czbooks.net')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const applyConfig = useCallback((result: Awaited<ReturnType<typeof scrapeApi.proxyConfig>>) => {
    setDraft(result.config)
    setEffective(result.effective)
    setNoProxy(result.noProxy)
    setEffectiveHost(result.effectiveHost)
    setSource(result.source)
  }, [])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      setLogs((await scrapeApi.proxyLogs(50)).logs)
    } catch (err) {
      toast((err as Error).message || '代理日志加载失败', 'error')
    } finally {
      setLogsLoading(false)
    }
  }, [toast])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      applyConfig(await scrapeApi.proxyConfig())
    } catch (err) {
      toast((err as Error).message || '代理配置加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [applyConfig, toast])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
      void loadLogs()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load, loadLogs])

  async function save() {
    setSaving(true)
    setTestResult(null)
    try {
      const result = await scrapeApi.saveProxyConfig({
        proxyBase: draft.proxyBase.trim(),
        proxyBypass: draft.proxyBypass.trim(),
      })
      applyConfig(result)
      const message =
        result.source === 'environment' ? '配置已保存；当前仍优先使用部署环境变量' : result.configured ? '代理配置已保存，后续出站请求立即生效' : '代理已关闭'
      toast(message, 'success')
    } catch (err) {
      toast((err as Error).message || '代理配置保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    const url = targetUrl.trim()
    if (!url) {
      toast('请输入要测试的目标网址', 'error')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await scrapeApi.testProxy(url)
      if (result.ok) {
        setTestResult({
          ok: true,
          text: `代理响应正常 · ${result.proxyHost || '代理'} · ${result.elapsedMs ?? 0} ms · ${result.length ?? 0} 字符`,
        })
        toast('代理连通性测试通过', 'success')
      } else {
        setTestResult({ ok: false, text: result.error || '代理请求失败' })
        toast(result.error || '代理请求失败', 'error')
      }
    } catch (err) {
      const message = (err as Error).message || '代理测试失败'
      setTestResult({ ok: false, text: message })
      toast(message, 'error')
    } finally {
      setTesting(false)
      void loadLogs()
    }
  }

  const enabled = Boolean(effectiveHost || effective.proxyBase)
  const environmentOverride = source === 'environment'

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Waypoints className="size-4 text-primary" aria-hidden="true" />
              HTTP / HTTPS 出站代理
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              统一作用于 AI 文本、图像生成、远程图片、书源导入和网页抓取。Docker 部署优先使用 HTTP_PROXY / HTTPS_PROXY。
            </CardDescription>
          </div>
          <Badge className={enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{enabled ? '已启用' : '未启用'}</Badge>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-base">代理地址</Label>
              <Input
                id="proxy-base"
                type="url"
                placeholder="http://127.0.0.1:7890"
                value={draft.proxyBase}
                disabled={loading || saving}
                onChange={(event) => setDraft((current) => ({ ...current, proxyBase: event.target.value }))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">填写 Clash mixed-port 等标准 HTTP Forward Proxy 地址，保存后无需重启。</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-bypass">跳过代理</Label>
              <Input
                id="proxy-bypass"
                placeholder="localhost,127.0.0.1,::1,.internal.example.com"
                value={draft.proxyBypass}
                disabled={loading || saving}
                onChange={(event) => setDraft((current) => ({ ...current, proxyBypass: event.target.value }))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">多个主机、域名、IP 或 host:port 用逗号分隔。生产环境同时遵循 NO_PROXY。</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button onClick={() => void save()} disabled={loading || saving}>
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {saving ? '保存中' : '保存代理配置'}
            </Button>
            <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              重新读取
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" aria-hidden="true" />
              当前来源：{sourceLabel(source)}
            </span>
          </div>

          {environmentOverride && (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>当前由 Docker / 系统环境变量提供代理。管理端配置会保留，但 HTTP_PROXY / HTTPS_PROXY 和 NO_PROXY 优先。</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            代理连通性测试
          </CardTitle>
          <CardDescription>服务端通过与正式请求相同的代理链路访问一次公开网址，并写入下方日志。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="proxy-test-url">测试目标网址</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="proxy-test-url"
                type="url"
                placeholder="https://czbooks.net"
                value={targetUrl}
                disabled={testing}
                onChange={(event) => setTargetUrl(event.target.value)}
                className="sm:max-w-xl"
              />
              <Button variant="secondary" onClick={() => void test()} disabled={testing || !enabled}>
                {testing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Globe2 className="size-4" aria-hidden="true" />}
                {testing ? '测试中' : '开始测试'}
              </Button>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            <Network className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              当前代理：{effective.proxyBase || effectiveHost || '未配置'}
              {effective.proxyBypass || noProxy ? ` · 跳过：${[effective.proxyBypass, noProxy].filter(Boolean).join(',')}` : ''}
            </span>
          </div>
          {testResult && (
            <div
              className={`rounded-md border px-3 py-2.5 text-sm ${testResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}
              role="status"
            >
              {testResult.text}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="size-4 text-primary" aria-hidden="true" />
              最近出站日志
            </CardTitle>
            <CardDescription className="mt-1">仅保留本进程最近 100 条；目标查询参数、请求头、正文及代理凭据不会记录。</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void loadLogs()} disabled={logsLoading} title="刷新日志" aria-label="刷新日志">
            <RefreshCw className={`size-4 ${logsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">时间</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>链路</TableHead>
                <TableHead>结果</TableHead>
                <TableHead className="pr-6 text-right">耗时</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logsLoading && !logs.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : !logs.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    暂无出站请求记录
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap pl-6 text-xs text-muted-foreground">{formatTime(log.timestamp)}</TableCell>
                    <TableCell>
                      <code className="text-xs">{log.scope}</code>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate text-xs" title={log.target}>
                      {log.method} {log.target}
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-0.5">
                        <span className="text-xs">{logSourceLabel(log.proxySource)}</span>
                        {log.proxyHost && <code className="text-xs text-muted-foreground">{log.proxyHost}</code>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={log.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
                        {log.status ?? (log.error || '失败')}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right text-xs text-muted-foreground">{log.durationMs} ms</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
