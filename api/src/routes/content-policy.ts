import { Hono } from 'hono'
import type { AuthEnv } from '../middlewares/auth'
import { clearAdultAccessCookie, createAdultAccessToken, setAdultAccessCookie } from '../services/content-access'
import { getAdultContentEnabled, setAdultContentEnabled } from '../services/content-policy'

export { ADULT_CONTENT_SETTING_KEY } from '../services/content-policy'
export { getAdultContentEnabled, setAdultContentEnabled } from '../services/content-policy'

export const contentPolicyRoutes = new Hono<AuthEnv>()

contentPolicyRoutes.get('/', async (c) => {
  const adultContentEnabled = await getAdultContentEnabled()
  return c.json({ adultContentEnabled }, 200, { 'Cache-Control': 'no-store' })
})

/**
 * 读者在确认成年后申请本设备的短期访问凭证。
 * 这是现有“自我确认”语义的服务端配套，不声称完成真实年龄验证。
 */
contentPolicyRoutes.post('/unlock', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body.confirmed !== true) return c.json({ error: '必须确认已年满 18 岁' }, 400)
  if (!(await getAdultContentEnabled())) {
    return c.json({ error: '站点当前未开放限制级内容', code: 'adult_content_disabled' }, 403, { 'Cache-Control': 'no-store' })
  }

  const token = createAdultAccessToken()
  setAdultAccessCookie(c, token)
  return c.json({ adultContentEnabled: true, expiresIn: 24 * 60 * 60 }, 200, { 'Cache-Control': 'no-store' })
})

contentPolicyRoutes.post('/lock', (c) => {
  clearAdultAccessCookie(c)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})
