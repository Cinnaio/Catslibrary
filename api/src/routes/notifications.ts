import { visibleNovelSql } from '../services/novel-visibility'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { NotificationSettings } from '@shared/notifications'
import { getDb } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { loadConfig } from '../config'
import { hashToken } from '../services/auth'
import { requestSession } from '../services/browser-session'
import { resolveContentAccess } from '../services/content-access'
import { notificationItem, notificationRows, notificationSettings, notificationVisibleSql } from '../services/notifications'
import { pushConfiguration, validPushEndpoint } from '../services/notification-push'

export const notificationRoutes = new Hono<AuthEnv>()
notificationRoutes.use('*', requireUser())
notificationRoutes.get('/', async (c) => {
  const userId = c.get('user').id,
    db = getDb()
  const restricted = (await resolveContentAccess(c)).canViewRestricted
  const before = Number(c.req.query('before'))
  if (c.req.query('before') && (!Number.isSafeInteger(before) || before < 0)) return c.json({ error: '分页位置无效' }, 400)
  const rows = await notificationRows(db, userId, {
    before: before || undefined,
    beforeId: c.req.query('beforeId'),
    unread: c.req.query('unread') === '1',
    restricted,
  })
  const count = await first<{ count: number }>(
    db,
    `SELECT count(*)::int AS count FROM notifications m WHERE m.user_id=$1 AND m.read_at IS NULL AND ${notificationVisibleSql(restricted)}`,
    [userId],
  )
  return c.json({ items: rows.slice(0, 30).map(notificationItem), unread: Number(count?.count || 0), hasMore: rows.length > 30 })
})
notificationRoutes.get('/settings', async (c) => {
  const db = getDb(),
    userId = c.get('user').id,
    config = pushConfiguration()
  const session = await hashToken(requestSession(c), loadConfig().sessionHashSalt)
  const devices = await all(
    db,
    `SELECT id,name,created_at AS "createdAt",(session_hash=$2) AS current FROM notification_subscriptions WHERE user_id=$1 AND ($3='' OR vapid_public_key=$3) ORDER BY created_at DESC`,
    [userId, session, config.publicKey],
  )
  return c.json({ settings: await notificationSettings(db, userId), devices, publicKey: config.publicKey, pushConfigured: config.configured })
})
notificationRoutes.put('/settings', async (c) => {
  const input = ((await c.req.json().catch(() => ({}))) || {}) as NotificationSettings
  if (
    ['replies', 'tasks', 'preview', 'quietEnabled'].some((k) => typeof input[k as keyof NotificationSettings] !== 'boolean') ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quietStart || '') ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quietEnd || '') ||
    typeof input.timeZone !== 'string' ||
    input.timeZone.length > 80 ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    (input.quietEnabled && input.quietStart === input.quietEnd)
  )
    return c.json({ error: '请检查通知设置及免打扰时段' }, 400)
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format()
  } catch {
    return c.json({ error: '时区无效' }, 400)
  }
  const result = await withTx(getDb(), async (query) => {
    await query('INSERT INTO notification_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING', [c.get('user').id])
    return query(
      `UPDATE notification_settings SET replies=$2,tasks=$3,preview=$4,quiet_enabled=$5,
      quiet_start=$6,quiet_end=$7,time_zone=$8,revision=revision+1 WHERE user_id=$1 AND revision=$9 RETURNING user_id`,
      [c.get('user').id, input.replies, input.tasks, input.preview, input.quietEnabled, input.quietStart, input.quietEnd, input.timeZone, input.revision],
    )
  })
  if (!result.rows.length) return c.json({ error: '设置已在其他设备修改，请重新载入后再保存' }, 409)
  return c.json({ settings: await notificationSettings(getDb(), c.get('user').id) })
})
notificationRoutes.post('/read', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {}
  if (body.all !== true && (typeof body.id !== 'string' || body.id.length > 100)) return c.json({ error: '消息编号无效' }, 400)
  const restricted = (await resolveContentAccess(c)).canViewRestricted
  await getDb().query(
    `UPDATE notifications m SET read_at=$2 WHERE user_id=$1 AND read_at IS NULL
    AND ($3='' OR id=$3) AND ${notificationVisibleSql(restricted)}`,
    [c.get('user').id, Date.now(), body.all === true ? '' : body.id],
  )
  return c.json({ ok: true })
})
notificationRoutes.post('/subscriptions', async (c) => {
  const config = pushConfiguration()
  if (!config.configured) return c.json({ error: '站点尚未配置推送，请稍后再试' }, 503)
  const body = (await c.req.json().catch(() => ({}))) || {},
    keys = body.keys
  if (body.applicationServerKey !== config.publicKey) return c.json({ error: '站点推送密钥已变化，请重新载入设置并开启推送' }, 409)
  if (
    typeof body.endpoint !== 'string' ||
    body.endpoint.length > 2048 ||
    !validPushEndpoint(body.endpoint) ||
    !keys ||
    !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh || '') ||
    !/^[A-Za-z0-9_-]{22}$/.test(keys.auth || '')
  )
    return c.json({ error: '无效的浏览器订阅' }, 400)
  const userId = c.get('user').id,
    session = await hashToken(requestSession(c), loadConfig().sessionHashSalt)
  const id = await withTx(getDb(), async (query) => {
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    // A request waiting on another subscription must not delete that newer key's devices.
    if (pushConfiguration().publicKey !== config.publicKey) return false
    await query('DELETE FROM notification_subscriptions WHERE user_id=$1 AND vapid_public_key<>$2', [userId, config.publicKey])
    const existing = (
      await query<{ id: string; user_id: string; auth: string }>('SELECT id,user_id,auth FROM notification_subscriptions WHERE endpoint=$1 FOR UPDATE', [
        body.endpoint,
      ])
    ).rows[0]
    // Account switch must create a fresh browser subscription; never silently transfer another account's endpoint.
    if (existing && (existing.user_id !== userId || existing.auth !== keys.auth)) return null
    const count = (await query<{ count: number }>('SELECT count(*)::int AS count FROM notification_subscriptions WHERE user_id=$1', [userId])).rows[0]!.count
    if (!existing && count >= 10) return null
    const deviceId = existing?.id || randomUUID()
    const stored = await query<{ id: string }>(
      `INSERT INTO notification_subscriptions(id,user_id,session_hash,endpoint,p256dh,auth,name,created_at,vapid_public_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(endpoint) DO UPDATE SET session_hash=EXCLUDED.session_hash,name=EXCLUDED.name
      WHERE notification_subscriptions.user_id=EXCLUDED.user_id AND notification_subscriptions.auth=EXCLUDED.auth
        AND notification_subscriptions.p256dh=EXCLUDED.p256dh RETURNING id`,
      [deviceId, userId, session, body.endpoint, keys.p256dh, keys.auth, String(body.name || '网页设备').slice(0, 80), Date.now(), config.publicKey],
    )
    return stored.rows[0]?.id || null
  })
  if (id === false) return c.json({ error: '站点推送配置已变化，请重新载入设置并开启推送' }, 409)
  return id ? c.json({ id }) : c.json({ error: '此订阅属于其他账号或设备数量已达上限，请先关闭当前推送或移除旧设备' }, 409)
})
notificationRoutes.delete('/subscriptions/:id', async (c) => {
  await getDb().query('DELETE FROM notification_subscriptions WHERE id=$1 AND user_id=$2', [c.req.param('id'), c.get('user').id])
  return c.json({ ok: true })
})
notificationRoutes.post('/test', async (c) => {
  const config = pushConfiguration()
  if (!config.configured) return c.json({ error: '站点尚未配置推送' }, 503)
  const body = (await c.req.json().catch(() => ({}))) || {},
    now = Date.now(),
    userId = c.get('user').id
  const session = await hashToken(requestSession(c), loadConfig().sessionHashSalt)
  const accepted = await withTx(getDb(), async (query) => {
    const updated = await query(
      `UPDATE notification_subscriptions SET test_at=$3 WHERE id=$1 AND user_id=$2
      AND session_hash=$4 AND vapid_public_key=$5 AND test_at<$3::bigint-60000 RETURNING id`,
      [String(body.deviceId || ''), userId, now, session, config.publicKey],
    )
    if (!updated.rows.length) return false
    await query(
      "INSERT INTO notifications(id,user_id,kind,reference_id,created_at) VALUES($1,$2,'test',$3,$4) ON CONFLICT(user_id,kind,reference_id) DO UPDATE SET created_at=$4,read_at=NULL",
      [randomUUID(), userId, body.deviceId, now],
    )
    // A repeated test reuses the inbox row and resets only this device's delivery.
    await query(
      `INSERT INTO notification_deliveries(notification_id,subscription_id,available_at)
      SELECT id,$2,$3 FROM notifications WHERE user_id=$1 AND kind='test' AND reference_id=$2
      ON CONFLICT(notification_id,subscription_id) DO UPDATE SET state='pending',attempts=0,available_at=$3,lease=''`,
      [userId, body.deviceId, now],
    )
    return true
  })
  return accepted ? c.json({ ok: true }) : c.json({ error: '请先开启当前设备推送，测试间隔至少一分钟' }, 429)
})
notificationRoutes.get('/watches', async (c) => {
  const restricted = (await resolveContentAccess(c)).canViewRestricted
  const search = (c.req.query('search') || '').slice(0, 100)
  const offset = Math.min(100000, Math.max(0, Math.trunc(Number(c.req.query('offset')) || 0)))
  const rows = await all(
    getDb(),
    `SELECT n.id AS "novelId",n.title,(w.user_id IS NOT NULL) AS enabled,
    COALESCE(f.enabled,false) AS "checksEnabled" FROM user_bookshelf b JOIN novels n ON n.id=b.novel_id
    LEFT JOIN notification_book_watches w ON w.user_id=b.user_id AND w.novel_id=b.novel_id
    LEFT JOIN novel_followups f ON f.novel_id=n.id
    WHERE b.user_id=$1 AND ${visibleNovelSql(c)} ${restricted ? '' : "AND n.content_rating<>'restricted'"}
      AND ($2='' OR STRPOS(LOWER(n.title),LOWER($2))>0) ORDER BY n.title,n.id LIMIT 31 OFFSET $3`,
    [c.get('user').id, search, offset],
  )
  return c.json({ items: rows.slice(0, 30), hasMore: rows.length > 30 })
})
notificationRoutes.put('/watches/:novelId', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {},
    novelId = c.req.param('novelId'),
    userId = c.get('user').id
  if (typeof body.enabled !== 'boolean') return c.json({ error: '请选择是否订阅' }, 400)
  if (!body.enabled) {
    await getDb().query('DELETE FROM notification_book_watches WHERE user_id=$1 AND novel_id=$2', [userId, novelId])
    return c.json({ ok: true })
  }
  const restricted = (await resolveContentAccess(c)).canViewRestricted
  const result = await getDb().query(
    `INSERT INTO notification_book_watches(user_id,novel_id,source_url,known_urls,created_at)
    SELECT b.user_id,n.id,COALESCE(sc.source_url,''),CASE WHEN n.source_chapter_snapshot IS NULL THEN NULL ELSE
      COALESCE((SELECT jsonb_agg(item->>'url') FROM jsonb_array_elements(n.source_chapter_snapshot) item),'[]'::jsonb) END,$3
    FROM user_bookshelf b JOIN novels n ON n.id=b.novel_id LEFT JOIN scrape_configs sc ON sc.novel_id=n.id
    WHERE b.user_id=$1 AND n.id=$2 AND ${visibleNovelSql(c)} ${restricted ? '' : "AND n.content_rating<>'restricted'"}
    ON CONFLICT(user_id,novel_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING user_id`,
    [userId, novelId, Date.now()],
  )
  return result.rows.length ? c.json({ ok: true }) : c.json({ error: '请先收藏这本书，或检查作品是否仍可访问' }, 404)
})
notificationRoutes.get('/:id/preview', async (c) => {
  const row = (await notificationRows(getDb(), c.get('user').id, { id: c.req.param('id') }))[0]
  if (!row) return c.json({ error: '消息不可用' }, 404)
  const settings = await notificationSettings(getDb(), c.get('user').id)
  return c.json({
    title: settings.preview ? row.title : 'Cat’s Library',
    body: settings.preview ? row.body : '你有一条新消息',
    url: '/messages?message=' + encodeURIComponent(row.id),
  })
})
notificationRoutes.get('/:id', async (c) => {
  const db = getDb(),
    restricted = (await resolveContentAccess(c)).canViewRestricted
  const row = (await notificationRows(db, c.get('user').id, { id: c.req.param('id'), restricted }))[0]
  if (!row) return c.json({ error: '消息已删除或当前账号无权查看' }, 404)
  let text = '',
    href = '',
    linkLabel = ''
  if (row.kind === 'chapters') {
    text = row.title
    href = '/novel/' + encodeURIComponent(row.novelId)
    linkLabel = '打开作品'
  } else if (row.kind === 'reply') {
    const reply = await first<{ comment_text: string }>(db, 'SELECT comment_text FROM novel_comments WHERE id=$1', [row.referenceId])
    text = reply?.comment_text || ''
    href = '/novel/' + encodeURIComponent(row.novelId) + '?comment=' + encodeURIComponent(row.parentId)
    linkLabel = '查看评论对话'
  } else if (row.kind === 'task') {
    text = row.status === 'failed' ? row.error || '任务未能完成，请到任务管理查看详情。' : '任务已完成，可以查看产出。'
    if (row.reportId) {
      href = '/admin/ai?sub=writing&view=analysis&novel=' + encodeURIComponent(row.novelId) + '&report=' + encodeURIComponent(row.reportId)
      linkLabel = '查看分析报告'
    } else {
      href = '/admin/tasks?view=ai&notificationTask=' + encodeURIComponent(row.referenceId)
      linkLabel = '查看任务详情'
    }
  } else text = '这条消息用于确认当前设备能够接收推送。'
  return c.json({ item: notificationItem(row), text, href, linkLabel, novelId: row.novelId, taskId: row.kind === 'task' ? row.referenceId : '' })
})
