export type MemoryKind = 'plot' | 'relationship'
export interface MemoryRebuildRequest {
  kinds: MemoryKind[]
  range: 'single' | 'range' | 'all'
  startChapterId?: string
  endChapterId?: string
  followThrough: boolean
  sampleChapters?: number
}
export interface MemoryRebuildPlan {
  revision: string
  items: {
    kind: MemoryKind
    selectedStart: number
    selectedEnd: number
    actualStart: number
    targetOrdinal: number
    targetChapterId: string
    previousThrough: number
    seedSnapshotId: string | null
    hasManualOverride: boolean
  }[]
}
