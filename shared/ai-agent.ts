import type { StoryThread } from './story-graph'
import type { AgentTextDifference } from './ai-text-diff'
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

/** Personal reusable writing material, never a published story fact or permission. */
export interface AgentWritingReference {
  id: string
  title: string
  tags: string[]
  content: string
  usage: string
  revision: number
  createdAt: number
  updatedAt: number
}
export type AgentWritingReferenceSnapshot = Omit<AgentWritingReference, 'createdAt' | 'updatedAt'>
export interface AgentReferenceSelection {
  ids: string[]
  scope: 'turn' | 'session'
}
export const AGENT_REFERENCE_LIMIT = 6
export const AGENT_REFERENCE_BUDGET = 24000

export interface AgentChapterPlanInput {
  title: string
  goal: string
  beats: string
  characters: string
  ending: string
  constraints: string
  targetWords: number
}

/** A session-scoped proposal. Only an explicit author message can snapshot it for writing. */
export interface AgentChapterPlan extends AgentChapterPlanInput {
  version: 1
  revision: number
  updatedAt: number
  sourceBranch?: { id: string; name: string }
  sourceOutline?: { chapterId: string; revision: number }
  storyThreads?: AgentStoryThreadPlan[]
}

export interface AgentChapterPlanBranch {
  id: string
  name: string
  plan: AgentChapterPlan
  source: 'saved' | 'switch'
  createdAt: number
}
export interface AgentChapterPlanBranchState {
  plan: AgentChapterPlan | null
  branches: AgentChapterPlanBranch[]
}
export const AGENT_PLAN_BRANCH_LIMIT = 8
export const AGENT_PLAN_BRANCH_NAME_LIMIT = 60

export const AGENT_CHAPTER_PLAN_LIMITS = { title: 200, goal: 1200, beats: 4000, characters: 1200, ending: 1200, constraints: 1200 } as const

export const AGENT_OUTLINE_MIN = 3
export const AGENT_OUTLINE_MAX = 5
export const AGENT_OUTLINE_LIMITS = { title: 80, goal: 180, beats: 1000 } as const
export interface AgentOutlineChapter {
  id?: string
  title: string
  goal: string
  beats: string
  progress?: { status: 'planned' | 'draft' | 'published' | 'unavailable'; drafts: Array<{ id: string; title: string; sessionId: string; status: string; chapterId?: string }>; changedSinceWriting: boolean }
}
export type AgentStoryThreadDisposition = 'advance' | 'later' | 'hold' | 'resolved'
export interface AgentStoryThreadPlan {
  id: string
  thread: StoryThread
  disposition: AgentStoryThreadDisposition
  note: string
  revision: number
  sourceRevision: string
  sourceAnchorId: string
  stale?: boolean
}
export interface AgentStoryThreadState {
  candidates: StoryThread[]
  sourceRevision: string
  graphStatus: string
  plans: AgentStoryThreadPlan[]
}
export interface AgentOutline { revision: number; chapters: AgentOutlineChapter[] }

export type AgentContinuationNoteKind = 'question' | 'next_step' | 'author_message' | 'note'
export interface AgentContinuationNote { kind: AgentContinuationNoteKind; text: string }
export interface AgentContinuationPreview {
  chapter: { id: string; title: string }
  candidates: Array<AgentContinuationNote & { id: string }>
  revision: string
  existingSession?: AgentSession
}
export interface AgentContinuationInput { expectedRevision: string; selectedIds: string[]; note: string }
export const AGENT_CONTINUATION_LIMIT = 6
export const AGENT_CONTINUATION_NOTE_LIMIT = 1200
export const AGENT_CONTINUATION_LABELS: Record<AgentContinuationNoteKind, string> = {
  question: '摘要里的待讨论问题', next_step: '摘要里的后续安排', author_message: '作者原话', note: '补充给下一章',
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
  writingReferenceIds?: string[]
  bookSettingsRevision?: number
  continuationNotes?: AgentContinuationNote[]
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
    writingReferences?: Array<Pick<AgentWritingReference, 'id' | 'title' | 'revision'>>
    planningOnly?: true
    chapterPlanRevision?: number
    referenceSelection?: AgentReferenceSelection
    providerPresetId?: string
    model?: string
    round?: number
  }
  createdAt: number
}

export type AgentActionKind = 'apply_rewrite' | 'publish_draft' | 'adopt_cover' | 'restore_draft' | 'apply_chapter_edit' | 'restore_chapter'

/** Versioned choices over the exact original and proposed text; never replacement text. */
export interface AgentRewriteSelection {
  version: 1
  revision: string
  acceptedChanges: number[]
}

export interface AgentAction {
  id: string
  kind: AgentActionKind
  title: string
  status: 'pending' | 'executing' | 'completed' | 'rejected' | 'failed'
  preview: { description: string; before?: string; after?: string; candidateId?: string; draftId?: string; chapterId?: string; chapterTitle?: string; sourceTaskId?: string; selection?: AgentRewriteSelection }
  chapterImpactAvailable?: true
  continuationAvailable?: true
  error: string
  createdAt: number
  canResume?: boolean
}

export interface AgentChapterImpactFinding {
  chapterId: string
  chapterTitle: string
  description: string
  beforeQuote: string
  afterQuote: string
  chapterQuote: string
}

export interface AgentChapterImpactReport {
  checkedChapters: Array<{ id: string; title: string }>
  findings: AgentChapterImpactFinding[]
  rejectedFindings: number
}

export interface AgentArtifact {
  task: AgentTask
  drafts: Array<{
    id: string
    title: string
    content: string
    status: string
    revision: string
    publishedChapter?: { id: string; title: string; order: number; url: string }
    minimumLengthWarning?: string
    lengthCheck?: { actualWords: number; minimumWords?: number; targetWords?: number }
  }>
  covers: Array<{ id: string; prompt: string; imageUrl: string }>
  rewrite?: { draftId: string; before: string; after: string; baseRevision: string; selectionRevision?: string; differences?: AgentTextDifference[]; minimumLengthWarning?: string }
  chapterEdit?: { chapterId: string; chapterTitle: string; before: string; after: string; baseRevision: string; selectionRevision?: string; differences?: AgentTextDifference[] }
  analysisReport?: { id: string; title: string; url: string }
}

export interface AgentSessionDetail {
  writingStudioAvailable?: true
  chapterPlan?: AgentChapterPlan | null
  chapterPlanBranchesAvailable?: true
  outlineAvailable?: true
  outlineWorkflowAvailable?: true
  storyThreadPlansAvailable?: true
  writingReferencesAvailable?: true
  writingReferences?: AgentWritingReferenceSnapshot[]
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

export interface AgentChapterEditSource {
  id: string
  title: string
  content: string
  revision: string
}

export interface AgentChapterHistory {
  id: string
  chapterTitle: string
  kind: string
  createdAt: number
  canRestore: boolean
}
