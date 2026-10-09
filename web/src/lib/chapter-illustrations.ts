import type { IllustrationAnchor } from '@shared/chapter-illustrations'
import { hashParagraphText } from '@shared/thought-anchor'

export function makeIllustrationAnchor(paragraphs: HTMLElement[], index: number): IllustrationAnchor {
  const paragraph = paragraphs[index]
  const text = paragraph?.textContent || ''
  return {
    position: index === -1 ? 'start' : index === paragraphs.length ? 'end' : 'after',
    paragraphIndex: index,
    paragraphText: text,
    paragraphHash: hashParagraphText(text),
    previousText: paragraphs[index - 1]?.textContent || '',
    nextText: paragraphs[index + 1]?.textContent || '',
    sourceIndex: Number(paragraph?.dataset.sourceParagraphIndex ?? index),
    sourceHash: paragraph?.dataset.sourceParagraphHash || hashParagraphText(text),
  }
}
