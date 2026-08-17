import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { first } from '../db/query'

export const ADULT_CONTENT_SETTING_KEY = 'adult_content_enabled'

export async function getAdultContentEnabled(): Promise<boolean> {
  const row = await first<{ value: string }>(getDb(), 'SELECT value FROM app_settings WHERE key = $1', [ADULT_CONTENT_SETTING_KEY])
  // 保持既有站点行为：未设置时仍允许管理员开放成人内容模式。
  return row?.value !== 'false'
}

export async function setAdultContentEnabled(enabled: boolean): Promise<void> {
  await getDb().query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [ADULT_CONTENT_SETTING_KEY, String(enabled), Date.now()],
  )
}

export const contentPolicyRoutes = new Hono()

contentPolicyRoutes.get('/', async (c) => {
  const adultContentEnabled = await getAdultContentEnabled()
  return c.json({ adultContentEnabled }, 200, { 'Cache-Control': 'no-store' })
})
