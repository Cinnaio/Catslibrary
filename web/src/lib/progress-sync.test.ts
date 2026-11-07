import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getNovelHistory, saveHistory, setStorageUser } from './storage'
import { acknowledgeProgress, enqueueProgress, pendingProgress, type ProgressUpload } from './progress-outbox'
import { applyProgressState, type ProgressState } from './progress-state'
const mocks = vi.hoisted(() => ({ token: 'a', save: vi.fn(), exit: vi.fn() }))
vi.mock('./api', () => ({ getToken: () => mocks.token, progressApi: { save: mocks.save, saveOnExit: mocks.exit } }))
import { createProgressSync } from './progress-sync'

let sync: ReturnType<typeof createProgressSync>, stop: () => void
function account(id: string) {
  mocks.token = id
  localStorage.setItem('user_session_marker', id)
  setStorageUser(id)
}
const confirmed = (p: ProgressUpload) => ({ success: true, progress: { chapterId: p.chapterId, scrollPercent: p.scrollPercent, updatedAt: p.clientUpdatedAt }, tombstone: null })
const settle = () => vi.advanceTimersByTimeAsync(0)
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000)
  localStorage.clear(); sessionStorage.clear(); account('a')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  mocks.save.mockReset().mockImplementation(async p => confirmed(p))
  mocks.exit.mockReset().mockImplementation(async p => confirmed(p))
  sync = createProgressSync(); stop = sync.start()
})
afterEach(() => { stop(); vi.useRealTimers(); vi.restoreAllMocks() })

it('失败后自动退避重试，保留原操作时刻，成功确认后才清除', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'))
  sync.queue('n', 'c1', .2); await settle()
  expect(pendingProgress()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(9999)
  expect(mocks.save).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(mocks.save).toHaveBeenLastCalledWith({ novelId: 'n', chapterId: 'c1', scrollPercent: .2, clientUpdatedAt: 100_000 })
  expect(pendingProgress()).toEqual([])
})

it('离线保留每本书最新位置，重新联网可补传多本', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  sync.queue('n', 'c1', .1)
  await vi.advanceTimersByTimeAsync(1000)
  sync.queue('n', 'c2', .7); sync.queue('other', 'c3', .4)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(pendingProgress()).toHaveLength(2)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online')); await settle()
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(mocks.save).toHaveBeenCalledWith({ novelId: 'n', chapterId: 'c2', scrollPercent: .7, clientUpdatedAt: 101_000 })
  expect(pendingProgress()).toEqual([])
})

it('重新打开应用并确认身份后补传，不要求再次打开阅读器', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'))
  sync.queue('n', 'c', .5); await settle(); stop()
  sync = createProgressSync(); stop = sync.start(); await settle()
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(pendingProgress()).toEqual([])
  expect(getNovelHistory('n')?.chapterId).toBe('c')
})

it('账号切换不上传前一账号的队列，切回后可恢复', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'))
  sync.queue('n', 'a-chapter', .1); await settle()
  account('b'); stop(); stop = sync.start()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(pendingProgress()).toEqual([])
  account('a'); stop(); stop = sync.start(); await settle()
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(getNovelHistory('n')?.chapterId).toBe('a-chapter')
})

it('账号标记已变化但身份未确认时不重放，也不消费旧响应', async () => {
  let resolve!: (state: ProgressState) => void
  mocks.save.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  sync.queue('n', 'c', .1)
  mocks.token = 'b'; localStorage.setItem('user_session_marker', 'b')
  resolve(confirmed({ novelId: 'n', chapterId: 'c', scrollPercent: .1, clientUpdatedAt: 100_000 }))
  await settle(); await sync.flush()
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(getNovelHistory('n')).toBeNull()
  account('a')
  expect(pendingProgress()).toHaveLength(1)
})

it('延迟发送保留操作时刻，旧请求迟到不清掉更新的位置', async () => {
  let resolve!: (state: ProgressState) => void
  mocks.save.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  sync.queue('n', 'c1', .1)
  await vi.advanceTimersByTimeAsync(1000)
  saveHistory('n', { chapterId: 'c2', scrollPercent: .2, timestamp: 101_000 })
  sync.queue('n', 'c2', .2)
  resolve(confirmed({ novelId: 'n', chapterId: 'c1', scrollPercent: .1, clientUpdatedAt: 100_000 })); await settle()
  expect(pendingProgress()[0]?.payload.chapterId).toBe('c2')
  expect(getNovelHistory('n')?.chapterId).toBe('c2')
  await vi.advanceTimersByTimeAsync(9000)
  expect(mocks.save).toHaveBeenLastCalledWith({ novelId: 'n', chapterId: 'c2', scrollPercent: .2, clientUpdatedAt: 101_000 })
  expect(pendingProgress()).toEqual([])
})

it('删除标记清理旧队列，晚到的上传响应不恢复已删除历史', async () => {
  let resolve!: (state: ProgressState) => void
  mocks.save.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  saveHistory('n', { chapterId: 'c', timestamp: 100_000 }); sync.queue('n', 'c', .1)
  applyProgressState('n', { progress: null, tombstone: { deletedAt: 100_001 } })
  resolve(confirmed({ novelId: 'n', chapterId: 'c', scrollPercent: .1, clientUpdatedAt: 100_000 })); await settle()
  expect(getNovelHistory('n')).toBeNull()
  expect(pendingProgress()).toEqual([])
  await vi.advanceTimersByTimeAsync(60_000)
  expect(mocks.save).toHaveBeenCalledTimes(1)
})

it('删除之后的新阅读不会被旧墓碑或确认清掉', () => {
  enqueueProgress({ novelId: 'n', chapterId: 'new', scrollPercent: .5, clientUpdatedAt: 200_000 })
  saveHistory('n', { chapterId: 'new', timestamp: 200_000 })
  applyProgressState('n', { progress: null, tombstone: { deletedAt: 100_000 } })
  acknowledgeProgress('n', 100_000)
  expect(pendingProgress()).toHaveLength(1)
  expect(getNovelHistory('n')?.chapterId).toBe('new')
})

it('退出 keepalive 失败不丢队列，下次启动继续上传', async () => {
  sync.queue('first', 'c', .1); await settle()
  sync.queue('n', 'c', .2)
  mocks.exit.mockRejectedValueOnce(new Error('offline'))
  await sync.flush(true)
  expect(pendingProgress()).toHaveLength(1)
  stop(); sync = createProgressSync(); stop = sync.start(); await settle()
  expect(pendingProgress()).toEqual([])
})

it('没有进度或墓碑的成功响应不被误认为已同步', async () => {
  mocks.save.mockResolvedValueOnce({ success: true })
  sync.queue('n', 'c', .1); await settle()
  expect(pendingProgress()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(pendingProgress()).toEqual([])
})

it('连续离页事件不会重复发送同一待上传操作', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  sync.queue('n', 'c', .5)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  let finish!: (state: ProgressState) => void
  mocks.exit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pagehide'))
  await sync.flush(true)
  expect(mocks.exit).toHaveBeenCalledTimes(1)
  expect(pendingProgress()).toHaveLength(1)
  finish(confirmed({ novelId: 'n', chapterId: 'c', scrollPercent: .5, clientUpdatedAt: 100_000 }))
  await settle()
  expect(pendingProgress()).toEqual([])
})

it('单本被拒绝不阻塞其他作品，损坏缓存不阻止补传', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  sync.queue('ok', 'c', .1)
  await vi.advanceTimersByTimeAsync(1); sync.queue('denied', 'c', .2)
  localStorage.setItem('novel_progress_outbox:user%3Aa:broken', '{bad json')
  mocks.save.mockImplementation(async p => { if (p.novelId === 'denied') throw new Error('403'); return confirmed(p) })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online')); await settle()
  expect(getNovelHistory('ok')?.chapterId).toBe('c')
  expect(pendingProgress().map(e => e.payload.novelId)).toEqual(['denied'])
})

it('游客和待确认身份不会产生可上传队列', async () => {
  mocks.token = ''; localStorage.removeItem('user_session_marker'); setStorageUser(null)
  sync.queue('guest', 'c', .1)
  expect(enqueueProgress({ novelId: 'guest', chapterId: 'c', scrollPercent: .1, clientUpdatedAt: 100_000 })).toBe(false)
  mocks.token = 'pending'; localStorage.setItem('user_session_marker', 'pending')
  sync.queue('pending', 'c', .1); await sync.flush()
  expect(mocks.save).not.toHaveBeenCalled()
})

it('本地存储写入失败仍可在页面内重试，并保留旧持久副本', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  sync.queue('n', 'old', .1)
  await vi.advanceTimersByTimeAsync(1)
  const oldKey = pendingProgress()[0]!.key
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
  expect(() => sync.queue('n', 'new', .5)).not.toThrow()
  expect(localStorage.getItem(oldKey)).not.toBeNull()
  expect(pendingProgress()[0]?.payload.chapterId).toBe('new')
  write.mockRestore()
  // 设备时钟偏快时，服务端确认可能早于旧磁盘副本；旧位置也不得重新上传。
  mocks.save.mockImplementationOnce(async p => ({ progress: { ...confirmed(p).progress, updatedAt: 90_000 }, tombstone: null }))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online')); await settle()
  expect(mocks.save).toHaveBeenLastCalledWith({ novelId: 'n', chapterId: 'new', scrollPercent: .5, clientUpdatedAt: 100_001 })
  expect(pendingProgress()).toEqual([])
})
