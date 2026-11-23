import { createHash } from 'node:crypto'
import type { AgentEvidence, AgentSession } from '@shared/ai-agent'
import { ANALYSIS_KINDS, type WritingAnalysisReference } from '@shared/novel-analysis'
import type { Db, DbClient } from '../../db/pool'
import { all, first } from '../../db/query'
import { escapeLike } from '../text'
import { AiError } from './client'
import { getAnalysisReferences, listAnalysisReferences, readAnalysisReference } from './analysis-reference'
import { findExplicitAliasPairs } from './story-ledger-integrity'

const CHAPTER_BATCH = 6
const MAX_SOURCES = 10
const EXCERPT_LENGTH = 900
const splitTerms = (value: string) => [...new Set(value.trim().split(/[\s,，、;；]+/u).filter(Boolean))]
type Chapter = { id: string; title: string; content: string; sort_order: number }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sessionPublication = `EXISTS (SELECT 1 FROM ai_agent_artifacts a WHERE a.session_id=$2 AND a.task_id=c.ai_task_id)`

// A session may edit chapters it published after its anchor without advancing its continuation context.
const editableInSession = `(
  EXISTS (SELECT 1 FROM chapters anchor WHERE anchor.id=$3 AND anchor.novel_id=c.novel_id
    AND (c.sort_order,c.id)<=(anchor.sort_order,anchor.id))
  OR ${sessionPublication}
)`

export async function scopedEditableChapter(db: DbClient, session: AgentSession, chapterId: string, lock = false) {
  const row = await first<Chapter>(db,
    `SELECT c.id,c.title,c.content,c.sort_order FROM chapters c
     WHERE c.novel_id=$1 AND c.id=$4 AND ${editableInSession}${lock ? ' FOR UPDATE OF c' : ''}`,
    [session.novelId, session.id, session.afterChapterId, chapterId])
  if (!row) throw new AiError('invalid', '章节不存在或不在当前对话的可编辑范围内', 404)
  return row
}

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

export async function findAgentChapter(db: Db, session: AgentSession, ordinal?: number, title = '', order?: number, forEdit = false) {
  const name = title.trim()
  if ([ordinal !== undefined, !!name, order !== undefined].filter(Boolean).length !== 1)
    throw new AiError('invalid', '请只提供目录位置、页面显示章号或章名中的一项', 422)
  const anchor = forEdit ? null : await agentAnchor(db, session)
  if (!forEdit && !anchor) return { matches: [], hasMore: false }
  const matches = await all<{ id: string; title: string; ordinal: number; order: number; exactTitle: boolean }>(db,
    `WITH directory AS (
       SELECT c.id,c.novel_id,c.title,c.sort_order,c.ai_task_id,ROW_NUMBER() OVER (ORDER BY sort_order,id)::int AS ordinal
       FROM chapters c WHERE novel_id=$1
     )
     SELECT id,title,ordinal,sort_order AS "order",LOWER(TRIM(title))=LOWER($6) AS "exactTitle" FROM directory c
     WHERE ${forEdit ? editableInSession : '(c.sort_order,c.id)<=($2::int,$3)'}
       AND (ordinal=$4 OR sort_order=$5 OR ($4 IS NULL AND $5 IS NULL AND title ILIKE $7 ESCAPE '\\'))
     ORDER BY "exactTitle" DESC,ordinal LIMIT 11`,
    [session.novelId, forEdit ? session.id : anchor?.order, forEdit ? session.afterChapterId : anchor?.id,
      ordinal ?? null, order ?? null, name, `%${escapeLike(name)}%`])
  return { matches: matches.slice(0, 10), hasMore: matches.length > 10 }
}

export async function readAgentChapter(db: Db, session: AgentSession, chapterId: string, offset = 0, expectedRevision = '', quote = '', forEdit = false) {
  const anchor = forEdit ? null : await agentAnchor(db, session)
  const row = forEdit ? await scopedEditableChapter(db, session, chapterId) : anchor
    ? await first<Chapter>(db, 'SELECT id,title,content,sort_order FROM chapters WHERE id=$1 AND novel_id=$2 AND (sort_order,id)<=($3,$4)', [
        chapterId,
        session.novelId,
        anchor.order,
        anchor.id,
      ])
    : undefined
  if (!row) throw new AiError('invalid', '章节不在当前小说与起点范围内', 404)
  if (offset > row.content.length) throw new AiError('invalid', '读取位置超出章节长度，请从头重新读取', 422)
  const revision = chapterEvidence(session, row).revision
  if (expectedRevision && revision !== expectedRevision) throw new AiError('conflict', '章节已变化，请重新检索后读取', 409)
  const quoteOffset = quote ? row.content.indexOf(quote, offset) : -1
  if (quote) {
    if (quoteOffset < 0 || quote.length > 240) throw new AiError('invalid', '未在该范围找到逐字引文，请重新查阅原文', 422)
    offset = Math.max(0, quoteOffset - 220)
  }
  if (offset > 0 && /[\uDC00-\uDFFF]/u.test(row.content[offset]!)) offset--
  let end = Math.min(row.content.length, offset + 12000)
  if (end < row.content.length && /[\uDC00-\uDFFF]/u.test(row.content[end]!)) end--
  const source = chapterEvidence(session, row, offset)
  return {
    id: row.id,
    title: row.title,
    content: row.content.slice(offset, end),
    offset,
    ...(quote ? { quoteOffset, quoteRepeated: row.content.indexOf(quote) !== quoteOffset || row.content.indexOf(quote, quoteOffset + 1) >= 0 } : {}),
    revision: source.revision,
    url: chapterEvidenceUrl(source),
    nextOffset: end < row.content.length ? end : null,
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

async function aliasChapterMatches(db: Db, session: AgentSession, anchor: { id: string; order: number }, terms: string[]) {
  if (!terms.length) return []
  const rows = await all<Chapter>(db,
    `SELECT id,title,content,sort_order FROM chapters WHERE novel_id=$1 AND (sort_order,id)<=($2,$3)
      AND char_length(content)<=80000 AND content ILIKE ANY($4::text[])
      AND content ~ '又名|别名|化名|也叫|人称|唤作|原名|本名|真名'
      ORDER BY sort_order DESC,id DESC LIMIT 24`,
    [session.novelId, anchor.order, anchor.id, terms.map(term => `%${escapeLike(term)}%`)])
  const wanted = new Set(terms)
  return rows.flatMap(row => findExplicitAliasPairs(row.content, wanted).map(pair => ({ ...pair, row })))
}

async function verifiedSearchAliases(db: Db, session: AgentSession, anchor: { id: string; order: number }, terms: string[]) {
  const names = new Set(terms)
  const matches = await aliasChapterMatches(db, session, anchor, terms.filter(term => term.length >= 2 && term.length <= 20))
  const possible = [...new Set(matches.map(pair => names.has(pair.name) ? pair.alias : pair.name))]
    .filter(term => !names.has(term)).slice(0, 6)
  if (!possible.length) return []
  const allowed = new Set(possible)
  const peers = await aliasChapterMatches(db, session, anchor, possible)
  const ambiguous = new Set<string>()
  const owners = new Map<string, string>()
  for (const { alias, name } of [...matches, ...peers]) {
    const owner = owners.get(alias)
    if (owner && owner !== name) ambiguous.add(alias)
    owners.set(alias, name)
  }
  const seen = new Set<string>()
  return matches.flatMap(({ row, name, alias, quote, offset }) => {
    const term = names.has(name) ? alias : name
    if (!allowed.has(term) || ambiguous.has(alias) || seen.has(term)) return []
    seen.add(term)
    return [{ term, name, alias, quote, source: chapterEvidence(session, row, offset) }]
  })
}

/** Bounded original-text retrieval with optional plot terms and directory order. */
export async function searchAgentStory(
  db: Db,
  session: AgentSession,
  query: string,
  kind: 'all' | 'chapter' | 'analysis' = 'all',
  chapterOffset = 0,
  literalPhrase = false,
  options: { related?: string; order?: 'relevance' | 'earliest' } = {},
) {
  const terms = literalPhrase ? [query.trim()].filter(Boolean) : splitTerms(query)
  if (!terms.length || terms.length > 6 || query.length > 160) throw new AiError('invalid', '请用 1–6 个关键词检索，用空格分开，总长不超过 160 字', 422)
  const related = literalPhrase ? [] : splitTerms(options.related || '')
  if (related.length > 4 || (options.related?.length || 0) > 100)
    throw new AiError('invalid', '相关情节词最多 4 个，总长不超过 100 字', 422)
  const anchor = await agentAnchor(db, session)
  const aliases = anchor && !literalPhrase && kind !== 'analysis' ? await verifiedSearchAliases(db, session, anchor, terms) : []
  const aliasTerms = aliases.map(alias => alias.term)
  const contextTerms = related.filter(term => !terms.includes(term) && !aliasTerms.includes(term))
  const keywords = [
    ...terms.map(term => ({ term, textWeight: 5, titleWeight: 8 })),
    ...aliasTerms.map(term => ({ term, textWeight: 4, titleWeight: 6 })),
    ...contextTerms.map(term => ({ term, textWeight: 2, titleWeight: 3 })),
  ]
  const byChapter = options.order === 'earliest' && !literalPhrase && kind !== 'analysis'
  const chapterRanks = new Map<string, number>()
  const candidates: Array<{ source: AgentEvidence; score: number }> = []
  const analyses: Array<{ id: string; kind: string; revision: number }> = []
  let analysisLimited = false
  let matchingChapters = 0,
    selectedChapters = 0
  const patterns = keywords.map(keyword => ({ ...keyword, pattern: new RegExp(keyword.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') }))
  const score = (text: string, title = '') => patterns.reduce((sum, { pattern, textWeight, titleWeight }) =>
    sum + (pattern.test(text) ? textWeight : 0) + (pattern.test(title) ? titleWeight : 0), 0)
  let omittedPassages = 0
  function passages(text: string, title: string, create: (offset: number) => AgentEvidence, max = 2) {
    // Bounded candidate windows; regex indices preserve original UTF-16 offsets.
    const positions: number[] = []
    for (const { pattern } of patterns) {
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
    const clauses = keywords.map((_, index) => `(title ILIKE $${index + 4} ESCAPE '\\' OR content ILIKE $${index + 4} ESCAPE '\\')`)
    const ranking = keywords
      .map(
        ({ titleWeight, textWeight }, index) =>
          `(CASE WHEN title ILIKE $${index + 4} ESCAPE '\\' THEN ${titleWeight} ELSE 0 END + CASE WHEN content ILIKE $${index + 4} ESCAPE '\\' THEN ${textWeight} ELSE 0 END)`,
      )
      .join(' + ')
    const values = [session.novelId, anchor.order, anchor.id, ...keywords.map(({ term }) => `%${escapeLike(term)}%`)]
    const order = byChapter ? 'sort_order ASC,id ASC' : `(${ranking}) DESC,sort_order DESC,id DESC`
    const rows = await all<Chapter & { total: number }>(
      db,
      `SELECT id,title,content,sort_order,COUNT(*) OVER()::int AS total FROM chapters
       WHERE novel_id=$1 AND (sort_order,id)<=($2,$3) AND (${clauses.join(' OR ')})
       ORDER BY ${order} LIMIT ${CHAPTER_BATCH} OFFSET $${keywords.length + 4}`,
      [...values, chapterOffset],
    )
    matchingChapters = Number(rows[0]?.total || 0)
    if (!rows.length && chapterOffset)
      matchingChapters = Number(
        (
          await first<{ total: number }>(
            db,
            `SELECT COUNT(*)::int AS total FROM chapters WHERE novel_id=$1 AND (sort_order,id)<=($2,$3) AND (${clauses.join(' OR ')})`,
            values,
          )
        )?.total || 0,
      )
    selectedChapters = rows.length
    // One passage per chapter ensures every selected chapter is returned; pagination
    // never skips candidates merely because the combined evidence budget was full.
    for (const [rank, row] of rows.entries()) {
      chapterRanks.set(row.id, rank)
      passages(row.content, row.title, (offset) => chapterEvidence(session, row, offset), 1)
    }
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
    (a, b) => (byChapter ? (chapterRanks.get(a.source.chapterId || '') ?? CHAPTER_BATCH) - (chapterRanks.get(b.source.chapterId || '') ?? CHAPTER_BATCH) : 0) ||
      b.score - a.score || Number(b.source.kind === 'chapter') - Number(a.source.kind === 'chapter') || a.source.id.localeCompare(b.source.id),
  )
  const sources = candidates.slice(0, MAX_SOURCES - Math.min(aliases.length, 2)).map((candidate) => candidate.source)
  const resultCount = sources.length
  for (const { source } of aliases.slice(0, 2)) {
    if (!sources.some(candidate => candidate.id === source.id)) sources.push(source)
  }
  return {
    query,
    terms,
    sources,
    analyses,
    analysisLimited,
    matchingChapters,
    examinedChapters: selectedChapters,
    nextChapterOffset: matchingChapters > chapterOffset + selectedChapters ? chapterOffset + selectedChapters : null,
    omittedPassages: omittedPassages + Math.max(0, candidates.length - resultCount),
    limited: true,
    method: aliases.length || contextTerms.length ? 'expanded_keywords' : 'literal_keywords',
    ...(byChapter ? { order: 'earliest' as const } : {}),
    ...(contextTerms.length ? { relatedTerms: contextTerms } : {}),
    ...(aliases.length ? { aliases: aliases.map(({ name, alias, quote, source }) => ({
      name, alias, quote, chapterId: source.chapterId, revision: source.revision, offset: source.offset,
    })) } : {}),
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
