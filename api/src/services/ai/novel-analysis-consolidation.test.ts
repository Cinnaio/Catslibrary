import type { AnalysisNote } from '@shared/novel-analysis'
import { expect, it, vi } from 'vitest'
import { AiError } from './client'
import { consolidateAnalysisNotes, freshConsolidationState } from './novel-analysis-consolidation'
const material = (count: number, chars: number) => Array.from({ length: count }, (_, i) => ({ sourceIds: [`S${i + 1}`], content: '文'.repeat(chars) }))

it('限制同一次整理的缩组重试，并保留全部未完成材料', async () => {
  const notes = material(40, 900)
  const state = freshConsolidationState()
  const checkpoint = vi.fn(async (_notes: AnalysisNote[]) => {})
  const request = vi.fn(async () => { throw new AiError('truncated', '达到输出上限') })
  await expect(consolidateAnalysisNotes(notes, state, request, checkpoint)).rejects.toThrow('达到输出上限')
  expect(request.mock.calls.length).toBeLessThanOrEqual(5)
  expect(state.retries).toBeLessThanOrEqual(4)
  expect(checkpoint.mock.calls.every(call => JSON.stringify(call[0]) === JSON.stringify(notes))).toBe(true)
})
it.each(['timeout', 'cancelled', 'invalid'] as const)('%s 不触发付费重试', async code => {
  const request = vi.fn(async () => { throw new AiError(code, code) })
  await expect(consolidateAnalysisNotes(material(12, 3000), freshConsolidationState(), request, async () => {})).rejects.toThrow(code)
  expect(request).toHaveBeenCalledTimes(1)
})
it('先保存请求检查点，取消或失去任务所有权时不再调用模型', async () => {
  const request = vi.fn(async () => '摘要')
  await expect(consolidateAnalysisNotes(material(12, 3000), freshConsolidationState(), request,
    async () => { throw new AiError('cancelled', '任务已取消') })).rejects.toThrow('任务已取消')
  expect(request).not.toHaveBeenCalled()
})
it('非收缩结果不会成为检查点或无限循环', async () => {
  const notes = material(2, 20000)
  const checkpoint = vi.fn(async (_notes: AnalysisNote[]) => {})
  const request = vi.fn(async () => '文'.repeat(22000))
  await expect(consolidateAnalysisNotes(notes, freshConsolidationState(), request, checkpoint)).rejects.toThrow('未有效缩短')
  expect(request).toHaveBeenCalledTimes(1)
})
it('每次任务最多请求 24 次，预算耗尽仍保留成功分组供显式继续', async () => {
  const state = freshConsolidationState()
  const request = vi.fn(async () => '摘要')
  const snapshots: string[] = []
  await expect(consolidateAnalysisNotes(material(30, 30000), state, request,
    async notes => { snapshots.push(JSON.stringify(notes)) })).rejects.toThrow('调用预算')
  expect(request).toHaveBeenCalledTimes(24)
  expect(state.cursor).toBe(24)
  const saved = JSON.parse(snapshots.at(-1)!)
  expect(saved.slice(0, 24).every((note: { content: string }) => note.content === '摘要')).toBe(true)
  expect(saved.flatMap((note: { sourceIds: string[] }) => note.sourceIds)).toEqual(material(30, 1).flatMap(note => note.sourceIds))
})
