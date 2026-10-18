import { expect, it } from 'vitest'
import { planImportInsertions } from '@shared/book-import-resolution'
import type { BookImportChapterResolution } from '@shared/types'

it('后确认的新增章可以接在本轮已确认新增章之后', () => {
  const plan = planImportInsertions(
    [{ id: 'a', title: '起点', order: 57 }, { id: 'b', title: '终点', order: 58 }],
    [
      { chapterId: 'new-1', action: 'insert', afterChapterId: 'a' },
      { chapterId: 'new-2', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'new-1' },
    ],
  )
  expect(plan.insertOrders.get('new-1')).toBe(58)
  expect(plan.insertOrders.get('new-2')).toBe(59)
  expect(plan.orders.get('b')).toBe(60)
})

it('显式前后关系优先于文件顺序，未勾选的中间锚点不占序号', () => {
  const resolutions: BookImportChapterResolution[] = [
    { chapterId: 'third', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'second' },
    { chapterId: 'second', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'first' },
    { chapterId: 'first', action: 'insert', afterChapterId: 'a' },
  ]
  const local = [{ id: 'a', title: '前文', order: 57 }, { id: 'b', title: '后文', order: 58 }]
  const all = planImportInsertions(local, resolutions)
  expect([...all.insertOrders]).toEqual([['first', 58], ['second', 59], ['third', 60]])
  const partial = planImportInsertions(local, resolutions, new Set(['first', 'third']))
  expect([...partial.insertOrders]).toEqual([['first', 58], ['third', 59]])
  expect(partial.orders.get('b')).toBe(60)
  const none = planImportInsertions(local, resolutions, new Set())
  expect([...none.orders.values()]).toEqual([57, 58])
  expect(none.changes).toEqual([])
})
it('链式锚点与本地章节 ID 独立，长链可迭代规划', () => {
  const resolutions: BookImportChapterResolution[] = Array.from({ length: 2000 }, (_, index) => ({
    chapterId: `chapter-${index}`, action: 'insert', afterChapterId: index === 0 ? 'chapter-0' : null,
    ...(index ? { afterIncomingChapterId: `chapter-${index - 1}` } : {}),
  }))
  const plan = planImportInsertions([{ id: 'chapter-0', title: '本地章节', order: 1 }], resolutions)
  expect(plan.orders.get('chapter-0')).toBe(1)
  expect(plan.insertOrders.get('chapter-0')).toBe(2)
  expect(plan.insertOrders.get('chapter-1999')).toBe(2001)
})
it('拒绝悬空或循环引用，不把错误锚点静默当作书首', () => {
  expect(() => planImportInsertions([], [{ chapterId: 'a', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'missing' }])).toThrow('不存在')
  expect(() => planImportInsertions([], [
    { chapterId: 'a', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'b' },
    { chapterId: 'b', action: 'insert', afterChapterId: null, afterIncomingChapterId: 'a' },
  ])).toThrow('循环引用')
})

it('不勾选插章时保留现有序号，包括历史重号和间隙', () => {
  const plan = planImportInsertions(
    [
      { id: 'a', title: '甲', order: 2 },
      { id: 'b', title: '乙', order: 2 },
      { id: 'c', title: '丙', order: 9 },
    ],
    [],
  )
  expect([...plan.orders.values()]).toEqual([2, 2, 9])
  expect(plan.changes).toEqual([])
  expect(plan.maxOrder).toBe(9)
})
it('利用现有编号间隙，不无故移动后续章节', () => {
  const plan = planImportInsertions(
    [
      { id: 'a', title: '甲', order: 57 },
      { id: 'b', title: '乙', order: 59 },
    ],
    [{ chapterId: 'chapter-2', action: 'insert', afterChapterId: 'a' }],
  )
  expect(plan.insertOrders.get('chapter-2')).toBe(58)
  expect(plan.changes).toEqual([])
})
it('连续补入多章后顺延后续序号并保留章节身份', () => {
  const plan = planImportInsertions(
    [
      { id: 'a', title: '甲', order: 57 },
      { id: 'b', title: '乙', order: 58 },
    ],
    [
      { chapterId: 'chapter-2', action: 'insert', afterChapterId: 'a' },
      { chapterId: 'chapter-3', action: 'insert', afterChapterId: 'a' },
    ],
  )
  expect([...plan.insertOrders.values()]).toEqual([58, 59])
  expect(plan.orders.get('b')).toBe(60)
  expect(plan.changes).toEqual([{ chapterId: 'b', title: '乙', before: 58, after: 60 }])
})
it('本地 ID 与导入条目 ID 相同时仍分别规划，不覆盖插章位置', () => {
  const plan = planImportInsertions([{ id: 'chapter-1', title: '甲', order: 1 }], [{ chapterId: 'chapter-1', action: 'insert', afterChapterId: null }])
  expect(plan.orders.get('chapter-1')).toBe(2)
  expect(plan.insertOrders.get('chapter-1')).toBe(1)
})
