import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import type { ShelfEdit } from '@shared/bookshelf-organization'
import { getDb } from '../db/pool'
import { all, withTx } from '../db/query'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { visibleNovelSql } from '../services/novel-visibility'
import { contentPolicyHeaders, resolveContentAccess } from '../services/content-access'

export const bookshelfOrganizationRoutes = new Hono<AuthEnv>()
bookshelfOrganizationRoutes.use('*', requireUser(), async (c, next) => {
  for (const [key, value] of Object.entries(contentPolicyHeaders())) c.header(key, value)
  await next()
})
async function visible(c: Context<AuthEnv>) {
  const access = await resolveContentAccess(c)
  return `${visibleNovelSql(c)}${access.canViewRestricted && c.req.query('contentMode') !== 'safe' ? '' : " AND COALESCE(n.content_rating,'unknown') <> 'restricted'"}`
}
class ShelfError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message) }
}
bookshelfOrganizationRoutes.onError((error, c) => {
  if (error instanceof ShelfError) return c.json({ error: error.message }, error.status)
  throw error
})
const ids = (value: unknown, max = 100): value is string[] => Array.isArray(value) && value.length <= max &&
  value.every(v => typeof v === 'string' && v.length > 0 && v.length <= 80) && new Set(value).size === value.length
export function parseShelfEdit(value: unknown): ShelfEdit | null {
  if (!value || typeof value !== 'object') return null
  const b = value as Record<string, unknown>
  if (b.expectedVersion !== undefined && (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0)) return null
  if (!ids(b.novelIds) || !b.novelIds.length) return null
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500 || b.novelIds.length !== 1)) return null
  if (b.pinned !== undefined && typeof b.pinned !== 'boolean') return null
  if (['groupIds', 'addGroupIds', 'removeGroupIds'].some(k => b[k] !== undefined && !ids(b[k], 40))) return null
  if (b.groupIds !== undefined && (b.novelIds.length !== 1 || b.addGroupIds !== undefined || b.removeGroupIds !== undefined)) return null
  if ((b.note !== undefined || b.groupIds !== undefined) && (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0)) return null
  if (!['note', 'pinned', 'groupIds', 'addGroupIds', 'removeGroupIds'].some(k => b[k] !== undefined)) return null
  return b as unknown as ShelfEdit
}

bookshelfOrganizationRoutes.get('/groups', async c => {
  const filter = await visible(c)
  const groups = await all<{ id: string; name: string; count: string }>(getDb(), `SELECT g.id,g.name,
    (SELECT COUNT(*) FROM bookshelf_group_members m JOIN novels n ON n.id=m.novel_id
     WHERE m.user_id=g.user_id AND m.group_id=g.id AND ${filter}) AS count
    FROM bookshelf_groups g WHERE g.user_id=$1 ORDER BY g.created_at,g.id`, [c.get('user').id])
  return c.json({ groups: groups.map(g => ({ ...g, count: Number(g.count) })) })
})
bookshelfOrganizationRoutes.post('/groups', async c => {
  const raw = await c.req.json().catch(() => null)
  const body = raw && typeof raw === 'object' ? raw : {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 30) return c.json({ error: '分组名称需为 1–30 字' }, 400)
  const userId = c.get('user').id
  const group = await withTx(getDb(), async query => {
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const { rows } = await query<{ id: string; name: string }>('SELECT id,name FROM bookshelf_groups WHERE user_id=$1', [userId])
    const existing = rows.find(g => g.name === name)
    if (existing) return existing
    if (rows.length >= 40) throw new ShelfError('最多创建 40 个私人分组')
    const item = { id: randomUUID(), name }
    await query('INSERT INTO bookshelf_groups(user_id,id,name,created_at) VALUES($1,$2,$3,$4)', [userId,item.id,name,Date.now()])
    return item
  })
  return c.json({ group })
})
bookshelfOrganizationRoutes.patch('/groups/:id', async c => {
  const raw = await c.req.json().catch(() => null)
  const body = raw && typeof raw === 'object' ? raw : {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 30) return c.json({ error: '分组名称需为 1–30 字' }, 400)
  await withTx(getDb(), async query => {
    const userId = c.get('user').id, id = c.req.param('id')
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const duplicate = await query('SELECT id FROM bookshelf_groups WHERE user_id=$1 AND name=$2 AND id<>$3', [userId,name,id])
    if (duplicate.rows.length) throw new ShelfError('已有同名分组', 409)
    const result = await query('UPDATE bookshelf_groups SET name=$3 WHERE user_id=$1 AND id=$2', [userId,id,name])
    if (!result.rowCount) throw new ShelfError('分组已不存在', 404)
  })
  return c.json({ success: true })
})
bookshelfOrganizationRoutes.delete('/groups/:id', async c => {
  await withTx(getDb(), async query => {
    const userId = c.get('user').id, id = c.req.param('id')
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    await query(`UPDATE user_bookshelf SET organization_version=organization_version+1 WHERE user_id=$1
      AND novel_id IN (SELECT novel_id FROM bookshelf_group_members WHERE user_id=$1 AND group_id=$2)`, [userId,id])
    await query('DELETE FROM bookshelf_groups WHERE user_id=$1 AND id=$2', [userId,id])
  })
  return c.json({ success: true })
})
bookshelfOrganizationRoutes.patch('/entries', async c => {
  const body = parseShelfEdit(await c.req.json().catch(() => null))
  if (!body) return c.json({ error: '请选择 1–100 本书；备注最多 500 字，修改备注和分组须携带当前版本' }, 400)
  const filter = await visible(c), userId = c.get('user').id
  await withTx(getDb(), async query => {
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const { rows } = await query<{ novel_id: string; organization_version: number }>(`SELECT b.novel_id,b.organization_version FROM user_bookshelf b
      JOIN novels n ON n.id=b.novel_id WHERE b.user_id=$1 AND b.novel_id=ANY($2::text[]) AND ${filter} FOR UPDATE OF b`, [userId,body.novelIds])
    if (rows.length !== body.novelIds.length) throw new ShelfError('所选收藏已移除或暂不可访问', 404)
    if (body.expectedVersion !== undefined && rows.some(r => r.organization_version !== body.expectedVersion)) throw new ShelfError('收藏已在其他页面更新，请重新打开后整理', 409)
    const groupIds = [...new Set([...(body.groupIds ?? []), ...(body.addGroupIds ?? []), ...(body.removeGroupIds ?? [])])]
    if (groupIds.length) {
      const groups = await query('SELECT id FROM bookshelf_groups WHERE user_id=$1 AND id=ANY($2::text[])', [userId,groupIds])
      if (groups.rows.length !== groupIds.length) throw new ShelfError('分组已变化，请刷新后重试', 409)
    }
    await query(`UPDATE user_bookshelf SET note=COALESCE($3,note),pinned=COALESCE($4,pinned),organization_version=organization_version+1
      WHERE user_id=$1 AND novel_id=ANY($2::text[])`, [userId,body.novelIds,body.note ?? null,body.pinned ?? null])
    if (body.groupIds !== undefined) await query('DELETE FROM bookshelf_group_members WHERE user_id=$1 AND novel_id=ANY($2::text[])', [userId,body.novelIds])
    if (body.removeGroupIds?.length) await query('DELETE FROM bookshelf_group_members WHERE user_id=$1 AND novel_id=ANY($2::text[]) AND group_id=ANY($3::text[])', [userId,body.novelIds,body.removeGroupIds])
    for (const groupId of body.groupIds ?? body.addGroupIds ?? []) {
      await query(`INSERT INTO bookshelf_group_members(user_id,group_id,novel_id)
        SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`, [userId,groupId,body.novelIds])
    }
  })
  return c.json({ success: true })
})
bookshelfOrganizationRoutes.post('/move', async c => {
  const raw = await c.req.json().catch(() => null)
  const b = raw && typeof raw === 'object' ? raw : {}
  if (typeof b.novelId !== 'string' || !['up','down'].includes(b.direction) || (b.groupId !== undefined && typeof b.groupId !== 'string')) return c.json({ error: '排序参数无效' }, 400)
  const filter = await visible(c), userId = c.get('user').id
  await withTx(getDb(), async query => {
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const { rows } = await query<{ novel_id: string; pinned: boolean }>(`SELECT b.novel_id,b.pinned FROM user_bookshelf b JOIN novels n ON n.id=b.novel_id
      WHERE b.user_id=$1 AND ${filter} AND ($2='' OR EXISTS(SELECT 1 FROM bookshelf_group_members m WHERE m.user_id=b.user_id AND m.novel_id=b.novel_id AND m.group_id=$2))
      ORDER BY b.pinned DESC,b.position,b.updated_at DESC,b.novel_id FOR UPDATE OF b`, [userId,b.groupId || ''])
    const index = rows.findIndex(r => r.novel_id === b.novelId)
    if (index < 0) throw new ShelfError('收藏已移除或暂不可访问', 404)
    const target = index + (b.direction === 'up' ? -1 : 1)
    if (target < 0 || target >= rows.length || rows[index]!.pinned !== rows[target]!.pinned) return
    // Reassign the existing subset's positions; books in other groups retain their relative order.
    const positions = await query<{ novel_id: string }>(`SELECT b.novel_id FROM user_bookshelf b WHERE b.user_id=$1 ORDER BY b.pinned DESC,b.position,b.updated_at DESC,b.novel_id`, [userId])
    const ordered = positions.rows.map(r => r.novel_id)
    const a = ordered.indexOf(rows[index]!.novel_id), z = ordered.indexOf(rows[target]!.novel_id)
    ;[ordered[a],ordered[z]] = [ordered[z]!,ordered[a]!]
    await query(`UPDATE user_bookshelf b SET position=s.ordinality FROM unnest($2::text[]) WITH ORDINALITY AS s(id,ordinality)
      WHERE b.user_id=$1 AND b.novel_id=s.id`, [userId,ordered])
  })
  return c.json({ success: true })
})
