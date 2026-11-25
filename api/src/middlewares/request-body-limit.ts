import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'

/**
 * /api/* 的全局请求体兜底上限。
 *
 * 路由级 bodyLimit 只覆盖了认证、安全中心、备份、阅读数据、插图等少数入口；段评（匿名可写）、
 * 评论、书签、书架、进度、AI 参数等端点此前会把客户端声明的任意大小请求体整包读入内存
 * （@hono/node-server 不限制 body，Hono 的 c.req.json()/formData() 会全量缓冲）。
 */

/** 默认上限：覆盖最重的 JSON 端点（整章正文、批量操作、AI 参数）。 */
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024

/**
 * 上传类路径按前缀放宽：值需覆盖各自路由内的文件校验上限 + multipart 开销。
 * 匹配取最长前缀，避免 /preview 意外放行 /preview-zip。
 */
const PATH_LIMITS: ReadonlyArray<readonly [string, number]> = [
  ['/api/book-import/preview-zip', 70 * 1024 * 1024],
  ['/api/book-import/preview', 32 * 1024 * 1024],
  ['/api/ai/cover/upload', 8 * 1024 * 1024],
]

function limitFor(path: string): number {
  let limit = DEFAULT_MAX_BYTES
  let matched = -1
  for (const [prefix, bytes] of PATH_LIMITS) {
    if (path.startsWith(prefix) && prefix.length > matched) {
      limit = bytes
      matched = prefix.length
    }
  }
  return limit
}

// 按上限复用中间件实例：每个请求都要按路径选一档，避免逐请求构造 handler。
const handlers = new Map<number, MiddlewareHandler>()

function handlerFor(maxSize: number): MiddlewareHandler {
  let handler = handlers.get(maxSize)
  if (!handler) {
    handler = bodyLimit({ maxSize, onError: (c) => c.json({ error: '请求体过大', code: 'body_too_large' }, 413) })
    handlers.set(maxSize, handler)
  }
  return handler
}

export function requestBodyLimit(): MiddlewareHandler {
  return async (c, next) => handlerFor(limitFor(c.req.path))(c, next)
}
