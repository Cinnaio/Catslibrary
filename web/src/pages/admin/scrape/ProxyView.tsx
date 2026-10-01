import AdminFormField from '@/components/admin/AdminFormField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, CircleAlert, Info, LoaderCircle } from 'lucide-react'
import { scrapeApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AdminPanelHeading } from '@/components/admin/AdminWorkspace'

type ProxyConfig = { proxyBase: string; proxyBypass: string }
type ProxySource = 'environment' | 'runtime' | 'none'
type ProxyResult = { tone: 'success' | 'muted' | 'error'; title: string; detail: string }

function ProxyResultRow({ label, result }: { label: string; result: ProxyResult }) {
  const Icon = result.tone === 'success' ? Check : result.tone === 'error' ? CircleAlert : Info
  return (
    <div className="proxy-result-row">
      <span className="proxy-result-row__label">{label}</span>
      <div className="proxy-result-row__content">
        <div className={`proxy-result-row__title proxy-result-row__title--${result.tone}`}>
          <Icon aria-hidden="true" />
          {result.title}
        </div>
        <p>{result.detail}</p>
      </div>
    </div>
  )
}

function sourceLabel(source: ProxySource): string {
  if (source === 'environment') return '环境变量优先'
  if (source === 'runtime') return '管理端配置'
  return '未启用'
}

export default function ProxyView() {
  const { toast } = useToast()
  const [draft, setDraft] = useState<ProxyConfig>({ proxyBase: '', proxyBypass: '' })
  const [effective, setEffective] = useState<ProxyConfig>({ proxyBase: '', proxyBypass: '' })
  const [saved, setSaved] = useState<ProxyConfig>({ proxyBase: '', proxyBypass: '' })
  const [noProxy, setNoProxy] = useState('')
  const [effectiveHost, setEffectiveHost] = useState('')
  const [source, setSource] = useState<ProxySource>('none')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveFeedback, setSaveFeedback] = useState('配置已同步')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [routeChecking, setRouteChecking] = useState(false)
  const [targetUrl, setTargetUrl] = useState('https://czbooks.net')
  const [testResult, setTestResult] = useState<ProxyResult | null>(null)
  const [routeResult, setRouteResult] = useState<ProxyResult | null>(null)

  const applyConfig = useCallback((result: Awaited<ReturnType<typeof scrapeApi.proxyConfig>>) => {
    setDraft(result.config)
    setSaved(result.config)
    setEffective(result.effective)
    setNoProxy(result.noProxy)
    setEffectiveHost(result.effectiveHost)
    setSource(result.source)
    setLoaded(true)
    setLoadError('')
    setTestResult(null)
    setRouteResult(null)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setTestResult(null)
    setRouteResult(null)
    try {
      applyConfig(await scrapeApi.proxyConfig())
      setSaveFeedback('配置已同步')
    } catch (err) {
      const message = (err as Error).message || '代理配置加载失败'
      setLoadError(message)
      toast(message, 'error')
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
    try {
      const result = await scrapeApi.saveProxyConfig({
        proxyBase: draft.proxyBase.trim(),
        proxyBypass: draft.proxyBypass.trim(),
      })
      applyConfig(result)
      const message =
        result.source === 'environment' ? '配置已保存；当前仍优先使用部署环境变量' : result.configured ? '代理配置已保存，后续出站请求立即生效' : '代理已关闭'
      toast(message, 'success')
      setSaveFeedback(message)
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
          tone: 'success',
          title: '代理响应正常',
          detail: `${result.proxyHost || '代理'} · ${result.elapsedMs ?? 0} ms · ${(result.length ?? 0).toLocaleString('zh-CN')} 字符`,
        })
        toast('代理连通性测试通过', 'success')
      } else {
        setTestResult({ tone: 'error', title: '代理请求失败', detail: result.error || '代理请求失败' })
        toast(result.error || '代理请求失败', 'error')
      }
    } catch (err) {
      const message = (err as Error).message || '代理测试失败'
      setTestResult({ tone: 'error', title: '代理请求失败', detail: message })
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
        setRouteResult({ tone: 'success', title: '将通过代理请求', detail: `${sourceLabel(result.source)} · ${result.proxyHost || ''} · ${result.reason}` })
      } else if (result.bypassed) {
        setRouteResult({ tone: 'muted', title: '将直接连接', detail: `命中跳过规则「${result.bypassRule}」。直连属于正常路由结果。` })
      } else {
        setRouteResult({ tone: 'muted', title: '将直接连接', detail: result.reason })
      }
    } catch (err) {
      setRouteResult({ tone: 'error', title: '路由检查失败', detail: (err as Error).message || '路由检查失败' })
    } finally {
      setRouteChecking(false)
    }
  }

  const enabled = Boolean(effectiveHost || effective.proxyBase)
  const environmentOverride = source === 'environment'
  const dirty = draft.proxyBase.trim() !== saved.proxyBase || draft.proxyBypass.trim() !== saved.proxyBypass
  const busy = loading || saving || testing || routeChecking
  const unavailable = !loaded || Boolean(loadError)

  return (
    <div className="proxy-settings-page">
      <Card className="admin-panel-card proxy-config-panel" aria-labelledby="proxy-config-title">
        <AdminPanelHeading
          title="出站代理配置"
          titleId="proxy-config-title"
          status={
            <AdminStatusBadge tone={loaded && !loading && !loadError && enabled ? 'success' : 'muted'}>
              {loading ? '读取中' : loadError ? '读取失败' : enabled ? '已启用' : '未启用'}
            </AdminStatusBadge>
          }
        />
        <div className="proxy-effective" aria-busy={loading}>
          <span className="proxy-effective__label">当前生效配置</span>
          <div>
            <div className="proxy-effective__value">
              <code>
                {loading ? '正在读取配置…' : loadError ? '配置读取失败，请重新读取' : effective.proxyBase || effectiveHost || '未配置 · 出站请求直连'}
              </code>
              {loaded && !loading && !loadError && <span>来源：{sourceLabel(source)}</span>}
            </div>
            {loaded && !loading && !loadError && enabled && (
              <div className="proxy-effective__rules">
                {effective.proxyBypass && <span>管理端跳过：{effective.proxyBypass}</span>}
                {noProxy && <span>NO_PROXY：{noProxy}</span>}
                {!effective.proxyBypass && !noProxy && <span>跳过规则：未设置</span>}
              </div>
            )}
          </div>
        </div>
        {environmentOverride && (
          <div className="proxy-override">
            <Info aria-hidden="true" />
            <span>环境变量优先。管理端配置仍可保存；出站请求按部署环境中的代理与跳过规则执行。</span>
          </div>
        )}
        <form
          className="proxy-config-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && !unavailable && dirty) void save()
          }}
        >
          <div className="proxy-setting-row">
            <div className="proxy-setting-row__copy">
              <label htmlFor="proxy-base">代理地址</label>
              <p>保存后，后续出站请求立即生效。留空可关闭管理端代理。</p>
            </div>
            <div className="proxy-setting-row__control">
              <Input
                id="proxy-base"
                type="url"
                placeholder="http://127.0.0.1:7890"
                value={draft.proxyBase}
                disabled={busy || unavailable}
                aria-describedby="proxy-base-hint"
                onChange={(event) => setDraft((current) => ({ ...current, proxyBase: event.target.value }))}
              />
              <p className="proxy-hint" id="proxy-base-hint">
                Clash / Mihomo mixed-port 通常填写 http://，目标网站为 HTTPS 也一样。
              </p>
            </div>
          </div>
          <div className="proxy-setting-row">
            <div className="proxy-setting-row__copy">
              <label htmlFor="proxy-bypass">跳过代理</label>
              <p>匹配的目标直接连接。</p>
            </div>
            <div className="proxy-setting-row__control">
              <Input
                id="proxy-bypass"
                placeholder="localhost,127.0.0.1,::1,.internal.example.com"
                value={draft.proxyBypass}
                disabled={busy || unavailable}
                aria-describedby="proxy-bypass-hint"
                onChange={(event) => setDraft((current) => ({ ...current, proxyBypass: event.target.value }))}
              />
              <p className="proxy-hint" id="proxy-bypass-hint">
                主机、域名、IP 或 host:port，以逗号分隔。环境中的 NO_PROXY 同时生效。
              </p>
            </div>
          </div>
          <div className="proxy-config-actions">
            <Button type="submit" disabled={busy || unavailable || !dirty}>
              {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {saving ? '保存中' : '保存配置'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void load()} disabled={busy}>
              {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}重新读取
            </Button>
            <span className="proxy-save-feedback" role="status">
              {loading ? '正在读取配置' : loadError ? loadError : dirty ? '有未保存的修改' : saveFeedback}
            </span>
          </div>
        </form>
      </Card>
      <Card className="admin-panel-card proxy-test-panel" aria-labelledby="proxy-test-title">
        <AdminPanelHeading title="路由与连通性" titleId="proxy-test-title" />
        <div className="proxy-test-body">
          <AdminFormField label="测试目标网址" htmlFor="proxy-test-url">
            <div className="proxy-target-row">
              <Input
                id="proxy-test-url"
                type="url"
                placeholder="https://czbooks.net"
                value={targetUrl}
                disabled={busy || unavailable}
                aria-describedby="proxy-test-hint"
                onChange={(event) => {
                  setTargetUrl(event.target.value)
                  setRouteResult(null)
                  setTestResult(null)
                }}
              />
              <Button type="button" variant="outline" onClick={() => void checkRoute()} disabled={busy || unavailable}>
                {routeChecking && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {routeChecking ? '检查中' : '检查路由'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void test()} disabled={busy || unavailable || !enabled}>
                {testing && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {testing ? '测试中' : '测试代理连接'}
              </Button>
            </div>
          </AdminFormField>
          <p className="proxy-hint" id="proxy-test-hint">
            检查路由按已生效配置判断；连接测试强制使用代理，不受跳过规则影响。
          </p>
          {dirty && <p className="proxy-hint">配置尚未保存，下面的检查仍使用上方“当前生效配置”。</p>}
          <div className="proxy-results" role="status" aria-live="polite" aria-atomic="true" aria-busy={testing || routeChecking}>
            {!routeResult && !testResult && (
              <p className="proxy-hint">
                {unavailable
                  ? '配置读取成功后，可以检查路由与连接。'
                  : routeChecking
                    ? '正在检查目标的请求路由…'
                    : testing
                      ? '正在通过代理请求目标网址…'
                      : '尚未检查。先确认目标是否走代理，再测试代理连接。'}
              </p>
            )}
            {routeResult && <ProxyResultRow label="请求路由" result={routeResult} />}
            {testResult && <ProxyResultRow label="代理连接" result={testResult} />}
          </div>
        </div>
      </Card>
      <details className="proxy-help">
        <summary>
          <ChevronRight aria-hidden="true" />
          代理协议与部署说明
        </summary>
        <div className="proxy-help__content">
          <p>
            <strong>代理协议：</strong>这里的 <code>http://</code> / <code>https://</code> 描述代理监听端口的协议，和目标网站是否为 HTTPS
            无关。只有代理端口本身提供 TLS，才填写 <code>https://</code>。
          </p>
          <p>
            <strong>Docker 部署：</strong>代理运行在宿主机上时，Docker Desktop 一般使用 <code>http://host.docker.internal:7890</code>
            ，并确认代理允许来自容器的连接。
          </p>
          <p>
            <strong>排查失败：</strong>代理端口可达不等于目标可访问。连接失败时结合出站请求记录检查 CONNECT、目标 TLS、超时和目标站点权限。
          </p>
        </div>
      </details>
    </div>
  )
}
