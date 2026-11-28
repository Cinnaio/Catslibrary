import type { AnalysisNote } from '@shared/novel-analysis'
import { AiError } from './client'

const GROUP_CHARS = 10_000
const TARGET_CHARS = 28_000
const MAX_REQUESTS = 24
const MAX_RETRIES = 4
export interface ConsolidationState { cursor: number; groupChars: number; requests: number; retries: number }
export const freshConsolidationState = (): ConsolidationState => ({ cursor: 0, groupChars: GROUP_CHARS, requests: 0, retries: 0 })

export function readConsolidationState(value: unknown): ConsolidationState {
  const fallback = freshConsolidationState()
  if (!value || typeof value !== 'object') return fallback
  const state = value as Record<string, unknown>
  for (const key of ['cursor', 'groupChars', 'requests', 'retries'] as const) {
    if (!Number.isSafeInteger(state[key]) || Number(state[key]) < (key === 'groupChars' ? 1 : 0)) return fallback
  }
  return { cursor: Number(state.cursor), groupChars: Math.min(GROUP_CHARS, Number(state.groupChars)),
    requests: Number(state.requests), retries: Number(state.retries) }
}

/** Every accepted group and the next cursor are saved together, including before a paid request.
 * Traversal moves forward so an early summary is not repeatedly compressed in the same pass.
 * Requests reserve their full output allowance: at most 24 × the configured per-request cap,
 * including at most four smaller-group retries. Explicit resume resets this task budget.
 */
export async function consolidateAnalysisNotes(initial: AnalysisNote[], state: ConsolidationState,
  request: (notes: AnalysisNote[]) => Promise<string>,
  checkpoint: (notes: AnalysisNote[], state: ConsolidationState) => Promise<void>,
): Promise<AnalysisNote[]> {
  let notes = [...initial]
  while (JSON.stringify(notes).length > TARGET_CHARS) {
    if (state.cursor >= notes.length) state.cursor = 0
    let group: AnalysisNote[] = []
    let size = 0
    for (const note of notes.slice(state.cursor)) {
      if (group.length && size + note.content.length > state.groupChars) break
      group.push(note); size += note.content.length
    }
    if (!group.length) throw new AiError('invalid', '没有可整理的阅读记录', 422)
    while (true) {
      if (state.requests >= MAX_REQUESTS) throw new AiError('invalid', '整理记录已达到本次调用预算，已完成的分组已保存；可继续分析', 422)
      state.requests++
      await checkpoint(notes, { ...state })
      let content: string
      try {
        content = await request(group)
      } catch (error) {
        if (!(error instanceof AiError) || error.code !== 'truncated' || group.length < 2 || state.retries >= MAX_RETRIES) throw error
        state.retries++
        group = group.slice(0, Math.ceil(group.length / 2))
        state.groupChars = Math.max(1, group.reduce((sum, note) => sum + note.content.length, 0))
        // Persist the reduced group even if cancellation or a process restart happens next.
        await checkpoint(notes, { ...state })
        continue
      }
      const merged = { sourceIds: [...new Set(group.flatMap(note => note.sourceIds))], content }
      if (JSON.stringify(merged).length >= JSON.stringify(group).length * 0.9)
        throw new AiError('invalid', '整理结果未有效缩短，原记录已保留；请调整模型或分析要求后继续', 422)
      notes = [...notes.slice(0, state.cursor), merged, ...notes.slice(state.cursor + group.length)]
      state.cursor++
      await checkpoint(notes, { ...state })
      break
    }
  }
  return notes
}
