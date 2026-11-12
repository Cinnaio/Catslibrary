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
  updatedAt?: number
}

export type AgentPhase = 'context' | 'summary' | 'model' | 'retrieval' | 'generation' | 'save'
export interface AgentRecovery {
  taskId: string
  phase: AgentPhase
  canResume: boolean
  message: string
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

/** A bounded snapshot of material actually read by the server, never model-authored. */
export interface AgentEvidence {
  id: string
  /** Legacy profile kinds are retained only for already-saved evidence snapshots. */
  kind: 'chapter' | 'analysis' | 'style' | 'plot' | 'relationship'
  novelId: string
  title: string
  chapterId?: string
  reportId?: string
  reportRevision?: number
  origin: 'published' | 'automatic' | 'manual'
  revision: string
  offset: number
  endOffset: number
  excerpt: string
  truncated: boolean
  fromChapter?: { id: string; title: string }
  /** The analysis covers this range; this is not an exact quotation attribution. */
  throughChapter?: { id: string; title: string }
}

/** Structural failure details only; no prompts, response text, or upstream errors. */
export interface AgentSummaryDiagnostic {
  stage: 'prepare' | 'request' | 'usage' | 'validate' | 'persist'
  reason:
    | 'input_too_long'
    | 'output_too_long'
    | 'invalid_json'
    | 'invalid_structure'
    | 'invalid_goal'
    | 'invalid_items'
    | 'refusal'
    | 'incomplete'
    | 'unexpected_tools'
    | 'timeout'
    | 'cancelled'
    | 'request_failed'
    | 'usage_failed'
    | 'persist_failed'
    | 'internal'
  previousThroughEventId: number
  firstEventId: number
  lastEventId: number
  eventCount: number
  batchCharacters: number
  elapsedMs: number
  usageRecorded: boolean
  /** Raw failed output is stored privately; false indicates audit storage failed. */
  failureArchived?: boolean
  responseCharacters?: number
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'other' | 'missing'
  field?: keyof AgentSummaryContent
  observed?: number
  limit?: number
}

export interface AgentDraftRead {
  kind: 'draft' | 'rewrite'
  title: string
  draftId: string
  revision: string
  taskId?: string
  createdAt?: number
  truncated?: boolean
}

export interface AgentEvent {
  id: number
  role: 'user' | 'assistant' | 'activity'
  content: string
  taskId: string
  requestId?: string
  metadata: {
    tool?: string
    artifactTaskId?: string
    actionId?: string
    memoryId?: string
    sources?: AgentEvidence[]
    draftReads?: AgentDraftRead[]
    summaryDiagnostic?: AgentSummaryDiagnostic
    failurePhase?: AgentPhase
    recoveryFromTaskId?: string
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
  drafts: Array<{ id: string; title: string; content: string; status: string; revision: string; minimumLengthWarning?: string }>
  covers: Array<{ id: string; prompt: string; imageUrl: string }>
  rewrite?: { draftId: string; before: string; after: string; baseRevision: string; minimumLengthWarning?: string }
  analysisReport?: { id: string; title: string; url: string }
}

export interface AgentSessionDetail {
  turnUsage?: AgentTurnUsage[]
  messageReceipt?: { requestId: string; taskId: string } | null
  session: AgentSession
  events: AgentEvent[]
  hasEarlier: boolean
  activeTask: AgentTask | null
  artifacts: AgentArtifact[]
  actions: AgentAction[]
  memories?: AgentMemory[]
  summary?: AgentSummary | null
  recovery?: AgentRecovery | null
}

/** Recorded coordinating/summary calls only. Independent generation is excluded. */
export interface AgentTurnUsage {
  taskId: string
  status: AgentTask['status']
  startedAt: number
  elapsedMs: number
  tracked: boolean
  chatCalls: number
  summaryCalls: number
  inputTokens: number
  outputTokens: number
  unknownTokenCalls: number
  costs: Array<{ currency: string; amount: number }>
  unknownCostCalls: number
}

export const agentTaskRunning = (task: AgentTask | null | undefined): boolean => !!task && ['queued', 'running'].includes(task.status)
