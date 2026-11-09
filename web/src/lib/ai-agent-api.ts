import type {
  AgentAction,
  AgentActionKind,
  AgentArtifact,
  AgentContentPreferences,
  AgentEvent,
  AgentMemory,
  AgentMemoryPage,
  AgentMemorySource,
  AgentSession,
  AgentSessionDetail,
} from '@shared/ai-agent'
import { request } from './api'

const root = '/ai/agent/sessions'
const path = (id: string) => `${root}/${encodeURIComponent(id)}`
export const agentApi = {
  sessions: (novelId: string, offset = 0) =>
    request<{ sessions: AgentSession[]; hasMore: boolean }>('GET', `${root}?${new URLSearchParams({ novelId, offset: String(offset) })}`, null, true),
  create: (novelId: string, afterChapterId = '') => request<{ session: AgentSession }>('POST', root, { novelId, afterChapterId }, true),
  get: (id: string, requestId?: string) => request<AgentSessionDetail>('GET', `${path(id)}${requestId ? `?${new URLSearchParams({ requestId })}` : ''}`, null, true),
  events: (id: string, before: number) => request<{ events: AgentEvent[]; hasEarlier: boolean }>('GET', `${path(id)}/events?before=${before}`, null, true),
  message: (id: string, content: string, requestId: string, providerPresetId = '') =>
    request<{ taskId: string; created: boolean }>('POST', `${path(id)}/messages`, { content, requestId, providerPresetId }, true),
  resume: (id: string, taskId: string) =>
    request<{ taskId: string; created: boolean }>('POST', `${path(id)}/tasks/${encodeURIComponent(taskId)}/resume`, { confirmModelCall: true }, true),
  save: (id: string, brief: string, contentPreferences: AgentContentPreferences, expectedUpdatedAt: number) =>
    request<{ session: AgentSession }>('PATCH', path(id), { brief, contentPreferences, expectedUpdatedAt }, true),
  memories: (id: string, offset = 0) => request<AgentMemoryPage>('GET', `${path(id)}/memories?offset=${offset}`, null, true),
  memorySource: (id: string, memoryId: string) =>
    request<{ source: AgentMemorySource | null }>('GET', `${path(id)}/memories/${encodeURIComponent(memoryId)}/source`, null, true),
  createMemory: (id: string, title: string, content: string) => request<{ memory: AgentMemory }>('POST', `${path(id)}/memories`, { title, content }, true),
  changeMemory: (id: string, memoryId: string, operation: 'edit' | 'confirm' | 'archive', expectedRevision: number, title?: string, content?: string) =>
    request<{ memory: AgentMemory }>('PATCH', `${path(id)}/memories/${encodeURIComponent(memoryId)}`, { operation, expectedRevision, title, content }, true),
  stop: (id: string, taskId: string) => request('POST', `${path(id)}/stop`, { taskId }, true),
  artifact: (id: string, taskId: string) => request<AgentArtifact>('GET', `${path(id)}/artifacts/${encodeURIComponent(taskId)}`, null, true),
  prepare: (id: string, kind: AgentActionKind, targetId: string, title = '') =>
    request<{ action: AgentAction }>('POST', `${path(id)}/actions`, { kind, targetId, title }, true),
  action: (id: string, actionId: string) => request<{ action: AgentAction }>('GET', `${path(id)}/actions/${encodeURIComponent(actionId)}`, null, true),
  confirm: (id: string, actionId: string) => request<{ action: AgentAction }>('POST', `${path(id)}/actions/${encodeURIComponent(actionId)}/confirm`, {}, true),
  reject: (id: string, actionId: string) => request('POST', `${path(id)}/actions/${encodeURIComponent(actionId)}/reject`, {}, true),
}
