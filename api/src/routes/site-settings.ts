import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { DEFAULT_SITE_BRANDING } from '@shared/site-settings'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { run } from '../db/query'
import { BRANDING_KEY, TURNSTILE_KEY, encryptSiteSecret, getSiteBranding, readSetting, updateSiteSettings, validateBranding, writeSetting } from '../services/site-settings'
import { parseHostnames, publicTurnstileSettings, verifyAdultChallenge, type StoredTurnstile } from '../services/turnstile'
import { clientIpFromContext } from '../services/ai/audit-context'
import { checkContentRate } from '../services/content-rate-limit'

const MAX_IMAGE_BYTES = 1024 * 1024
const assetKey = (kind: string) => `site_asset_${kind}`
const validKind = (kind: string): kind is 'logo' | 'favicon' => kind === 'logo' || kind === 'favicon'
interface Asset { data: string; hash: string }

export const publicSiteSettingsRoutes = new Hono()
publicSiteSettingsRoutes.get('/', async c => c.json(await getSiteBranding(), 200, { 'Cache-Control': 'no-store' }))
publicSiteSettingsRoutes.get('/assets/:kind', async c => {
  const kind = c.req.param('kind')
  if (!validKind(kind)) return c.notFound()
  const asset = await readSetting<Asset>(assetKey(kind))
  if (!asset) return c.notFound()
  const headers = { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: `"${asset.hash}"` }
  if (c.req.header('If-None-Match') === headers.ETag) return c.body(null, 304, headers)
  return c.body(new Uint8Array(Buffer.from(asset.data, 'base64')), 200, headers)
})

export const adminSiteSettingsRoutes = new Hono<AuthEnv>()
adminSiteSettingsRoutes.use('*', requireAdmin())
adminSiteSettingsRoutes.use('*', bodyLimit({ maxSize: MAX_IMAGE_BYTES + 65536, onError: c => c.json({ error: '请求过大，图片不能超过 1MB' }, 413) }))
adminSiteSettingsRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
adminSiteSettingsRoutes.get('/branding', async c => c.json(await getSiteBranding()))
adminSiteSettingsRoutes.put('/branding', async c => {
  const body = await c.req.json().catch(() => null)
  let text
  try { text = validateBranding(body || {}) } catch (error) { return c.json({ error: (error as Error).message }, 400) }
  const branding = await updateSiteSettings(async db => {
    const next = { ...await getSiteBranding(db), ...text }
    await writeSetting(BRANDING_KEY, next, db)
    return next
  })
  return c.json(branding)
})
adminSiteSettingsRoutes.put('/assets/:kind', async c => {
  const kind = c.req.param('kind')
  if (!validKind(kind)) return c.notFound()
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('image')
  if (!file || typeof file === 'string') return c.json({ error: '请选择图片文件' }, 400)
  if (!file.size || file.size > MAX_IMAGE_BYTES) return c.json({ error: '图片不能超过 1MB' }, 400)
  let data: Buffer
  try {
    const input = Buffer.from(await file.arrayBuffer())
    // Reject SVG/HTML before decoding, regardless of client-supplied extension/MIME.
    const png = input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    const webp = input.subarray(0, 4).toString() === 'RIFF' && input.subarray(8, 12).toString() === 'WEBP'
    if (!png && !webp) throw new Error('unsupported')
    const image = sharp(input, { limitInputPixels: 4096 * 4096, failOn: 'warning' })
    const meta = await image.metadata()
    if (!['png', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1 || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) throw new Error('unsupported')
    data = await image.rotate().resize(kind === 'favicon' ? 128 : 512, kind === 'favicon' ? 128 : 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    if (data.length > MAX_IMAGE_BYTES) throw new Error('large')
  } catch { return c.json({ error: '请选择有效的静态 PNG 或 WebP 图片，尺寸不超过 4096×4096' }, 400) }
  const hash = createHash('sha256').update(data).digest('hex')
  const branding = await updateSiteSettings(async db => {
    await writeSetting(assetKey(kind), { data: data.toString('base64'), hash }, db)
    const next = { ...await getSiteBranding(db), [`${kind}Url`]: `/api/site-settings/assets/${kind}?v=${hash.slice(0, 16)}` }
    await writeSetting(BRANDING_KEY, next, db)
    return next
  })
  return c.json(branding)
})
adminSiteSettingsRoutes.delete('/assets/:kind', async c => {
  const kind = c.req.param('kind')
  if (!validKind(kind)) return c.notFound()
  const branding = await updateSiteSettings(async db => {
    await run(db, 'DELETE FROM app_settings WHERE key = $1', [assetKey(kind)])
    const key = `${kind}Url` as 'logoUrl' | 'faviconUrl'
    const next = { ...await getSiteBranding(db), [key]: DEFAULT_SITE_BRANDING[key] }
    await writeSetting(BRANDING_KEY, next, db)
    return next
  })
  return c.json(branding)
})
adminSiteSettingsRoutes.get('/turnstile', async c => c.json(await publicTurnstileSettings()))
adminSiteSettingsRoutes.put('/turnstile', async c => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.siteKey !== 'string' || body.siteKey.trim().length > 200 || (body.siteKey && !/^[a-zA-Z0-9_-]+$/.test(body.siteKey.trim()))) return c.json({ error: 'Site Key 格式无效' }, 400)
  let hostnames: string[], encrypted: string | undefined
  try {
    hostnames = parseHostnames(body.hostnames)
    if (body.secretKey !== undefined && (typeof body.secretKey !== 'string' || body.secretKey.trim().length > 200 || (body.secretKey && !/^[a-zA-Z0-9_-]+$/.test(body.secretKey.trim())))) throw new Error('Secret Key 格式无效')
    if (body.clearSecret !== undefined && typeof body.clearSecret !== 'boolean') throw new Error('清除密钥选项无效')
    if (body.clearSecret && body.secretKey?.trim()) throw new Error('不能同时清除并替换密钥')
    if (body.secretKey?.trim()) encrypted = encryptSiteSecret(body.secretKey.trim())
    for (const [field, env] of [['siteKey', 'TURNSTILE_SITE_KEY'], ['secretKey', 'TURNSTILE_SECRET_KEY'], ['hostnames', 'TURNSTILE_HOSTNAMES']] as const) {
      if (!process.env[env]?.trim()) continue
      const current = await publicTurnstileSettings()
      if ((field === 'siteKey' && body.siteKey.trim() !== current.siteKey) ||
        (field === 'secretKey' && (encrypted || body.clearSecret)) ||
        (field === 'hostnames' && JSON.stringify(hostnames) !== JSON.stringify(current.hostnames))) throw new Error('此字段由环境变量管理，请在部署配置中修改')
    }
  } catch (error) { return c.json({ error: (error as Error).message }, 400) }
  await updateSiteSettings(async db => {
    const previous = await readSetting<StoredTurnstile>(TURNSTILE_KEY, db)
    await writeSetting(TURNSTILE_KEY, { siteKey: body.siteKey.trim(), hostnames, secret: body.clearSecret ? '' : encrypted ?? previous?.secret ?? '' }, db)
  })
  return c.json(await publicTurnstileSettings())
})
adminSiteSettingsRoutes.post('/turnstile/test', async c => {
  const limited = await checkContentRate(c, 'unlock')
  if (limited) return limited
  const body = await c.req.json().catch(() => ({}))
  const ok = await verifyAdultChallenge(body.token, clientIpFromContext(c))
  return c.json({ ok, message: ok ? '小组件与服务端验证通过；此测试不会授予成人内容访问权。' : '验证失败，请检查密钥、域名或重新完成验证。' }, ok ? 200 : 400)
})
