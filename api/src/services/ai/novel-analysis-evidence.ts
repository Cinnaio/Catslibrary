import { createHash } from 'node:crypto'
import type { AnalysisEvidenceCheck, AnalysisEvidenceItem, AnalysisEvidenceMatch, AnalysisSource } from '@shared/novel-analysis'

export const ANALYSIS_CHECKER_VERSION = 'evidence-1'
export const analysisContentHash = (content: string) => createHash('sha256').update(content).digest('hex')
export const analysisSourceFingerprint = (sources: Omit<AnalysisSource, 'text'>[]) => analysisContentHash(JSON.stringify(
  sources.map(s => [s.id, s.chapterId, s.revision, s.offset, s.endOffset, s.part, s.chapterTitle, s.chapterOrdinal])))
export const citedAnalysisSources = (text: string) => [...new Set([...text.matchAll(/\[\[(S\d+)\]\]/g)].map(m => m[1]!))]

/** Join only contiguous pieces of the same frozen chapter, never adjacent chapters. */
export function analysisSourceRuns(sources: AnalysisSource[]) {
  const runs: Array<{ sources: AnalysisSource[]; text: string }> = []
  for (const source of sources) {
    const run = runs.at(-1), last = run?.sources.at(-1)
    if (run && last && last.chapterId === source.chapterId && last.revision === source.revision && last.endOffset === source.offset) {
      run.sources.push(source); run.text += source.text
    } else runs.push({ sources: [source], text: source.text })
  }
  return runs
}

export function findAnalysisQuote(quote: string, sources: AnalysisSource[], limit = 6): AnalysisEvidenceMatch[] {
  return findInRuns(quote, analysisSourceRuns(sources), limit)
}
function findInRuns(quote: string, runs: ReturnType<typeof analysisSourceRuns>, limit: number): AnalysisEvidenceMatch[] {
  const matches: AnalysisEvidenceMatch[] = []
  if (!quote) return matches
  for (const run of runs) {
    let at = run.text.indexOf(quote)
    while (at >= 0) {
      const first = run.sources[0]!, start = first.offset + at, end = start + quote.length
      matches.push({ sourceIds: run.sources.filter(s => s.offset < end && s.endOffset > start).map(s => s.id),
        chapterId: first.chapterId, chapterTitle: first.chapterTitle, start, end, quote })
      if (matches.length >= limit) return matches
      at = run.text.indexOf(quote, at + 1)
    }
  }
  return matches
}

/** Literal provenance only. A match never certifies the surrounding interpretation. */
export function checkAnalysisEvidence(content: string, sources: AnalysisSource[]): AnalysisEvidenceCheck {
  const quotes = [...content.matchAll(/“([^”\n]+)”|「([^」\n]+)」|"([^"\n]+)"|^>\s?([^\n]+)$/gm)]
  const runs = analysisSourceRuns(sources)
  const items: AnalysisEvidenceItem[] = []
  for (const [index, match] of quotes.slice(0, 200).entries()) {
    const blockCitations = match[4]?.match(/\s*((?:\[\[S\d+\]\]\s*)+)$/)?.[1]
    const quote = (match[1] ?? match[2] ?? match[3] ?? (blockCitations ? match[4]!.slice(0, -blockCitations.length) : match[4]) ?? '').trim()
    const start = match.index!, end = start + match[0].length
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const nextLine = content.indexOf('\n', end)
    const nextQuote = quotes[index + 1]?.index ?? content.length
    // Assign the first following citation cluster only; a later quote cannot lend its source.
    const after = content.slice(end, Math.min(nextLine < 0 ? content.length : nextLine, nextQuote))
    const cluster = after.match(/^\s*(?:[，。；：,.!！?？:;]\s*)?((?:\[\[S\d+\]\]\s*)+)/)?.[1]
    const before = content.slice(lineStart, start)
    const prefix = before.match(/((?:\[\[S\d+\]\]\s*)+)[:：]?\s*$/)?.[1]
    const directIds = citedAnalysisSources(blockCitations || cluster || prefix || '')
    // Older prose sometimes cites several quotes only at the sentence end. Such a
    // group can reveal a wrong chapter, but cannot certify each quote's attribution.
    const sentenceTail = content.slice(end, nextLine < 0 ? content.length : nextLine)
      .replace(/“[^”]*”|「[^」]*」|"[^"]*"/g, '').split(/[。！？]/u)[0] || ''
    const citedSourceIds = directIds.length ? directIds : citedAnalysisSources(sentenceTail)
    const conceptual = /(?:主题|概念|术语|意象|风格|命题|标题|关键词)(?:是|为|叫作|称为|可概括为)?[：:\s]*$/.test(before)
      || /(?:所谓|称为)[：:\s]*$/.test(before)
    const explicit = !!match[4] || /(?:原文|原句|写道|说道|说|问出|问|回答|答|道|提到|引文|记载|给出|补了一句)[：:\s]*$/.test(before)
      || (!!directIds.length && quote.length >= 6)
    // Check the named sources BEFORE applying a global candidate cap. A common
    // sentence in six earlier chapters must not hide its explicitly cited source.
    const attributed = quote.length <= 4000 ? findInRuns(quote, analysisSourceRuns(sources.filter(s => citedSourceIds.includes(s.id))), 6) : []
    const matches = attributed.length ? attributed : quote.length <= 4000 ? findInRuns(quote, runs, 6) : []
    const invalidSource = citedSourceIds.some(id => !sources.some(s => s.id === id))
    const status: AnalysisEvidenceItem['status'] = conceptual || !explicit || quote.length > 4000 ? 'uncertain'
      : !citedSourceIds.length ? 'missing_source'
      : invalidSource ? 'wrong_source'
      : attributed.length > 1 ? 'ambiguous'
      : attributed.length === 1 ? (directIds.length ? 'matched' : 'uncertain')
      : matches.length > 1 ? 'ambiguous'
      : matches.length ? 'wrong_source' : 'not_found'
    items.push({ id: `Q${index + 1}`, start, end, quote, citedSourceIds, status,
      matches: attributed.length ? attributed : matches })
  }
  return { checkerVersion: ANALYSIS_CHECKER_VERSION, contentHash: analysisContentHash(content), sourceFingerprint: analysisSourceFingerprint(sources),
    coverage: quotes.length > items.length || items.some(i => i.quote.length > 4000) ? 'partial' : 'complete',
    scannedQuotes: items.length, totalQuotes: quotes.length, items }
}
