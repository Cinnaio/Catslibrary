import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { NovelVisibility } from '@shared/types'
import type { AuthEnv } from '../middlewares/auth'
import type { DbClient } from '../db/pool'
import { newId } from './auth'

/** Only server-authenticated account IDs enter this SQL literal. Never pass request input. */
export function viewerSql(c: Context<AuthEnv>): string {
  return `'${String(c.get('user')?.id || '').replace(/'/g, "''")}'`
}

/** Apply before pagination, counts, metadata, or content-rating checks. Arguments are SQL expressions owned by the caller. */
export function novelVisibilitySql(userExpression: string, alias = 'n'): string {
  return `(${alias}.visibility = 'public' OR EXISTS (
    SELECT 1 FROM users privacy_user WHERE privacy_user.id = ${userExpression} AND privacy_user.status = 'active'
      AND (privacy_user.role IN ('admin', 'super_admin') OR (${alias}.visibility = 'selected' AND EXISTS (
        SELECT 1 FROM novel_access_grants privacy_grant
        WHERE privacy_grant.novel_id = ${alias}.id AND privacy_grant.user_id = privacy_user.id
      )))
  ))`
}

export function visibleNovelSql(c: Context<AuthEnv>, alias = 'n'): string {
  return novelVisibilitySql(viewerSql(c), alias)
}

export interface VisibilityInput {
  visibility: NovelVisibility
  userIds: string[]
  revision?: number
}

export function parseVisibilityInput(body: Record<string, unknown>, creating = false): VisibilityInput | undefined {
  if (body.visibility === undefined && body.allowedUserIds === undefined && body.visibilityRevision === undefined) return undefined
  if (!['public', 'admin', 'selected'].includes(String(body.visibility))) throw new HTTPException(400, { message: '可见范围无效' })
  const visibility = body.visibility as NovelVisibility
  const raw = body.allowedUserIds ?? []
  if (!Array.isArray(raw) || raw.length > 500 || raw.some((id) => typeof id !== 'string' || !id.trim() || id.length > 100))
    throw new HTTPException(400, { message: '请选择有效的授权用户，最多 500 人' })
  const userIds = [...new Set((raw as string[]).map((id) => id.trim()))].sort()
  if (visibility === 'selected' && !userIds.length) throw new HTTPException(400, { message: '指定用户可见时至少选择一位用户' })
  if (visibility !== 'selected' && userIds.length) throw new HTTPException(400, { message: '当前可见范围不接受指定用户' })
  if (!creating && (!Number.isInteger(body.visibilityRevision) || Number(body.visibilityRevision) < 0))
    throw new HTTPException(400, { message: '修改可见范围需携带有效版本，请刷新后重试' })
  return { visibility, userIds, revision: creating ? undefined : Number(body.visibilityRevision) }
}

/** Caller holds the novel row lock; updates, grants, and audit are one transaction. */
export async function applyNovelVisibility(
  query: DbClient['query'], novelId: string, actorId: string, input: VisibilityInput,
) {
  const novel = (await query<{ visibility: NovelVisibility; visibility_revision: number }>(
    'SELECT visibility, visibility_revision FROM novels WHERE id=$1 FOR UPDATE', [novelId],
  )).rows[0]
  if (!novel) throw new HTTPException(404, { message: 'Novel not found' })
  if (input.revision !== undefined && input.revision !== novel.visibility_revision)
    throw new HTTPException(409, { message: '可见范围已被其他管理员修改，请刷新后重试' })
  if (input.userIds.length) {
    const users = await query<{ id: string }>("SELECT id FROM users WHERE id=ANY($1::text[]) AND role='reader' FOR SHARE", [input.userIds])
    if (users.rows.length !== input.userIds.length) throw new HTTPException(400, { message: '部分用户不存在或不是普通读者，请重新选择' })
  }
  const previousIds = (await query<{ user_id: string }>('SELECT user_id FROM novel_access_grants WHERE novel_id=$1 ORDER BY user_id', [novelId])).rows.map((r) => r.user_id)
  if (novel.visibility === input.visibility && JSON.stringify(previousIds) === JSON.stringify(input.userIds)) return
  const now = Date.now()
  await query('DELETE FROM novel_access_grants WHERE novel_id=$1', [novelId])
  if (input.userIds.length) await query(
    'INSERT INTO novel_access_grants(novel_id,user_id,created_at) SELECT $1,unnest($2::text[]),$3', [novelId, input.userIds, now],
  )
  const revision = novel.visibility_revision + 1
  await query('UPDATE novels SET visibility=$2,visibility_revision=$3,updated_at=$4 WHERE id=$1', [novelId, input.visibility, revision, now])
  await query(`INSERT INTO novel_visibility_audit(id,novel_id,actor_user_id,previous_visibility,visibility,previous_user_ids,user_ids,revision,created_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
  [newId('visibility'), novelId, actorId, novel.visibility, input.visibility, JSON.stringify(previousIds), JSON.stringify(input.userIds), revision, now])
}
