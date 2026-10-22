export type StoryEvidenceKind = 'relationship' | 'plot'
export type StoryCertainty = 'fact' | 'belief' | 'clue' | 'possibility' | 'inference'
export interface StoryEvidence {
  kind: StoryEvidenceKind
  /** Exact excerpt from the effective archive, not a quotation from chapter prose. */
  quote: string
  chapterIds: string[]
}
export interface StoryPerson {
  id: string
  name: string
  aliases: string[]
  summary: string
  evidence: StoryEvidence[]
}
export interface StoryRelationship {
  id: string
  from: string
  to: string
  label: string
  summary: string
  directed: boolean
  certainty: StoryCertainty
  evidence: StoryEvidence[]
}
export interface StoryThread {
  id: string
  title: string
  kind: 'state' | 'conflict' | 'clue' | 'item' | 'place'
  people: string[]
  summary: string
  certainty: StoryCertainty
  evidence: StoryEvidence[]
}
export interface StoryGraph {
  version: 1
  people: StoryPerson[]
  relationships: StoryRelationship[]
  threads: StoryThread[]
}
export interface StoryGraphResponse {
  novel: { id: string; title: string }
  anchor?: { id: string; title: string; ordinal: number }
  graph: StoryGraph | null
  updatedAt: number
  status: 'ready' | 'missing' | 'unavailable' | 'outdated'
  archives: Array<{ kind: StoryEvidenceKind; content: string; eligibility: string; origin: string; chaptersThrough: number }>
  chapters: Array<{ id: string; title: string; ordinal: number }>
}
