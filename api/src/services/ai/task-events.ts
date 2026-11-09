import type { AiTask } from './tasks'

type Listener = (patch: Partial<AiTask>) => void
const listeners = new Map<string, Set<Listener>>()

export function publishAiTask(id: string, patch: Partial<AiTask>) {
  for (const listener of listeners.get(id) || []) {
    try {
      listener(patch)
    } catch {
      /* A disconnected observer must not fail generation. */
    }
  }
}

export function subscribeAiTask(id: string, listener: Listener): () => void {
  let group = listeners.get(id)
  if (!group) listeners.set(id, (group = new Set()))
  group.add(listener)
  return () => {
    group.delete(listener)
    if (!group.size) listeners.delete(id)
  }
}
