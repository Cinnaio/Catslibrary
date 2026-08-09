/**
 * API 客户端 —— 类型化 fetch 封装（由 Novel-KV js/api.js 平移）。
 * 零依赖：AbortSignal.timeout 超时、token 存储（localStorage/sessionStorage）、
 * 通用 request(method, path, body, useAuth)。
 */
import type { ChapterFull, ChapterMeta, Comment, Novel, NovelListResponse, Rating, ReaderSettings, Thought, User } from '@shared/types'

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

function timedFetch(input: RequestInfo | URL, opts: RequestInit = {}): Promise<Response> {
  if (!opts.signal && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    opts.signal = (AbortSignal as { timeout(ms: number): AbortSignal }).timeout(API_TIMEOUT_MS)
  }
  return fetch(input, opts)
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  keepalive?: boolean
  signal?: AbortSignal
}

async function request<T = unknown>(method: string, path: string, body: unknown = null, useAuth = false, extraHeaders: Record<string, string> = {}): Promise<T> {
  const hasBody = !!body && method !== 'GET'
  // 有 body 才声明 Content-Type：GET 带它会让跨域读取多一次 preflight
  const headers = { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }
  if (useAuth) Object.assign(headers, authHeaders())

  const opts: RequestInit = { method, headers }
  if (hasBody) opts.body = JSON.stringify(body)
  // 禁用浏览器 HTTP 缓存：管理员读写后必须拿到最新数据（后端 max-age 只留给 CDN/代理层）
  opts.cache = 'no-store'

  const res = await timedFetch(url(path), opts)
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

export const progressApi = {
  get(novelId: string): Promise<{ progress: unknown }> {
    return request('GET', `/progress?novelId=${encodeURIComponent(novelId)}`, null, isAuthenticated())
  },
  recent(limit = 5): Promise<{ items: unknown[] }> {
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

export const ratingsApi = {
  get(novelId: string): Promise<{ rating?: number; myRating?: number; average?: number; count?: number }> {
    return request('GET', `/ratings?novelId=${encodeURIComponent(novelId)}`, null, isAuthenticated())
  },
  set(novelId: string, rating: number): Promise<{ ok: boolean }> {
    return request('POST', '/ratings', { novelId, rating }, true)
  },
  remove(novelId: string): Promise<{ ok: boolean }> {
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

// ---------- Auth ----------

let mePromise: Promise<{ user: User | null }> | null = null

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
