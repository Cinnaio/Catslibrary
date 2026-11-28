import type { SourceThoughtPage } from '@shared/source-thoughts'
import { hashParagraphText } from '@shared/thought-anchor'
import { removeAdPatterns } from '@shared/ad-cleaner'

export interface SourceThoughtContext { chapterUrl: string; bookUrl: string }
export interface SourceParagraph { index: number; text: string; count: number }
export interface SourceThoughtProvider {
  enabled(): boolean
  paragraphs(context: SourceThoughtContext): Promise<SourceParagraph[]>
  comments(context: SourceThoughtContext, paragraph: SourceParagraph, cursor: string): Promise<SourceThoughtPage>
  replies(context: SourceThoughtContext, commentId: string, cursor: string): Promise<SourceThoughtPage>
}
export function sourceThoughtParagraphs(content: string): string[] {
  const text = removeAdPatterns(content)
  // Existing imports are plain text; HTML chapters need the same paragraph boundaries as the reader.
  if (/<[a-z][\s\S]*>/i.test(text)) return Array.from(text.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), m => m[1]!
    .replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
      if (entity.startsWith('#')) {
        const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
      }
      return ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()] || ''
    }).trim())
  return text.replace(/\r\n?/g, '\n').split(/\n+/).map(t => t.trim()).filter(Boolean)
}
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
/** Equal revisions keep positional identity; edited chapters require an unambiguous text/context match. */
export function matchSourceParagraphs(content: string, source: SourceParagraph[]) {
  const local = sourceThoughtParagraphs(content).map(normalize)
  const remote = source.map(p => normalize(p.text))
  const same = local.length === remote.length && local.every((text, i) => text === remote[i])
  const byText = new Map<string, number[]>()
  remote.forEach((text, i) => { const indices = byText.get(text) || []; indices.push(i); byText.set(text, indices) })
  const matches = local.map((text, paragraphIndex) => {
    let candidates = same ? [paragraphIndex] : text ? byText.get(text) || [] : []
    if (!same && candidates.length > 1) candidates = candidates.filter(i =>
      paragraphIndex > 0 && i > 0 && local[paragraphIndex - 1] === remote[i - 1] &&
      paragraphIndex + 1 < local.length && i + 1 < remote.length && local[paragraphIndex + 1] === remote[i + 1])
    return candidates.length === 1 ? { paragraphIndex, paragraphHash: hashParagraphText(text), source: source[candidates[0]!]! } : null
  })
  // A repeated inserted paragraph must not share a source anchor with an existing paragraph.
  const uses = new Map<number, number>()
  for (const match of matches) if (match) uses.set(match.source.index, (uses.get(match.source.index) || 0) + 1)
  return matches.filter((m): m is NonNullable<typeof m> => m !== null).filter(m => uses.get(m.source.index) === 1)
}
