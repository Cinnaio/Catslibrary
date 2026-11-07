import type { BookImportPayload } from '@shared/types'

const MARKER = '知舟书籍导出 v1'
const line = (value: string) =>
  value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\u0000/g, '')
    .trim()
const indent = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((part) => '    ' + part)
    .join('\n')

/** Explicit numbered boundaries and indented bodies remain readable in plain-text readers. */
export function formatExportText(book: { title: string; author: string; description: string }, chapters: Array<{ title: string; content: string }>): string {
  return [
    MARKER,
    `书名：${line(book.title)}`,
    `作者：${line(book.author) || '未知作者'}`,
    '简介：',
    indent(book.description),
    '',
    ...chapters.flatMap((chapter, index) => [`第${index + 1}章 ${line(chapter.title)}`, indent(chapter.content), '']),
  ].join('\n')
}

/** Only our explicit format bypasses heuristic heading detection. No instruction in the text is executed. */
export function parseExportText(
  input: string,
): { payload: BookImportPayload; boundaries: number[]; ranges: Array<{ startLine: number; endLine: number }> } | null {
  const lines = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  if (lines[0] !== MARKER || !lines[1]?.startsWith('书名：') || !lines[2]?.startsWith('作者：') || lines[3] !== '简介：') return null
  const payload: BookImportPayload = { title: lines[1].slice(3), author: lines[2].slice(3), description: '', chapters: [] }
  const boundaries: number[] = []
  const ranges: Array<{ startLine: number; endLine: number }> = []
  let body: string[] = []
  const description: string[] = []
  const flush = () => {
    if (payload.chapters.length) payload.chapters[payload.chapters.length - 1]!.content = body.join('\n')
    body = []
  }
  for (let index = 4; index < lines.length; index++) {
    const raw = lines[index]!
    const match = raw.match(/^第([1-9]\d*)章 (.*)$/)
    if (match && Number(match[1]) === payload.chapters.length + 1) {
      flush()
      if (ranges.length) ranges[ranges.length - 1]!.endLine = index
      payload.chapters.push({ title: match[2]!, order: Number(match[1]), content: '' })
      boundaries.push(index + 1)
      ranges.push({ startLine: index + 1, endLine: lines.length })
    } else if (raw.startsWith('    ')) {
      if (payload.chapters.length) body.push(raw.slice(4))
      else description.push(raw.slice(4))
    } else if (raw.trim()) {
      // A damaged or manually reformatted file should use the normal parser rather than silently lose lines.
      return null
    }
  }
  flush()
  payload.description = description.join('\n')
  return { payload, boundaries, ranges }
}
