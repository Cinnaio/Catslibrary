import '@/styles/input-fields.css'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import type { PasskeyAdminSettings, SiteBranding, TurnstileSettings } from '@shared/site-settings'
import { siteSettingsApi } from '@/lib/api'
import { brandingAssetUrl, setSiteBranding } from '@/lib/site-branding'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useConfirm, useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import FormField from '@/components/shared/FormField'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState, InlineError, LoadingState } from '@/components/shared/AsyncStates'
import TurnstileTestWidget from '@/components/TurnstileTestWidget'
import ContentPolicyTab from './ContentPolicyTab'
import SiteSettingsNavigation from './SiteSettingsNavigation'
import { getSiteSettingsView, type SiteSettingsView } from './site-settings-views'
import styles from './site-settings.module.css'

const AiSettingsWorkspace = lazy(() => import('./ai/AiSettingsWorkspace'))
type LocalView = 'branding' | 'security' | 'passkey'
const meta: Record<SiteSettingsView, { title: string; description: string }> = {
  branding: { title: '站点信息', description: '统一主站的名称、介绍、浏览器标题与品牌图片。' },
  'content-policy': { title: '内容安全', description: '设置全站限制级内容的访问入口与解锁条件。' },
  security: { title: '安全验证', description: '配置成人内容解锁验证，并独立测试已保存的配置。' },
  passkey: { title: 'Passkey', description: '管理通行密钥登录、凭据添加与部署身份配置。' },
  config: { title: '模型与服务', description: '连接文本与图像服务，管理模型和读者生成策略。' },
  params: { title: '创作参数', description: '调整摘要、回顾、创作和生图的生成参数。' },
}
const sourceLabel = { environment: '环境变量', database: '后台配置', default: '未设置 / 默认' } as const
const initialLoads = { branding: { loading: true, error: '' }, security: { loading: true, error: '' }, passkey: { loading: true, error: '' } }

function announceBranding(value: SiteBranding) {
  setSiteBranding(value)
  try { localStorage.setItem('site-branding-updated', String(Date.now())) } catch { /* usable without localStorage */ }
}

export default function SiteSettingsTab() {
  const location = useLocation()
  const view = getSiteSettingsView(location.pathname, location.search, localStorage.getItem('ai_active_subtab')) || 'branding'
  const localView = view === 'branding' || view === 'security' || view === 'passkey' ? view : null
  const aiView = view === 'config' || view === 'params' ? view : null
  const [aiVisited, setAiVisited] = useState(Boolean(aiView))
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { refreshPolicy } = useContentPolicy()
  const [branding, setBranding] = useState<SiteBranding | null>(null)
  const [savedBranding, setSavedBranding] = useState<SiteBranding | null>(null)
  const [challenge, setChallenge] = useState<TurnstileSettings | null>(null)
  const [siteKey, setSiteKey] = useState('')
  const [hostnames, setHostnames] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  const [passkey, setPasskey] = useState<PasskeyAdminSettings | null>(null)
  const [savedPasskey, setSavedPasskey] = useState<PasskeyAdminSettings | null>(null)
  const [loads, setLoads] = useState(initialLoads)
  const [saveErrors, setSaveErrors] = useState({ branding: '', security: '', passkey: '' })
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testToken, setTestToken] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [testPassed, setTestPassed] = useState<boolean | null>(null)
  const [widgetRound, setWidgetRound] = useState(0)
  const requested = useRef(new Set<LocalView>())
  const revision = useRef({ branding: 0, security: 0, passkey: 0 })
  const mounted = useRef(true)
  const operation = useRef(false)
  const loading = localView ? loads[localView].loading : false
  const loadError = localView ? loads[localView].error : ''
  const saveError = localView ? saveErrors[localView] : ''
  const brandDirty = Boolean(branding && JSON.stringify(branding) !== JSON.stringify(savedBranding))
  const hosts = hostnames.split(/[\n,]/).map(value => value.trim().toLowerCase()).filter(Boolean)
  const securityDirty = Boolean(challenge && (siteKey.trim() !== challenge.siteKey || JSON.stringify(hosts) !== JSON.stringify(challenge.hostnames) || secretKey.trim() || clearSecret))
  const passkeyDirty = Boolean(passkey && savedPasskey && JSON.stringify(passkey) !== JSON.stringify(savedPasskey))
  const dirty = view === 'security' ? securityDirty : view === 'passkey' ? passkeyDirty : brandDirty
  const hasData = view === 'branding' ? Boolean(branding) : view === 'security' ? Boolean(challenge) : Boolean(passkey)

  const invalidateTest = useCallback(() => {
    setTesting(false); setTestToken(''); setTestMessage(''); setTestPassed(null)
  }, [])
  const acceptChallenge = useCallback((value: TurnstileSettings) => {
    setChallenge(value); setSiteKey(value.siteKey); setHostnames(value.hostnames.join('\n')); setSecretKey(''); setClearSecret(false)
    invalidateTest()
  }, [invalidateTest])
  const load = useCallback(async (target: LocalView) => {
    const request = ++revision.current[target]
    setLoads(previous => ({ ...previous, [target]: { loading: true, error: '' } }))
    try {
      if (target === 'branding') {
        const value = await siteSettingsApi.branding()
        if (request !== revision.current[target]) return
        setBranding(value); setSavedBranding(value)
      } else if (target === 'security') {
        const value = await siteSettingsApi.turnstile()
        if (request !== revision.current[target]) return
        acceptChallenge(value)
      } else {
        const value = await siteSettingsApi.passkey()
        if (request !== revision.current[target]) return
        setPasskey(value); setSavedPasskey(value)
      }
    } catch (error) {
      if (request === revision.current[target]) setLoads(previous => ({ ...previous, [target]: { loading: false, error: error instanceof Error ? error.message : '设置读取失败' } }))
    } finally {
      if (request === revision.current[target]) setLoads(previous => ({ ...previous, [target]: { ...previous[target], loading: false } }))
    }
  }, [acceptChallenge])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requested.current.clear()
      for (const target of ['branding', 'security', 'passkey'] as const) revision.current[target]++
    }
  }, [])
  useEffect(() => {
    if (localView && !requested.current.has(localView)) {
      requested.current.add(localView)
      void load(localView)
    }
    if (aiView) {
      setAiVisited(true)
      localStorage.setItem('ai_active_subtab', aiView)
    }
    if (view !== 'security') { setTesting(false); setTestToken('') }
  }, [view, localView, aiView, load])

  function beginOperation(target: LocalView) {
    if (operation.current || loading) return false
    operation.current = true
    setBusy(true)
    setSaveErrors(previous => ({ ...previous, [target]: '' }))
    return true
  }
  function endOperation() {
    operation.current = false
    if (mounted.current) setBusy(false)
  }
  function reportError(target: LocalView, error: unknown) {
    if (mounted.current) setSaveErrors(previous => ({ ...previous, [target]: error instanceof Error ? error.message : '操作失败，请重试' }))
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!localView || !dirty || !beginOperation(localView)) return
    const target = localView
    try {
      if (target === 'security' && challenge) {
        const value = await siteSettingsApi.saveTurnstile({ siteKey: siteKey.trim(), hostnames: hosts, ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}), clearSecret })
        if (!mounted.current) return
        acceptChallenge(value)
        try { await refreshPolicy() } catch { reportError(target, new Error('配置已保存，阅读模式同步失败，请刷新页面重试。')) }
      } else if (target === 'passkey' && passkey) {
        const value = await siteSettingsApi.savePasskey({ enabled: passkey.enabled, registrationEnabled: passkey.registrationEnabled, rpName: passkey.rpName })
        if (!mounted.current) return
        setPasskey(value); setSavedPasskey(value)
      } else if (target === 'branding' && branding) {
        const value = await siteSettingsApi.saveBranding(branding)
        if (!mounted.current) return
        setBranding(value); setSavedBranding(value); announceBranding(value)
      }
      toast('设置已保存', 'success')
    } catch (error) { reportError(target, error) } finally { endOperation() }
  }
  async function asset(kind: 'logo' | 'favicon', file?: File) {
    if (operation.current || loading) return
    if (!file && !await confirm({ title: '恢复默认图片', message: `将${kind === 'logo' ? 'Logo' : '浏览器图标'}恢复为默认图片。`, okText: '恢复默认' })) return
    if (file && (file.size > 1024 * 1024 || !['image/png', 'image/webp'].includes(file.type))) { reportError('branding', new Error('请选择不超过 1MB 的 PNG 或 WebP 图片')); return }
    if (!beginOperation('branding')) return
    try {
      const value = file ? await siteSettingsApi.upload(kind, file) : await siteSettingsApi.resetAsset(kind)
      if (!mounted.current) return
      setBranding(previous => previous ? { ...previous, logoUrl: value.logoUrl, faviconUrl: value.faviconUrl } : value)
      setSavedBranding(value); announceBranding(value)
      toast(file ? '图片已更新并生效' : '已恢复默认图片', 'success')
    } catch (error) { reportError('branding', error) } finally { endOperation() }
  }
  async function test() {
    if (!testToken || securityDirty || !beginOperation('security')) return
    setTestMessage(''); setTestPassed(null)
    try {
      const result = await siteSettingsApi.testTurnstile(testToken)
      if (mounted.current) { setTestMessage(result.message); setTestPassed(result.ok) }
    } catch (error) {
      if (mounted.current) { setTestMessage(error instanceof Error ? error.message : '验证失败'); setTestPassed(false) }
    } finally {
      if (mounted.current) { setTestToken(''); setWidgetRound(value => value + 1) }
      endOperation()
    }
  }
  const widgetError = useCallback((message: string) => { setTestMessage(message); setTestPassed(false); setTestToken('') }, [])

  return <AdminPage {...meta[view]} className="admin-redesign-page--site-settings">
    <SiteSettingsNavigation view={view} disabled={busy || aiBusy} />
    {view === 'content-policy' && <ContentPolicyTab />}
    {localView && <>
      {!hasData && (loadError
        ? <ErrorState message={`${meta[view].title}读取失败：${loadError}`} onRetry={() => void load(localView)} />
        : <LoadingState label={`正在读取${meta[view].title}…`} rows={4} />)}
      {hasData && <form onSubmit={event => void save(event)} className={styles.layout}>
        <Card>
          <CardHeader><CardTitle>{view === 'security' ? 'Turnstile 配置' : view === 'passkey' ? 'Passkey 登录配置' : '品牌与标题'}</CardTitle></CardHeader>
          <CardContent className={styles.fields}>
            {view === 'security' && challenge ? <>
              <p className={styles.hint} role="status">{challenge.configured ? '已保存配置齐全，实际可用性请通过右侧验证测试确认。' : '已保存配置尚未齐全，成人内容解锁验证暂不可用。'}</p>
              <FormField label="Site Key" hint={`来源：${sourceLabel[challenge.sources.siteKey]}`}>{({ id }) => <Input id={id} value={siteKey} maxLength={200} disabled={busy || challenge.sources.siteKey === 'environment'} onChange={event => { setSiteKey(event.target.value); invalidateTest() }} autoComplete="off" />}</FormField>
              <FormField label="Secret Key" hint={`来源：${sourceLabel[challenge.sources.secret]}。${challenge.secretSet ? '已设置，留空保留原密钥。' : '尚未设置。'}保存后不会回显原值。`}>{({ id }) => <Input id={id} type="password" value={secretKey} maxLength={200} disabled={busy || clearSecret || !challenge.encryptionReady || challenge.sources.secret === 'environment'} onChange={event => { setSecretKey(event.target.value); invalidateTest() }} autoComplete="new-password" placeholder={challenge.secretSet ? '已设置 · 输入新密钥以替换' : '输入私钥'} />}</FormField>
              {challenge.secretSet && challenge.sources.secret !== 'environment' && <label className={styles.check} htmlFor="clear-turnstile-secret"><Checkbox id="clear-turnstile-secret" checked={clearSecret} disabled={busy} onCheckedChange={value => { setClearSecret(value === true); setSecretKey(''); invalidateTest() }} />保存时清除后台密钥（成人验证将不可用）</label>}
              {!challenge.encryptionReady && <p className={styles.hint}>后台私钥存储需要部署端配置 SITE_SETTINGS_ENCRYPTION_KEY。现有环境变量密钥仍可正常使用。</p>}
              {challenge.secretSet && !challenge.secretReadable && <InlineError message="已存密钥无法解密，请恢复原加密主密钥，或配置主密钥后替换私钥。" />}
              <FormField label="允许验证的域名" hint={`来源：${sourceLabel[challenge.sources.hostnames]}。每行一个纯域名；同时在 Cloudflare 控制台配置对应域名。`}>{({ id }) => <Textarea id={id} rows={4} value={hostnames} disabled={busy || challenge.sources.hostnames === 'environment'} onChange={event => { setHostnames(event.target.value); invalidateTest() }} placeholder="read.example.com" />}</FormField>
            </> : view === 'passkey' && passkey && savedPasskey ? <>
              <p className={styles.hint} role="status">已保存状态：{savedPasskey.enabled ? savedPasskey.configured ? '已开启 Passkey 登录。' : '已开启，但部署环境尚未完成 RP 配置。' : 'Passkey 登录当前关闭。'}</p>
              <label className={styles.switchRow} htmlFor="passkey-login-enabled"><span><span className={styles.label}>启用 Passkey 登录</span><span className={styles.hint}>保存后控制登录页是否提供通行密钥入口。</span></span><Switch id="passkey-login-enabled" checked={passkey.enabled} disabled={busy} onCheckedChange={value => setPasskey({ ...passkey, enabled: value })} /></label>
              <label className={styles.switchRow} htmlFor="passkey-registration-enabled"><span><span className={styles.label}>允许添加新的 Passkey</span><span className={styles.hint}>允许已登录用户添加通行密钥凭据，与新用户注册无关。</span></span><Switch id="passkey-registration-enabled" checked={passkey.registrationEnabled} disabled={busy} onCheckedChange={value => setPasskey({ ...passkey, registrationEnabled: value })} /></label>
              <FormField label="Passkey 显示名称" hint="会显示在浏览器或系统的凭据选择器中，最多 64 个字符。">{({ id }) => <Input id={id} value={passkey.rpName} maxLength={64} disabled={busy} onChange={event => setPasskey({ ...passkey, rpName: event.target.value })} />}</FormField>
              <p className={styles.hint}>RP ID 与允许来源由部署环境决定，后台仅供查看。</p>
            </> : branding && <>
              {([['name', '站点名称', 32], ['tagline', '站点简介', 100], ['homeTitle', '首页浏览器标题', 100]] as const).map(([key, label, limit]) => <FormField key={key} label={label}>{({ id }) => <Input id={id} required value={branding[key]} maxLength={limit} disabled={busy} onChange={event => setBranding({ ...branding, [key]: event.target.value })} />}</FormField>)}
              <FormField label="SEO 描述" hint="用于页面描述，最多 300 个字符。">{({ id }) => <Textarea id={id} required rows={3} value={branding.description} maxLength={300} disabled={busy} onChange={event => setBranding({ ...branding, description: event.target.value })} />}</FormField>
              <div className={styles.assets}>{(['logo', 'favicon'] as const).map(kind => <div key={kind} className={styles.asset}>
                <img src={brandingAssetUrl(branding[`${kind}Url`])} width={48} height={48} alt={`${kind === 'logo' ? 'Logo' : '浏览器图标'}预览`} />
                <FormField label={kind === 'logo' ? 'Logo' : '浏览器图标 Favicon'} hint="PNG / WebP，最大 1MB；上传后立即生效。">{({ id }) => <Input id={id} type="file" accept="image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void asset(kind, file) }} />}</FormField>
                <Button type="button" variant="ghost" disabled={busy || branding[`${kind}Url`] === '/images/logo.png'} onClick={() => void asset(kind)}>恢复默认</Button>
              </div>)}</div>
            </>}
            {saveError && <InlineError message={saveError} />}
            <div className={styles.save}><span role="status">{dirty ? '有未保存的修改，切换设置页会保留草稿' : '已与当前配置同步'}</span><Button type="submit" disabled={busy || loading || !dirty}>{busy ? '处理中…' : '保存设置'}</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{view === 'security' ? '验证测试' : view === 'passkey' ? '运行时诊断' : '品牌预览'}</CardTitle></CardHeader>
          <CardContent className={styles.fields}>
            {view === 'security' && challenge ? <>
              <p className={styles.hint}>测试使用已保存配置，不会授予成人内容访问权，也不会改变内容安全策略。</p>
              <p className={styles.hint} role="status">{testPassed === true ? '最近一次服务端验证已通过。' : testPassed === false ? '最近一次验证失败，请检查配置或重新测试。' : '尚未完成验证测试。'}</p>
              <Button type="button" variant="secondary" disabled={busy || securityDirty || !challenge.configured} onClick={() => { setTesting(true); setTestToken(''); setTestMessage(''); setTestPassed(null); setWidgetRound(value => value + 1) }}>开始 / 重新验证</Button>
              {securityDirty && <p className={styles.hint}>请先保存修改，再测试新配置。</p>}
              {testing && <TurnstileTestWidget key={widgetRound} siteKey={challenge.siteKey} onToken={setTestToken} onError={widgetError} />}
              {testing && <Button type="button" disabled={!testToken || busy || securityDirty} onClick={() => void test()}>{busy ? '验证中…' : '检查服务端验证'}</Button>}
              {testMessage && <p role={testPassed === false ? 'alert' : 'status'} className={styles.hint}>{testMessage}</p>}
            </> : view === 'passkey' && passkey ? <>
              <dl className={styles.diagnostics}>
                <div><dt>RP ID</dt><dd><code>{passkey.rpId || '未配置'}</code><span className={styles.hint}>来源：{sourceLabel[passkey.sources.rpId]}</span></dd></div>
                <div><dt>允许来源</dt><dd><code>{passkey.origins.length ? passkey.origins.join('\n') : '未配置'}</code><span className={styles.hint}>来源：{sourceLabel[passkey.sources.origins]}</span></dd></div>
                <div><dt>用户验证</dt><dd>必须验证<span className={styles.hint}>添加凭据与登录均要求设备验证</span></dd></div>
              </dl>
            </> : branding && <>
              <p className={styles.hint}>文字为当前草稿预览，保存后生效；上传的品牌图片立即生效。</p>
              <div className={styles.brandPreview}><img src={brandingAssetUrl(branding.logoUrl)} alt="" width={40} height={40} /><span><strong>{branding.name}</strong><span className={styles.hint}>{branding.tagline}</span></span></div>
              <div className={styles.loginPreview}><img src={brandingAssetUrl(branding.logoUrl)} alt="" width={28} height={28} /><span>{branding.name}</span><p>欢迎回来</p><span className={styles.hint}>登录后继续你的阅读与创作</span></div>
              <div className={styles.browserPreview}><img src={brandingAssetUrl(branding.faviconUrl)} alt="" width={20} height={20} /><span>{branding.homeTitle}</span></div>
              <p className={styles.hint}>小说和章节的浏览器标题仍以作品为主，站点名称作为后缀。</p>
            </>}
          </CardContent>
        </Card>
      </form>}
    </>}
    {aiVisited && <Suspense fallback={<LoadingState label="正在打开 AI 设置…" />}><AiSettingsWorkspace view={aiView} group={new URLSearchParams(location.search).get('group')} onBusyChange={setAiBusy} /></Suspense>}
  </AdminPage>
}
