import type { AnalysisDraft, AnalysisDraftSection } from '@shared/novel-analysis'
import { AiError } from './client'

export type DraftStage = 'outline' | 'section' | 'split' | 'consistency'
const MAX_SECTIONS = 16
const MAX_DEPTH = 2
const MAX_SECTION_CHARS = 8_000
const MAX_REPORT_CHARS = 50_000
const invalid = (message: string) => new AiError('invalid', `${message}；已保存的目录和小节保留，可继续分析`, 422)

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('分节结果格式无效')
  return value as Record<string, unknown>
}
function json(text: string): Record<string, unknown> {
  try { return object(JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, ''))) }
  catch { throw invalid('模型未返回有效的分节结构') }
}
function string(value: unknown, max: number, trim = true): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid('分节内容为空或超过长度限制')
  return trim ? value.trim() : value
}
function sections(value: unknown, sources: Set<string>, prefix = '', depth = 0): AnalysisDraftSection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw invalid('目录需要包含 1–8 个小节')
  const titles = new Set<string>()
  return value.map((item, index) => {
    const row = object(item)
    const title = string(row.title, 80)
    if (/[\r\n]/.test(title) || titles.has(title)) throw invalid('小节标题重复或包含换行')
    titles.add(title)
    if (!Array.isArray(row.sourceIds) || row.sourceIds.length > 24 || row.sourceIds.some(id => typeof id !== 'string' || !sources.has(id)))
      throw invalid('目录包含范围外来源或过多来源')
    return { id: `${prefix}${index + 1}`, title, focus: string(row.focus, 600),
      sourceIds: [...new Set(row.sourceIds as string[])], depth, content: '' }
  })
}
function citations(text: string, sources: Set<string>) {
  for (const match of text.matchAll(/\[\[(S\d+)\]\]/g)) if (!sources.has(match[1]!)) throw invalid('小节包含范围外引用')
}
export function assembleAnalysisDraft(draft: AnalysisDraft): string {
  return draft.sections.map(section => `## ${section.title.replace(/[\\`*_{}[\]<>]/g, '\\$&')}\n\n${section.content}`).join('\n\n')
}
function withinReportLimit(draft: AnalysisDraft) {
  if (assembleAnalysisDraft(draft).length > MAX_REPORT_CHARS) throw invalid('分节报告合计超过 50000 字，请调整输出上限或分析范围')
}

/** Validate all edits against the same version, then apply atomically; never accept a whole-report rewrite. */
export function reconcileAnalysisDraft(draft: AnalysisDraft, text: string, sources: Set<string>): AnalysisDraft {
  const value = json(text)
  if (!Array.isArray(value.patches) || value.patches.length > 12) throw invalid('跨节核对需要返回至多 12 处局部修订')
  const edits = new Map<string, Array<{ start: number; end: number; after: string }>>()
  for (const item of value.patches) {
    const patch = object(item)
    const section = draft.sections.find(section => section.id === patch.sectionId)
    const before = string(patch.before, 1500, false)
    const after = string(patch.after, 1500, false)
    if (!section) throw invalid('跨节核对引用了不存在的小节')
    const start = section.content.indexOf(before)
    if (start < 0 || section.content.indexOf(before, start + 1) >= 0) throw invalid('跨节修订无法唯一定位原句')
    citations(after, sources)
    const changes = edits.get(section.id) || []
    if (changes.some(change => start < change.end && start + before.length > change.start)) throw invalid('跨节修订范围重叠')
    changes.push({ start, end: start + before.length, after })
    edits.set(section.id, changes)
  }
  const next: AnalysisDraft = { ...draft, review: 'completed', sections: draft.sections.map(section => {
    let content = section.content
    for (const change of (edits.get(section.id) || []).sort((a, b) => b.start - a.start))
      content = content.slice(0, change.start) + change.after + content.slice(change.end)
    return { ...section, content }
  }) }
  withinReportLimit(next)
  return next
}

export async function generateAnalysisDraft(options: {
  draft: AnalysisDraft | null
  sourceIds: string[]
  generate: (stage: DraftStage, material: Record<string, unknown>) => Promise<string>
  save: (draft: AnalysisDraft) => Promise<void>
  step: (message: string) => Promise<void>
}): Promise<AnalysisDraft> {
  const sources = new Set(options.sourceIds)
  let draft = options.draft
  const save = async (next: AnalysisDraft) => {
    withinReportLimit(next)
    await options.save(next)
    draft = next
  }
  if (!draft) {
    await options.step('正在规划报告目录')
    const outline = json(await options.generate('outline', {}))
    await save({ version: 1, overview: string(outline.overview, 2400), sections: sections(outline.sections, sources), review: 'pending' })
  }
  if (!draft || draft.version !== 1 || !draft.sections.length || draft.sections.length > MAX_SECTIONS) throw invalid('已保存的分节版本无效')
  while (draft.sections.some(section => !section.content)) {
    const section = draft.sections.find(section => section.id === draft!.splitSectionId) || draft.sections.find(section => !section.content)!
    if (draft.splitSectionId) {
      if (section.content || section.depth >= MAX_DEPTH || draft.sections.length >= MAX_SECTIONS)
        throw invalid('小节已达到拆分上限，请调高最终报告输出上限后继续')
      await options.step(`正在拆分过长小节：${section.title}`)
      const result = json(await options.generate('split', { overview: draft.overview, section,
        outline: draft.sections.map(({ content: _content, ...item }) => item) }))
      const children = sections(result.sections, sources, `${section.id}.`, section.depth + 1)
      if (children.length !== 2) throw invalid('过长小节需要拆成两个互补的小节')
      const next: AnalysisDraft = { ...draft, sections: draft.sections.flatMap(item => item.id === section.id ? children : [item]) }
      delete next.splitSectionId
      await save(next)
      continue
    }
    await options.step(`正在生成小节 ${draft.sections.filter(item => item.content).length + 1} / ${draft.sections.length}：${section.title}`)
    const remaining = draft.sections.filter(item => !item.content).length
    const maxChars = Math.min(MAX_SECTION_CHARS, Math.floor((MAX_REPORT_CHARS - 2000 - draft.sections.reduce((sum, item) => sum + item.content.length, 0)) / remaining))
    try {
      const text = await options.generate('section', { overview: draft.overview, section,
        outline: draft.sections.map(({ content: _content, ...item }) => item), maxChars })
      if (!text.trim()) throw invalid('模型返回了空的小节')
      if (text.length > maxChars) throw new AiError('truncated', '小节超过篇幅上限', 422)
      citations(text, sources)
      await save({ ...draft, sections: draft.sections.map(item => item.id === section.id ? { ...item, content: text.trim() } : item) })
    } catch (error) {
      if (!(error instanceof AiError) || error.code !== 'truncated' || section.depth >= MAX_DEPTH || draft.sections.length >= MAX_SECTIONS) throw error
      // Save split intent before requesting a new outline so resume never repeats the oversized section.
      await save({ ...draft, splitSectionId: section.id })
    }
  }
  if (draft.review !== 'completed') {
    await options.step('小节已全部保存，正在核对跨节一致性')
    const result = await options.generate('consistency', { overview: draft.overview, sections: draft.sections })
    await save(reconcileAnalysisDraft(draft, result, sources))
  }
  return draft
}
