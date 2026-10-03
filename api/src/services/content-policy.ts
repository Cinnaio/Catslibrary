import { getDb } from '../db/pool'
import { first, withTx } from '../db/query'
import { parseSettingsDocument } from './reader-settings'

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
  await withTx(getDb(), async (query) => {
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [ADULT_CONTENT_SETTING_KEY, String(enabled), Date.now()],
    )
    // 重新开放不能恢复关闭前的读者授权。
    if (!enabled) {
      await query('UPDATE user_sessions SET adult_access_until = 0 WHERE adult_access_until > 0')
      const { rows } = await query<{ id: string; reader_settings: string }>('SELECT id, reader_settings FROM users FOR UPDATE')
      for (const user of rows) {
        const document = parseSettingsDocument(user.reader_settings || '')
        if (document.shared.values.contentMode !== 'adult') continue
        document.shared.values.contentMode = 'safe'
        document.shared.updatedAt.contentMode = Date.now()
        await query('UPDATE users SET reader_settings=$1 WHERE id=$2', [JSON.stringify(document), user.id])
      }
    }
  })
}
