import { expect, it } from 'vitest'
import { planImportInsertions } from '@shared/book-import-resolution'

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
