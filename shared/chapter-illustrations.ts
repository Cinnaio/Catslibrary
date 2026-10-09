export interface IllustrationAnchor {
  position: 'start' | 'after' | 'end'
  paragraphIndex: number
  paragraphText: string
  paragraphHash: string
  previousText: string
  nextText: string
  sourceIndex: number
  sourceHash: string
}

export interface ChapterIllustration {
  id: string
  chapterId: string
  assetId: string
  width: number
  height: number
  caption: string
  size: 'medium' | 'full'
  anchor: IllustrationAnchor
  chapterRevision: string
  version: number
  order: number
  deleted: boolean
}

export function normalizeIllustrationText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Duplicate paragraphs require unique context after a chapter changes. Never guess. */
export function resolveIllustrationAnchor(anchor: IllustrationAnchor, paragraphs: string[], sameRevision: boolean): number | null {
  if (anchor.position === 'start') return -1
  if (anchor.position === 'end') return paragraphs.length
  const texts = paragraphs.map(normalizeIllustrationText)
  const target = normalizeIllustrationText(anchor.paragraphText)
  if (sameRevision && texts[anchor.paragraphIndex] === target) return anchor.paragraphIndex
  const matches = texts.flatMap((text, index) => (text === target ? [index] : []))
  if (matches.length === 1) return matches[0]!
  const contextual = matches.filter(
    (index) =>
      (texts[index - 1] || '') === normalizeIllustrationText(anchor.previousText) && (texts[index + 1] || '') === normalizeIllustrationText(anchor.nextText),
  )
  return contextual.length === 1 ? contextual[0]! : null
}
