import type { AgentTask } from '@shared/ai-agent'
import { agentTaskRunning } from '@shared/ai-agent'
import { getStorageScope } from '@/lib/storage'

export function currentAgentTask(saved: AgentTask, live?: AgentTask): AgentTask {
  if (!live || live.id !== saved.id) return saved
  if (!agentTaskRunning(saved) && agentTaskRunning(live)) return saved
  if (!agentTaskRunning(live) && agentTaskRunning(saved)) return live
  return (saved.updatedAt || 0) > (live.updatedAt || 0) ? saved : live
}

export interface PendingAgentMessage {
  content: string
  id: string
  providerPresetId: string
}
export function pendingAgentKey(novelId: string, sessionId: string) {
  const scope = getStorageScope()
  return scope.startsWith('user:') ? `agent-pending:${JSON.stringify([scope, novelId, sessionId])}` : ''
}
export function readPendingAgentMessage(key: string): PendingAgentMessage | null {
  if (!key) return null
  try {
    const item = JSON.parse(sessionStorage.getItem(key) || 'null')
    return item &&
      typeof item.content === 'string' &&
      item.content.length <= 8000 &&
      typeof item.id === 'string' &&
      /^[a-zA-Z0-9_-]{8,160}$/.test(item.id) &&
      typeof item.providerPresetId === 'string' &&
      item.providerPresetId.length <= 160
      ? item
      : null
  } catch {
    return null
  }
}
export function savePendingAgentMessage(key: string, message: PendingAgentMessage | null) {
  if (!key) return
  try {
    if (message) sessionStorage.setItem(key, JSON.stringify(message))
    else sessionStorage.removeItem(key)
  } catch {
    /* The current page retains its in-memory receipt when storage is unavailable. */
  }
}
