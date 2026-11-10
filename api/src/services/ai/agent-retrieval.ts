import { createHash } from 'node:crypto'
import type { AgentEvidence, AgentSession } from '@shared/ai-agent'
import { ANALYSIS_KINDS, type WritingAnalysisReference } from '@shared/novel-analysis'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { escapeLike } from '../text'
import { AiError } from './client'
import { getAnalysisReferences, listAnalysisReferences, readAnalysisReference } from './analysis-reference'

const CHAPTER_BATCH = 6
const MAX_SOURCES = 10
const EXCERPT_LENGTH = 900
type Chapter = { id: string; title: string; content: string; sort_order: number }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Directory ordering uses the id tie-breaker too. An empty anchor stays empty. */
export async function agentAnchor(db: Db, session: AgentSession) {
  if (!session.afterChapterId) return null
  const anchor = await first<{ id: string; sort_order: number }>(db, 'SELECT id,sort_order FROM chapters WHERE id=$1 AND novel_id=$2', [
    session.afterChapterId,
    session.novelId,
  ])
  if (!anchor) throw new AiError('conflict', '此对话的续写起点已删除，请新建对话选择起点', 409)
  return { id: anchor.id, order: Number(anchor.sort_order) }
}

function snapshot(input: Omit<AgentEvidence, 'id' | 'endOffset' | 'excerpt' | 'truncated'>, text: string, length = EXCERPT_LENGTH): AgentEvidence {
  const endOffset = Math.min(text.length, input.offset + length)
  return {
    ...input,
    id: hash([input.novelId, input.kind, input.chapterId, input.reportId, input.revision, input.offset, endOffset]).slice(0, 24),
    endOffset,
    excerpt: text.slice(input.offset, endOffset),
    truncated: input.offset > 0 || endOffset < text.length,
  }
}

export function chapterEvidence(session: AgentSession, chapter: Chapter, offset = 0): AgentEvidence {
  return snapshot(
    {
      kind: 'chapter',
      novelId: session.novelId,
      chapterId: chapter.id,
      title: chapter.title,
      origin: 'published',
      revision: hash([chapter.id, chapter.title, chapter.sort_order, chapter.content]),
      offset,
    },
    chapter.content,
  )
}

function analysisEvidence(session: AgentSession, report: WritingAnalysisReference, offset = 0): AgentEvidence {
  return snapshot(
    {
      kind: 'analysis',
      novelId: session.novelId,
      reportId: report.id,
      reportRevision: report.revision,
      title: ANALYSIS_KINDS[report.kind],
      origin: report.edited ? 'manual' : 'automatic',
      revision: String(report.revision),
      offset,
      fromChapter: report.startChapter,
      throughChapter: report.endChapter,
    },
    report.content,
  )
}

export const chapterEvidenceUrl = (source: AgentEvidence) =>
  source.kind === 'chapter' && source.chapterId ? `/read/${encodeURIComponent(source.novelId)}/${encodeURIComponent(source.chapterId)}` : undefined

export async function readAgentChapter(db: Db, session: AgentSession, chapterId: string, offset = 0, expectedRevision = '') {
  const anchor = await agentAnchor(db, session)
  const row = anchor
    ? await first<Chapter>(db, 'SELECT id,title,content,sort_order FROM chapters WHERE id=$1 AND novel_id=$2 AND (sort_order,id)<=($3,$4)', [
        chapterId,
        session.novelId,
        anchor.order,
        anchor.id,
      ])
    : undefined
  if (!row) throw new AiError('invalid', '章节不在当前小说与起点范围内', 404)
  if (offset > row.content.length) throw new AiError('invalid', '读取位置超出章节长度，请从头重新读取', 422)
  const source = chapterEvidence(session, row, offset)
  if (expectedRevision && source.revision !== expectedRevision) throw new AiError('conflict', '章节已变化，请重新检索后读取', 409)
  return {
    id: row.id,
    title: row.title,
    content: row.content.slice(offset, offset + 12000),
    offset,
    revision: source.revision,
    url: chapterEvidenceUrl(source),
    nextOffset: offset + 12000 < row.content.length ? offset + 12000 : null,
    sources: [source],
  }
}

export async function listAgentAnalyses(db: Db, session: AgentSession, offset = 0) {
  return { ...await listAnalysisReferences(db, session.novelId, session.afterChapterId, offset),
    scope: '只读分析报告目录。usable=false 的报告不可作为当前起点的创作依据。没有可用报告时仍可搜索和读取正式章节，不会自动创建分析。' }
}

export async function readAgentAnalysis(db: Db, session: AgentSession, reportId: string, offset = 0, expectedRevision = '') {
  if (expectedRevision && (!/^\d+$/.test(expectedRevision) || !Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 1))
    throw new AiError('invalid', '分析报告版本无效，请重新读取目录', 422)
  const report = await readAnalysisReference(db, session.novelId, session.afterChapterId, reportId, expectedRevision ? Number(expectedRevision) : undefined)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > report.content.length) throw new AiError('invalid', '读取位置超出报告长度，请从头重新读取', 422)
  const content = report.content.slice(offset, offset + 10000)
  const cited = new Set([...content.matchAll(/\[\[(S\d+)\]\]/g)].map(match => match[1]))
  return { id: report.id, kind: report.kind, content, revision: String(report.revision), edited: report.edited,
    review: report.review,
    startChapter: report.startChapter, endChapter: report.endChapter, offset,
    nextOffset: offset + 10000 < report.content.length ? offset + 10000 : null,
    sources: [analysisEvidence(session, report, offset)],
    citations: report.sources.filter(source => cited.has(source.id)).map(source => ({ sourceId: source.id, chapterId: source.chapterId,
      chapterTitle: source.chapterTitle, part: source.part, url: `/read/${encodeURIComponent(session.novelId)}/${encodeURIComponent(source.chapterId)}` })),
    scope: '报告为分析材料，包含推断和人工修订；章节范围并非逐句出处。重要判断按 citations 用 read_chapter 核对原文。' }
}

/** Lexical retrieval with bounded output; never claims semantic/exhaustive coverage. */
export async function searchAgentStory(
  db: Db,
  session: AgentSession,
  query: string,
  kind: 'all' | 'chapter' | 'analysis' = 'all',
  chapterOffset = 0,
  literalPhrase = false,
) {
  const terms = [...new Set((literalPhrase ? [query.trim()] : query.trim().split(/[\s,，、;；]+/u)).filter(Boolean))]
  if (!terms.length || terms.length > 6 || query.length > 160) throw new AiError('invalid', '请用 1–6 个关键词检索，用空格分开，总长不超过 160 字', 422)
  const anchor = await agentAnchor(db, session)
  const candidates: Array<{ source: AgentEvidence; score: number }> = []
  const analyses: Array<{ id: string; kind: string; revision: number }> = []
  let analysisLimited = false
  let matchingChapters = 0,
    selectedChapters = 0
  const patterns = terms.map((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'))
  const score = (text: string, title = '') => patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 5 : 0) + (pattern.test(title) ? 8 : 0), 0)
  let omittedPassages = 0
  function passages(text: string, title: string, create: (offset: number) => AgentEvidence, max = 2) {
    // Bounded candidate windows; regex indices preserve original UTF-16 offsets.
    const positions: number[] = []
    for (const pattern of patterns) {
      let count = 0
      for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
        positions.push(Math.max(0, match.index! - 180))
        if (++count === 6) break
      }
    }
    const starts = [...new Set(positions)]
    if (!starts.length && score('', title)) starts.push(0)
    const windows = starts
      .map((start) => ({ source: create(start), score: score(text.slice(start, start + EXCERPT_LENGTH), title) }))
      .sort((a, b) => b.score - a.score || a.source.offset - b.source.offset)
    const chosen: typeof windows = []
    for (const window of windows) {
      if (chosen.some((other) => window.source.offset < other.source.endOffset && other.source.offset < window.source.endOffset)) continue
      chosen.push(window)
    }
    omittedPassages += Math.max(0, chosen.length - max)
    candidates.push(...chosen.slice(0, max))
  }
  if (anchor && (kind === 'all' || kind === 'chapter')) {
    const clauses = terms.map((_, index) => `(title ILIKE $${index + 4} ESCAPE '\\' OR content ILIKE $${index + 4} ESCAPE '\\')`)
    const ranking = terms
      .map(
        (_, index) =>
          `(CASE WHEN title ILIKE $${index + 4} ESCAPE '\\' THEN 8 ELSE 0 END + CASE WHEN content ILIKE $${index + 4} ESCAPE '\\' THEN 5 ELSE 0 END)`,
      )
      .join(' + ')
    const rows = await all<Chapter & { total: number }>(
      db,
      `SELECT id,title,content,sort_order,COUNT(*) OVER()::int AS total FROM chapters
       WHERE novel_id=$1 AND (sort_order,id)<=($2,$3) AND (${clauses.join(' OR ')})
       ORDER BY (${ranking}) DESC,sort_order DESC,id DESC LIMIT ${CHAPTER_BATCH} OFFSET $${terms.length + 4}`,
      [session.novelId, anchor.order, anchor.id, ...terms.map((term) => `%${escapeLike(term)}%`), chapterOffset],
    )
    matchingChapters = Number(rows[0]?.total || 0)
    if (!rows.length && chapterOffset)
      matchingChapters = Number(
        (
          await first<{ total: number }>(
            db,
            `SELECT COUNT(*)::int AS total FROM chapters WHERE novel_id=$1 AND (sort_order,id)<=($2,$3) AND (${clauses.join(' OR ')})`,
            [session.novelId, anchor.order, anchor.id, ...terms.map((term) => `%${escapeLike(term)}%`)],
          )
        )?.total || 0,
      )
    selectedChapters = rows.length
    // One passage per chapter ensures every selected chapter is returned; pagination
    // never skips candidates merely because the combined evidence budget was full.
    for (const row of rows) passages(row.content, row.title, (offset) => chapterEvidence(session, row, offset), 1)
  }
  if (anchor && kind !== 'chapter') {
    const result = await getAnalysisReferences(db, session.novelId, session.afterChapterId)
    analysisLimited = result.limited
    for (const report of result.reports) {
      analyses.push({ id: report.id, kind: report.kind, revision: report.revision })
      passages(report.content, ANALYSIS_KINDS[report.kind], (offset) => analysisEvidence(session, report, offset))
    }
  }
  candidates.sort(
    (a, b) => b.score - a.score || Number(b.source.kind === 'chapter') - Number(a.source.kind === 'chapter') || a.source.id.localeCompare(b.source.id),
  )
  const sources = candidates.slice(0, MAX_SOURCES).map((candidate) => candidate.source)
  return {
    query,
    terms,
    sources,
    analyses,
    analysisLimited,
    matchingChapters,
    examinedChapters: selectedChapters,
    nextChapterOffset: matchingChapters > chapterOffset + selectedChapters ? chapterOffset + selectedChapters : null,
    omittedPassages: omittedPassages + Math.max(0, candidates.length - sources.length),
    limited: true,
    method: 'literal_keywords',
    scope: '仅当前作品、续写起点及之前章节，以及各主题最新可用分析报告（最多五份）。其他报告可用 list_novel_analyses 分页查阅。关键词匹配不等于穷尽相关事实；没有命中不代表正文不存在。报告是分析材料，重要事实须回读原文。',
    readMore: sources.map((source) => ({
      id: source.id,
      tool: source.kind === 'chapter' ? 'read_chapter' : 'read_novel_analysis',
      arguments: {
        ...(source.kind === 'chapter' ? { chapterId: source.chapterId } : { reportId: source.reportId }),
        offset: source.offset,
        expectedRevision: source.revision,
      },
      ...(chapterEvidenceUrl(source) ? { url: chapterEvidenceUrl(source) } : {}),
    })),
  }
}
