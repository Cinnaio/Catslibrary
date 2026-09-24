import { getDb } from '../db/pool'
import { first } from '../db/query'

export const ADULT_CONTENT_SETTING_KEY = 'adult_content_enabled'

/**
 * 读取全站成人内容开关。
 *
 * 这个开关只表示站点是否允许读者申请成人内容访问权；它不等于已经给
 * 当前请求授权。具体作品仍需经过 content-access 的请求级判定。
 */
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
