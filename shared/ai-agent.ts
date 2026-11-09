/** Conversation state belongs to an author and a novel; it is never formal story memory. */
export interface AgentContentPreferences {
  version: 1
  adultContentMode: 'off' | 'explicit'
  intimacyWeight: 'none' | 'low' | 'medium' | 'high'
  adultCharactersConfirmed: boolean
  consentRuleTier?: 'default' | 'fictional_nonconsent'
}

export interface AgentTask {
  id: string
  kind: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  step: string
  current: number
  total: number
  error: string
  result?: string
}

export interface AgentSession {
  id: string
  novelId: string
  novelTitle: string
  title: string
  afterChapterId: string
  anchorTitle: string
  brief: string
  contentPreferences: AgentContentPreferences
  activeTaskId: string
  createdAt: number
  updatedAt: number
}

export interface AgentMemory {
  id: string
  novelId: string
  sessionId: string
  kind: 'agreement'
  title: string
  content: string
  status: 'pending' | 'active' | 'superseded' | 'archived'
  sourceEventId: number | null
  supersedesId: string | null
  revision: number
  createdAt: number
  updatedAt: number
}

export interface AgentSummaryContent {
  goal: string
  decisions: string[]
  rejected: string[]
  openQuestions: string[]
  nextSteps: string[]
  references: string[]
}

export interface AgentSummary {
  throughEventId: number
  content: AgentSummaryContent
  revision: number
  updatedAt: number
}

export interface AgentMemorySource {
  id: number
  content: string
  sessionId: string
}

export interface AgentMemoryPage {
  memories: AgentMemory[]
  hasMore: boolean
  summary: AgentSummary | null
}

export interface AgentEvent {
  id: number
  role: 'user' | 'assistant' | 'activity'
  content: string
  taskId: string
  metadata: {
    tool?: string
    artifactTaskId?: string
    actionId?: string
    memoryId?: string
    error?: boolean
    providerPresetId?: string
    model?: string
    round?: number
  }
  createdAt: number
}

export type AgentActionKind = 'apply_rewrite' | 'publish_draft' | 'adopt_cover' | 'restore_draft'

export interface AgentAction {
  id: string
  kind: AgentActionKind
  title: string
  status: 'pending' | 'executing' | 'completed' | 'rejected' | 'failed'
  preview: { description: string; before?: string; after?: string; candidateId?: string; draftId?: string }
  error: string
  createdAt: number
  canResume?: boolean
}

export interface AgentArtifact {
  task: AgentTask
  drafts: Array<{ id: string; title: string; content: string; status: string; revision: string }>
  covers: Array<{ id: string; prompt: string; imageUrl: string }>
  rewrite?: { draftId: string; before: string; after: string; baseRevision: string }
}

export interface AgentSessionDetail {
  session: AgentSession
  events: AgentEvent[]
  hasEarlier: boolean
  activeTask: AgentTask | null
  artifacts: AgentArtifact[]
  actions: AgentAction[]
  memories?: AgentMemory[]
  summary?: AgentSummary | null
}

export const agentTaskRunning = (task: AgentTask | null | undefined): boolean => !!task && ['queued', 'running'].includes(task.status)
