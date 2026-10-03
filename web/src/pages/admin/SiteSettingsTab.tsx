import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { SiteBranding, TurnstileSettings } from '@shared/site-settings'
import { siteSettingsApi } from '@/lib/api'
import { brandingAssetUrl, setSiteBranding } from '@/lib/site-branding'
import { useContentPolicy } from '@/context/ContentPolicyContext'
import { useConfirm, useToast } from '@/components/feedback'
import AdminPage from '@/components/admin/AdminPage'
import AdminFormField from '@/components/admin/AdminFormField'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import TurnstileTestWidget from '@/components/TurnstileTestWidget'
import '@/styles/admin/pages/site-settings.css'

function announceBranding(value: SiteBranding) {
  setSiteBranding(value)
  try { localStorage.setItem('site-branding-updated', String(Date.now())) } catch { /* usable without localStorage */ }
}
const sourceLabel = { environment: '环境变量', database: '后台配置', default: '未设置 / 默认' }

export default function SiteSettingsTab() {
  const [params] = useSearchParams()
  const security = params.get('view') === 'security'
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

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void Promise.all([siteSettingsApi.branding(), siteSettingsApi.turnstile()]).then(([brand, settings]) => {
      if (!active) return
      setBranding(brand); setSavedBranding(brand); setChallenge(settings)
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
        acceptChallenge(await siteSettingsApi.saveTurnstile({ siteKey: siteKey.trim(), hostnames: hosts, ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}), clearSecret }))
        await refreshPolicy()
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

  return <AdminPage title={security ? '安全验证' : '站点信息'} description={security ? '配置 Cloudflare Turnstile，当前用于开启 R18 成人内容模式。' : '统一主站的名称、介绍、浏览器标题与品牌图片。'} className="admin-redesign-page--site-settings site-settings">
    {loading && <p role="status">正在读取站点设置…</p>}
    {error && <div role="alert" className="site-settings__error"><p>{error}</p>{!branding && <Button variant="secondary" onClick={() => setReload(v => v + 1)}>重新加载</Button>}</div>}
    {!loading && branding && challenge && <form onSubmit={event => void save(event)} className="site-settings__layout">
      <Card className="admin-panel-card">
        <CardHeader><CardTitle>{security ? 'Turnstile 配置' : '品牌与标题'}</CardTitle></CardHeader>
        <CardContent className="site-settings__fields">
          {security ? <>
            <p className="site-settings__status" role="status">{challenge.configured ? '已配置，可用于成人模式验证' : '尚未就绪，成人模式验证不会放行'}</p>
            <AdminFormField label="Site Key" hint={`来源：${sourceLabel[challenge.sources.siteKey]}`}>{({ id }) => <Input id={id} value={siteKey} maxLength={200} disabled={busy || challenge.sources.siteKey === 'environment'} onChange={e => { setSiteKey(e.target.value); setTesting(false); setTestToken('') }} autoComplete="off" />}</AdminFormField>
            <AdminFormField label="Secret Key" hint={`来源：${sourceLabel[challenge.sources.secret]}。${challenge.secretSet ? '已设置，留空保留原密钥。' : '尚未设置。'}保存后不会回显原值。`}>{({ id }) => <Input id={id} type="password" value={secretKey} maxLength={200} disabled={busy || clearSecret || !challenge.encryptionReady || challenge.sources.secret === 'environment'} onChange={e => { setSecretKey(e.target.value); setTesting(false); setTestToken('') }} autoComplete="new-password" placeholder={challenge.secretSet ? '已设置 · 输入新密钥以替换' : '输入私钥'} />}</AdminFormField>
            {challenge.secretSet && challenge.sources.secret !== 'environment' && <label className="site-settings__check"><input type="checkbox" checked={clearSecret} disabled={busy} onChange={e => { setClearSecret(e.target.checked); setSecretKey(''); setTesting(false); setTestToken('') }} />保存时清除后台密钥（成人验证将不可用）</label>}
            {!challenge.encryptionReady && <p className="site-settings__hint">后台私钥存储需要部署端配置 SITE_SETTINGS_ENCRYPTION_KEY。现有环境变量密钥仍可正常使用。</p>}
            {challenge.secretSet && !challenge.secretReadable && <p role="alert">已存密钥无法解密，请恢复原加密主密钥，或配置主密钥后替换私钥。</p>}
            <AdminFormField label="允许验证的域名" hint={`来源：${sourceLabel[challenge.sources.hostnames]}。每行一个纯域名；同时在 Cloudflare 控制台配置对应域名。`}>{({ id }) => <Textarea id={id} rows={4} value={hostnames} disabled={busy || challenge.sources.hostnames === 'environment'} onChange={e => { setHostnames(e.target.value); setTesting(false); setTestToken('') }} placeholder="read.example.com" />}</AdminFormField>
          </> : <>
            {([['name', '站点名称', 32], ['tagline', '站点简介', 100], ['homeTitle', '首页浏览器标题', 100], ['description', 'SEO 描述', 300]] as const).map(([key, label, limit]) => <AdminFormField key={key} label={label}>{({ id }) => <Input id={id} required value={branding[key]} maxLength={limit} disabled={busy} onChange={e => setBranding({ ...branding, [key]: e.target.value })} />}</AdminFormField>)}
            <div className="site-settings__assets">{(['logo', 'favicon'] as const).map(kind => <div key={kind} className="site-settings__asset">
              <img src={brandingAssetUrl(branding[`${kind}Url`])} width={48} height={48} alt={`${kind === 'logo' ? 'Logo' : '浏览器图标'}预览`} />
              <AdminFormField label={kind === 'logo' ? 'Logo' : '浏览器图标 Favicon'} hint="PNG / WebP，最大 1MB；图片上传后立即生效。">{({ id }) => <Input id={id} type="file" accept="image/png,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void asset(kind, file) }} />}</AdminFormField>
              <Button type="button" variant="ghost" disabled={busy || branding[`${kind}Url`] === '/images/logo.png'} onClick={() => void asset(kind)}>恢复默认</Button>
            </div>)}</div>
          </>}
          <div className="site-settings__save"><span>{(security ? securityDirty : brandDirty) ? '有未保存的修改' : '已与当前配置同步'}</span><Button type="submit" disabled={busy || !(security ? securityDirty : brandDirty)}>{busy ? '处理中…' : '保存设置'}</Button></div>
        </CardContent>
      </Card>
      <Card className="admin-panel-card site-settings__preview">
        <CardHeader><CardTitle>{security ? '验证测试' : '品牌预览'}</CardTitle></CardHeader>
        <CardContent className="site-settings__fields">
          {security ? <>
            <p className="site-settings__hint">测试使用已保存配置，不会授予成人内容访问权，也不会改变内容安全策略。</p>
            <Button type="button" variant="secondary" disabled={busy || securityDirty || !challenge.configured} onClick={() => { setTesting(true); setTestToken(''); setTestMessage(''); setWidgetRound(v => v + 1) }}>开始 / 重新验证</Button>
            {securityDirty && <p className="site-settings__hint">请先保存修改，再测试新配置。</p>}
            {testing && <TurnstileTestWidget key={widgetRound} siteKey={challenge.siteKey} onToken={setTestToken} onError={setTestMessage} />}
            {testing && <Button type="button" disabled={!testToken || busy || securityDirty} onClick={() => void test()}>{busy ? '验证中…' : '检查服务端验证'}</Button>}
            {testMessage && <p role="status" className="site-settings__hint">{testMessage}</p>}
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
