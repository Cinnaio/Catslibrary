import type { StoryEcho, StoryEchoInput, StoryEchoResponse } from './story-echoes'

export type CharacterCardInput = StoryEchoInput
export type CharacterClueKind = 'appearance' | 'relationship' | 'recent'
export interface CharacterClue extends StoryEcho {
  kind: CharacterClueKind
  certainty: 'supported' | 'uncertain'
}
export interface CharacterCardResponse extends Omit<StoryEchoResponse, 'items'> {
  items: CharacterClue[]
}
export const CHARACTER_CLUE_LABELS: Record<CharacterClueKind, string> = {
  appearance: '此前出现', relationship: '人物联系', recent: '最近动向',
}
