import type { BookImportChapterResolution, BookImportLocalChapter } from './types'

/** 保留本地顺序及可用编号间隙，仅为明确确认的插章让出位置。 */
export function planImportInsertions(local: BookImportLocalChapter[], resolutions: BookImportChapterResolution[]) {
  const orders = new Map<string, number>()
  const insertOrders = new Map<string, number>()
  const changes: Array<{ chapterId: string; title: string; before: number; after: number }> = []
  if (!resolutions.some((item) => item.action === 'insert')) {
    for (const chapter of local) orders.set(chapter.id, chapter.order)
    return { orders, insertOrders, changes, maxOrder: Math.max(0, ...local.map((item) => item.order)) }
  }
  let order = 0
  function insert(afterId: string | null) {
    for (const item of resolutions) {
      if (item.action === 'insert' && item.afterChapterId === afterId) insertOrders.set(item.chapterId, ++order)
    }
  }
  insert(null)
  for (const chapter of [...local].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    order = Math.max(order + 1, chapter.order)
    orders.set(chapter.id, order)
    if (order !== chapter.order) changes.push({ chapterId: chapter.id, title: chapter.title, before: chapter.order, after: order })
    insert(chapter.id)
  }
  return { orders, insertOrders, changes, maxOrder: order }
}
