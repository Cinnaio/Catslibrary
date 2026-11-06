import type { Novel, NovelListResponse } from '@shared/types'

type Params = Record<string, string | number>
type Entry = {
  key: string
  expiresAt: number
  data: Promise<NovelListResponse>
  match?: { query: string; data: Promise<NovelListResponse> }
}

/** 页面内最多保留一组候选及一组命中结果；不持久化，身份/策略变化时销毁。 */
export function createPinyinSearchCache(
  loadPage: (params: Params) => Promise<NovelListResponse>,
  matches: (novel: Novel, query: string) => Promise<boolean>,
  ttl = 60_000,
) {
  let entry: Entry | null = null
  let generation = 0
  const clear = () => { entry = null; generation++ }

  async function load(params: Params, current: number): Promise<NovelListResponse> {
    const check = () => { if (generation !== current) throw new Error('搜索范围已变化') }
    const first = await loadPage({ ...params, page: 1, limit: 100 })
    check()
    const pages: Novel[][] = [first.novels]
    let nextPage = 2
    // 初次索引仍覆盖完整候选集合；限制三路请求，避免逐页串行或全量并发。
    const worker = async () => {
      while (nextPage <= first.totalPages) {
        check()
        const page = nextPage++
        const data = await loadPage({ ...params, page, limit: 100, includeCategories: 0 })
        check()
        pages[page - 1] = data.novels
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, Math.max(0, first.totalPages - 1)) }, worker))
    return { ...first, novels: pages.flat() }
  }

  async function search(params: Params, identity: string, query: string): Promise<NovelListResponse> {
    const key = JSON.stringify([identity, params])
    if (!entry || entry.key !== key || entry.expiresAt <= Date.now()) {
      clear()
      const next: Entry = { key, expiresAt: Date.now() + ttl, data: load(params, generation) }
      entry = next
      void next.data.catch(() => { if (entry === next) clear() })
    }
    const selected = entry
    const current = generation
    if (!selected.match || selected.match.query !== query) {
      const result = selected.data.then(async (data) => {
        const novels: Novel[] = []
        for (let i = 0; i < data.novels.length; i++) {
          if (generation !== current) throw new Error('搜索范围已变化')
          if (await matches(data.novels[i]!, query)) novels.push(data.novels[i]!)
          // 拼音匹配中的 Promise 通常已完成，定期让出任务才能响应输入和取消。
          if (i % 100 === 99) await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        if (generation !== current) throw new Error('搜索范围已变化')
        return { ...data, novels }
      })
      selected.match = { query, data: result }
      void result.catch(() => { if (selected.match?.data === result) selected.match = undefined })
    }
    return selected.match.data
  }
  return { search, clear }
}
