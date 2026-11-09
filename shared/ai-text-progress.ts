export type AiReasoningMode = 'inherit' | 'disabled' | 'low' | 'high'
export interface AiTextProgress {
  kind: 'text-progress'
  phase: 'thinking' | 'writing'
  preview: string
  generatedCharacters: number
  reasoningCharacters: number
  startedAt: number
  updatedAt: number
  /** Agent round, to distinguish a saved reply from its live preview. */
  round?: number
}

/** Task results also carry cover data; only accept bounded text-preview records. */
export function parseAiTextProgress(raw: string | undefined): AiTextProgress | null {
  if (!raw || raw.length > 160000) return null
  try {
    const value = JSON.parse(raw) as AiTextProgress
    if (value.kind !== 'text-progress' || !['thinking', 'writing'].includes(value.phase) || typeof value.preview !== 'string' || value.preview.length > 24000) return null
    if (value.round !== undefined && (!Number.isInteger(value.round) || value.round < 0 || value.round > 8)) return null
    if (![value.generatedCharacters, value.reasoningCharacters, value.startedAt, value.updatedAt].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null
    return value
  } catch { return null }
}

/** A periodic DB checkpoint may trail a live fragment from the same model call. */
export function newestTextProgress(previous: string | undefined, incoming: string | undefined): string | undefined {
  const before = parseAiTextProgress(previous)
  const after = parseAiTextProgress(incoming)
  if (before && after && before.startedAt === after.startedAt && before.round === after.round &&
    (before.generatedCharacters > after.generatedCharacters || before.reasoningCharacters > after.reasoningCharacters)) return previous
  return incoming
}
