/** Original generation evidence is kept separately from the current library binding. */
export interface GenerationBookSnapshot {
  novelId: string
  title: string
  author: string
  sourceUrl: string
  anchor?: { chapterId: string; title: string; sortOrder: number }
}

export interface GenerationAssociationChange {
  operationId: string
  actorUserId: string
  createdAt: number
  previousNovelId: string
  previousChapterId: string
  target: GenerationBookSnapshot
}

export interface GenerationAssociation {
  state: 'linked' | 'missing' | 'unassigned'
  source: GenerationBookSnapshot
  revision: number
  history: GenerationAssociationChange[]
}

export interface GenerationAssociationRequest {
  ids: string[]
  novelId: string
  includeBatch: boolean
}

export interface GenerationAssociationPreview {
  revision: string
  target: GenerationBookSnapshot
  selectedCount: number
  additionalCount: number
  batchRemainderCount: number
  items: Array<{ id: string; title: string; source: GenerationBookSnapshot }>
}
