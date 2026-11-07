import { getStorageScope } from './storage'

export type ProgressUpload = {
  novelId: string
  chapterId: string
  scrollPercent: number
  clientUpdatedAt: number
}

export interface PendingProgress {
  key: string
  scope: string
  payload: ProgressUpload
}

export const PROGRESS_OUTBOX_PREFIX = 'novel_progress_outbox:'
// 存储不可写时仍保留本次页面的重试机会；持久化失败不能中断阅读。
const volatileEntries = new Map<string, PendingProgress>()

function prefix(scope: string): string {
  return `${PROGRESS_OUTBOX_PREFIX}${encodeURIComponent(scope)}:`
}

function validPayload(value: unknown): value is ProgressUpload {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<ProgressUpload>
  return typeof p.novelId === 'string' && !!p.novelId && typeof p.chapterId === 'string' && !!p.chapterId
    && typeof p.scrollPercent === 'number' && Number.isFinite(p.scrollPercent) && p.scrollPercent >= 0 && p.scrollPercent <= 1
    && typeof p.clientUpdatedAt === 'number' && Number.isSafeInteger(p.clientUpdatedAt) && p.clientUpdatedAt > 0
}

function allPending(): PendingProgress[] {
  const scope = getStorageScope()
  if (!scope.startsWith('user:')) return []
  const entries = new Map<string, PendingProgress>()
  const scopedPrefix = prefix(scope)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(scopedPrefix)) continue
      try {
        const payload: unknown = JSON.parse(localStorage.getItem(key) || '')
        if (validPayload(payload)) entries.set(key, { key, scope, payload })
      } catch { /* 单条损坏不影响其他作品补传。 */ }
    }
  } catch { /* 当前页面仍可使用内存中的待发送记录。 */ }
  for (const [key, entry] of volatileEntries) if (entry.scope === scope) entries.set(key, entry)
  return [...entries.values()]
}

export function removePendingProgress(entry: PendingProgress): void {
  if (entry.scope !== getStorageScope()) return
  try { localStorage.removeItem(entry.key) } catch { /* 重复补传仍由服务端时间戳保证幂等。 */ }
  volatileEntries.delete(entry.key)
}

export function hasPendingProgress(entry: PendingProgress): boolean {
  if (entry.scope !== getStorageScope()) return false
  if (volatileEntries.has(entry.key)) return true
  try { return localStorage.getItem(entry.key) !== null } catch { return false }
}

/** 操作使用独立键，旧请求确认/另一标签页清理时不会删除后来写入的位置。 */
export function enqueueProgress(payload: ProgressUpload): boolean {
  const scope = getStorageScope()
  if (!scope.startsWith('user:') || !validPayload(payload)) return false
  const previous = allPending().filter(entry => entry.payload.novelId === payload.novelId)
  if (previous.some(entry => entry.payload.clientUpdatedAt > payload.clientUpdatedAt)) return false
  const key = prefix(scope) + crypto.randomUUID()
  const entry = { key, scope, payload: { ...payload } }
  let persisted = true
  try { localStorage.setItem(key, JSON.stringify(payload)) }
  catch { persisted = false; volatileEntries.set(key, entry) }
  if (persisted) previous.forEach(removePendingProgress)
  else previous.forEach(old => volatileEntries.delete(old.key)) // 写盘失败时保留旧的持久副本。
  return true
}

export function pendingProgress(): PendingProgress[] {
  const latest = new Map<string, PendingProgress>()
  const ordered = allPending().sort((a, b) => b.payload.clientUpdatedAt - a.payload.clientUpdatedAt || b.key.localeCompare(a.key))
  for (const entry of ordered) if (!latest.has(entry.payload.novelId)) latest.set(entry.payload.novelId, entry)
  return [...latest.values()]
}

/** 云端新位置/删除标记确认后，只丢弃不晚于该版本的待上传操作。 */
export function acknowledgeProgress(novelId: string, through: number): void {
  if (!Number.isFinite(through) || through <= 0) return
  for (const entry of allPending()) {
    if (entry.payload.novelId === novelId && entry.payload.clientUpdatedAt <= through) removePendingProgress(entry)
  }
}
