import type { EffectiveProfileResult } from './profile-overrides'
import type { getStoryMemoryProgress } from './story-memory'
import type { getStoryMemoryTask } from './story-memory-tasks'

/** Opt-in metadata reads keep legacy clients' full-content responses intact. */
export function profileReadResponse(result: EffectiveProfileResult, summaryOnly: boolean) {
  return {
    ...result,
    hasContent: Boolean(result.effectiveContent || result.profile),
    hasEffectiveContent: Boolean(result.effectiveContent.trim()),
    ...(summaryOnly ? {
      profile: undefined,
      effectiveContent: undefined,
      manualOverride: result.manualOverride ? { ...result.manualOverride, content: undefined } : undefined,
    } : {}),
  }
}

function shortPreview(value: string | undefined) {
  if (!value) return value
  // Bound work before iterating Unicode scalars, including a single very long line.
  const prefix = Array.from(value.slice(0, 1202)).slice(0, 600).join('')
  return prefix.length < value.length ? `${prefix}…` : prefix
}

export function memoryProgressResponse(progress: Awaited<ReturnType<typeof getStoryMemoryProgress>>, summaryOnly: boolean) {
  return summaryOnly && progress ? { ...progress, previewContent: shortPreview(progress.previewContent) } : progress
}

export function memoryTaskResponse(task: Awaited<ReturnType<typeof getStoryMemoryTask>>, summaryOnly: boolean) {
  return summaryOnly && task?.livePreview
    ? { ...task, livePreview: { ...task.livePreview, preview: shortPreview(task.livePreview.preview) } }
    : task
}
