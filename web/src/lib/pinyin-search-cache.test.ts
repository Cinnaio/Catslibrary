import { afterEach, expect, it, vi } from 'vitest'
import type { Novel, NovelListResponse } from '@shared/types'
import { createPinyinSearchCache } from './pinyin-search-cache'

const book = (id: string) => ({ id, title: id }) as Novel
const page = (novels: Novel[], totalPages = 1): NovelListResponse => ({ novels, totalPages, total: novels.length, page: 1, limit: 100, hasMore: false, availableCategories: [] })
afterEach(() => vi.restoreAllMocks())

it('复用候选与命中集合，分页读取不再次下载或匹配，换查询只重新匹配', async () => {
  const fetcher = vi.fn(async (params: Record<string, string | number>) => page([book(String(params.page))], 2))
  const match = vi.fn(async () => true)
  const cache = createPinyinSearchCache(fetcher, match)
  expect((await cache.search({}, 'a:safe', 'shan')).novels.map(n => n.id)).toEqual(['1', '2'])
  await cache.search({}, 'a:safe', 'shan')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(match).toHaveBeenCalledTimes(2)
  await cache.search({}, 'a:safe', 'hai')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(match).toHaveBeenCalledTimes(4)
})

it('换身份、过滤条件或过期后重新取数据，清理后旧响应不能继续拉页', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
  const fetcher = vi.fn(async () => page([book('one')]))
  const cache = createPinyinSearchCache(fetcher, async () => true, 100)
  await cache.search({}, 'a', 'q')
  await cache.search({}, 'b', 'q')
  await cache.search({ category: '玄幻' }, 'b', 'q')
  clock.mockReturnValue(101)
  await cache.search({ category: '玄幻' }, 'b', 'q')
  expect(fetcher).toHaveBeenCalledTimes(4)
  let finish!: (data: NovelListResponse) => void
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = cache.search({}, 'c', 'q')
  const rejected = expect(pending).rejects.toThrow('搜索范围已变化')
  cache.clear(); finish(page([book('old')], 10))
  await rejected
  expect(fetcher).toHaveBeenCalledTimes(5)
})

it('并发读取复用同一候选请求，失败后能够重试', async () => {
  let finish!: (data: NovelListResponse) => void
  const fetcher = vi.fn(() => new Promise<NovelListResponse>(resolve => { finish = resolve }))
  const cache = createPinyinSearchCache(fetcher, async () => true)
  const first = cache.search({}, 'a', 'q')
  const second = cache.search({}, 'a', 'q')
  finish(page([book('shared')]))
  expect(await first).toEqual(await second)
  expect(fetcher).toHaveBeenCalledOnce()
  cache.clear()
  fetcher.mockRejectedValueOnce(new Error('offline'))
  await expect(cache.search({}, 'a', 'q')).rejects.toThrow('offline')
  fetcher.mockResolvedValueOnce(page([book('recovered')]))
  expect((await cache.search({}, 'a', 'q')).novels[0]?.id).toBe('recovered')
})
