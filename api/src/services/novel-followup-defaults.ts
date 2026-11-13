import type { Db } from '../db/pool'
import { all } from '../db/query'
import { presetForUrl } from './scraper/presets'

/** 来源必须实际可抓取，不能把一个来源链接当成完整配置。 */
export function hasFollowupSource(sourceUrl: string | null, rawSelectors: string | null): boolean {
  try {
    const url = new URL(sourceUrl || '')
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false
    const selectors = JSON.parse(rawSelectors || '{}')
    return ['chapterList', 'chapterContent'].every((key) => typeof selectors?.[key] === 'string' && selectors[key].trim())
  } catch {
    return false
  }
}

/** 同一默认策略覆盖旧书、新建和导入；用户后续的明确操作优先。 */
export async function applyFollowupDefaults(db: Db, novelId?: string) {
  const rows = await all<{
    id: string
    status: string
    novel_source_url: string
    source_url: string | null
    selectors: string | null
    enabled: boolean | null
  }>(
    db,
    `SELECT n.id,n.status,n.source_url AS novel_source_url,c.source_url,c.selectors,f.enabled FROM novels n
     LEFT JOIN scrape_configs c ON c.novel_id=n.id LEFT JOIN novel_followups f ON f.novel_id=n.id
     WHERE (f.novel_id IS NULL OR NOT f.user_configured) ${novelId ? 'AND n.id=$1' : ''}`,
    novelId ? [novelId] : [],
  )
  // 网页或TXT导入只保存作品来源时，使用已支持站点的规则补齐抓取配置。
  // 不覆盖已有配置，也不猜测未知网站的选择器。
  for (const row of rows) {
    if (row.source_url !== null || row.status !== 'ongoing') continue
    let url: URL
    try {
      url = new URL(row.novel_source_url)
    } catch {
      continue
    }
    const preset = presetForUrl(url.href)
    if (!preset?.selectors || !hasFollowupSource(url.href, JSON.stringify(preset.selectors))) continue
    const source = preset.urlTransform ? preset.urlTransform(url.href) : url.href
    const inserted = await db.query<{ novel_id: string }>(
      `INSERT INTO scrape_configs(novel_id,source_url,selectors,encoding,updated_at) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(novel_id) DO NOTHING RETURNING novel_id`,
      [row.id, source, JSON.stringify(preset.selectors), preset.encoding, Date.now()],
    )
    if (inserted.rows.length) {
      row.source_url = source
      row.selectors = JSON.stringify(preset.selectors)
    }
  }
  const changed = rows.filter((row) => row.enabled !== (row.status === 'ongoing' && hasFollowupSource(row.source_url, row.selectors)))
  if (!changed.length) return
  await db.query(
    `INSERT INTO novel_followups (novel_id,enabled,next_check_at)
     SELECT id,enabled,CASE WHEN enabled THEN $3::bigint + 6 * 3600000::bigint ELSE 0 END
     FROM UNNEST($1::text[],$2::boolean[]) AS items(id,enabled)
     ON CONFLICT (novel_id) DO UPDATE SET enabled=EXCLUDED.enabled,
       next_check_at=CASE WHEN EXCLUDED.enabled THEN $3::bigint + novel_followups.interval_hours * 3600000::bigint ELSE 0 END
     WHERE NOT novel_followups.user_configured AND novel_followups.enabled IS DISTINCT FROM EXCLUDED.enabled`,
    [changed.map((row) => row.id), changed.map((row) => row.status === 'ongoing' && hasFollowupSource(row.source_url, row.selectors)), Date.now()],
  )
}
