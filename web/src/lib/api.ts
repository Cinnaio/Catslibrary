/**
 * API 客户端 —— 类型化 fetch 封装（由 Novel-KV js/api.js 平移）。
 * 零依赖：AbortSignal.timeout 超时、token 存储（localStorage/sessionStorage）、
 * 通用 request(method, path, body, useAuth)。
 */
import type { ChapterFull, ChapterMeta, Comment, Novel, NovelListResponse, ReaderSettings, Thought, User } from '@shared/types'

/** API base：Vite 注入 VITE_API_BASE（生产经 NOVEL_API_BASE define），默认同源 /api。 */
function resolveBase(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  const injected = env?.VITE_API_BASE || (globalThis as Record<string, unknown>).__NOVEL_API_BASE__ as string | undefined
  const base = String(injected || '/api').trim() || '/api'
  return base.replace(/\/+$/, '')
}

export const API_BASE = resolveBase()

function normalizePath(path: string): string {
  path = String(path || '')
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/api/')) path = path.slice(4)
  if (path === '/api') path = ''
  if (!path || path[0] === '?' || path[0] === '#') return path
  return path[0] === '/' ? path : '/' + path
}

export function url(path: string): string {
  const p = normalizePath(path)
  if (/^https?:\/\//i.test(p)) return p
  return API_BASE + p
}

// ---------- Token（与后端 user_sessions.token_hash 对应，只存服务端摘要） ----------

const TOKEN_KEY = 'user_session_token'

// 当前登录用户的去重缓存（见 authApi.meCached），token 变化时由 clearToken 失效
let mePromise: Promise<{ user: User | null }> | null = null

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string, persist = false): void {
  clearToken()
  try {
    if (persist) localStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* ignore unavailable storage */
  }
}

export function clearToken(): void {
  // token 变化 ⇒ 身份缓存必须失效（setToken 内部先调本函数，登录/登出/换 token 全覆盖），
  // 否则同一会话内换账号会从 meCached 拿到上一个用户的身份
  mePromise = null
  try {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function authHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const result = { ...headers }
  const token = getToken()
  if (token) result.Authorization = `Bearer ${token}`
  return result
}

// ---------- 请求 ----------

export interface ApiError extends Error {
  status?: number
  data?: unknown
}

const API_TIMEOUT_MS = 30000

function timedFetch(input: RequestInfo | URL, opts: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  if (!opts.signal && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    opts.signal = (AbortSignal as { timeout(ms: number): AbortSignal }).timeout(timeoutMs)
  }
  return fetch(input, opts)
}

async function request<T = unknown>(method: string, path: string, body: unknown = null, useAuth = false, extraHeaders: Record<string, string> = {}, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  const hasBody = !!body && method !== 'GET'
  // 有 body 才声明 Content-Type：GET 带它会让跨域读取多一次 preflight
  const headers = { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }
  if (useAuth) Object.assign(headers, authHeaders())

  const opts: RequestInit = { method, headers }
  if (hasBody) opts.body = JSON.stringify(body)
  // 禁用浏览器 HTTP 缓存：管理员读写后必须拿到最新数据（后端 max-age 只留给 CDN/代理层）
  opts.cache = 'no-store'

  let res: Response
  try {
    res = await timedFetch(url(path), opts, timeoutMs)
  } catch (err) {
    const name = (err as Error)?.name || ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      // 通用超时文案：AI 写作已改异步任务（立即返回 202），不再有长轮询特例
      const apiError = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒无响应），请检查网络后重试`) as ApiError
      apiError.status = 504
      throw apiError
    }
    throw err
  }
  const data = await res.json().catch(() => ({})) as T & { error?: string }

  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `HTTP ${res.status}`) as ApiError
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

/** 非 JSON 直接 fetch（上传表单/keepalive 等），自动带 token 与 base。 */
export function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(init.headers as Record<string, string> | undefined) }
  const opts: RequestInit = { ...init, headers: authHeaders(headers) }
  return timedFetch(url(path), opts)
}

// ---------- Novels ----------

export const novelsApi = {
  list(params: Record<string, string | number> = {}): Promise<NovelListResponse> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    return request('GET', `/novels${qs ? '?' + qs : ''}`)
  },
  get(id: string): Promise<{ novel: Novel }> {
    return request('GET', `/novels/${encodeURIComponent(id)}`)
  },
  create(data: Record<string, unknown>): Promise<{ novel: Novel }> {
    return request('POST', '/novels', data, true)
  },
  update(id: string, data: Record<string, unknown>): Promise<{ novel: Novel }> {
    return request('PUT', `/novels/${encodeURIComponent(id)}`, data, true)
  },
  remove(id: string): Promise<{ success: boolean }> {
    return request('DELETE', `/novels/${encodeURIComponent(id)}`, null, true)
  },
  batchDelete(ids: string[]): Promise<{ ok: boolean }> {
    return request('POST', '/novels', { action: 'batch-delete', novelIds: ids }, true)
  },
  categories(): Promise<{ categories: string[] }> {
    return request('GET', '/categories')
  },
}

// ---------- Chapters ----------

export const chaptersApi = {
  list(novelId: string): Promise<{ chapters: ChapterMeta[] }> {
    return request('GET', `/chapters?novelId=${encodeURIComponent(novelId)}`)
  },
  get(id: string): Promise<{ chapter: ChapterFull }> {
    return request('GET', `/chapters/${encodeURIComponent(id)}`)
  },
  getByOrder(novelId: string, order: number): Promise<{ chapter: ChapterFull }> {
    return request('GET', `/chapters?novelId=${encodeURIComponent(novelId)}&order=${encodeURIComponent(order)}`)
  },
  create(data: Record<string, unknown>): Promise<{ chapter: ChapterMeta }> {
    return request('POST', '/chapters', data, true)
  },
  update(id: string, data: Record<string, unknown>): Promise<{ chapter: ChapterMeta }> {
    return request('PUT', `/chapters/${encodeURIComponent(id)}`, data, true)
  },
  remove(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/chapters/${encodeURIComponent(id)}`, null, true)
  },
  renameByOrder(data: Record<string, unknown>): Promise<{ ok: boolean }> {
    return request('POST', '/chapters', { action: 'rename-by-order', ...data }, true)
  },
  batchDelete(novelId: string, chapterIds: string[]): Promise<{ ok: boolean }> {
    return request('POST', '/chapters', { action: 'batch-delete', novelId, chapterIds }, true)
  },
}

// ---------- Categories ----------

export const categoriesApi = {
  list(): Promise<{ categories: string[] }> {
    return request('GET', '/categories')
  },
}

// ---------- Progress ----------

/** GET /progress?recent=1 的进度条目（服务端 listRecent 映射） */
export interface RecentProgressItem {
  novelId: string
  novelTitle: string
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  scrollPercent: number
  timestamp: number
  updatedAt: number
}

/** 已删除进度的墓碑：本地时间戳不新于它时应清掉本地记录 */
export interface ProgressTombstone {
  novelId: string
  deletedAt: number
  updatedAt: number
}

export const progressApi = {
  get(novelId: string): Promise<{ progress: unknown }> {
    return request('GET', `/progress?novelId=${encodeURIComponent(novelId)}`, null, isAuthenticated())
  },
  recent(limit = 5): Promise<{ progress: RecentProgressItem[]; tombstones: ProgressTombstone[] }> {
    return request('GET', `/progress?recent=1&limit=${encodeURIComponent(limit)}`, null, true)
  },
  save(data: Record<string, unknown>): Promise<{ ok: boolean }> {
    return request('POST', '/progress', data, isAuthenticated())
  },
  // Last-chance write：pagehide/visibilitychange 用 keepalive 让请求越过页面销毁。
  // sendBeacon 不能带 Authorization 头，故用 fetch keepalive。
  saveOnExit(data: Record<string, unknown>): void {
    const opts: RequestInit = {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
      keepalive: true,
    }
    try {
      fetch(url('/progress'), opts).catch(() => {})
    } catch {
      /* 忽略卸载期异常 */
    }
  },
  remove(novelId: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/progress?novelId=${encodeURIComponent(novelId)}&clientUpdatedAt=${encodeURIComponent(Date.now())}`, null, true)
  },
}

// ---------- Bookshelf ----------

export const bookshelfApi = {
  get(): Promise<{ favorites: unknown[]; recent: unknown[]; thoughts: unknown[] }> {
    return request('GET', '/bookshelf', null, true)
  },
  add(novelId: string): Promise<{ ok: boolean }> {
    return request('POST', '/bookshelf', { novelId }, true)
  },
  remove(novelId: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/bookshelf?novelId=${encodeURIComponent(novelId)}`, null, true)
  },
}

// ---------- Bookmarks（本地 + 后端同步） ----------

export const bookmarksApi = {
  list(): Promise<{ bookmarks: unknown[] }> {
    return request('GET', '/bookmarks', null, true)
  },
  replace(bookmarks: unknown[]): Promise<{ ok: boolean }> {
    return request('PUT', '/bookmarks', { bookmarks }, true)
  },
}

export interface ThoughtAdmin extends Thought {
  novelTitle: string
  chapterTitle: string
  userUsername: string
  userDisplayName: string
  clientIdHash: string
  ipHash: string
}

// ---------- Thoughts（段评） ----------

export const thoughtsApi = {
  list(chapterId: string): Promise<{ thoughts: Thought[] }> {
    return request('GET', `/thoughts?chapterId=${encodeURIComponent(chapterId)}`)
  },
  create(data: Record<string, unknown>, readerId?: string): Promise<{ thought: Thought }> {
    const headers: Record<string, string> = {}
    if (readerId) headers['X-Reader-Id'] = readerId
    return request('POST', '/thoughts', data, isAuthenticated(), headers)
  },
  update(id: string, data: Record<string, unknown>): Promise<{ thought: Thought }> {
    return request('PUT', '/thoughts', { id, ...data }, true)
  },
  remove(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/thoughts?id=${encodeURIComponent(id)}`, null, true)
  },
  /** 管理端列表：admin=1 返回未删除/报告中的段评。 */
  adminList(params: Record<string, string> = {}): Promise<{ thoughts: ThoughtAdmin[]; total?: number }> {
    const qs = new URLSearchParams({ ...params, admin: '1' }).toString()
    return request('GET', `/thoughts${qs ? '?' + qs : ''}`, null, true)
  },
  /** 管理端硬删除（绕过软删除，直接从库中移除）。 */
  hardDelete(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/thoughts?id=${encodeURIComponent(id)}&hard=1`, null, true)
  },
  mine(limit = 50): Promise<{ thoughts: Thought[] }> {
    return request('GET', `/thoughts?mine=1&limit=${encodeURIComponent(limit)}`, null, true)
  },
}

// ---------- Ratings ----------

/** GET/POST/DELETE /ratings 共用的评分汇总（服务端 ratingSummary） */
export interface RatingSummaryResponse {
  novelId: string
  average: number
  count: number
  distribution: Record<number, number>
  myRating: number | null
}

export const ratingsApi = {
  get(novelId: string): Promise<RatingSummaryResponse> {
    return request('GET', `/ratings?novelId=${encodeURIComponent(novelId)}`, null, isAuthenticated())
  },
  set(novelId: string, rating: number): Promise<RatingSummaryResponse> {
    return request('POST', '/ratings', { novelId, rating }, true)
  },
  remove(novelId: string): Promise<RatingSummaryResponse> {
    return request('DELETE', `/ratings?novelId=${encodeURIComponent(novelId)}`, null, true)
  },
}

// ---------- Comments ----------

export const commentsApi = {
  list(params: Record<string, string> = {}): Promise<{ comments: Comment[]; total?: number; hasMore?: boolean }> {
    const qs = new URLSearchParams(params).toString()
    return request('GET', `/comments${qs ? '?' + qs : ''}`, null, isAuthenticated())
  },
  create(data: Record<string, unknown>): Promise<{ comment: Comment }> {
    return request('POST', '/comments', data, true)
  },
  update(id: string, data: Record<string, unknown>): Promise<{ comment: Comment }> {
    return request('PUT', '/comments', { id, ...data }, true)
  },
  remove(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/comments?id=${encodeURIComponent(id)}`, null, true)
  },
  hardDelete(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/comments?id=${encodeURIComponent(id)}&hard=1`, null, true)
  },
  like(id: string): Promise<{ ok: boolean }> {
    return request('POST', `/comments/${encodeURIComponent(id)}/like`, null, true)
  },
  unlike(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/comments/${encodeURIComponent(id)}/like`, null, true)
  },
  report(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    return request('POST', `/comments/${encodeURIComponent(id)}/report`, data, true)
  },
}

// ---------- Setup（安装向导，免鉴权；仅安装窗口内可用） ----------

export interface SetupStatus {
  needsSetup: boolean
  needsBootstrap: boolean
  optionalKeys: string[]
}

export interface SetupDatabaseFields {
  host: string
  port: string
  user: string
  password: string
  database: string
  ssl: boolean
}

export const setupApi = {
  status(): Promise<SetupStatus> {
    return request('GET', '/setup/status')
  },
  database(fields: SetupDatabaseFields): Promise<{ ok: boolean; applied: string[] }> {
    return request('POST', '/setup/database', fields)
  },
  options(fields: Record<string, string>): Promise<{ ok: boolean; optionalKeys: string[] }> {
    return request('POST', '/setup/options', fields)
  },
}

export const authApi = {
  me(): Promise<{ user: User | null }> {
    return request('GET', '/auth/me', null, true)
  },
  meCached(): Promise<{ user: User | null }> {
    if (!getToken()) return Promise.resolve({ user: null })
    if (!mePromise) {
      mePromise = request<{ user: User | null }>('GET', '/auth/me', null, true).catch((err) => {
        mePromise = null
        throw err
      })
    }
    return mePromise!
  },
  invalidate(): void {
    mePromise = null
  },
  register(username: string, password: string, invite = ''): Promise<{ token: string; user: User }> {
    return request('POST', '/auth/register', { username, password, ...(invite ? { invite } : {}) }).then((r) => {
      if ((r as { token?: string }).token) setToken((r as { token: string }).token)
      return r as { token: string; user: User }
    })
  },
  login(username: string, password: string, persist = false): Promise<{ token: string; user: User }> {
    return request('POST', '/auth/login', { username, password }).then((r) => {
      if ((r as { token?: string }).token) setToken((r as { token: string }).token, persist)
      return r as { token: string; user: User }
    })
  },
  registerStatus(): Promise<{ mode: 'invite' | 'open' | 'closed' }> {
    return request('GET', '/auth/register-status')
  },
  bootstrapStatus(): Promise<{ needsBootstrap: boolean }> {
    return request('GET', '/auth/bootstrap-admin')
  },
  bootstrapAdmin(username: string, password: string): Promise<{ token: string; user: User }> {
    return request('POST', '/auth/bootstrap-admin', { username, password }).then((r) => {
      if ((r as { token?: string }).token) setToken((r as { token: string }).token)
      return r as { token: string; user: User }
    })
  },
  update(data: Record<string, unknown>): Promise<{ user: User }> {
    return request('PUT', '/auth/me', data, true)
  },
  changePassword(currentPassword: string, newPassword: string): Promise<{ token: string }> {
    return request('POST', '/auth/change-password', { currentPassword, newPassword }, true).then((r) => {
      if ((r as { token?: string }).token) setToken((r as { token: string }).token)
      return r as { token: string }
    })
  },
  logout(): Promise<void> {
    return request('POST', '/auth/logout', null, true).catch(() => {}).then(() => clearToken())
  },
  logoutAll(): Promise<void> {
    return request('POST', '/auth/logout-all', null, true).catch(() => {}).then(() => clearToken())
  },
  readerSettings(): Promise<{ settings: Record<string, string>; updatedAt: Record<string, number> }> {
    return request('GET', '/auth/reader-settings', null, true)
  },
  updateReaderSettings(settings: ReaderSettings): Promise<{ settings: Record<string, string>; updatedAt: Record<string, number> }> {
    return request('PUT', '/auth/reader-settings', { settings: settings.values, updatedAt: settings.updatedAt }, true)
  },
  uploadAvatar(file: File): Promise<{ ok: boolean }> {
    const form = new FormData()
    form.append('avatar', file)
    return authFetch('/auth/avatar', { method: 'PUT', body: form }).then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
      return data
    })
  },
  deleteAvatar(): Promise<{ ok: boolean }> {
    return request('DELETE', '/auth/avatar', null, true)
  },
  sessions(): Promise<{ sessions: unknown[] }> {
    return request('GET', '/auth/sessions', null, true)
  },
  deleteSession(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/auth/sessions?id=${encodeURIComponent(id)}`, null, true)
  },
}

// ---------- Admin ----------

export interface AdminComment extends Comment {
  novelTitle: string
  userUsername: string
  userDisplayName: string
  clientIdHash: string
  ipHash: string
}

export interface CommentReportItem {
  id: string
  commentId: string
  reportedBy: string
  reason: string
  note: string
  status: string
  resolvedBy: string
  resolvedAt: number
  createdAt: number
  commentText: string
  commentStatus: string
  commentNovelId: string
  commentAuthor: string
  novelTitle: string
  reporterUsername: string
  reporterDisplayName: string
  resolverUsername: string
}

export const adminApi = {
  stats(): Promise<Record<string, unknown>> {
    return request('GET', '/admin/stats', null, true)
  },
  novelIndex(params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams(params).toString()
    return request('GET', `/admin/novel-index${qs ? '?' + qs : ''}`, null, true)
  },
  comments: {
    list(params: Record<string, string> = {}): Promise<{ comments: AdminComment[]; total?: number }> {
      const qs = new URLSearchParams(params).toString()
      return request('GET', `/admin/comments${qs ? '?' + qs : ''}`, null, true)
    },
    update(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
      return request('PUT', '/admin/comments', { id, ...data }, true)
    },
    remove(id: string): Promise<{ ok: boolean }> {
      return request('DELETE', `/admin/comments?id=${encodeURIComponent(id)}`, null, true)
    },
  },
  commentReports: {
    list(params: Record<string, string> = {}): Promise<{ reports: CommentReportItem[]; total?: number }> {
      const qs = new URLSearchParams(params).toString()
      return request('GET', `/admin/comment-reports${qs ? '?' + qs : ''}`, null, true)
    },
    update(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
      return request('PUT', '/admin/comment-reports', { id, ...data }, true)
    },
  },
  users: {
    list(): Promise<Record<string, unknown>> {
      return request('GET', '/admin-users', null, true)
    },
    setRegisterMode(registerMode: string): Promise<{ ok: boolean }> {
      return request('POST', '/admin-users', { action: 'settings', registerMode }, true)
    },
    createInvites(count: number): Promise<{ code: string; codes: string[] }> {
      return request('POST', '/admin-users', { action: 'invite', count }, true)
    },
    disableInvite(code: string): Promise<{ ok: boolean }> {
      return request('POST', '/admin-users', { action: 'disable-invite', code }, true)
    },
    clearInvites(): Promise<{ success: boolean; removed: number }> {
      return request('POST', '/admin-users', { action: 'clear-invites' }, true)
    },
    setStatus(id: string, status: string): Promise<{ ok: boolean }> {
      return request('POST', '/admin-users', { action: 'user-status', id, status }, true)
    },
    setRole(id: string, role: string): Promise<{ ok: boolean }> {
      return request('POST', '/admin-users', { action: 'user-role', id, role }, true)
    },
    resetPassword(id: string): Promise<{ success: boolean; username: string; tempPassword: string }> {
      return request('POST', '/admin-users', { action: 'reset-password', id }, true)
    },
    deleteUser(id: string, confirmUsername: string): Promise<{ ok: boolean }> {
      return request('POST', '/admin-users', { action: 'delete-user', id, confirmUsername }, true)
    },
    loginAudit(filters: { status?: string; username?: string; limit?: number; offset?: number } = {}): Promise<{
      audits: Array<{
        id: string
        userId: string
        username: string
        displayName: string
        status: string
        reason: string
        ipAddress: string
        userAgent: string
        createdAt: number
      }>
      total: number
      limit: number
      offset: number
    }> {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.username) params.set('username', filters.username)
      params.set('limit', String(filters.limit || 50))
      params.set('offset', String(filters.offset || 0))
      return request('GET', `/admin-users/login-audit?${params.toString()}`, null, true)
    },
  },
}

// ---------- Download logs ----------

export const downloadLogsApi = {
  list(limit = 50): Promise<{ logs: unknown[] }> {
    return request('GET', `/download-logs?limit=${encodeURIComponent(limit)}`, null, true)
  },
}

// ---------- Scrape ----------

export const scrapeApi = {
  detect(sourceUrl: string): Promise<{ detected: boolean; source?: string; preset?: unknown }> {
    return request('POST', '/scrape', { action: 'detect', sourceUrl }, true)
  },
  detectMeta(sourceUrl: string): Promise<Record<string, unknown>> {
    return request('POST', '/scrape', { action: 'detect-meta', sourceUrl }, true)
  },
  start(config: Record<string, unknown>): Promise<{ jobId: string }> {
    return request('POST', '/scrape', { action: 'start', ...config }, true)
  },
  status(jobId: string): Promise<Record<string, unknown>> {
    return request('GET', `/scrape?action=job-status&jobId=${encodeURIComponent(jobId)}`, null, true)
  },
  jobs(): Promise<{ jobs: unknown[] }> {
    return request('GET', '/scrape?action=jobs', null, true)
  },
  jobItems(jobId: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({ action: 'job-items', jobId, ...params }).toString()
    return request('GET', `/scrape?${qs}`, null, true)
  },
  jobLogs(jobId: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({ action: 'job-logs', jobId, ...params }).toString()
    return request('GET', `/scrape?${qs}`, null, true)
  },
  retryFailed(jobId: string): Promise<{ ok: boolean }> {
    return request('POST', '/scrape', { action: 'retry-failed', jobId }, true)
  },
  cancel(jobId: string): Promise<{ ok: boolean }> {
    return request('POST', '/scrape', { action: 'cancel', jobId }, true)
  },
}

// ---------- AI ----------

export interface AiQuota {
  used: number
  /** -1 表示不限额（管理员） */
  limit: number
  resetAt: number
}

export interface AiStatus {
  configured: boolean
  features: { recap: boolean; catchup: boolean }
  model: string
  quota: AiQuota | null
  /** 「回来接着读」的过期天数：入口渲染阈值与后端判定同源 */
  catchupStaleDays: number
}

export interface AiSettings {
  recapEnabled: boolean
  dailyQuota: number
  maxChapterChars: number
  // 前情提要参数
  recapTemperature: number
  recapMaxTokens: number
  recapSystemPrompt: string
  // 回顾总结参数
  catchupEnabled: boolean
  catchupStaleDays: number
  catchupMaxChapters: number
  catchupTemperature: number
  catchupMaxTokens: number
  // AI 创作参数
  writingTemperature: number
  writingMaxTokens: number
  writingSystemPrompt: string
  maxConcurrentWritingTasks: number
  // 运维配置
  taskRetentionDays: number
  // 审计配置
  logIpAddress: boolean
  logUserAgent: boolean
}

export interface AiUsageSummary {
  calls: number
  promptTokens: number
  completionTokens: number
  costMillicents: number
}

export interface AiTaskInfo {
  id: string
  userId: string
  novelId: string
  kind: string
  status: string
  current: number
  total: number
  step: string
  prompt: string
  batchId: string
  /** 创建时的请求参数（JSON），非空才支持重试 */
  params: string
  error: string
  createdAt: number
  updatedAt: number
  finishedAt: number
}

export interface AiProviderConfig {
  baseUrl: string
  model: string
  /** 密钥不回传明文，只告知是否已设定 */
  hasApiKey: boolean
}

export const aiApi = {
  status(): Promise<AiStatus> {
    return request('GET', '/ai/status', null, true)
  },
  recap(chapterId: string, force = false): Promise<{ recap: string; cached: boolean; model: string; id: string }> {
    return request('POST', '/ai/recap', force ? { chapterId, force: true } : { chapterId }, true)
  },
  /** 只读缓存：没有已生成的提要就返回空串，不触发生成也不计配额。 */
  cachedRecap(chapterId: string): Promise<{ recap: string; cached: boolean }> {
    return request('GET', `/ai/recap?chapterId=${encodeURIComponent(chapterId)}`, null, true)
  },
  /** 回来接着读：用已缓存的单章提要合成一段连贯回顾；原料不足时 recap 为 null。 */
  catchup(novelId: string): Promise<{
    recap: string | null
    cached: boolean
    model?: string
    id?: string
    chapterIds?: string[]
    reason?: 'no_progress' | 'not_stale' | 'insufficient_summaries'
  }> {
    return request('POST', '/ai/catchup', { novelId }, true)
  },
  settings(): Promise<{ settings: AiSettings; provider: { configured: boolean; host: string; model: string; hasKey: boolean }; providerConfig: AiProviderConfig }> {
    return request('GET', '/ai/settings', null, true)
  },
  saveSettings(patch: Partial<AiSettings>): Promise<{ settings: AiSettings }> {
    return request('PUT', '/ai/settings', patch, true)
  },
  /**
   * 修改 AI 供应商配置（baseUrl / apiKey / model）。
   * apiKey 传 undefined 表示不改动原密钥；传空字符串表示清空。
   */
  saveProviderConfig(patch: { baseUrl?: string; apiKey?: string; model?: string }): Promise<{
    ok: boolean
    provider: { configured: boolean; host: string; model: string; hasKey: boolean }
    providerConfig: AiProviderConfig
  }> {
    return request('PUT', '/ai/provider', patch, true)
  },
  test(): Promise<{ ok: boolean; model?: string; reply?: string; error?: string; code?: string; elapsedMs: number }> {
    return request('POST', '/ai/test', {}, true)
  },
  writing: {
    /** 创作类接口统一为后台任务模式：立即返回任务 id，用 aiApi.task 轮询进度，产物在「已生成内容」。 */
    outline(data: Record<string, unknown>): Promise<{ ok: boolean; taskId: string; batchId: string; total: number }> {
      return request('POST', '/ai/writing/outline', data, true)
    },
    chapter(data: Record<string, unknown>): Promise<{ ok: boolean; taskId: string; batchId: string; total: number }> {
      return request('POST', '/ai/writing/chapter', data, true)
    },
    continue(data: Record<string, unknown>): Promise<{ ok: boolean; taskId: string; batchId: string; total: number }> {
      return request('POST', '/ai/writing/continue', data, true)
    },
    titles(data: { content: string; novelId?: string; contextTitle?: string }): Promise<{ titles: string[]; usage: { model: string; promptTokens: number; completionTokens: number } }> {
      return request('POST', '/ai/writing/titles', data, true)
    },
    updateDraft(id: string, result: string): Promise<{ ok: boolean; id: string; result: string }> {
      return request('PUT', `/ai/writing/drafts/${encodeURIComponent(id)}`, { result }, true)
    },
    publishDraft(id: string, data: { novelId: string; title: string }): Promise<{ ok: boolean; chapter: { id: string; title: string; order: number } }> {
      return request('POST', `/ai/writing/drafts/${encodeURIComponent(id)}/publish`, data, true)
    },
    /** 整批发布续写草稿：按 batchIndex 顺序发布，标题自动使用「第 N 章」递增。 */
    publishBatch(batchId: string, data: { novelId: string }): Promise<{ ok: boolean; published: Array<{ id: string; title: string; order: number; generationId: string }>; novelId: string }> {
      return request('POST', `/ai/writing/batches/${encodeURIComponent(batchId)}/publish`, data, true)
    },
  },
  usage(): Promise<{ today: AiUsageSummary; last30d: AiUsageSummary }> {
    return request('GET', '/ai/usage', null, true)
  },
  tasks(filters: { limit?: number; offset?: number; status?: string; kind?: string } = {}): Promise<{
    items: AiTaskInfo[]
    total: number
    limit: number
    offset: number
  }> {
    const params = new URLSearchParams({ limit: String(filters.limit || 50), offset: String(filters.offset || 0) })
    if (filters.status) params.set('status', filters.status)
    if (filters.kind) params.set('kind', filters.kind)
    return request('GET', `/ai/tasks?${params}`, null, true)
  },
  /** 单任务查询：后台创作任务的进度轮询。 */
  task(id: string): Promise<{ task: AiTaskInfo }> {
    return request('GET', `/ai/tasks/${encodeURIComponent(id)}`, null, true)
  },
  cancelTask(id: string): Promise<{ ok: boolean }> {
    return request('POST', `/ai/tasks/${encodeURIComponent(id)}/cancel`, {}, true)
  },
  /** 删除已结束的任务记录（completed/failed/cancelled），运行中需先取消。 */
  deleteTask(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/ai/tasks/${encodeURIComponent(id)}`, null, true)
  },
  /** 按原参数重试失败/取消的创作任务，返回新任务 id。 */
  retryTask(id: string): Promise<{ ok: boolean; taskId: string; batchId: string; total: number }> {
    return request('POST', `/ai/tasks/${encodeURIComponent(id)}/retry`, {}, true)
  },
  /** 已生成内容列表（管理端）：默认已发布，可筛类型。 */
  generations(filters: { kind?: 'summary' | 'catchup' | 'continue' | 'write_outline' | 'write_chapter'; scope?: 'all' | 'reader' | 'writing'; status?: 'all' | 'published' | 'draft' | 'rejected'; limit?: number; offset?: number } = {}): Promise<{
    items: Array<{
      id: string
      novelId: string
      novelTitle: string
      chapterId: string
      chapterTitle: string
      kind: string
      model: string
      result: string
      status: string
      createdAt: number
      prompt: string
      batchId: string
      batchIndex: number
      batchCount: number
    }>
    total: number
    limit: number
    offset: number
  }> {
    const params = new URLSearchParams()
    if (filters.kind) params.set('kind', filters.kind)
    if (filters.scope) params.set('scope', filters.scope)
    if (filters.status) params.set('status', filters.status)
    if (filters.limit) params.set('limit', String(filters.limit))
    if (filters.offset) params.set('offset', String(filters.offset))
    return request('GET', `/ai/generations?${params}`, null, true)
  },
  /** 删除单条已生成内容（管理端）：读者再访问时会重新生成并计配额。 */
  deleteGeneration(id: string): Promise<{ ok: boolean }> {
    return request('DELETE', `/ai/generations/${encodeURIComponent(id)}`, null, true)
  },
  deleteGenerations(ids: string[]): Promise<{ ok: boolean; deleted: number }> {
    return request('POST', '/ai/generations/batch-delete', { ids }, true)
  },
  audit: {
    users(limit = 50, offset = 0): Promise<{
      users: Array<{
        id: string
        username: string
        displayName: string
        callCount: number
        totalPromptTokens: number
        totalCompletionTokens: number
        totalCostMillicents: number
        lastCallAt: number
      }>
      total: number
      limit: number
      offset: number
    }> {
      return request('GET', `/ai/audit/users?limit=${limit}&offset=${offset}`, null, true)
    },
    calls(filters: { userId?: string; type?: string; from?: number; to?: number; limit?: number; offset?: number } = {}): Promise<{
      calls: Array<{
        id: string
        type: string
        model: string
        promptTokens: number
        completionTokens: number
        costMillicents: number
        createdAt: number
        userId: string
        username: string
        displayName: string
        novelId: string
        novelTitle: string
        chapterId: string
        chapterTitle: string
        ipAddress: string
        userAgent: string
      }>
      total: number
      limit: number
      offset: number
    }> {
      const params = new URLSearchParams()
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.type) params.set('type', filters.type)
      if (filters.from) params.set('from', String(filters.from))
      if (filters.to) params.set('to', String(filters.to))
      if (filters.limit) params.set('limit', String(filters.limit))
      if (filters.offset) params.set('offset', String(filters.offset))
      return request('GET', `/ai/audit/calls?${params}`, null, true)
    },
    trend(days = 30): Promise<{
      trend: Array<{
        date: string
        calls: number
        promptTokens: number
        completionTokens: number
        costMillicents: number
      }>
      days: number
    }> {
      return request('GET', `/ai/audit/trend?days=${days}`, null, true)
    },
  },
}
