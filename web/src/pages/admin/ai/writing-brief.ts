import type { AiWritingBrief } from '@/lib/api'

export const emptyWritingBrief = (): AiWritingBrief => ({
  version: 1,
  viewpoint: '',
  pace: '',
  objective: '',
  requiredFacts: '',
  forbiddenEvents: '',
  characters: [],
  chapterGoals: [],
})
