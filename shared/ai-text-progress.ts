export type AiReasoningMode = 'inherit' | 'disabled' | 'low' | 'high'
export interface AiTextProgress {
  kind: 'text-progress'
  phase: 'thinking' | 'writing'
  preview: string
  generatedCharacters: number
  reasoningCharacters: number
  startedAt: number
  updatedAt: number
}

/** Task results also carry cover data; only accept bounded text-preview records. */
export function parseAiTextProgress(raw: string | undefined): AiTextProgress | null {
  if (!raw || raw.length > 30000) return null
  try {
    const value = JSON.parse(raw) as AiTextProgress
    if (value.kind !== 'text-progress' || !['thinking', 'writing'].includes(value.phase) || typeof value.preview !== 'string' || value.preview.length > 4000) return null
    if (![value.generatedCharacters, value.reasoningCharacters, value.startedAt, value.updatedAt].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null
    return value
  } catch { return null }
}
