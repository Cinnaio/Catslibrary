import styles from './proxy.module.css'
import FormField from "@/components/shared/FormField"
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, CircleAlert, Info, Network, ArrowRight } from 'lucide-react'
import { scrapeApi } from '@/lib/api'
import { useToast } from '@/components/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PanelHeading } from '@/components/shared/PanelHeading'

type ProxyConfig = { proxyBase: string; proxyBypass: string }
type ProxySource = 'environment' | 'runtime' | 'none'
type ProxyResult = { tone: 'success' | 'muted' | 'error'; title: string; detail: string }

function ProxyResultRow({ label, result }: { label: string; result: ProxyResult }) {
  const Icon = result.tone === 'success' ? Check : result.tone === 'error' ? CircleAlert : Info
  return (
    <div className={styles.resultRow}>
      <span className={styles.resultLabel}>{label}</span>
      <div className={styles.resultContent}>
        <div className={styles.resultTitle} data-tone={result.tone}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />
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
        result.source === 'environment'
          ? '配置已保存；当前仍优先使用部署环境变量'
          : result.configured
            ? '代理配置已保存，后续出站请求立即生效'
            : '代理已关闭'
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
        setRouteResult({
          tone: 'success',
          title: '将通过代理请求',
          detail: `${sourceLabel(result.source)} · ${result.proxyHost || ''} · ${result.reason}`,
        })
      } else if (result.bypassed) {
        setRouteResult({
          tone: 'muted',
          title: '将直接连接',
          detail: `命中跳过规则「${result.bypassRule}」。直连属于正常路由结果。`,
        })
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
    <div className={styles.page}>
      <div className={styles.statusCard}>
        <div className={styles.effective} aria-busy={loading}>
          <Network className={styles.effectiveIcon} aria-hidden="true" />
          <div className={styles.effectiveCopy}>
            <div className={styles.effectiveTop}>
              <span className={styles.eyebrow}>当前生效配置</span>
              <AdminStatusBadge tone={loaded && !loading && !loadError && enabled ? 'success' : 'muted'}>
                {loading ? '读取中' : loadError ? '读取失败' : enabled ? '已启用' : '未启用'}
              </AdminStatusBadge>
            </div>
            <code className={styles.effectiveValue}>
              {loading
                ? '正在读取配置…'
                : loadError
                  ? '配置读取失败，请重新读取'
                  : effective.proxyBase || effectiveHost || '未配置 · 出站请求直连'}
            </code>
            {loaded && !loading && !loadError && (
              <div className={styles.effectiveMeta}>
                <span>来源：{sourceLabel(source)}</span>
                {enabled && <span>{effective.proxyBypass || noProxy ? '已设置跳过规则' : '跳过规则：未设置'}</span>}
              </div>
            )}
          </div>
          {loaded && !loading && !loadError && enabled && (effective.proxyBypass || noProxy) && (
            <details className={styles.effectiveRules}>
              <summary>查看跳过规则<ChevronRight aria-hidden="true" /></summary>
              <div>
                {effective.proxyBypass && <p>管理端跳过：{effective.proxyBypass}</p>}
                {noProxy && <p>NO_PROXY：{noProxy}</p>}
              </div>
            </details>
          )}
        </div>

        {environmentOverride && (
          <div className={styles.notice}>
            <Info aria-hidden="true" />
            <p>环境变量优先。管理端配置仍可保存；出站请求按部署环境中的代理与跳过规则执行。</p>
          </div>
        )}
      </div>

      <div className={styles.workbench}>
        <div className={styles.columns}>
          <section className={styles.configSection} aria-labelledby="proxy-config-title">
            <PanelHeading
              className={styles.sectionHeading}
              title="出站代理配置"
              titleId="proxy-config-title"
              description="设置请求出口，保存后对后续请求生效。"
            />
            <form
              className={styles.configForm}
              onSubmit={(event) => {
                event.preventDefault()
                if (!busy && !unavailable && dirty) void save()
              }}
            >
              <FormField
                label="代理地址"
                htmlFor="proxy-base"
                hint="填写代理监听地址；留空可关闭管理端代理。"
              >
                <Input
                  id="proxy-base"
                  className={styles.addressInput}
                  type="url"
                  placeholder="http://127.0.0.1:7890"
                  value={draft.proxyBase}
                  disabled={busy || unavailable}
                  onChange={(event) => setDraft((current) => ({ ...current, proxyBase: event.target.value }))}
                />
              </FormField>

              <FormField
                label="跳过代理"
                htmlFor="proxy-bypass"
                hint="匹配的目标直接连接，以逗号分隔。环境中的 NO_PROXY 同时生效。"
              >
                <Input
                  id="proxy-bypass"
                  className={styles.addressInput}
                  placeholder="localhost,127.0.0.1,::1,.internal.example.com"
                  value={draft.proxyBypass}
                  disabled={busy || unavailable}
                  onChange={(event) => setDraft((current) => ({ ...current, proxyBypass: event.target.value }))}
                />
              </FormField>

              <div className={styles.configActions}>
                <span className={styles.saveFeedback} role="status">
                  {loading ? '正在读取配置' : loadError ? loadError : dirty ? '有未保存的修改' : saveFeedback}
                </span>
                <div className={styles.actionButtons}>
                  <Button type="button" variant="ghost" onClick={() => void load()} disabled={busy}>
                    {loading && <Spinner size="sm" aria-hidden="true" />}重新读取
                  </Button>
                  <Button type="submit" disabled={busy || unavailable || !dirty}>
                    {saving && <Spinner size="sm" aria-hidden="true" />}
                    {saving ? '保存中' : '保存配置'}
                  </Button>
                </div>
              </div>
            </form>
          </section>

          <section className={styles.testSection} aria-labelledby="proxy-test-title">
            <PanelHeading
              className={styles.sectionHeading}
              title="路由与连通性"
              titleId="proxy-test-title"
              description="确认请求走向，再检查代理是否可用。"
            />
            <div className={styles.testBody}>
              <FormField label="测试目标网址" htmlFor="proxy-test-url">
                <Input
                  id="proxy-test-url"
                  className={styles.addressInput}
                  type="url"
                  placeholder="https://czbooks.net"
                  value={targetUrl}
                  disabled={busy || unavailable}
                  onChange={(event) => {
                    setTargetUrl(event.target.value)
                    setRouteResult(null)
                    setTestResult(null)
                  }}
                />
              </FormField>

              <div className={styles.diagnostics}>
                <div className={styles.diagnosticRow}>
                  <div>
                    <span className={styles.diagnosticLabel}>请求路由</span>
                    <p id="proxy-route-hint">按生效配置判断，包含跳过规则。</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    aria-describedby="proxy-route-hint"
                    onClick={() => void checkRoute()}
                    disabled={busy || unavailable}
                  >
                    {routeChecking && <Spinner size="sm" aria-hidden="true" />}
                    {routeChecking ? '检查中' : '检查路由'}
                  </Button>
                </div>
                <div className={styles.diagnosticRow}>
                  <div>
                    <span className={styles.diagnosticLabel}>代理连接</span>
                    <p id="proxy-connection-hint">强制使用代理，不受跳过规则影响。{!unavailable && !enabled && '启用代理后可测试。'}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    aria-describedby="proxy-connection-hint"
                    onClick={() => void test()}
                    disabled={busy || unavailable || !enabled}
                  >
                    {testing && <Spinner size="sm" aria-hidden="true" />}
                    {testing ? '测试中' : '测试代理连接'}
                  </Button>
                </div>
              </div>

              {dirty && <p className={styles.draftWarning}>配置尚未保存，检查仍使用上方“当前生效配置”。</p>}

              <div
                className={styles.results}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-busy={testing || routeChecking}
              >
                {(testing || routeChecking || (!routeResult && !testResult)) && (
                  <p className={styles.resultHint}>
                    {testing || routeChecking
                      ? <Spinner size="sm" aria-hidden="true" />
                      : <ArrowRight aria-hidden="true" />}
                    {unavailable
                      ? '读取配置后即可开始诊断。'
                      : routeChecking
                        ? '正在检查目标的请求路由…'
                        : testing
                          ? '正在通过代理请求目标网址…'
                          : '填写目标网址，选择上方操作开始检查。'}
                  </p>
                )}
                {routeResult && <ProxyResultRow label="请求路由" result={routeResult} />}
                {testResult && <ProxyResultRow label="代理连接" result={testResult} />}
              </div>
            </div>
          </section>
        </div>

        <details className={styles.help}>
          <summary>
            <ChevronRight aria-hidden="true" />
            代理协议与部署说明
          </summary>
          <div className={styles.helpContent}>
            <p>
              <strong>代理协议</strong>
              Clash / Mihomo mixed-port 通常填写 <code>http://</code>，目标网站为 HTTPS 也一样。
              这里的协议描述代理监听端口，只有该端口本身提供 TLS，才填写 <code>https://</code>。
            </p>
            <p>
              <strong>Docker 部署</strong>
              代理运行在宿主机上时，Docker Desktop 一般使用 <code>http://host.docker.internal:7890</code>，并确认代理允许来自容器的连接。
            </p>
            <p>
              <strong>跳过规则</strong>
              支持主机、域名、IP 或 host:port，以逗号分隔，例如 <code>localhost,127.0.0.1,::1,.internal.example.com</code>。
              环境中的 NO_PROXY 同时生效。
            </p>
            <p>
              <strong>排查失败</strong>
              代理端口可达不等于目标可访问。连接失败时结合出站请求记录检查 CONNECT、目标 TLS、超时和目标站点权限。
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}
