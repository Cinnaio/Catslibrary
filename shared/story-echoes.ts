/** Reader-selected anchors use UTF-16 lengths, matching the paragraph hash contract. */
export interface StoryEchoInput {
  chapterId: string
  paragraphIndex: number
  paragraphHash: string
  selectedText: string
  /** Native evidence navigation loads the server-normalized text representation. */
  sourceFormat?: 'text'
}

export interface StoryEchoSource {
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  paragraphIndex: number
  paragraphHash: string
  quote: string
}

export interface StoryEcho {
  source: StoryEchoSource
  explanation: string
}

export interface StoryEchoResponse {
  anchor: StoryEchoSource
  items: StoryEcho[]
  cached: boolean
  generated: boolean
  /** Candidate retrieval is lexical and bounded; zero results never proves no echo exists. */
  searchedChapters: number
  candidateCount: number
  limited: boolean
  omitted: number
  model: string
}

/** Match normalized source quotes while retaining offsets into the displayed text. */
export function findStoryEchoMatches(text: string, quote: string): { start: number; end: number }[] {
  if (!quote.trim()) return []
  const literal = quote.trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const result: { start: number; end: number }[] = []
  for (const match of text.matchAll(new RegExp(literal, 'gu'))) {
    result.push({ start: match.index, end: match.index + match[0].length })
    if (result.length === 1000) break
  }
  return result
}
