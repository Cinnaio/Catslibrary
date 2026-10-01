import { Link } from 'react-router-dom'
import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useState } from 'react'
import { Globe2, Info, LoaderCircle, Network, RefreshCw, Route, Save } from 'lucide-react'
import { scrapeApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'

type ProxyConfig = { proxyBase: string; proxyBypass: string }
type ProxySource = 'environment' | 'runtime' | 'none'

function sourceLabel(source: ProxySource): string {
  if (source === 'environment') return '环境变量优先'
  if (source === 'runtime') return '管理端配置'
  return '未启用'
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
  const [routeChecking, setRouteChecking] = useState(false)
  const [targetUrl, setTargetUrl] = useState('https://czbooks.net')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [routeResult, setRouteResult] = useState<{ ok: boolean; text: string } | null>(null)

  const applyConfig = useCallback((result: Awaited<ReturnType<typeof scrapeApi.proxyConfig>>) => {
    setDraft(result.config)
    setEffective(result.effective)
    setNoProxy(result.noProxy)
    setEffectiveHost(result.effectiveHost)
    setSource(result.source)
  }, [])

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
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

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
    }
  }

  async function checkRoute() {
    const url = targetUrl.trim()
    if (!url) {
      toast('请输入要检查的目标网址', 'error')
      return
    }
    setRouteChecking(true)
    setRouteResult(null)
    try {
      const result = await scrapeApi.proxyRoute(url)
      if (result.usesProxy) {
        setRouteResult({ ok: true, text: `将走代理：${sourceLabel(result.source)} ${result.proxyHost || ''} · ${result.reason}` })
      } else if (result.bypassed) {
        setRouteResult({ ok: false, text: `将直连：命中跳过规则「${result.bypassRule}」· ${result.reason}` })
      } else {
        setRouteResult({ ok: false, text: `将直连：${result.reason}` })
      }
    } catch (err) {
      setRouteResult({ ok: false, text: (err as Error).message || '路由检查失败' })
    } finally {
      setRouteChecking(false)
    }
  }

  const enabled = Boolean(effectiveHost || effective.proxyBase)
  const environmentOverride = source === 'environment'

  return (
    <div className="proxy-settings-page grid gap-4">
      <Card className="admin-panel-card proxy-config-panel">
        <AdminPanelHeading
          title="HTTP / HTTPS 出站代理"
          status={<AdminStatusBadge tone={enabled ? 'success' : 'muted'}>{enabled ? '已启用' : '未启用'}</AdminStatusBadge>}
        />
        <CardContent className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <AdminFormField label="代理地址" htmlFor="proxy-base">
              <Input
                id="proxy-base"
                type="url"
                placeholder="http://127.0.0.1:7890"
                value={draft.proxyBase}
                disabled={loading || saving}
                onChange={(event) => setDraft((current) => ({ ...current, proxyBase: event.target.value }))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">填写 Clash mixed-port 等标准 HTTP Forward Proxy 地址，保存后无需重启。</p>
            </AdminFormField>
            <AdminFormField label="跳过代理" htmlFor="proxy-bypass">
              <Input
                id="proxy-bypass"
                placeholder="localhost,127.0.0.1,::1,.internal.example.com"
                value={draft.proxyBypass}
                disabled={loading || saving}
                onChange={(event) => setDraft((current) => ({ ...current, proxyBypass: event.target.value }))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">多个主机、域名、IP 或 host:port 用逗号分隔。生产环境同时遵循 NO_PROXY。</p>
            </AdminFormField>
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

      <Card className="admin-panel-card proxy-test-panel">
        <AdminPanelHeading title="代理连通性测试" />
        <CardContent className="grid gap-4">
          <AdminFormField label="测试目标网址" htmlFor="proxy-test-url">
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
          </AdminFormField>
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            <Network className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              当前代理：{effective.proxyBase || effectiveHost || '未配置'}
              {effective.proxyBypass || noProxy ? ` · 跳过：${[effective.proxyBypass, noProxy].filter(Boolean).join(',')}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void checkRoute()} disabled={routeChecking || !enabled}>
              {routeChecking ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Route className="size-4" aria-hidden="true" />}
              检查该目标是否走代理
            </Button>
            {routeResult && (
              <span className={`text-sm ${routeResult.ok ? 'text-success' : 'text-foreground'}`} role="status">
                {routeResult.text}
              </span>
            )}
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

      <Button variant="outline" asChild>
        <Link to="/admin/calls?view=outbound">查看出站请求记录</Link>
      </Button>
    </div>
  )
}
