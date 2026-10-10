/**
 * 认证中间件 —— requireUser / requireAdmin。
 * 挂到需要登录/管理员的子路由上；用户信息写入 context variable `user`。
 */
import type { MiddlewareHandler } from 'hono'
import { loadConfig } from '../config'
import { getDb } from '../db/pool'
import { hashToken, REAUTH_TTL, type UserRow } from '../services/auth'
import type { Context } from 'hono'
import { requestSession, browserRequest } from '../services/browser-session'
import { getUserByToken } from '../services/sessions'

export type AuthEnv = { Variables: { user: UserRow } }

function accountChanged(c: Context, user: UserRow): boolean {
  return (
    browserRequest(c) &&
    !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
    c.req.header('Authorization') === undefined &&
    c.req.header('X-ZZ-Account') !== user.id
  )
}

export function requireUser(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    let db
    try {
      db = getDb()
    } catch {
      return c.json({ error: '数据库未配置', needsSetup: true }, 503)
    }
    const token = requestSession(c)
    const user = await getUserByToken(db, token, loadConfig().sessionHashSalt)
    if (!user) return c.json({ error: '需要登录' }, 401)
    if (accountChanged(c, user)) return c.json({ error: '账号已变化，请刷新页面后再操作', code: 'account_changed' }, 409)
    c.set('user', user)
    await next()
  }
}

export function requireAdmin(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    let db
    try {
      db = getDb()
    } catch {
      return c.json({ error: '数据库未配置', needsSetup: true }, 503)
    }
    const token = requestSession(c)
    const user = await getUserByToken(db, token, loadConfig().sessionHashSalt)
    if (!user) return c.json({ error: '需要管理员登录' }, 401)
    if (user.role !== 'admin') return c.json({ error: '需要管理员权限' }, 403)
    if (accountChanged(c, user)) return c.json({ error: '账号已变化，请刷新页面后再操作', code: 'account_changed' }, 409)
    const sensitive =
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      (/^\/api\/admin-users(?:\/|$)/.test(c.req.path) ||
        /^\/api\/admin\/backups\/(settings|targets|deployment|policy)(?:\/|$)/.test(c.req.path) ||
        c.req.path === '/api/admin/site-settings/turnstile')
    if (sensitive) {
      const session = (
        await db.query<{ reauthenticated_at: number }>('SELECT reauthenticated_at FROM user_sessions WHERE token_hash=$1', [
          await hashToken(token, loadConfig().sessionHashSalt),
        ])
      ).rows[0]
      if (!session || Number(session.reauthenticated_at) < Date.now() - REAUTH_TTL)
        return c.json({ error: '请重新验证管理员身份', code: 'reauth_required' }, 403)
    }
    c.set('user', user)
    await next()
  }
}

/** 有 token 就解析用户（读进度等匿名可用的用户增强路由），无 token 不拦截。 */
export function optionalUser(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    try {
      const token = requestSession(c)
      if (token) {
        const user = await getUserByToken(getDb(), token, loadConfig().sessionHashSalt)
        if (user && accountChanged(c, user)) return c.json({ error: '账号已变化，请刷新页面后再操作', code: 'account_changed' }, 409)
        if (user) c.set('user', user)
      }
    } catch {
      // 未配置 DB 或解析失败：按匿名处理
    }
    await next()
  }
}
