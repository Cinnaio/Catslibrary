import { expect, it } from 'vitest'
import { groupSupplementaryFiles, supplementaryCatalog, type SupplementaryFile } from './supplementary-source'
const file = (key: string, overrides: Partial<SupplementaryFile> = {}): SupplementaryFile => ({
  key,
  url: `https://dudu88.lanzov.com/i${key}`,
  name: '[更2] 山雨 作者：甲.txt',
  title: '山雨',
  author: '甲',
  revision: 2,
  folder: '1016',
  size: '1 M',
  ...overrides,
})
it('跨日期归并完整书名与作者，保留全部版本及缺口标记', () => {
  const files = [
    file('old', { folder: '1015', revision: 1, incomplete: true }),
    file('new'),
    file('other', { author: '乙' }),
    file('long', { title: '山雨来时' }),
    file('otherSubtitle', { title: '山雨（下）' }),
  ]
  const groups = groupSupplementaryFiles(files)
  expect(groups).toHaveLength(4)
  const book = groups.find((b) => b.title === '山雨' && b.author === '甲')!
  expect(book.highestRevision).toBe(2)
  expect(book.versions.map((f) => f.key)).toEqual(['new', 'old'])
  expect(book.versions[1]!.incomplete).toBe(true)
})
it('搜索某版文件名仍返回这本书的全部版本，而不是裁掉历史', () => {
  const catalog = supplementaryCatalog([file('old', { name: '[更1] 山雨 作者：甲.txt', folder: '1015', revision: 1, incomplete: true }), file('new')], '[更1]')
  expect(catalog).toMatchObject({ grouped: true, total: 1, fileCount: 2 })
  expect(catalog.items[0]!.versions).toHaveLength(2)
  expect(catalog.folders).toContainEqual({ name: '1015', fileCount: 1, incomplete: true, staleCount: 0 })
})
it('分页按书籍计算，版本不被文件页边界截断，最高进度不误称为最新', () => {
  const files = Array.from({ length: 31 }, (_, i) => [
    file('new' + i, { title: '书' + i, revision: null }),
    file('old' + i, { title: '书' + i, revision: 5, folder: '1015', stale: true, incomplete: true }),
  ]).flat()
  const first = supplementaryCatalog(files),
    last = supplementaryCatalog(files, '', 30)
  expect(first).toMatchObject({ total: 31, fileCount: 62 })
  expect(first.items).toHaveLength(30)
  expect(last.items).toHaveLength(1)
  expect(last.items[0]).toMatchObject({ highestRevision: 5 })
  expect(last.items[0]!.versions).toHaveLength(2)
})
it('同一文件重复出现只计一个版本，空查询不伪造书籍', () => {
  expect(groupSupplementaryFiles([file('same'), file('same')])[0]!.versions).toHaveLength(1)
  expect(supplementaryCatalog([])).toEqual({ grouped: true, items: [], total: 0, fileCount: 0, folders: [] })
})
