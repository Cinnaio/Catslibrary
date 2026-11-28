import type { StudioCard, StudioCardInput, StudioState, StudioVersion } from '@shared/ai-writing-studio'
import type { AgentChapterEditSource, AgentChapterHistory } from '@shared/ai-agent'
import type {
  AgentChapterPlan,
  AgentStoryThreadState,
  AgentStoryThreadInput,
  AgentChapterImpactReport,
  AgentContinuationInput,
  AgentContinuationPreview,
  AgentOutline,
  AgentOutlineChapter,
  AgentChapterPlanInput,
  AgentChapterPlanBranchState,
  AgentWritingReference,
  AgentRewriteSelection,
  AgentReferenceSelection,
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
  writingStudio: (id: string) => request<StudioState>('GET', path(id) + '/writing-studio', null, true),
  saveWritingCard: (id: string, card: StudioCardInput, existing?: StudioCard) => request<{ card: StudioCard }>(existing ? 'PATCH' : 'POST', path(id) + '/writing-studio/cards' + (existing ? '/' + encodeURIComponent(existing.id) : ''), { card, ...(existing ? { expectedRevision: existing.revision } : {}) }, true),
  changeWritingCard: (id: string, card: StudioCard, operation: 'accept' | 'archive' | 'lock' | 'unlock' | 'restore', version?: number) => request<{ card: StudioCard }>('POST', path(id) + '/writing-studio/cards/' + encodeURIComponent(card.id) + '/change', { operation, expectedRevision: card.revision, ...(version ? { version } : {}) }, true),
  writingCardVersions: (id: string, cardId: string) => request<{ versions: StudioVersion[] }>('GET', path(id) + '/writing-studio/cards/' + encodeURIComponent(cardId) + '/versions', null, true),
  assembleScenes: (id: string, title: string, scenes: Array<{ id: string; revision: number }>) => request<{ draftId: string; taskId: string }>('POST', path(id) + '/writing-studio/assemble', { title, scenes }, true),
  outline: (id: string) => request<{ outline: AgentOutline | null }>('GET', path(id) + '/outline', null, true),
  saveOutline: (id: string, chapters: AgentOutlineChapter[], expectedRevision: number) =>
    request<{ outline: AgentOutline }>('PATCH', path(id) + '/outline', { chapters, expectedRevision }, true),
  applyOutlineChapter: (id: string, index: number, expectedOutlineRevision: number, expectedPlanRevision: number) =>
    request<{ plan: AgentChapterPlan }>('POST', path(id) + '/outline/apply', { index, expectedOutlineRevision, expectedPlanRevision }, true),
  storyThreads: (id: string) => request<AgentStoryThreadState>('GET', path(id) + '/story-threads', null, true),
  saveStoryThread: (id: string, value: AgentStoryThreadInput) =>
    request<AgentStoryThreadState>('POST', path(id) + '/story-threads', value, true),
  removeStoryThread: (id: string, threadId: string, expectedRevision: number) => request('DELETE', path(id) + '/story-threads/' + encodeURIComponent(threadId), { expectedRevision }, true),
  applyStoryThreads: (id: string, ids: string[], revisions: number[], expectedPlanRevision: number) =>
    request<{ plan: AgentChapterPlan }>('POST', path(id) + '/story-threads/apply', { ids, revisions, expectedPlanRevision }, true),
  planBranches: (id: string) => request<AgentChapterPlanBranchState>('GET', path(id) + '/chapter-plan/branches', null, true),
  savePlanBranch: (id: string, name: string, expectedRevision: number, operationId: string) =>
    request<AgentChapterPlanBranchState>('POST', path(id) + '/chapter-plan/branches', { name, expectedRevision, operationId }, true),
  selectPlanBranch: (id: string, branchId: string, expectedRevision: number, operationId: string) =>
    request<AgentChapterPlanBranchState>('POST', path(id) + '/chapter-plan/branches/' + encodeURIComponent(branchId) + '/select', { expectedRevision, operationId }, true),
  removePlanBranch: (id: string, branchId: string) =>
    request<AgentChapterPlanBranchState>('DELETE', path(id) + '/chapter-plan/branches/' + encodeURIComponent(branchId), null, true),
  saveChapterPlan: (id: string, plan: AgentChapterPlanInput, expectedRevision: number) =>
    request<{ plan: AgentChapterPlan }>('PATCH', path(id) + '/chapter-plan', { plan, expectedRevision }, true),
  writingReferences: (query = '', offset = 0) => request<{ references: AgentWritingReference[]; hasMore: boolean }>('GET', `/ai/agent/writing-references?${new URLSearchParams({ q: query, offset: String(offset) })}`, null, true),
  createWritingReference: (value: Pick<AgentWritingReference, 'title' | 'tags' | 'content' | 'usage'>) => request<{ reference: AgentWritingReference }>('POST', '/ai/agent/writing-references', value, true),
  editWritingReference: (id: string, value: Pick<AgentWritingReference, 'title' | 'tags' | 'content' | 'usage'>, expectedRevision: number) => request<{ reference: AgentWritingReference }>('PATCH', `/ai/agent/writing-references/${encodeURIComponent(id)}`, { ...value, expectedRevision }, true),
  removeWritingReference: (id: string, expectedRevision: number) => request<{ ok: boolean }>('DELETE', `/ai/agent/writing-references/${encodeURIComponent(id)}`, { expectedRevision }, true),
  chapter: (id: string, chapterId: string) => request<{ chapter: AgentChapterEditSource }>('GET', path(id) + '/chapters/' + encodeURIComponent(chapterId), null, true),
  chapterHistory: (id: string, chapterId: string, offset = 0) => request<{ history: AgentChapterHistory[]; hasMore: boolean }>('GET', path(id) + '/chapters/' + encodeURIComponent(chapterId) + '/history?offset=' + offset, null, true),
  editChapter: (sessionId: string, input: { chapterId: string; baseRevision: string; startUTF16: number; endUTF16: number; selectedText: string; instruction: string; clientRequestId: string; providerPresetId: string }) =>
    request<{ taskId: string }>('POST', '/ai/writing/chapter-edits', { ...input, sessionId }, true),
  sessions: (novelId = '', offset = 0) =>
    request<{ sessions: AgentSession[]; hasMore: boolean }>('GET', `${root}?${new URLSearchParams({ ...(novelId ? { novelId } : {}), offset: String(offset) })}`, null, true),
  create: (novelId: string, afterChapterId = '') => request<{ session: AgentSession }>('POST', root, { novelId, afterChapterId }, true),
  remove: (id: string) => request<{ ok: boolean }>('DELETE', path(id), null, true),
  get: (id: string, requestId?: string) => request<AgentSessionDetail>('GET', `${path(id)}${requestId ? `?${new URLSearchParams({ requestId })}` : ''}`, null, true),
  events: (id: string, before: number) => request<{ events: AgentEvent[]; hasEarlier: boolean }>('GET', `${path(id)}/events?before=${before}`, null, true),
  message: (id: string, content: string, requestId: string, providerPresetId = '', referenceSelection?: AgentReferenceSelection, chapterPlanRevision?: number, planningOnly?: true) =>
    request<{ taskId: string; created: boolean }>('POST', `${path(id)}/messages`, { content, requestId, providerPresetId, referenceSelection, ...(planningOnly ? { planningOnly } : {}), ...(chapterPlanRevision === undefined ? {} : { chapterPlanRevision }) }, true),
  resume: (id: string, taskId: string) =>
    request<{ taskId: string; created: boolean }>('POST', `${path(id)}/tasks/${encodeURIComponent(taskId)}/resume`, { confirmModelCall: true }, true),
  save: (id: string, brief: string, contentPreferences: AgentContentPreferences, expectedUpdatedAt: number, expectedBookSettingsRevision?: number) =>
    request<{ session: AgentSession }>('PATCH', path(id), { brief, contentPreferences, expectedUpdatedAt, expectedBookSettingsRevision }, true),
  memories: (id: string, offset = 0) => request<AgentMemoryPage>('GET', `${path(id)}/memories?offset=${offset}`, null, true),
  memorySource: (id: string, memoryId: string) =>
    request<{ source: AgentMemorySource | null }>('GET', `${path(id)}/memories/${encodeURIComponent(memoryId)}/source`, null, true),
  createMemory: (id: string, title: string, content: string) => request<{ memory: AgentMemory }>('POST', `${path(id)}/memories`, { title, content }, true),
  changeMemory: (id: string, memoryId: string, operation: 'edit' | 'confirm' | 'archive', expectedRevision: number, title?: string, content?: string) =>
    request<{ memory: AgentMemory }>('PATCH', `${path(id)}/memories/${encodeURIComponent(memoryId)}`, { operation, expectedRevision, title, content }, true),
  stop: (id: string, taskId: string) => request('POST', `${path(id)}/stop`, { taskId }, true),
  artifact: (id: string, taskId: string) => request<AgentArtifact>('GET', `${path(id)}/artifacts/${encodeURIComponent(taskId)}`, null, true),
  prepare: (id: string, kind: AgentActionKind, targetId: string, title = '', selection?: AgentRewriteSelection) =>
    request<{ action: AgentAction }>('POST', `${path(id)}/actions`, { kind, targetId, title, ...(selection ? { selection } : {}) }, true),
  action: (id: string, actionId: string) => request<{ action: AgentAction }>('GET', `${path(id)}/actions/${encodeURIComponent(actionId)}`, null, true),
  chapterImpact: (id: string, actionId: string, chapterCount: number) =>
    request<{ report: AgentChapterImpactReport }>('POST', `${path(id)}/actions/${encodeURIComponent(actionId)}/impact`, { chapterCount }, true, {}, 150_000),
  continuation: (id: string, actionId: string) =>
    request<AgentContinuationPreview>('GET', `${path(id)}/actions/${encodeURIComponent(actionId)}/continuation`, null, true),
  continueChapter: (id: string, actionId: string, input: AgentContinuationInput) =>
    request<{ session: AgentSession }>('POST', `${path(id)}/actions/${encodeURIComponent(actionId)}/continuation`, input, true),
  confirm: (id: string, actionId: string) => request<{ action: AgentAction }>('POST', `${path(id)}/actions/${encodeURIComponent(actionId)}/confirm`, {}, true),
  reject: (id: string, actionId: string) => request('POST', `${path(id)}/actions/${encodeURIComponent(actionId)}/reject`, {}, true),
}
