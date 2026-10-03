import { Hono } from 'hono'
import { optionalUser, requireUser, type AuthEnv } from '../middlewares/auth'
import { ADULT_ACCESS_TTL_SECONDS, clearAdultAccessCookie, contentPolicyHeaders, createAdultAccessToken, resolveContentAccess, restrictedContentResponse, setAccountContentMode, setAdultAccessCookie } from '../services/content-access'
import { getDb } from '../db/pool'
import { withTx } from '../db/query'
import { bearerToken, hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { effectiveTurnstile, verifyAdultChallenge } from '../services/turnstile'
import { clientIpFromContext } from '../services/ai/audit-context'
import { checkContentRate } from '../services/content-rate-limit'
import { getAdultContentEnabled } from '../services/content-policy'

export { ADULT_CONTENT_SETTING_KEY } from '../services/content-policy'
export { getAdultContentEnabled, setAdultContentEnabled } from '../services/content-policy'

export const contentPolicyRoutes = new Hono<AuthEnv>()

contentPolicyRoutes.get('/', async (c) => {
  const adultContentEnabled = await getAdultContentEnabled()
  const challenge = await effectiveTurnstile()
  return c.json({ adultContentEnabled, turnstileSiteKey: challenge.configured ? challenge.siteKey : '', turnstileConfigured: challenge.configured }, 200, contentPolicyHeaders())
})

/**
 * 登录读者确认成年并通过 Turnstile 后，授予该会话的短期访问权。
 * 人机验证不等于实际年龄验证。
 */
contentPolicyRoutes.post('/unlock', requireUser(), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body.confirmed !== true) return c.json({ error: '必须确认已年满 18 岁' }, 400)
  if (!(await getAdultContentEnabled())) {
    return c.json({ error: '站点当前未开放限制级内容', code: 'adult_content_disabled' }, 403, { 'Cache-Control': 'no-store' })
  }

  const limited = await checkContentRate(c, 'unlock')
  if (limited) return limited
  if (!(await effectiveTurnstile()).configured) return c.json({ error: '成人模式验证尚未配置，请联系管理员', code: 'turnstile_not_configured' }, 503, contentPolicyHeaders())
  if (!await verifyAdultChallenge(body.turnstileToken, clientIpFromContext(c))) {
    return c.json({ error: '人机验证失败或已过期，请重新验证', code: 'turnstile_failed' }, 403, contentPolicyHeaders())
  }
  const sessionHash = await hashToken(bearerToken(c.req.header('Authorization') || ''), loadConfig().sessionHashSalt)
  const until = Date.now() + ADULT_ACCESS_TTL_SECONDS * 1000
  const granted = await withTx(getDb(), async (query) => {
    // 与全站开关的事务共用行锁，关闭期间正在验证的请求不能留下新授权。
    await query("INSERT INTO app_settings(key,value,updated_at) VALUES ('adult_content_enabled','true',$1) ON CONFLICT(key) DO NOTHING", [Date.now()])
    const setting = await query<{ value: string }>("SELECT value FROM app_settings WHERE key='adult_content_enabled' FOR UPDATE")
    if (setting.rows[0]?.value === 'false') return 'site_disabled'
    const { rows } = await query<{ reader_settings: string }>("SELECT reader_settings FROM users WHERE id = $1 AND status = 'active' FOR UPDATE", [c.get('user').id])
    if (!rows[0]) return false
    const result = await query('UPDATE user_sessions SET adult_access_until = LEAST(expires_at, $1) WHERE token_hash = $2 AND user_id = $3 AND expires_at > $4 RETURNING token_hash', [until, sessionHash, c.get('user').id, Date.now()])
    if (!result.rows.length) return false
    await query('UPDATE users SET reader_settings = $1 WHERE id = $2', [setAccountContentMode(rows[0].reader_settings, 'adult'), c.get('user').id])
    return true
  })
  if (granted === 'site_disabled') return restrictedContentResponse(c, 'site_disabled')
  if (!granted) return c.json({ error: '登录已失效，请重新登录', code: 'login_required' }, 401, contentPolicyHeaders())
  const token = createAdultAccessToken(sessionHash, until)
  setAdultAccessCookie(c, token)
  return c.json({ adultContentEnabled: true, expiresIn: ADULT_ACCESS_TTL_SECONDS }, 200, contentPolicyHeaders())
})

contentPolicyRoutes.post('/refresh', requireUser(), async (c) => {
  const access = await resolveContentAccess(c)
  if (!access.canViewRestricted) return restrictedContentResponse(c, access.reason)
  return c.json({ ok: true }, 200, contentPolicyHeaders())
})

contentPolicyRoutes.post('/lock', optionalUser(), async (c) => {
  const user = c.get('user')
  if (user) await withTx(getDb(), async query => {
    const { rows } = await query<{ reader_settings: string }>('SELECT reader_settings FROM users WHERE id = $1 FOR UPDATE', [user.id])
    if (rows[0]) await query('UPDATE users SET reader_settings = $1 WHERE id = $2', [setAccountContentMode(rows[0].reader_settings, 'safe'), user.id])
    await query('UPDATE user_sessions SET adult_access_until = 0 WHERE user_id = $1', [user.id])
  })
  clearAdultAccessCookie(c)
  return c.json({ ok: true }, 200, contentPolicyHeaders())
})
