import { createHash } from 'node:crypto'
import type { AgentRewriteSelection } from '@shared/ai-agent'
import { compareAgentText, mergeAgentText } from '@shared/ai-text-diff'
import { AiError } from './client'

export const rewriteSelectionRevision = (before: string, after: string) =>
  createHash('sha256').update(JSON.stringify([1, before, after])).digest('hex')

/** Reconstruct exclusively from the saved suggestion. Old clients still adopt the whole suggestion. */
export function resolveRewriteSelection(before: string, after: string, input?: unknown) {
  const differences = compareAgentText(before, after)
  const total = differences.filter(part => part.kind !== 'equal').length
  const revision = rewriteSelectionRevision(before, after)
  let acceptedChanges = Array.from({ length: total }, (_, index) => index)
  if (input !== undefined) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AiError('invalid', '改动选择无效，请重新预览', 422)
    const value = input as Record<string, unknown>
    if (value.version !== 1 || typeof value.revision !== 'string' || !Array.isArray(value.acceptedChanges) ||
      !value.acceptedChanges.length || value.acceptedChanges.length > total ||
      !value.acceptedChanges.every(index => Number.isSafeInteger(index) && index >= 0 && index < total) ||
      new Set(value.acceptedChanges).size !== value.acceptedChanges.length)
      throw new AiError('invalid', '请选择有效且不重复的改动', 422)
    if (value.revision !== revision) throw new AiError('conflict', '改写建议已变化，请重新读取后选择', 409)
    acceptedChanges = [...value.acceptedChanges].sort((a, b) => a - b)
  }
  const text = mergeAgentText(differences, acceptedChanges)
  if (input !== undefined && text === before) throw new AiError('invalid', '所选结果与原文一致，无需采纳', 422)
  const selection: AgentRewriteSelection = { version: 1, revision, acceptedChanges }
  return { text, selection, total }
}
