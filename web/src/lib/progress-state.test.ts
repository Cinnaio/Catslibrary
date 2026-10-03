import { beforeEach, expect, it } from 'vitest'
import { applyProgressState } from './progress-state'
import { getNovelHistory, saveHistory, setStorageUser } from './storage'
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setStorageUser(null) })
it('云端位置镜像到本机，刷新后可恢复章节及滚动比例', () => {
  applyProgressState('book', { progress: { chapterId: 'chapter', scrollPercent: .75, updatedAt: 200 } })
  expect(getNovelHistory('book')).toMatchObject({ chapterId: 'chapter', scrollPercent: .75, timestamp: 200 })
})
it('较新或同版本墓碑清除旧历史，较旧墓碑不删除新阅读', () => {
  saveHistory('book', { chapterId: 'chapter', timestamp: 200 })
  expect(applyProgressState('book', { progress: null, tombstone: { deletedAt: 100 } })?.chapterId).toBe('chapter')
  expect(applyProgressState('book', { progress: null, tombstone: { deletedAt: 200 } })).toBeNull()
  expect(getNovelHistory('book')).toBeNull()
})
it('新云端位置不沿用旧设备页码；同位置保留本机分页信息', () => {
  saveHistory('book', { chapterId: 'chapter', scrollPercent: .2, pageMode: 'page', pageIndex: 9, timestamp: 100 })
  applyProgressState('book', { progress: { chapterId: 'chapter', scrollPercent: .8, updatedAt: 200 } })
  expect(getNovelHistory('book')).toMatchObject({ scrollPercent: .8, pageMode: '', pageIndex: 0 })
  saveHistory('book', { chapterId: 'chapter', scrollPercent: .8, pageMode: 'page', pageIndex: 5, timestamp: 200 })
  applyProgressState('book', { progress: { chapterId: 'chapter', scrollPercent: .8, updatedAt: 300 } })
  expect(getNovelHistory('book')?.pageIndex).toBe(5)
})
it('较新的本机位置不会被旧云端响应覆盖', () => {
  saveHistory('book', { chapterId: 'new', timestamp: 300 })
  expect(applyProgressState('book', { progress: { chapterId: 'old', updatedAt: 200 } })?.chapterId).toBe('new')
})
