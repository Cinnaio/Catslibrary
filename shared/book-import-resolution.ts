import type { BookImportChapterResolution, BookImportLocalChapter } from './types'

/** 保留本地顺序及可用编号间隙，仅为明确确认的插章让出位置。 */
export function planImportInsertions(local: BookImportLocalChapter[], resolutions: BookImportChapterResolution[], selectedIds?: ReadonlySet<string>) {
  const orders = new Map<string, number>()
  const insertOrders = new Map<string, number>()
  const changes: Array<{ chapterId: string; title: string; before: number; after: number }> = []
  const inserts = resolutions.filter((item) => item.action === 'insert')
  const byId = new Map(inserts.map(item => [item.chapterId, item]))
  if (byId.size !== inserts.length) throw new Error('新增章节确认重复，请重新核对')
  const localIds = new Set(local.map(item => item.id))
  const children = new Map<string, typeof inserts>()
  for (const item of inserts) {
    if (item.afterIncomingChapterId !== undefined) {
      if (item.afterChapterId !== null || !byId.has(item.afterIncomingChapterId)) throw new Error('插入位置对应的本轮新增章节不存在，请重新核对')
    } else if (item.afterChapterId !== null && !localIds.has(item.afterChapterId)) throw new Error('插入位置对应的本地章节不存在，请重新预览')
    const key = item.afterIncomingChapterId !== undefined ? `incoming:${item.afterIncomingChapterId}` : item.afterChapterId === null ? 'start' : `local:${item.afterChapterId}`
    const siblings = children.get(key) || []
    siblings.push(item)
    children.set(key, siblings)
  }
  // 先检查所有依赖，未勾选的锚点也要保留其位置；用迭代遍历避免长链递归溢出。
  const visited = new Set<string>()
  const sequence: typeof inserts = []
  function descendants(key: string) {
    const stack = [...(children.get(key) || [])].reverse()
    while (stack.length) {
      const item = stack.pop()!
      if (visited.has(item.chapterId)) throw new Error('新增章节插入位置不能循环引用')
      visited.add(item.chapterId)
      sequence.push(item)
      stack.push(...[...(children.get(`incoming:${item.chapterId}`) || [])].reverse())
    }
  }
  const groups = new Map<string, typeof inserts>()
  for (const key of ['start', ...local.map(item => `local:${item.id}`)]) {
    const start = sequence.length
    descendants(key)
    groups.set(key, sequence.slice(start))
  }
  if (visited.size !== inserts.length) throw new Error('新增章节插入位置不能循环引用')
  if (!inserts.some(item => !selectedIds || selectedIds.has(item.chapterId))) {
    for (const chapter of local) orders.set(chapter.id, chapter.order)
    return { orders, insertOrders, changes, maxOrder: Math.max(0, ...local.map((item) => item.order)) }
  }
  let order = 0
  function insert(key: string) {
    for (const item of groups.get(key) || []) if (!selectedIds || selectedIds.has(item.chapterId)) insertOrders.set(item.chapterId, ++order)
  }
  insert('start')
  for (const chapter of [...local].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    order = Math.max(order + 1, chapter.order)
    orders.set(chapter.id, order)
    if (order !== chapter.order) changes.push({ chapterId: chapter.id, title: chapter.title, before: chapter.order, after: order })
    insert(`local:${chapter.id}`)
  }
  return { orders, insertOrders, changes, maxOrder: order }
}
