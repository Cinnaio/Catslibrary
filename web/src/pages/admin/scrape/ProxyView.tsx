import { useEffect, useState } from 'react'
import { Globe2, Info, LoaderCircle, Network, Save, ShieldCheck, Waypoints } from 'lucide-react'
import { scrapeApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ProxyConfig = { proxyBase: string; proxyDomains: string }
type ProxySource = 'environment' | 'runtime' | 'none'

function sourceLabel(source: ProxySource): string {
  if (source === 'environment') return '环境变量优先'
  if (source === 'runtime') return '运行时配置'
  return '未启用'
}

export default function ProxyView() {
  const { toast } = useToast()
  const [draft, setDraft] = useState<ProxyConfig>({ proxyBase: '', proxyDomains: '' })
  const [effective, setEffective] = useState<ProxyConfig>({ proxyBase: '', proxyDomains: '' })
  const [effectiveHost, setEffectiveHost] = useState('')
  const [source, setSource] = useState<ProxySource>('none')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [targetUrl, setTargetUrl] = useState('https://czbooks.net')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const result = await scrapeApi.proxyConfig()
      setDraft(result.config)
      setEffective(result.effective)
      setEffectiveHost(result.effectiveHost)
      setSource(result.source)
    } catch (err) {
      toast((err as Error).message || '代理配置加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void scrapeApi
      .proxyConfig()
      .then((result) => {
        if (cancelled) return
        setDraft(result.config)
        setEffective(result.effective)
        setEffectiveHost(result.effectiveHost)
        setSource(result.source)
      })
      .catch((err) => {
        if (!cancelled) toast((err as Error).message || '代理配置加载失败', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  async function save() {
    setSaving(true)
    setTestResult(null)
    try {
      const result = await scrapeApi.saveProxyConfig({
        proxyBase: draft.proxyBase.trim(),
        proxyDomains: draft.proxyDomains.trim(),
      })
      setDraft(result.config)
      setEffective(result.effective)
      setEffectiveHost(result.effectiveHost)
      setSource(result.source)
      const message =
        result.source === 'environment'
          ? '开发环境代理已保存；当前仍优先使用部署环境变量'
          : result.configured
            ? '代理配置已保存，后续抓取立即生效'
            : '代理已关闭'
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

  const enabled = Boolean(effective.proxyBase)
  const environmentOverride = source === 'environment'

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Waypoints className="size-4 text-primary" aria-hidden="true" />
              HTTP / HTTPS 代理
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              开发环境可直接填写 Clash 地址；Docker 部署会优先使用 HTTP_PROXY / HTTPS_PROXY 环境变量。
            </CardDescription>
          </div>
          <Badge className={enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{enabled ? '已启用' : '未启用'}</Badge>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-base">开发环境代理地址</Label>
              <Input
                id="proxy-base"
                type="url"
                placeholder="http://127.0.0.1:7890"
                value={draft.proxyBase}
                disabled={loading || saving}
                onChange={(event) => setDraft((current) => ({ ...current, proxyBase: event.target.value }))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">标准 HTTP Forward Proxy 地址，例如 Clash 的 mixed-port。保存后无需重启服务。</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="proxy-domains">开发环境代理域名</Label>
              <Input
                id="proxy-domains"
                placeholder="czbooks.net, example.com"
                value={draft.proxyDomains}
                disabled={loading || saving}
                onChange={(event) => setDraft((current) => ({ ...current, proxyDomains: event.target.value }))}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">多个域名用逗号分隔；留空时仅代理默认站点。部署环境变量代理不受此列表限制。</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button onClick={() => void save()} disabled={loading || saving}>
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {saving ? '保存中' : '保存代理配置'}
            </Button>
            <Button variant="ghost" onClick={() => void load()} disabled={loading || saving}>
              重新读取
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" aria-hidden="true" />
              当前来源：{sourceLabel(source)}
            </span>
          </div>

          {environmentOverride && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>当前由 Docker / 系统环境变量提供代理。页面保存的开发地址会保留，但实际抓取优先使用 HTTP_PROXY / HTTPS_PROXY。</span>
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
          <CardDescription>输入一个公开网址，服务端会通过与正式抓取相同的代理链路请求一次。</CardDescription>
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
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            <Network className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              当前生效地址：{effective.proxyBase || effectiveHost || '未配置'}
              {effective.proxyDomains ? ` · 域名：${effective.proxyDomains}` : ''}
            </span>
          </div>
          {testResult && (
            <div
              className={`rounded-lg border px-3 py-2.5 text-sm ${testResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}
              role="status"
            >
              {testResult.text}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
