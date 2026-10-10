import { beforeEach, expect, it } from 'vitest'
import { readLegacyReadingData } from './legacy-reading-data'
import { normalizeLegacyReadingData } from '@shared/reading-data'
beforeEach(() => localStorage.clear())
it('仅识别未归属的旧版数据，规范字段、去重并保留原始键', () => {
  const bookmarks = JSON.stringify([
    { id: 'other-users-id', novelId: 'n', chapterId: 'c', note: '备注', timestamp: 1 },
    { novelId: 'n', chapterId: 'c', note: '最新', timestamp: 2 },
  ])
  localStorage.setItem('novel_bookmarks', bookmarks)
  localStorage.setItem('novel_reading_history', JSON.stringify({ n: { chapterId: 'c', scrollPercent: 2, timestamp: 3 } }))
  localStorage.setItem('novel_bookshelf', JSON.stringify([{ novelId: 's', title: '旧书' }]))
  localStorage.setItem('novel_bookmarks:user:someone', JSON.stringify([{ novelId: 'private', chapterId: 'secret' }]))
  localStorage.setItem('novel_bookmarks:guest', JSON.stringify([{ novelId: 'guest', chapterId: 'c' }]))
  const result = readLegacyReadingData()
  expect(result.data.bookmarks).toEqual([{ novelId: 'n', chapterId: 'c', note: '最新', timestamp: 2 }])
  expect(result.data.progress[0]).toMatchObject({ novelId: 'n', chapterId: 'c', scrollPercent: 1 })
  expect(result.data.bookshelf[0]).toMatchObject({ novelId: 's' })
  expect(localStorage.getItem('novel_bookmarks')).toBe(bookmarks)
  expect(JSON.stringify(result.data)).not.toMatch(/private|guest|other-users-id|旧书/)
})
it('损坏 JSON、错误结构和非法关联有反馈，不读取或改写其他账号缓存', () => {
  localStorage.setItem('novel_reading_history', '{bad')
  localStorage.setItem('novel_bookshelf', '{}')
  localStorage.setItem('novel_bookmarks', JSON.stringify([null, { novelId: 'n', chapterId: 'c' }, { novelId: 'n', chapterId: '\u0000bad' }]))
  const result = readLegacyReadingData()
  expect(result.invalid).toBe(2)
  expect(result.errors).toHaveLength(2)
  expect(result.data.bookmarks).toHaveLength(1)
  expect(localStorage.getItem('novel_reading_history')).toBe('{bad')
})
it('读取来源变化使快照改变，超过上限不截断并悄悄导入', () => {
  const before = readLegacyReadingData().fingerprint
  localStorage.setItem('novel_bookshelf', JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ novelId: `n${i}` }))))
  const next = readLegacyReadingData()
  expect(next.fingerprint).not.toBe(before)
  expect(next.errors[0]).toContain('超过 500')
  expect(next.data.bookshelf).toEqual([])
  expect(normalizeLegacyReadingData({ bookmarks: [{}], progress: [], bookshelf: [] })).toBeNull()
})
