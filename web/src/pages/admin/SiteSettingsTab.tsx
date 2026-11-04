import '@/styles/input-fields.css'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { PasskeyAdminSettings, SiteBranding, TurnstileSettings } from '@shared/site-settings'
import { siteSettingsApi } from '@/lib/api'
import { brandingAssetUrl, setSiteBranding } from '@/lib/site-branding'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useConfirm, useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import FormField from "@/components/shared/FormField"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { LoadingState } from "@/components/shared/AsyncStates"
import TurnstileTestWidget from '@/components/TurnstileTestWidget'
import '@/styles/admin/pages/site-settings.css'

function announceBranding(value: SiteBranding) {
  setSiteBranding(value)
  try { localStorage.setItem('site-branding-updated', String(Date.now())) } catch { /* usable without localStorage */ }
}

const sourceLabel = { environment: '环境变量', database: '后台配置', default: '未设置 / 默认' } as const

export default function SiteSettingsTab() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedView = params.get('view')
  const view = requestedView === 'security' || requestedView === 'passkey' ? requestedView : 'branding'
  const security = view === 'security'
  const passkeyView = view === 'passkey'
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
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [testing, setTesting] = useState(false)
  const [testToken, setTestToken] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [widgetRound, setWidgetRound] = useState(0)
  const brandDirty = Boolean(branding && JSON.stringify(branding) !== JSON.stringify(savedBranding))
  const hosts = hostnames.split(/[\n,]/).map(v => v.trim().toLowerCase()).filter(Boolean)
  const securityDirty = Boolean(challenge && (siteKey.trim() !== challenge.siteKey || JSON.stringify(hosts) !== JSON.stringify(challenge.hostnames) || secretKey.trim() || clearSecret))
  const passkeyDirty = Boolean(passkey && savedPasskey && JSON.stringify(passkey) !== JSON.stringify(savedPasskey))
  const dirty = security ? securityDirty : passkeyView ? passkeyDirty : brandDirty

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void Promise.all([siteSettingsApi.branding(), siteSettingsApi.turnstile(), siteSettingsApi.passkey()]).then(([brand, settings, passkeySettings]) => {
      if (!active) return
      setBranding(brand); setSavedBranding(brand); setChallenge(settings); setPasskey(passkeySettings); setSavedPasskey(passkeySettings)
      setSiteKey(settings.siteKey); setHostnames(settings.hostnames.join('\n')); setSecretKey(''); setClearSecret(false)
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '设置加载失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  function acceptChallenge(value: TurnstileSettings) {
    setChallenge(value); setSiteKey(value.siteKey); setHostnames(value.hostnames.join('\n')); setSecretKey(''); setClearSecret(false)
    setTesting(false); setTestToken(''); setTestMessage('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || loading) return
    setBusy(true); setError('')
    try {
      if (security) {
        if (!challenge) return
        acceptChallenge(await siteSettingsApi.saveTurnstile({ siteKey: siteKey.trim(), hostnames: hosts, ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}), clearSecret }))
        await refreshPolicy()
      } else if (passkeyView && passkey) {
        const value = await siteSettingsApi.savePasskey({ enabled: passkey.enabled, registrationEnabled: passkey.registrationEnabled, rpName: passkey.rpName })
        setPasskey(value); setSavedPasskey(value)
      } else if (branding) {
        const value = await siteSettingsApi.saveBranding(branding)
        setBranding(value); setSavedBranding(value); announceBranding(value)
      }
      toast('设置已保存', 'success')
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }

  async function asset(kind: 'logo' | 'favicon', file?: File) {
    if (busy || loading) return
    if (!file && !await confirm({ title: '恢复默认图片', message: `将${kind === 'logo' ? 'Logo' : '浏览器图标'}恢复为默认图片。`, okText: '恢复默认' })) return
    if (file && (file.size > 1024 * 1024 || !['image/png', 'image/webp'].includes(file.type))) { setError('请选择不超过 1MB 的 PNG 或 WebP 图片'); return }
    setBusy(true); setError('')
    try {
      const value = file ? await siteSettingsApi.upload(kind, file) : await siteSettingsApi.resetAsset(kind)
      // Uploads apply immediately; preserve unrelated unsaved text fields in the draft.
      setBranding(previous => previous ? { ...previous, logoUrl: value.logoUrl, faviconUrl: value.faviconUrl } : value)
      setSavedBranding(value); announceBranding(value)
      toast(file ? '图片已更新并生效' : '已恢复默认图片', 'success')
    } catch (e) { setError(e instanceof Error ? e.message : '图片更新失败') } finally { setBusy(false) }
  }

  async function test() {
    if (!testToken || busy || securityDirty) return
    setBusy(true); setTestMessage('')
    try { const result = await siteSettingsApi.testTurnstile(testToken); setTestMessage(result.message) }
    catch (e) { setTestMessage(e instanceof Error ? e.message : '验证失败') }
    finally { setTestToken(''); setWidgetRound(v => v + 1); setBusy(false) }
  }

  const title = security ? '安全验证' : passkeyView ? 'Passkey' : '站点信息'
  const description = security
    ? '配置 Cloudflare Turnstile，当前用于开启 R18 成人内容模式。'
    : passkeyView
      ? '管理无密码登录的开关与用户注册入口；凭据验证边界由部署环境控制。'
      : '统一主站的名称、介绍、浏览器标题与品牌图片。'

  return <AdminPage title={title} description={description} className="admin-redesign-page admin-redesign-page--site-settings site-settings">
    <Tabs value={view} className="admin-capsule-tabs site-settings-tabs" onValueChange={val => navigate(`/admin/site-settings?view=${val}`)}>
      <TabsList aria-label="站点设置视图切换">
        <TabsTrigger value="branding">站点信息</TabsTrigger>
        <TabsTrigger value="security">安全验证</TabsTrigger>
        <TabsTrigger value="passkey">Passkey</TabsTrigger>
      </TabsList>
    </Tabs>
    {loading && <LoadingState label="正在读取站点设置…" rows={4} className="py-8" />}
    {error && <div role="alert" className="site-settings__error"><p>{error}</p>{!branding && <Button variant="secondary" onClick={() => setReload(v => v + 1)}>重新加载</Button>}</div>}
    {!loading && branding && challenge && passkey && <form onSubmit={event => void save(event)} className="site-settings__layout">
      <Card className="admin-panel-card">
        <CardHeader><CardTitle>{security ? 'Turnstile 配置' : passkeyView ? 'Passkey 登录配置' : '品牌与标题'}</CardTitle></CardHeader>
        <CardContent className="site-settings__fields">
          {security ? <>
            <p className="site-settings__status" role="status">{challenge.configured ? '已配置，可用于成人模式验证' : '尚未就绪，成人模式验证不会放行'}</p>
            <FormField label="Site Key" hint={`来源：${sourceLabel[challenge.sources.siteKey]}`}>{({ id }) => <Input id={id} value={siteKey} maxLength={200} disabled={busy || challenge.sources.siteKey === 'environment'} onChange={e => { setSiteKey(e.target.value); setTesting(false); setTestToken('') }} autoComplete="off" />}</FormField>
            <FormField label="Secret Key" hint={`来源：${sourceLabel[challenge.sources.secret]}。${challenge.secretSet ? '已设置，留空保留原密钥。' : '尚未设置。'}保存后不会回显原值。`}>{({ id }) => <Input id={id} type="password" value={secretKey} maxLength={200} disabled={busy || clearSecret || !challenge.encryptionReady || challenge.sources.secret === 'environment'} onChange={e => { setSecretKey(e.target.value); setTesting(false); setTestToken('') }} autoComplete="new-password" placeholder={challenge.secretSet ? '已设置 · 输入新密钥以替换' : '输入私钥'} />}</FormField>
            {challenge.secretSet && challenge.sources.secret !== 'environment' && <label className="site-settings__check"><input type="checkbox" checked={clearSecret} disabled={busy} onChange={e => { setClearSecret(e.target.checked); setSecretKey(''); setTesting(false); setTestToken('') }} />保存时清除后台密钥（成人验证将不可用）</label>}
            {!challenge.encryptionReady && <p className="site-settings__hint">后台私钥存储需要部署端配置 SITE_SETTINGS_ENCRYPTION_KEY。现有环境变量密钥仍可正常使用。</p>}
            {challenge.secretSet && !challenge.secretReadable && <p role="alert">已存密钥无法解密，请恢复原加密主密钥，或配置主密钥后替换私钥。</p>}
            <FormField label="允许验证的域名" hint={`来源：${sourceLabel[challenge.sources.hostnames]}。每行一个纯域名；同时在 Cloudflare 控制台配置对应域名。`}>{({ id }) => <Textarea id={id} rows={4} value={hostnames} disabled={busy || challenge.sources.hostnames === 'environment'} onChange={e => { setHostnames(e.target.value); setTesting(false); setTestToken('') }} placeholder="read.example.com" />}</FormField>
          </> : passkeyView ? <>
            <p className="site-settings__status" role="status">{passkey.enabled ? passkey.configured ? '已开启，登录页会提供 Passkey 登录。' : '已开启，但部署环境尚未完成 RP 配置。' : '当前关闭，用户不会看到 Passkey 登录入口。'}</p>
            <label className="site-settings__check"><input type="checkbox" checked={passkey.enabled} disabled={busy} onChange={e => setPasskey({ ...passkey, enabled: e.target.checked })} />启用 Passkey 登录</label>
            <label className="site-settings__check"><input type="checkbox" checked={passkey.registrationEnabled} disabled={busy} onChange={e => setPasskey({ ...passkey, registrationEnabled: e.target.checked })} />允许已登录用户注册新的 Passkey</label>
            <FormField label="Passkey 显示名称" hint="会显示在浏览器或系统的凭据选择器中，最多 64 个字符。">{({ id }) => <Input id={id} value={passkey.rpName} maxLength={64} disabled={busy} onChange={e => setPasskey({ ...passkey, rpName: e.target.value })} />}</FormField>
            <p className="site-settings__hint">凭据的 RP ID 与允许来源不能在后台改写，避免误配后把现有 Passkey 绑定到错误站点。</p>
          </> : <>
            {([['name', '站点名称', 32], ['tagline', '站点简介', 100], ['homeTitle', '首页浏览器标题', 100], ['description', 'SEO 描述', 300]] as const).map(([key, label, limit]) => <FormField key={key} label={label}>{({ id }) => <Input id={id} required value={branding[key]} maxLength={limit} disabled={busy} onChange={e => setBranding({ ...branding, [key]: e.target.value })} />}</FormField>)}
            <div className="site-settings__assets">{(['logo', 'favicon'] as const).map(kind => <div key={kind} className="site-settings__asset">
              <img src={brandingAssetUrl(branding[`${kind}Url`])} width={48} height={48} alt={`${kind === 'logo' ? 'Logo' : '浏览器图标'}预览`} />
              <FormField label={kind === 'logo' ? 'Logo' : '浏览器图标 Favicon'} hint="PNG / WebP，最大 1MB；图片上传后立即生效。">{({ id }) => <Input id={id} type="file" accept="image/png,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void asset(kind, file) }} />}</FormField>
              <Button type="button" variant="ghost" disabled={busy || branding[`${kind}Url`] === '/images/logo.png'} onClick={() => void asset(kind)}>恢复默认</Button>
            </div>)}</div>
          </>}
          <div className="site-settings__save"><span>{dirty ? '有未保存的修改' : '已与当前配置同步'}</span><Button type="submit" disabled={busy || !dirty}>{busy ? '处理中…' : '保存设置'}</Button></div>
        </CardContent>
      </Card>
      <Card className="admin-panel-card site-settings__preview">
        <CardHeader><CardTitle>{security ? '验证测试' : passkeyView ? '运行时诊断' : '品牌预览'}</CardTitle></CardHeader>
        <CardContent className="site-settings__fields">
          {security ? <>
            <p className="site-settings__hint">测试使用已保存配置，不会授予成人内容访问权，也不会改变内容安全策略。</p>
            <Button type="button" variant="secondary" disabled={busy || securityDirty || !challenge.configured} onClick={() => { setTesting(true); setTestToken(''); setTestMessage(''); setWidgetRound(v => v + 1) }}>开始 / 重新验证</Button>
            {securityDirty && <p className="site-settings__hint">请先保存修改，再测试新配置。</p>}
            {testing && <TurnstileTestWidget key={widgetRound} siteKey={challenge.siteKey} onToken={setTestToken} onError={setTestMessage} />}
            {testing && <Button type="button" disabled={!testToken || busy || securityDirty} onClick={() => void test()}>{busy ? '验证中…' : '检查服务端验证'}</Button>}
            {testMessage && <p role="status" className="site-settings__hint">{testMessage}</p>}
          </> : passkeyView ? <>
            <div className="site-settings__diagnostics">
              <div className="site-settings__diagnostic"><span>RP ID</span><code>{passkey.rpId || '未配置'}</code><small>来源：{sourceLabel[passkey.sources.rpId]}</small></div>
              <div className="site-settings__diagnostic"><span>允许来源</span><code>{passkey.origins.length ? passkey.origins.join('\n') : '未配置'}</code><small>来源：{sourceLabel[passkey.sources.origins]}</small></div>
              <div className="site-settings__diagnostic"><span>用户验证</span><strong>{passkey.userVerification === 'required' ? '必须验证' : '未设置'}</strong><small>注册与登录均要求设备验证</small></div>
            </div>
            <p className="site-settings__hint">本地开发请统一使用 <code>http://localhost:5173</code> 打开前端；如果改用 127.0.0.1，浏览器会将它视为不同的站点身份。</p>
          </> : <>
            <div className="site-settings__brand-preview"><img src={brandingAssetUrl(branding.logoUrl)} alt="" width={40} height={40} /><strong>{branding.name}</strong></div>
            <div className="site-settings__login-preview"><img src={brandingAssetUrl(branding.logoUrl)} alt="" width={28} height={28} /><span>{branding.name}</span><p>请登录后继续阅读</p></div>
            <p className="site-settings__footer-preview">{branding.name} · {branding.tagline}</p>
            <p className="site-settings__hint">顶栏、登录页与页脚预览；文字保存后生效。小说和章节标题继续以作品为主，站点名称为后缀。</p>
          </>}
        </CardContent>
      </Card>
    </form>}
  </AdminPage>
}
